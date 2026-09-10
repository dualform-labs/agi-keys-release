import streamDeck, { type DialAction, type KeyAction } from "@elgato/streamdeck";
import { join } from "node:path";
import { codexDeckStateRoot } from "./codex-deck-paths.js";
import { bridgeFailureCode } from "./bridge-error.js";
import { safeActionFailureCode, type ActionFailureCode } from "./action-feedback.js";
import { CodexMicroRendererBridge } from "./codex-micro-renderer-bridge.js";
import { focusCodexApp } from "./codex-focus.js";
import { feedbackDelta } from "./feedback-delta.js";
import {
  DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS,
  parseActionPreferences,
  streamDeckDisplayLanguage,
  type ActionPreferences,
} from "./action-preferences.js";
import { resolveEffectivePhysicalSlot } from "./effective-layout.js";
import { InputCoordinator, InputOwnedError } from "./input-coordination.js";
import { OFFICIAL_KEYCAP_IDS, type OfficialKeycapId } from "./keycaps.js";
import { LatestTaskQueue } from "./latest-task-queue.js";
import { readUserIconSvg } from "./user-icon.js";
import {
  customizeKeyImage,
  renderAgentKey,
  renderBuiltinKeycap,
  renderCatalogKeycap,
  renderFallbackKeycap,
  renderImportedKeycap,
  renderActionFeedback,
  renderKeyContact,
  operationFeedbackDetail,
  renderDialInteractionRibbon,
  renderDialSurface,
  dialInteractionValueColor,
  dialInteractionStrength,
  DIAL_INTERACTION_DURATION_MS,
  KEY_CONTACT_DURATION_MS,
  renderContextCompactionKey,
  renderRateLimitResetKey,
  renderPlusDialFeedback,
  renderUsageLimitKey,
  renderUsageOverviewKey,
  type BuiltinIconName,
  type DisplayLifecycleState,
  type MicroPlusFeedbackStatus,
  type OperationFeedback,
  type UsageFreshness
} from "./render.js";
import { visualStatusFromMicro } from "./status.js";
import type {
  HostHealth,
  MicroActionSlot,
  MicroAgentSlot,
  MicroDirection,
  MicroPlusDialKind,
  MicroLayout,
  MicroSnapshot,
  MutationConfirmation,
  ReasoningAdjustment,
  UsageLimitMode,
  UsageWindowKind
} from "./types.js";
import { selectUsageWindow } from "./usage.js";

export type FixedIconSource =
  | { kind: "local"; keycapId: string }
  | { kind: "builtin"; name: BuiltinIconName };

type FixedIconRegistration = { action: KeyAction; id: string; source: FixedIconSource };
type AgentRegistration = { action: KeyAction; slot: number };
type MicroActionRegistration = { action: KeyAction; slot: MicroActionSlot };
type UsageLimitRegistration = { action: KeyAction; mode: UsageLimitMode };
type ContextCompactionRegistration = { action: KeyAction };
type ContextCompactionFeedback = {
  state: "pending" | "confirmed" | "error";
  detail?: string;
  incarnation: number;
  sequence: number;
};
type ContextCompactionFeedbackToken = { actionId: string; incarnation: number; sequence: number };
type ContextCompactionFeedbackTimer = { handle: NodeJS.Timeout; token: ContextCompactionFeedbackToken };
type ContextCompactionFlight = { actionId: string; incarnation: number; promise: Promise<void> };
type RenderedAgentBinding = {
  action: KeyAction;
  incarnation: number;
  snapshotRevision: number;
  slot: number;
  threadKey: string;
};
type ContextCompactionTargetIdentity = {
  targetIdentity: string;
  activeThreadKey: string;
  activeComposerKey: string;
};
type PlusDialRegistration = { action: DialAction; kind: MicroPlusDialKind; layoutState: "pending" | "ready" | "error"; generation: number; layoutPath: string };
type ActionIdentity = { id: string };
type ContextRingSettings = { showContextRings?: boolean };
type FeedbackOperationToken = { actionId: string; incarnation: number; sequence: number };
type KeyContact = { owner: KeyAction; phase: "press" | "release"; startedAt: number };
type DisplayRenderFailureCode =
  | "E_RENDER_ANIMATED_ACTION"
  | "E_RENDER_AGENT"
  | "E_RENDER_MICRO_ACTION"
  | "E_RENDER_FIXED_ACTION"
  | "E_RENDER_USAGE_LIMIT"
  | "E_RENDER_USAGE_OVERVIEW"
  | "E_RENDER_RATE_RESET"
  | "E_RENDER_CONTEXT_COMPACTION"
  | "E_RENDER_PLUS_DIAL";

/** Native bridge contract for active-task compaction and its postcondition. */
export type ContextCompactionBridge = {
  compactActiveThread(): Promise<MutationConfirmation>;
};

const USER_ICON_ROOT = join(codexDeckStateRoot(), "icons");
const RESET_HOLD_MS = 1_200;
const DIAL_ROTATION_CUE_MS = DIAL_INTERACTION_DURATION_MS;
const DIAL_COMMANDS = ["TERM", "DIFF", "SETUP", "FOLD"] as const;
export const MICROPLUS_DIAL_LAYOUT = "static/layouts/microplus-dial.json";

const DISPLAY_COMMAND_KEYCAP_IDS = new Set<OfficialKeycapId>(
  OFFICIAL_KEYCAP_IDS.filter((id) => !(DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS as readonly string[]).includes(id)),
);

const CONTEXT_COMPACTION_FEEDBACK_RESET_MS = 1_400;

export type DialFailureCode = ActionFailureCode;

/** Preserve only reviewed bridge diagnostics; exception text never reaches logs or displays. */
export function safeDialFailureCode(error: unknown): DialFailureCode | "E_DIAL_UNKNOWN" {
  const code = safeActionFailureCode(error);
  return code === "E_ACTION_UNKNOWN" ? "E_DIAL_UNKNOWN" : code;
}

/**
 * Reject a physical action that the current Codex Micro layout explicitly
 * marks inactive.  The combined microphone layout owns both ACT10/ACT11
 * switches through ACT10_ACT11; dispatching a raw ACT11 event in that mode
 * would be accepted by the plugin but ignored by Codex.
 */
export function assertMicroActionDispatchable(layout: MicroLayout | undefined, slot: MicroActionSlot): void {
  if (slot === "ACT11" && layout?.separateMicrophoneKeys === false
    && resolveEffectivePhysicalSlot(layout, slot) == null) {
    throw new Error("E_MAPPING_INACTIVE");
  }
}

function refreshDialSnapshotInBackground(refresh: () => Promise<void>): void {
  setTimeout(() => {
    void refresh().catch(() => streamDeck.logger.warn("Dial snapshot refresh unavailable (E_DIAL_REFRESH)."));
  }, 0);
}

function contextCompactionTargetIdentity(snapshot: MicroSnapshot | undefined): ContextCompactionTargetIdentity | undefined {
  if (!snapshot?.targetIdentity || !snapshot.activeThreadKey || !snapshot.activeComposerKey) return undefined;
  return {
    targetIdentity: snapshot.targetIdentity,
    activeThreadKey: snapshot.activeThreadKey,
    activeComposerKey: snapshot.activeComposerKey,
  };
}

function isSameContextCompactionTarget(
  expected: ContextCompactionTargetIdentity,
  snapshot: MicroSnapshot | undefined,
): boolean {
  const current = contextCompactionTargetIdentity(snapshot);
  return current?.targetIdentity === expected.targetIdentity
    && current.activeThreadKey === expected.activeThreadKey
    && current.activeComposerKey === expected.activeComposerKey;
}

function isUnverifiedMutation(result: unknown): result is MutationConfirmation {
  return result != null
    && typeof result === "object"
    && (result as { semanticOutcome?: unknown }).semanticOutcome === "unverified";
}

export class DeckController {
  private readonly microBridge = new CodexMicroRendererBridge((message) => streamDeck.logger.info(message));
  private readonly agents = new Map<string, AgentRegistration>();
  /** Retain the agent ownership marker across disappearance to reject late downs. */
  private readonly agentActionIds = new Set<string>();
  private readonly microActions = new Map<string, MicroActionRegistration>();
  private readonly fixedActions = new Map<string, FixedIconRegistration>();
  private readonly usageLimitActions = new Map<string, UsageLimitRegistration>();
  private readonly usageOverviewActions = new Map<string, KeyAction>();
  private readonly contextCompactionActions = new Map<string, ContextCompactionRegistration>();
  private readonly contextCompactionFeedback = new Map<string, ContextCompactionFeedback>();
  private readonly contextCompactionFeedbackTimers = new Map<string, ContextCompactionFeedbackTimer>();
  private readonly rateLimitResetActions = new Map<string, KeyAction>();
  private readonly plusDials = new Map<string, PlusDialRegistration>();
  private readonly keycapImages = new Map<string, Promise<string>>();
  private readonly lastImages = new Map<string, string>();
  private readonly lastPlusFeedback = new Map<string, string>();
  private readonly resetHolds = new Map<string, number>();
  private readonly resetRequestIds = new Map<string, ReturnType<typeof crypto.randomUUID>>();
  private readonly inputs = new InputCoordinator();
  private readonly actionPreferences = new Map<string, ActionPreferences>();
  private focusApplication = focusCodexApp;
  private readonly visibleActionIds = new Set<string>();
  private readonly operationFeedback = new Map<string, OperationFeedback>();
  /** The latest press result remains available while its matching release is queued. */
  private readonly retainedPressResults = new Map<string, { token: FeedbackOperationToken; feedback: OperationFeedback }>();
  private readonly pressFeedbackTokens = new Map<string, FeedbackOperationToken>();
  /** Task identity represented by the last successfully sent agent image. */
  private readonly renderedAgentBindings = new Map<string, RenderedAgentBinding>();
  private readonly keyContacts = new Map<string, KeyContact>();
  private readonly feedbackRenderQueues = new Map<string, Promise<void>>();
  private readonly plusDialRenders = new LatestTaskQueue<object, object, PlusDialRegistration>();
  private readonly animatedActions = new LatestTaskQueue<string, object, () => Promise<void>>();
  private readonly feedbackSequences = new Map<string, number>();
  private readonly actionIncarnations = new Map<string, number>();
  private readonly keyRenders = new LatestTaskQueue<string, number, { value: string; expiredContact?: KeyContact }>();
  private readonly resetFeedbackTokens = new Map<string, FeedbackOperationToken>();
  private readonly displayOverrideOwners = new Set<string>();
  private readonly displayPttOwners = new Set<string>();
  private readonly activeRenderFailures = new Set<string>();
  private snapshot: MicroSnapshot | undefined;
  private health: HostHealth = { state: "connecting", reason: "awaiting-snapshot", changedAt: Date.now() };
  private poll?: NodeJS.Timeout;
  private animation: NodeJS.Timeout | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private usageRefreshInFlight: Promise<void> | undefined;
  private snapshotRevision = 0;
  private snapshotObservationSequence = 0;
  private committedSnapshotObservation = 0;
  private stopped = false;
  private animationFrame = 0;
  private readonly animationOrigin = Date.now();
  private animationDelay = 200;
  private lastError = "";
  private lastLayoutSignature = "";
  private showContextRings = true;
  private plusAgentSlot = 0;
  private readonly dialSelections = new Map<string, number>();
  private readonly lastPhysicalDialRotations = new Map<string, number>();
  private readonly lastPhysicalDialDirections = new Map<string, number>();
  private plusAgentSelectionInitialized = false;
  private lastReasoningAdjustment: ReasoningAdjustment | undefined;
  private readonly rotationQueues = new Map<string, Promise<void>>();
  private pulseSequence = 0;
  private plusDialGeneration = 0;
  private stopInFlight: Promise<void> | undefined;
  private contextCompactionInFlight: ContextCompactionFlight | undefined;

  setActionPreferences(actionId: string, settings: unknown): void {
    const previous = this.actionPreferences.get(actionId);
    const next = parseActionPreferences(settings, streamDeckDisplayLanguage());
    this.actionPreferences.set(actionId, next);
    if (next.animation === false) this.keyContacts.delete(actionId);
    const dial = this.plusDials.get(actionId);
    if (dial && (previous?.textSize !== next.textSize || previous?.theme !== next.theme)) this.registerPlusDial(dial.kind, dial.action);
    this.lastImages.delete(actionId);
    this.lastPlusFeedback.delete(actionId);
    void this.renderAll();
  }

  async prepareAction(actionId: string): Promise<void> {
    if (this.actionPreferences.get(actionId)?.focusBeforeAction) await this.focusApplication();
  }

  /** Runs the configured press behavior for keys whose primary purpose is display. */
  async pressDisplayAction(actionId: string): Promise<void> {
    const preferences = this.actionPreferences.get(actionId);
    switch (preferences?.pressBehavior ?? "none") {
      case "none":
        await this.trackDisplayOperation(actionId, () => this.prepareAction(actionId));
        return;
      case "disabled":
        await this.trackDisplayOperation(actionId, async () => undefined);
        return;
      case "refresh":
        await this.trackDisplayOperation(actionId, async () => {
          await this.prepareAction(actionId);
          await this.refresh();
        });
        return;
      case "focus":
        await this.trackDisplayOperation(actionId, () => this.focusApplication());
        return;
      case "ptt": {
        const slot = this.resolveMicrophoneSlot(actionId);
        this.displayPttOwners.add(actionId);
        await this.pressMicroAction(actionId, slot);
        return;
      }
      case "command": {
        const command = preferences?.pressCommand;
        if (!command || !DISPLAY_COMMAND_KEYCAP_IDS.has(command)) {
          await this.setOperationFeedback(actionId, { phase: "error", detail: "E_DISPLAY_PRESS_COMMAND_INVALID" });
          throw new Error("E_DISPLAY_PRESS_COMMAND_INVALID");
        }
        await this.runKeycap(command, actionId);
        return;
      }
      case "model-next":
        await this.rotateModelFromDisplay(actionId, "increase");
        return;
      case "model-previous":
        await this.rotateModelFromDisplay(actionId, "decrease");
        return;
      case "reasoning-increase":
        await this.adjustReasoning("increase", actionId);
        return;
      case "reasoning-decrease":
        await this.adjustReasoning("decrease", actionId);
        return;
    }
  }

  /** Starts an explicit display-key override; undefined preserves the action's native default. */
  pressConfiguredDisplayAction(actionId: string): Promise<void> | undefined {
    if ((this.actionPreferences.get(actionId)?.pressBehavior ?? "none") === "none") return undefined;
    this.displayOverrideOwners.add(actionId);
    return this.pressDisplayAction(actionId);
  }

  /** Completes the override selected at key-down, even if settings changed while held. */
  releaseConfiguredDisplayAction(actionId: string): Promise<void> | undefined {
    if (!this.displayOverrideOwners.delete(actionId)) return undefined;
    if (!this.displayPttOwners.delete(actionId)) return Promise.resolve();
    return this.releaseInput(actionId);
  }

  private async rotateModelFromDisplay(actionId: string, direction: ReasoningAdjustment): Promise<void> {
    const result = await this.trackMutation(actionId, () => this.microBridge.rotateModelPicker(direction), "MODEL");
    if (!result.observedSnapshot && result.semanticOutcome !== "unverified") await this.refresh();
  }

  private async trackDisplayOperation(actionId: string, operation: () => Promise<void>): Promise<void> {
    const token = this.beginFeedbackOperation(actionId);
    void this.setOperationFeedback(actionId, { phase: "pending" }, token);
    try {
      await operation();
      await this.setOperationFeedback(actionId, undefined, token);
    } catch (error) {
      await this.setOperationFeedback(actionId, { phase: "error", detail: safeDialFailureCode(error) }, token);
      throw error;
    }
  }

  private theme(actionId: string): "dark" | "light" {
    const theme = this.actionPreferences.get(actionId)?.theme;
    return theme === "dark" || theme === "light" ? theme : this.snapshot?.theme ?? "dark";
  }

  private frame(actionId: string): number {
    if (this.actionPreferences.get(actionId)?.animation === false) return 0;
    const slot = this.agents.has(actionId) || this.plusDials.get(actionId)?.kind === "agents";
    return this.animationFrame * (slot ? 2 : 4);
  }

  private language(actionId: string): "ja" | "en" {
    return this.actionPreferences.get(actionId)?.language ?? streamDeckDisplayLanguage();
  }

  async start(): Promise<void> {
    this.stopped = false;
    try {
      const settings = await streamDeck.settings.getGlobalSettings<ContextRingSettings>();
      this.showContextRings = settings.showContextRings !== false;
    } catch {
      streamDeck.logger.warn("Context-ring settings unavailable (E_CONTEXT_SETTINGS_UNAVAILABLE); using enabled.");
    }
    await this.refresh();
    this.scheduleRefresh();
    this.scheduleAnimation();
  }

  stop(): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight;
    this.stopped = true;
    if (this.poll) clearTimeout(this.poll);
    if (this.animation) clearTimeout(this.animation);
    for (const actionId of this.contextCompactionFeedbackTimers.keys()) this.clearContextCompactionFeedbackTimer(actionId);
    this.contextCompactionFeedback.clear();
    this.stopInFlight = this.stopGracefully();
    return this.stopInFlight;
  }

  private async stopGracefully(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.inputs.releaseAll(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("E_RELEASE_TIMEOUT")), 1_500);
        })
      ]);
    } catch {
      streamDeck.logger.warn("Held input shutdown release unavailable (E_SHUTDOWN_RELEASE).");
    } finally {
      if (timeout) clearTimeout(timeout);
      this.microBridge.close();
    }
  }

  registerAgent(slot: number, action: KeyAction): void {
    this.agentActionIds.add(action.id);
    this.markPageLifecycle(this.agents, action, (registration) => registration.action);
    const registration = { action, slot };
    this.agents.set(action.id, registration);
    void this.renderAgent(registration);
  }

  unregisterAgent(action: ActionIdentity): void { this.unregisterWithPageLifecycle(action, this.agents, (registration) => registration.action); }

  setContextRingVisibility(visible: boolean): void {
    if (visible === this.showContextRings) return;
    this.showContextRings = visible;
    void Promise.all([...this.agents.values()].map((entry) => this.renderAgent(entry)));
  }

  registerMicroAction(slot: MicroActionSlot, action: KeyAction): void {
    this.markPageLifecycle(this.microActions, action, (registration) => registration.action);
    const registration = { action, slot };
    this.microActions.set(action.id, registration);
    void this.renderMicroAction(registration);
  }

  unregisterMicroAction(action: ActionIdentity): void { this.unregisterWithPageLifecycle(action, this.microActions, (registration) => registration.action); }

  registerFixedAction(id: string, action: KeyAction, source: FixedIconSource): void {
    this.markPageLifecycle(this.fixedActions, action, (registration) => registration.action);
    const registration = { action, id, source };
    this.fixedActions.set(action.id, registration);
    void this.renderFixedAction(registration);
  }

  unregisterFixedAction(action: ActionIdentity): void { this.unregisterWithPageLifecycle(action, this.fixedActions, (registration) => registration.action); }

  registerPlusDial(kind: MicroPlusDialKind, action: DialAction): void {
    this.markPageLifecycle(this.plusDials, action, (registration) => registration.action);
    const registration: PlusDialRegistration = { action, kind, layoutState: "pending", generation: ++this.plusDialGeneration, layoutPath: this.dialLayoutPath(action.id) };
    this.plusDials.set(action.id, registration);
    void this.initializePlusDial(registration);
  }

  private dialLayoutPath(actionId: string): string {
    const large = this.actionPreferences.get(actionId)?.textSize === "large";
    return `static/layouts/microplus-dial${large ? "-large" : ""}${this.theme(actionId) === "light" ? "-light" : ""}.json`;
  }

  private async initializePlusDial(registration: PlusDialRegistration): Promise<void> {
    try {
      await registration.action.setFeedbackLayout(registration.layoutPath);
      if (this.plusDials.get(registration.action.id) !== registration) return;
      this.lastPlusFeedback.delete(registration.action.id);
      registration.layoutState = "ready";
    } catch {
      if (this.plusDials.get(registration.action.id) !== registration) return;
      registration.layoutState = "error";
      streamDeck.logger.warn("Micro Plus dial layout unavailable (E_DIAL_LAYOUT).");
      try {
        await registration.action.showAlert();
      } catch {
        streamDeck.logger.warn("Micro Plus dial layout alert unavailable (E_DIAL_LAYOUT_ALERT).");
      }
      return;
    }
    try {
      await this.renderPlusDial(registration);
    } catch {
      streamDeck.logger.warn("Micro Plus dial initial render unavailable (E_DIAL_RENDER).");
    }
  }

  unregisterPlusDial(action: ActionIdentity): void {
    if (this.plusDials.get(action.id)?.action !== action) return;
    this.unmarkPageLifecycle(this.plusDials, action.id);
    this.plusDials.delete(action.id);
    this.lastPhysicalDialRotations.delete(action.id);
    this.lastPhysicalDialDirections.delete(action.id);
    this.lastPlusFeedback.delete(action.id);
    this.advanceActionIncarnation(action.id);
  }

  registerUsageLimit(action: KeyAction, mode: UsageLimitMode): void {
    this.markPageLifecycle(this.usageLimitActions, action, (registration) => registration.action);
    const registration = { action, mode };
    this.usageLimitActions.set(action.id, registration);
    void this.renderUsageLimit(registration);
  }

  updateUsageLimitMode(action: KeyAction, mode: UsageLimitMode): void {
    this.registerUsageLimit(action, mode);
  }

  unregisterUsageLimit(action: ActionIdentity): void { this.unregisterWithPageLifecycle(action, this.usageLimitActions, (registration) => registration.action); }

  registerUsageOverview(action: KeyAction): void {
    this.markPageLifecycle(this.usageOverviewActions, action, (registration) => registration);
    this.usageOverviewActions.set(action.id, action);
    void this.renderUsageOverview(action);
  }

  unregisterUsageOverview(action: ActionIdentity): void { this.unregisterWithPageLifecycle(action, this.usageOverviewActions, (registration) => registration); }

  registerContextCompaction(action: KeyAction): void {
    this.markPageLifecycle(this.contextCompactionActions, action, (registration) => registration.action);
    this.contextCompactionActions.set(action.id, { action });
    void this.renderContextCompaction({ action });
  }

  unregisterContextCompaction(action: ActionIdentity): void {
    if (!this.unregisterWithPageLifecycle(action, this.contextCompactionActions, (registration) => registration.action)) return;
    this.clearContextCompactionFeedbackTimer(action.id);
    this.contextCompactionFeedback.delete(action.id);
  }

  /**
   * Run the context key's truthful default or its configured display override.
   * The inspector only exposes these overrides because they do not claim to
   * have compacted context. The default path always reaches the explicit
   * native compaction method below.
   */
  async pressContextCompaction(actionId: string): Promise<void> {
    const configured = this.pressConfiguredDisplayAction(actionId);
    if (configured) {
      await configured;
      return;
    }
    await this.compactActiveThread(actionId);
  }

  /** Invoke the bridge postcondition for the current Codex task. */
  async compactActiveThread(actionId: string): Promise<void> {
    const incarnation = this.actionIncarnations.get(actionId) ?? 0;
    const inFlight = this.contextCompactionInFlight;
    if (inFlight) {
      if (inFlight.actionId === actionId && inFlight.incarnation === incarnation) return inFlight.promise;
      try { await inFlight.promise; } catch { /* A later generation still gets its own attempt. */ }
      if ((this.actionIncarnations.get(actionId) ?? 0) !== incarnation) throw new Error("E_RESULT_UNVERIFIED");
      return this.compactActiveThread(actionId);
    }
    const operation = this.runContextCompaction(actionId);
    const flight = { actionId, incarnation, promise: operation };
    this.contextCompactionInFlight = flight;
    try { await operation; }
    finally { if (this.contextCompactionInFlight === flight) this.contextCompactionInFlight = undefined; }
  }

  private async runContextCompaction(actionId: string): Promise<void> {
    const token = this.beginContextCompactionFeedback(actionId);
    try {
      await this.prepareAction(actionId);
      if (this.health.state !== "ready") throw new Error("E_CONTEXT_COMPACTION_UNAVAILABLE");
      const expectedTarget = contextCompactionTargetIdentity(this.snapshot);
      if (!expectedTarget) throw new Error("E_CONTEXT_COMPACTION_UNAVAILABLE");
      // Reserve the observation order before the asynchronous native request.
      // A later refresh can therefore supersede this result while it is in flight.
      const observationSequence = ++this.snapshotObservationSequence;
      const result = await this.microBridge.compactActiveThread();
      if (!isSameContextCompactionTarget(expectedTarget, this.snapshot)) throw new Error("E_RESULT_UNVERIFIED");
      if (result.observedSnapshot) {
        if (!isSameContextCompactionTarget(expectedTarget, result.observedSnapshot)) {
          throw new Error("E_RESULT_UNVERIFIED");
        }
        // A newer observation of the same target wins the display race, but
        // does not invalidate the bridge's verified compaction outcome.
        this.applySnapshot(result.observedSnapshot, observationSequence);
      }
      if (result.semanticOutcome !== "confirmed") throw new Error("E_RESULT_UNVERIFIED");
      await this.setContextCompactionFeedback(actionId, "confirmed", undefined, token);
    } catch (error) {
      const code = safeActionFailureCode(error);
      await this.setContextCompactionFeedback(actionId, "error", code, token);
      throw new Error(code);
    }
  }

  private beginContextCompactionFeedback(actionId: string): ContextCompactionFeedbackToken {
    this.clearContextCompactionFeedbackTimer(actionId);
    const sequence = (this.contextCompactionFeedback.get(actionId)?.sequence ?? 0) + 1;
    const token = { actionId, incarnation: this.actionIncarnations.get(actionId) ?? 0, sequence };
    this.contextCompactionFeedback.set(actionId, { state: "pending", incarnation: token.incarnation, sequence });
    if (this.actionPreferences.get(actionId)?.animation !== false) this.wakeAnimation();
    void this.renderContextCompactionForId(actionId);
    return token;
  }

  private isCurrentContextCompactionFeedback(token: ContextCompactionFeedbackToken): boolean {
    const current = this.contextCompactionFeedback.get(token.actionId);
    return (this.actionIncarnations.get(token.actionId) ?? 0) === token.incarnation
      && current?.incarnation === token.incarnation
      && current.sequence === token.sequence;
  }

  private async setContextCompactionFeedback(
    actionId: string,
    state: ContextCompactionFeedback["state"],
    detail?: string,
    token?: ContextCompactionFeedbackToken,
  ): Promise<void> {
    const current = this.contextCompactionFeedback.get(actionId);
    if (token && (token.actionId !== actionId || !this.isCurrentContextCompactionFeedback(token))) return;
    const nextToken = token ?? {
      actionId,
      incarnation: this.actionIncarnations.get(actionId) ?? 0,
      sequence: current?.sequence ?? 1,
    };
    this.clearContextCompactionFeedbackTimer(actionId);
    this.contextCompactionFeedback.set(actionId, {
      state,
      incarnation: nextToken.incarnation,
      sequence: nextToken.sequence,
      ...(detail ? { detail } : {}),
    });
    await this.renderContextCompactionForId(actionId);
    if (!this.isCurrentContextCompactionFeedback(nextToken)) return;
    if (state === "confirmed" || state === "error") this.scheduleContextCompactionFeedbackReset(nextToken);
  }

  private scheduleContextCompactionFeedbackReset(token: ContextCompactionFeedbackToken): void {
    if (!this.isCurrentContextCompactionFeedback(token)) return;
    this.clearContextCompactionFeedbackTimer(token.actionId);
    let timer: ContextCompactionFeedbackTimer;
    const handle = setTimeout(() => {
      if (this.contextCompactionFeedbackTimers.get(token.actionId) !== timer) return;
      this.contextCompactionFeedbackTimers.delete(token.actionId);
      if (!this.isCurrentContextCompactionFeedback(token)) return;
      const current = this.contextCompactionFeedback.get(token.actionId);
      if (!current || (current.state !== "confirmed" && current.state !== "error")) return;
      this.contextCompactionFeedback.delete(token.actionId);
      void this.renderContextCompactionForId(token.actionId);
    }, CONTEXT_COMPACTION_FEEDBACK_RESET_MS);
    timer = { handle, token };
    this.contextCompactionFeedbackTimers.set(token.actionId, timer);
  }

  private clearContextCompactionFeedbackTimer(actionId: string): void {
    const timer = this.contextCompactionFeedbackTimers.get(actionId);
    if (timer) clearTimeout(timer.handle);
    this.contextCompactionFeedbackTimers.delete(actionId);
  }

  private async renderContextCompactionForId(actionId: string): Promise<void> {
    const registration = this.contextCompactionActions.get(actionId);
    if (registration) await this.renderSafely("E_RENDER_CONTEXT_COMPACTION", actionId, () => this.renderContextCompaction(registration));
  }

  registerRateLimitReset(action: KeyAction): void {
    this.markPageLifecycle(this.rateLimitResetActions, action, (registration) => registration);
    this.rateLimitResetActions.set(action.id, action);
    void this.renderRateLimitReset(action);
  }

  unregisterRateLimitReset(action: ActionIdentity): void {
    if (!this.unregisterWithPageLifecycle(action, this.rateLimitResetActions, (registration) => registration)) return;
    this.resetHolds.delete(action.id);
    this.resetFeedbackTokens.delete(action.id);
  }

  beginRateLimitReset(action: ActionIdentity): void {
    const token = this.beginFeedbackOperation(action.id);
    this.resetFeedbackTokens.set(action.id, token);
    void this.setOperationFeedback(action.id, undefined, token);
    this.resetHolds.set(action.id, Date.now());
    this.setPhysicalKeyContact(action.id, "press");
    this.wakeAnimation();
    const registered = this.rateLimitResetActions.get(action.id);
    if (registered) void this.renderRateLimitReset(registered);
  }

  async finishRateLimitReset(action: ActionIdentity): Promise<boolean> {
    const token = this.resetFeedbackTokens.get(action.id) ?? this.beginFeedbackOperation(action.id);
    try {
      return await this.finishRateLimitResetOperation(action, token);
    } catch (error) {
      await this.setOperationFeedback(action.id, { phase: "error", detail: safeDialFailureCode(error) }, token);
      throw error;
    } finally {
      if (this.resetFeedbackTokens.get(action.id) === token) this.resetFeedbackTokens.delete(action.id);
    }
  }

  private async finishRateLimitResetOperation(action: ActionIdentity, token: FeedbackOperationToken): Promise<boolean> {
    const startedAt = this.resetHolds.get(action.id);
    this.resetHolds.delete(action.id);
    if (startedAt != null) this.setPhysicalKeyContact(action.id, "release");
    const registered = this.rateLimitResetActions.get(action.id);
    if (registered) await this.renderRateLimitReset(registered);
    if (startedAt == null || Date.now() - startedAt < RESET_HOLD_MS) return false;
    void this.setOperationFeedback(action.id, { phase: "pending" }, token);
    const requestId = this.resetRequestIds.get(action.id) ?? crypto.randomUUID();
    this.resetRequestIds.set(action.id, requestId);
    await this.prepareAction(action.id);
    const outcome = await this.microBridge.consumeRateLimitReset(requestId);
    if (outcome.code !== "reset" && outcome.code !== "already_redeemed") {
      await this.setOperationFeedback(action.id, { phase: "sent-unverified" }, token);
      return false;
    }
    this.resetRequestIds.delete(action.id);
    try { await this.refresh(); }
    catch { streamDeck.logger.warn("Rate-limit reset refresh failed (E_RESET_REFRESH_FAILED)."); }
    await this.setOperationFeedback(action.id, undefined, token);
    return true;
  }

  async pressAgent(ownerId: string, slot: number, expectedThreadKey?: string): Promise<void> {
    const registration = this.agents.get(ownerId);
    const isAgentOwner = registration != null || this.agentActionIds.has(ownerId);
    const renderedBinding = isAgentOwner ? this.renderedAgentBindings.get(ownerId) : undefined;
    if (isAgentOwner) {
      const incarnation = this.actionIncarnations.get(ownerId) ?? 0;
      if (!registration
        || registration.slot !== slot
        || !renderedBinding
        || renderedBinding.action !== registration.action
        || renderedBinding.incarnation !== incarnation
        || renderedBinding.slot !== slot
        || (expectedThreadKey !== undefined && renderedBinding.threadKey !== expectedThreadKey)) {
        await this.recordRejectedPress(ownerId, { phase: "error", detail: "E_TARGET_UNAVAILABLE" });
        throw new Error(`No Codex task is assigned to agent slot ${slot + 1}.`);
      }
      // The image currently committed to this physical key is the identity
      // the key is allowed to activate. A changed slot must fail the bridge's
      // existing expected-thread guard instead of being guessed into another
      // source slot.
      expectedThreadKey = renderedBinding.threadKey;
    }
    const assignment = this.toPressedAgent(slot, this.snapshot?.slots[slot], expectedThreadKey);
    if (!assignment) {
      await this.recordRejectedPress(ownerId, { phase: "error", detail: "E_TARGET_UNAVAILABLE" });
      throw new Error(`No Codex task is assigned to agent slot ${slot + 1}.`);
    }
    // Capture the normalized per-key route before dispatch so a settings
    // update while the key is held cannot send the matching release through a
    // different window policy.
    const unopenedTaskBehavior = this.actionPreferences.get(ownerId)?.unopenedTaskBehavior ?? "current-window";
    await this.trackPress(ownerId, async () => this.inputs.press(ownerId, `agent:${assignment.sourceSlot}`, async () => {
        await this.prepareAction(ownerId);
      await this.microBridge.sendAgent(assignment.sourceSlot, 1, assignment.threadKey, unopenedTaskBehavior);
      }, async () => {
        await this.microBridge.sendAgent(assignment.sourceSlot, 0, assignment.threadKey, unopenedTaskBehavior);
        void this.refresh();
      }), `AG${String(slot + 1).padStart(2, "0")}`);
  }

  async pressMicroAction(ownerId: string, slot: MicroActionSlot): Promise<void> {
    try {
      assertMicroActionDispatchable(this.snapshot?.layout, slot);
    } catch (error) {
      await this.recordRejectedPress(ownerId, { phase: "error", detail: safeActionFailureCode(error), target: slot });
      throw error;
    }
    const resourceId = slot === "ACT10" || slot === "ACT11" ? "microphone" : `micro:${slot}`;
    await this.trackPress(ownerId, async () => this.inputs.press(ownerId, resourceId, async () => {
      await this.prepareAction(ownerId);
      return await this.microBridge.sendAction(slot, 1);
    }, async (reason) => {
      if (slot === "ACT10" || slot === "ACT11") {
        await this.microBridge.releaseAction(slot, { onlyIfHeld: reason === "rollback" });
      }
      else await this.microBridge.sendAction(slot, 0);
    }), slot);
  }

  async pressJoystick(ownerId: string, direction: MicroDirection): Promise<void> {
    await this.trackPress(ownerId, async () => this.inputs.press(ownerId, `joystick:${direction}`, async () => {
      await this.prepareAction(ownerId);
      await this.microBridge.sendJoystick(direction, 1);
    }, async () => { await this.microBridge.sendJoystick(direction, 0); }), `JOY_${direction.toUpperCase()}`);
  }

  async pressEncoder(ownerId: string): Promise<void> {
    await this.trackPress(ownerId, async () => this.inputs.press(ownerId, "encoder", async () => {
      await this.prepareAction(ownerId);
      await this.microBridge.sendEncoder(1);
    }, async () => { await this.microBridge.sendEncoder(0); }), "ENC_CLK");
  }

  async releaseInput(ownerId: string): Promise<void> {
    const pressToken = this.pressFeedbackTokens.get(ownerId);
    const token = this.beginFeedbackOperation(ownerId);
    const release = this.inputs.release(ownerId);
    void this.setOperationFeedback(ownerId, {
      phase: "pending",
      detail: this.language(ownerId) === "ja" ? "解除確認中" : "RELEASE",
    }, token);
    try {
      const downResult = await release;
      const recorded = this.retainedPressResults.get(ownerId);
      const currentPress = this.pressFeedbackTokens.get(ownerId);
      const samePress = currentPress === pressToken;
      const activeRecorded = samePress && recorded
        && recorded.token.incarnation === token.incarnation
        && recorded.token === pressToken;
      if (samePress && (activeRecorded || isUnverifiedMutation(downResult))) {
        const feedback = recorded?.feedback ?? { phase: "sent-unverified" as const, detail: "E_RESULT_UNVERIFIED" as const };
        await this.setOperationFeedback(ownerId, feedback, token);
      } else if (samePress) {
        this.retainedPressResults.delete(ownerId);
        await this.setOperationFeedback(ownerId, undefined, token);
      }
    } catch (error) {
      if (this.pressFeedbackTokens.get(ownerId) === pressToken) this.retainedPressResults.delete(ownerId);
      const code = safeActionFailureCode(error);
      const detail = code === "E_ACTION_UNKNOWN" ? "E_RELEASE_UNVERIFIED" : code;
      await this.setOperationFeedback(ownerId, { phase: "sent-unverified", detail }, token);
      throw error;
    }
  }

  /** Release inputs held by the device without stopping the controller or bridge. */
  async releaseHeldInputs(): Promise<void> {
    await this.inputs.releaseAll();
  }

  resolveMicrophoneSlot(actionId?: string): "ACT10" | "ACT11" {
    if (this.health.state !== "ready" || !this.snapshot) {
      if (actionId) void this.setOperationFeedback(actionId, { phase: "error", detail: "E_MAPPING_STALE" });
      throw new Error("E_MAPPING_STALE");
    }
    for (const slot of ["ACT10", "ACT11"] as const) {
      const binding = resolveEffectivePhysicalSlot(this.snapshot.layout, slot);
      if (binding?.keycapId === "MIC" || binding?.keycapId === "MIC1") return slot;
    }
    if (actionId) void this.setOperationFeedback(actionId, { phase: "error", detail: "E_MAPPING_INACTIVE" });
    throw new Error("E_MAPPING_INACTIVE");
  }

  async adjustReasoning(
    direction: ReasoningAdjustment,
    actionId?: string,
    refreshFallback = true,
    waitForFeedbackRender = true,
    dialContext = false,
  ): Promise<MutationConfirmation> {
    this.lastReasoningAdjustment = direction;
    const observationSequence = actionId ? undefined : ++this.snapshotObservationSequence;
    try {
      const result = actionId
        ? await this.trackMutation(actionId, () => this.microBridge.adjustReasoning(direction), `MIND${direction === "increase" ? "+" : "-"}`, waitForFeedbackRender, dialContext)
        : await this.microBridge.adjustReasoning(direction);
      if (result.observedSnapshot && observationSequence != null) this.applySnapshot(result.observedSnapshot, observationSequence);
      if (refreshFallback && !result.observedSnapshot && result.semanticOutcome !== "unverified") await this.refresh();
      return result;
    } finally {
      this.lastReasoningAdjustment = undefined;
      const render = this.renderAllPlusDials();
      if (waitForFeedbackRender) {
        try { await render; }
        catch { streamDeck.logger.warn("Reasoning feedback refresh unavailable (E_FEEDBACK_RENDER)."); }
      } else {
        void render.catch(() => streamDeck.logger.warn("Reasoning feedback refresh unavailable (E_FEEDBACK_RENDER)."));
      }
    }
  }

  async plusDialRotate(actionId: string, ticks: number): Promise<void> {
    if (!Number.isFinite(ticks) || Math.trunc(ticks) === 0) return;
    const dial = this.plusDials.get(actionId);
    const physicalRotation = dial?.layoutState === "ready" && dial.kind !== "agents" && Number.isFinite(ticks) && Math.trunc(ticks) !== 0;
    if (physicalRotation) {
      this.lastPhysicalDialRotations.set(actionId, Date.now());
      this.lastPhysicalDialDirections.set(actionId, Math.sign(ticks));
      this.wakeAnimation();
      void this.renderSafely("E_RENDER_PLUS_DIAL", actionId, () => this.renderPlusDial(dial));
    }
    let token: FeedbackOperationToken | undefined;
    const previousRotation = this.rotationQueues.get(actionId) ?? Promise.resolve();
    const operation = previousRotation.catch(() => undefined).then(async () => {
      if (this.plusDials.get(actionId) !== dial) throw new Error("E_MAPPING_STALE");
      token = this.beginFeedbackOperation(actionId);
      void this.setOperationFeedback(actionId, {
        phase: "pending",
        detail: this.language(actionId) === "ja" ? "結果確認中" : "RESULT",
      }, token);
      try {
        await this.plusDialRotateNow(actionId, ticks);
      } catch (error) {
        const code = safeDialFailureCode(error);
        throw new Error(code);
      }
    });
    // Serialize native input only. The returned promise still preserves the
    // existing contract that final feedback has rendered, while a slow SDK
    // display send cannot hold the next physical dial operation.
    this.rotationQueues.set(actionId, operation);
    void operation.then(
      () => {
        if (this.rotationQueues.get(actionId) === operation) this.rotationQueues.delete(actionId);
      },
      () => {
        if (this.rotationQueues.get(actionId) === operation) this.rotationQueues.delete(actionId);
      },
    );
    return operation.then(
      async () => {
        if (token) await this.setOperationFeedback(actionId, undefined, token);
      },
      async (error: unknown) => {
        if (token) {
          await this.setOperationFeedback(actionId, {
            phase: "error",
            detail: safeDialFailureCode(error),
          }, token);
        }
        throw error;
      },
    );
  }

  private async plusDialRotateNow(actionId: string, ticks: number): Promise<void> {
    const registration = this.plusDials.get(actionId);
    if (!registration) throw new Error("The MicroPlus dial is no longer visible.");
    const preferences = this.actionPreferences.get(actionId);
    const wholeTicks = Math.trunc(ticks) * (preferences?.reverseDial ? -1 : 1) * (preferences?.dialStep ?? 1);
    const steps = Math.min(32, Math.abs(wholeTicks));
    if (steps === 0) return;
    if (registration.kind === "commands") {
      const count = DIAL_COMMANDS.length;
      this.dialSelections.set(actionId, ((this.dialSelections.get(actionId) ?? 0) + Math.sign(wholeTicks) * steps % count + count) % count);
      void this.renderSafely("E_RENDER_PLUS_DIAL", actionId, () => this.renderPlusDial(registration));
      await this.prepareAction(actionId);
      return;
    }
    if (registration.kind === "usage") {
      // This dial has two endpoints, not a cyclic catalog. A fast physical
      // turn can contain two or more ticks; modulo arithmetic would then land
      // back on the same window and make the control appear unresponsive.
      // Commit the endpoint before any focus or display await so the next
      // render observes a stable selection.
      this.dialSelections.set(actionId, wholeTicks > 0 ? 1 : 0);
      void this.renderSafely("E_RENDER_PLUS_DIAL", actionId, () => this.renderPlusDial(registration));
      await this.prepareAction(actionId);
      const usageObservedAt = this.snapshot?.usage?.observedAt;
      if (usageObservedAt == null || Date.now() - usageObservedAt > 300_000) {
        this.refreshUsageInBackground();
      }
      return;
    }
    if (registration.kind !== "reasoning" && registration.kind !== "model") await this.prepareAction(actionId);
    if (registration.kind === "agents") {
      const slotCount = Math.max(1, Math.min(6, this.snapshot?.slots.length ?? 6));
      const direction = wholeTicks > 0 ? 1 : -1;
      for (let index = 0; index < steps; index += 1) {
        this.plusAgentSlot = (this.plusAgentSlot + direction + slotCount) % slotCount;
      }
      void this.renderAllPlusDials().catch(() => streamDeck.logger.warn("Agent dial feedback refresh unavailable (E_FEEDBACK_RENDER)."));
      return;
    }
    if (this.health.state !== "ready") throw new Error("Codex Micro is not ready for dial input.");
    if (registration.kind === "model") {
      const direction = wholeTicks > 0 ? "decrease" : "increase";
      let observedSnapshot = false;
      for (let index = 0; index < steps; index += 1) {
        const result = await this.trackMutation(actionId, () => this.microBridge.rotateModelPicker(direction), "MODEL", false, true);
        observedSnapshot = result.observedSnapshot != null;
      }
      if (!observedSnapshot) refreshDialSnapshotInBackground(() => this.refresh());
    } else if (registration.kind === "reasoning") {
      const direction = wholeTicks > 0 ? "increase" : "decrease";
      let observedSnapshot = false;
      for (let index = 0; index < steps; index += 1) {
        const result = await this.adjustReasoning(direction, actionId, false, false, true);
        observedSnapshot = result.observedSnapshot != null;
      }
      if (!observedSnapshot) refreshDialSnapshotInBackground(() => this.refresh());
    } else {
      // The native left/right path is verified, but its semantic meaning is
      // selected by Codex Micro settings and is not always conversation history.
      const direction = wholeTicks > 0 ? "right" : "left";
      for (let index = 0; index < steps; index += 1) {
        const ownerId = `dial-pulse:${actionId}:${this.pulseSequence++}`;
        await this.inputs.pulse(ownerId, `joystick:${direction}`, async () => {
          await this.microBridge.sendJoystick(direction, 1);
        }, async () => { await this.microBridge.sendJoystick(direction, 0); });
      }
    }
    if (registration.kind === "navigation") refreshDialSnapshotInBackground(() => this.refresh());
  }

  async plusDialDown(actionId: string): Promise<void> {
    const registration = this.plusDials.get(actionId);
    if (!registration) throw new Error("The MicroPlus dial is no longer visible.");
    if (registration.kind === "model") {
      const result = await this.trackMutation(actionId, () => this.microBridge.pressModelPicker(), "MODEL", true, true);
      if (!result.observedSnapshot) await this.refresh();
      return;
    }
    if (registration.kind === "commands") {
      await this.runKeycap(DIAL_COMMANDS[this.dialSelections.get(actionId) ?? 0] ?? "TERM", actionId, true);
      return;
    }
    if (registration.kind === "usage") {
      await this.prepareAction(actionId);
      const observationSequence = ++this.snapshotObservationSequence;
      const snapshot = await this.microBridge.refreshUsage();
      if (!this.applySnapshot(snapshot, observationSequence)) throw new Error("E_RESULT_UNVERIFIED");
      await this.renderAll();
      return;
    }
    if (registration.kind === "agents") {
      const selected = this.snapshot?.slots[this.plusAgentSlot];
      if (!selected?.threadKey) throw new Error(`No Codex task is assigned to agent slot ${this.plusAgentSlot + 1}.`);
      await this.pressAgent(actionId, this.plusAgentSlot, selected.threadKey);
      return;
    }
    if (this.health.state !== "ready") throw new Error("Codex Micro is not ready for dial input.");
    await this.pressEncoder(actionId);
  }

  async plusDialUp(actionId: string): Promise<void> {
    const registration = this.plusDials.get(actionId);
    if (!registration) return;
    await this.releaseInput(actionId);
  }

  async runKeycap(keycapId: OfficialKeycapId, actionId: string, dialContext = false): Promise<void> {
    await this.trackMutation(actionId, () => this.microBridge.runKeycap(keycapId), keycapId, true, dialContext);
  }

  async moveSideDraftToMain(actionId: string): Promise<void> {
    await this.trackMutation(actionId, () => this.microBridge.moveSideDraftToMain(), "SIDE_TO_MAIN");
  }

  async createTask(actionId: string): Promise<void> {
    const result = await this.trackMutation(actionId, () => this.microBridge.runKeycap("NEW"), "NEW");
    if (result.semanticOutcome !== "confirmed") throw new Error("E_RESULT_UNVERIFIED");
  }

  private async trackMutation(
    actionId: string,
    operation: () => Promise<MutationConfirmation>,
    target: string,
    waitForFeedbackRender = true,
    dialContext = false,
  ): Promise<MutationConfirmation> {
    const token = this.beginFeedbackOperation(actionId);
    const observationSequence = ++this.snapshotObservationSequence;
    void this.setOperationFeedback(actionId, {
      phase: "pending",
      detail: this.language(actionId) === "ja" ? "結果確認中" : "RESULT",
      target,
    }, token);
    const pending = this.prepareAction(actionId).then(operation);
    try {
      const result = await pending;
      if (result.observedSnapshot) this.applySnapshot(result.observedSnapshot, observationSequence);
      if (result.semanticOutcome === "unverified") {
        const render = this.setOperationFeedback(actionId, { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED", target }, token);
        if (waitForFeedbackRender) await render;
        else void render.catch(() => streamDeck.logger.warn("Operation feedback render unavailable (E_FEEDBACK_RENDER)."));
      } else {
        const render = this.setOperationFeedback(actionId, undefined, token);
        if (waitForFeedbackRender) await render;
        else void render.catch(() => streamDeck.logger.warn("Operation feedback render unavailable (E_FEEDBACK_RENDER)."));
      }
      return result;
    } catch (error) {
      const code = dialContext ? safeDialFailureCode(error) : safeActionFailureCode(error);
      const render = this.setOperationFeedback(actionId, {
        phase: "sent-unverified",
        detail: code === "E_DIAL_UNKNOWN" || code === "E_ACTION_UNKNOWN" ? "E_RESULT_UNVERIFIED" : code,
        target,
      }, token);
      if (waitForFeedbackRender) await render;
      else void render.catch(() => streamDeck.logger.warn("Operation feedback render unavailable (E_FEEDBACK_RENDER)."));
      throw new Error(code);
    }
  }

  private async recordRejectedPress(ownerId: string, feedback: OperationFeedback): Promise<void> {
    const token = this.beginFeedbackOperation(ownerId);
    this.pressFeedbackTokens.set(ownerId, token);
    this.retainedPressResults.set(ownerId, { token, feedback });
    await this.setOperationFeedback(ownerId, feedback, token);
  }

  private async trackPress<T>(
    ownerId: string,
    operation: () => Promise<T>,
    target: string,
  ): Promise<T> {
    const token = this.beginFeedbackOperation(ownerId);
    this.pressFeedbackTokens.set(ownerId, token);
    this.retainedPressResults.delete(ownerId);
    const pending = operation();
    void this.setOperationFeedback(ownerId, {
      phase: "pending",
      detail: this.language(ownerId) === "ja" ? "結果確認中" : "RESULT",
      target,
    }, token);
    try {
      const result = await pending;
      if (this.pressFeedbackTokens.get(ownerId) !== token) return result;
      if (isUnverifiedMutation(result)) {
        const feedback: OperationFeedback = { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED", target };
        this.retainedPressResults.set(ownerId, { token, feedback });
        await this.setOperationFeedback(ownerId, feedback, token);
      } else {
        await this.setOperationFeedback(ownerId, {
          phase: "held",
          detail: this.language(ownerId) === "ja" ? "押下中" : "HELD",
          target,
        }, token);
      }
      return result;
    } catch (error) {
      const failureCode = error instanceof InputOwnedError ? "E_INPUT_OWNED" : safeActionFailureCode(error);
      // A failed window route is terminal even if it partially raised a
      // window. Explicit renderer predispatch rejection proves no native down
      // was sent. Neither should remain labelled as an uncertain submission.
      const terminal = error instanceof InputOwnedError
        || (error != null && typeof error === "object" && "codexDeckPredispatch" in error
          && error.codexDeckPredispatch === true)
        || failureCode === "E_AGENT_WINDOW_UNVERIFIED"
        || failureCode === "E_AGENT_SOURCE_UNVERIFIED"
        || failureCode === "E_AGENT_SOURCE_CHANGED"
        || failureCode === "E_AGENT_WINDOW_AMBIGUOUS"
        || failureCode === "E_AGENT_NEW_WINDOW_UNSUPPORTED"
        || failureCode === "E_AGENT_WINDOW_CREATION_UNCERTAIN";
      const feedback: OperationFeedback = terminal
        ? { phase: "error", detail: failureCode, target }
        : { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED", target };
      if (this.pressFeedbackTokens.get(ownerId) === token) {
        // Key-up may already own a newer render token while awaiting down.
        // Retain this press's outcome so its release cannot leave pending
        // feedback behind or erase a terminal down failure.
        this.retainedPressResults.set(ownerId, { token, feedback });
      }
      await this.setOperationFeedback(ownerId, feedback, token);
      throw error;
    }
  }

  private beginFeedbackOperation(actionId: string): FeedbackOperationToken {
    const sequence = (this.feedbackSequences.get(actionId) ?? 0) + 1;
    this.feedbackSequences.set(actionId, sequence);
    return { actionId, incarnation: this.actionIncarnations.get(actionId) ?? 0, sequence };
  }

  private isCurrentFeedbackOperation(token: FeedbackOperationToken): boolean {
    return this.feedbackSequences.get(token.actionId) === token.sequence
      && (this.actionIncarnations.get(token.actionId) ?? 0) === token.incarnation;
  }

  private async setOperationFeedback(actionId: string, feedback: OperationFeedback | undefined, token?: FeedbackOperationToken): Promise<void> {
    if (token && !this.isCurrentFeedbackOperation(token)) return;
    const previousFeedback = this.operationFeedback.get(actionId);
    this.updateKeyContact(actionId, previousFeedback, feedback);
    if (feedback) this.operationFeedback.set(actionId, feedback);
    else this.operationFeedback.delete(actionId);
    if (this.actionPreferences.get(actionId)?.animation !== false
      && (feedback?.phase === "held" || feedback?.phase === "pending")) {
      this.wakeAnimation();
    }
    const previous = this.feedbackRenderQueues.get(actionId) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      if (token && !this.isCurrentFeedbackOperation(token)) return;
      const agent = this.agents.get(actionId);
      if (agent) await this.renderAgent(agent);
      const microAction = this.microActions.get(actionId);
      if (microAction) await this.renderMicroAction(microAction);
      const fixed = this.fixedActions.get(actionId);
      if (fixed) await this.renderFixedAction(fixed);
      const dial = this.plusDials.get(actionId);
      if (dial) await this.renderPlusDial(dial);
      const usage = this.usageLimitActions.get(actionId);
      if (usage) await this.renderUsageLimit(usage);
      const overview = this.usageOverviewActions.get(actionId);
      if (overview) await this.renderUsageOverview(overview);
      const contextCompaction = this.contextCompactionActions.get(actionId);
      if (contextCompaction) await this.renderContextCompaction(contextCompaction);
      const reset = this.rateLimitResetActions.get(actionId);
      if (reset) await this.renderRateLimitReset(reset);
    });
    this.feedbackRenderQueues.set(actionId, pending);
    try { await pending; }
    catch { streamDeck.logger.warn("Operation feedback render unavailable (E_FEEDBACK_RENDER)."); }
    finally { if (this.feedbackRenderQueues.get(actionId) === pending) this.feedbackRenderQueues.delete(actionId); }
  }

  private withOperationFeedback(actionId: string, image: string): string {
    const feedback = this.operationFeedback.get(actionId);
    const operationImage = feedback ? renderActionFeedback(image, feedback, this.theme(actionId), this.language(actionId), this.frame(actionId)) : image;
    const contact = this.keyContacts.get(actionId);
    if (!contact) return operationImage;
    const action = this.currentKeyAction(actionId);
    if (action !== contact.owner || this.agents.has(actionId) || this.actionPreferences.get(actionId)?.animation === false) {
      this.keyContacts.delete(actionId);
      return operationImage;
    }
    const ageMs = Math.max(0, Date.now() - contact.startedAt);
    if (ageMs >= KEY_CONTACT_DURATION_MS) return operationImage;
    if (this.health.state !== "ready") return operationImage;
    return renderKeyContact(operationImage, contact.phase, ageMs, this.theme(actionId));
  }

  private updateKeyContact(actionId: string, previous: OperationFeedback | undefined, next: OperationFeedback | undefined): void {
    const action = this.currentKeyAction(actionId);
    if (!action || this.agents.has(actionId) || this.plusDials.has(actionId)
      || this.actionPreferences.get(actionId)?.animation === false || this.health.state !== "ready") {
      this.keyContacts.delete(actionId);
      return;
    }
    if (next?.phase === "error" || next?.phase === "sent-unverified") {
      this.keyContacts.delete(actionId);
      return;
    }
    const existing = this.keyContacts.get(actionId);
    const wasActive = previous?.phase === "pending" || previous?.phase === "held";
    if (next?.phase === "pending") {
      if (previous?.phase === "held") this.keyContacts.set(actionId, { owner: action, phase: "release", startedAt: Date.now() });
      else if (!wasActive && (!existing || !this.rateLimitResetActions.has(actionId))) {
        this.keyContacts.set(actionId, { owner: action, phase: "press", startedAt: Date.now() });
      }
      return;
    }
    if (!next && wasActive && existing?.phase !== "release") {
      this.keyContacts.set(actionId, { owner: action, phase: "release", startedAt: Date.now() });
    }
  }

  private setPhysicalKeyContact(actionId: string, phase: KeyContact["phase"]): void {
    const action = this.currentKeyAction(actionId);
    if (!action || this.agents.has(actionId) || this.plusDials.has(actionId)
      || this.actionPreferences.get(actionId)?.animation === false || this.health.state !== "ready") {
      this.keyContacts.delete(actionId);
      return;
    }
    this.keyContacts.set(actionId, { owner: action, phase, startedAt: Date.now() });
  }

  private toPressedAgent(slot: number, current: MicroAgentSlot | undefined, expectedThreadKey?: string): { sourceSlot: number; threadKey: string } | undefined {
    if (!current?.threadKey || (expectedThreadKey && current.threadKey !== expectedThreadKey)) return undefined;
    return { sourceSlot: slot, threadKey: current.threadKey };
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const pending = this.refreshOnce();
    this.refreshInFlight = pending;
    try { await pending; }
    finally { if (this.refreshInFlight === pending) this.refreshInFlight = undefined; }
  }

  private async refreshOnce(): Promise<void> {
    const revision = this.snapshotRevision;
    const observationSequence = ++this.snapshotObservationSequence;
    try {
      const snapshot = await this.microBridge.refresh();
      if (revision === this.snapshotRevision) this.applySnapshot(snapshot, observationSequence);
    } catch (error) {
      if (revision === this.snapshotRevision) {
        this.snapshot = undefined;
        const message = bridgeFailureCode(error);
        this.health = message === "missing-launcher"
          ? { state: "offline", reason: "missing-launcher", changedAt: Date.now() }
          : { state: "degraded", reason: "local-bridge-unavailable", changedAt: Date.now() };
        if (message !== this.lastError) {
          this.lastError = message;
          streamDeck.logger.warn(`Codex Micro bridge unavailable (${message}).`);
        }
      }
    }
    await this.renderAll();
  }

  private refreshUsageInBackground(): void {
    if (this.stopped || this.usageRefreshInFlight) return;
    const revision = this.snapshotRevision;
    const observationSequence = ++this.snapshotObservationSequence;
    const pending = this.microBridge.refreshUsage().then(async (snapshot) => {
      if (this.stopped) return;
      let adopted = this.applySnapshot(snapshot, observationSequence);
      if (!adopted && revision !== this.snapshotRevision && snapshot.usage && this.snapshot
        && snapshot.connectionEpoch === this.snapshot.connectionEpoch
        && snapshot.pageEpoch === this.snapshot.pageEpoch
        && snapshot.targetIdentity === this.snapshot.targetIdentity
        && snapshot.mappingFingerprint === this.snapshot.mappingFingerprint
        && snapshot.usage.observedAt != null
        && snapshot.usage.observedAt > (this.snapshot.usage?.observedAt ?? 0)) {
        this.snapshot = { ...this.snapshot, usage: snapshot.usage };
        this.snapshotRevision += 1;
        adopted = true;
      }
      if (!adopted) return;
      await Promise.all([...this.plusDials.values()]
        .filter(({ kind }) => kind === "usage")
        .map((registration) => this.renderSafely(
          "E_RENDER_PLUS_DIAL",
          registration.action.id,
          () => this.renderPlusDial(registration),
        )));
    }).catch(() => {
      if (!this.stopped) streamDeck.logger.warn("Usage refresh unavailable (E_USAGE_REFRESH).");
    }).finally(() => {
      if (this.usageRefreshInFlight === pending) this.usageRefreshInFlight = undefined;
    });
    this.usageRefreshInFlight = pending;
  }

  private applySnapshot(snapshot: MicroSnapshot, observationSequence: number): boolean {
    if (observationSequence < this.committedSnapshotObservation) return false;
    const current = this.snapshot;
    if (current && (snapshot.connectionEpoch < current.connectionEpoch
      || (snapshot.connectionEpoch === current.connectionEpoch && snapshot.pageEpoch < current.pageEpoch))) {
      return false;
    }
    const layoutSignature = JSON.stringify({ theme: snapshot.theme, slots: snapshot.layout.slots });
    if (layoutSignature !== this.lastLayoutSignature) {
      this.lastLayoutSignature = layoutSignature;
      this.keycapImages.clear();
      streamDeck.logger.info(`Codex Micro layout synchronized (${snapshot.agentSource}, ${snapshot.theme}).`);
    }
    if (!this.plusAgentSelectionInitialized) {
      const selectedSlot = snapshot.slots.findIndex((slot) => slot.selected);
      if (selectedSlot >= 0) this.plusAgentSlot = selectedSlot;
      this.plusAgentSelectionInitialized = true;
    }
    this.snapshot = snapshot;
    this.committedSnapshotObservation = observationSequence;
    this.snapshotRevision += 1;
    this.health = { state: "ready", changedAt: Date.now() };
    this.wakeAnimation();
    this.lastError = "";
    return true;
  }

  private async renderAll(): Promise<void> {
    await Promise.all([
      ...[...this.agents.values()].map((entry) => this.renderSafely("E_RENDER_AGENT", entry.action.id, () => this.renderAgent(entry))),
      ...[...this.microActions.values()].map((entry) => this.renderSafely("E_RENDER_MICRO_ACTION", entry.action.id, () => this.renderMicroAction(entry))),
      ...[...this.fixedActions.values()].map((entry) => this.renderSafely("E_RENDER_FIXED_ACTION", entry.action.id, () => this.renderFixedAction(entry))),
      ...[...this.usageLimitActions.values()].map((entry) => this.renderSafely("E_RENDER_USAGE_LIMIT", entry.action.id, () => this.renderUsageLimit(entry))),
      ...[...this.usageOverviewActions.values()].map((action) => this.renderSafely("E_RENDER_USAGE_OVERVIEW", action.id, () => this.renderUsageOverview(action))),
      ...[...this.contextCompactionActions.values()].map((entry) => this.renderSafely("E_RENDER_CONTEXT_COMPACTION", entry.action.id, () => this.renderContextCompaction(entry))),
      ...[...this.rateLimitResetActions.values()].map((action) => this.renderSafely("E_RENDER_RATE_RESET", action.id, () => this.renderRateLimitReset(action))),
      ...[...this.plusDials.values()].map((registration) => this.renderSafely("E_RENDER_PLUS_DIAL", registration.action.id, () => this.renderPlusDial(registration)))
    ]);
  }

  private async renderAllPlusDials(): Promise<void> {
    await Promise.all([...this.plusDials.values()].map((registration) =>
      this.renderSafely("E_RENDER_PLUS_DIAL", registration.action.id, () => this.renderPlusDial(registration))));
  }

  private async renderSafely(code: DisplayRenderFailureCode, actionId: string, render: () => Promise<void>): Promise<void> {
    const failureKey = `${code}:${actionId}`;
    try {
      await render();
      this.activeRenderFailures.delete(failureKey);
    } catch {
      if (!this.activeRenderFailures.has(failureKey)) {
        this.activeRenderFailures.add(failureKey);
        streamDeck.logger.warn(`Stream Deck display refresh unavailable (${code}).`);
      }
    }
  }

  private async renderPlusDial(registration: PlusDialRegistration): Promise<void> {
    const actionKey = registration.action as unknown as object;
    await this.plusDialRenders.request(
      actionKey,
      actionKey,
      registration,
      (requested) => this.renderPlusDialNow(requested),
    );
  }

  private async renderPlusDialNow({ action, kind }: PlusDialRegistration): Promise<void> {
    const registration = this.plusDials.get(action.id);
    if (!registration || registration.action !== action) return;
    if (registration.layoutState !== "ready") {
      const startedAt = this.lastPhysicalDialRotations.get(action.id);
      if (startedAt != null && Date.now() - startedAt >= DIAL_ROTATION_CUE_MS) this.clearDialInteraction(action.id, startedAt);
      return;
    }
    if (registration.layoutPath !== this.dialLayoutPath(action.id)) {
      this.registerPlusDial(kind, action);
      return;
    }
    const theme = this.theme(action.id);
    const recordedOperation = this.operationFeedback.get(action.id);
    const passiveUnverified = recordedOperation?.phase === "sent-unverified"
      && (!recordedOperation.detail || ["E_RESULT_UNVERIFIED", "E_DIAL_ROTATE_UNVERIFIED"].includes(recordedOperation.detail));
    const operation = passiveUnverified ? undefined : recordedOperation;
    const slot = this.snapshot?.slots[this.plusAgentSlot];
    const interactionAge = kind === "agents" ? undefined : this.dialInteractionAge(action.id);
    const interactionDirection = kind === "agents" ? undefined : this.lastPhysicalDialDirections.get(action.id);
    const feedback = renderPlusDialFeedback({
      kind,
      theme,
      language: this.language(action.id),
      animationFrame: this.frame(action.id),
      health: this.health.state,
      ...(operation ? {
        state: operation.phase === "pending" ? "pending"
          : operation.phase === "held" ? "pressed"
          : "error",
        detail: operationFeedbackDetail(operation, this.language(action.id)) || null,
      } : {}),
      ...(kind === "agents" ? {
        slot: this.plusAgentSlot,
        slotCount: Math.max(1, Math.min(6, this.snapshot?.slots.length ?? 6)),
        taskTitle: slot?.title ?? null,
        ...(slot ? { agentStatus: visualStatusFromMicro(slot.status) } : {}),
        ...(slot?.contextUsedPercent == null ? {} : { contextUsedPercent: slot.contextUsedPercent }),
      } : kind === "model" ? {
        observedValue: (this.snapshot?.composerReadback?.modelPickerOpen
          ? this.snapshot.composerReadback.modelCandidateLabel
          : undefined) ?? this.snapshot?.composerReadback?.modelLabel ?? null,
        detail: this.language(action.id) === "ja" ? "回転で変更" : "Turn to change",
      } : kind === "commands" ? {
        observedValue: DIAL_COMMANDS[this.dialSelections.get(action.id) ?? 0] ?? "TERM",
        detail: this.language(action.id) === "ja" ? "回転で選択／押して実行" : "Turn to choose · Press to run",
      } : kind === "usage" ? {
        ...this.usageDialValue(action.id),
      } : kind === "reasoning" ? {
        observedValue: this.snapshot?.composerReadback?.reasoningEffort ?? null,
        operation: operation?.phase === "pending" ? (this.lastReasoningAdjustment === "increase" ? "上げる"
          : this.lastReasoningAdjustment === "decrease" ? "下げる" : null) : null,
      } : {
        activeThreadTitle: this.snapshot?.activeThreadTitle ?? null,
        target: this.language(action.id) === "ja" ? "設定依存" : "SETTINGS DEPENDENT",
      }),
      ...(operation ? {
        state: operation.phase === "pending" ? "pending" as const
          : operation.phase === "held" ? "pressed" as const
          : "error" as const,
      } : {}),
      ...(interactionAge == null ? {} : { interactionAgeMs: interactionAge }),
      ...(interactionDirection == null ? {} : { interactionDirection }),
      ...(operation ? { detail: operationFeedbackDetail(operation, this.language(action.id)) } : {}),
    });
    feedback.progress = operation?.progress == null ? (feedback.progress ?? 0) : Math.max(0, Math.min(100, operation.progress * 100));
    if (kind === "agents" && operation && feedback.icon) feedback.icon = renderActionFeedback(feedback.icon, operation, theme, this.language(action.id), this.frame(action.id));
    const preferences = this.actionPreferences.get(action.id);
    const { title, ...lcdFields } = feedback;
    const valueInteractionAge = this.health.state === "ready" ? interactionAge : undefined;
    const lcdFeedback = { ...lcdFields, value: { value: feedback.value, color: dialInteractionValueColor(theme, valueInteractionAge), font: { weight: dialInteractionStrength(valueInteractionAge) > 0 ? 750 : 600, size: (preferences?.textSize === "large" ? 22 : 16 + Math.round(3 * dialInteractionStrength(valueInteractionAge))) } }, heading: title,
      ...(!operation && ["model", "reasoning", "commands", "navigation"].includes(kind) ? { detail: "" } : {}),
      ...(preferences?.label ? { heading: preferences.label } : {}),
      ...(preferences?.showDetails === false ? { detail: "" } : {}),
      status: ["ready", "unknown", "confirmed"].includes(feedback.status) ? ""
        : this.language(action.id) === "ja" ? localizedDialFeedbackStatus(feedback.status) : feedback.status,
      surface: renderDialSurface(
        kind,
        kind === "agents" ? "ready" : this.dialRibbonState(feedback.status),
        theme,
        kind === "agents" ? undefined : this.dialRibbonAge(action.id),
        interactionDirection,
      ),
      "backdrop-13": renderDialInteractionRibbon(
        kind === "agents" ? "ready" : this.dialRibbonState(feedback.status),
        theme,
        this.frame(action.id),
        kind === "agents" ? undefined : this.dialRibbonAge(action.id),
      ),
    };
    const serialized = JSON.stringify(lcdFeedback);
    const rotationTimestamp = kind === "agents" ? undefined : this.lastPhysicalDialRotations.get(action.id);
    const rotationExpired = rotationTimestamp != null && Date.now() - rotationTimestamp >= DIAL_ROTATION_CUE_MS;
    if (this.lastPlusFeedback.get(action.id) === serialized) {
      if (rotationExpired) this.clearDialInteraction(action.id, rotationTimestamp);
      return;
    }
    const priorFeedback = this.lastPlusFeedback.get(action.id);
    await action.setFeedback(feedbackDelta(priorFeedback ? JSON.parse(priorFeedback) : undefined, lcdFeedback) as Parameters<DialAction["setFeedback"]>[0]);
    const current = this.plusDials.get(action.id);
    if (current !== registration) {
      if (current?.layoutState === "ready") {
        // A stale write can land on the shared LCD after the replacement has
        // already rendered. Invalidate its cache and restore the current view.
        this.lastPlusFeedback.delete(action.id);
        if (current.action === action) await this.renderPlusDialNow(current);
        else await this.renderPlusDial(current);
      }
      return;
    }
    this.lastPlusFeedback.set(action.id, serialized);
    if (rotationExpired) this.clearDialInteraction(action.id, rotationTimestamp);
  }

  private dialInteractionAge(actionId: string): number | undefined {
    const startedAt = this.lastPhysicalDialRotations.get(actionId);
    if (startedAt == null) return undefined;
    return this.actionPreferences.get(actionId)?.animation === false ? undefined : Math.max(0, Date.now() - startedAt);
  }

  private dialRibbonAge(actionId: string): number | undefined {
    const startedAt = this.lastPhysicalDialRotations.get(actionId);
    if (startedAt == null) return undefined;
    const age = Math.max(0, Date.now() - startedAt);
    return this.actionPreferences.get(actionId)?.animation === false
      ? Math.min(DIAL_ROTATION_CUE_MS, age < DIAL_ROTATION_CUE_MS ? 0 : DIAL_ROTATION_CUE_MS)
      : age;
  }

  private clearDialInteraction(actionId: string, timestamp: number | undefined): void {
    if (timestamp == null || this.lastPhysicalDialRotations.get(actionId) !== timestamp) return;
    this.lastPhysicalDialRotations.delete(actionId);
    this.lastPhysicalDialDirections.delete(actionId);
  }

  private dialRibbonState(status: MicroPlusFeedbackStatus): MicroPlusFeedbackStatus {
    if (this.health.state === "ready") return status;
    if (this.health.state === "degraded") return "stale";
    return this.health.state;
  }

  private usageDialValue(actionId: string): { observedValue: string | null; detail: string; state?: MicroPlusFeedbackStatus } {
    const kind = (this.dialSelections.get(actionId) ?? 0) === 0 ? "five-hour" : "weekly";
    const window = selectUsageWindow(this.snapshot?.usage, kind);
    const fresh = this.snapshot?.usage?.observedAt != null && Date.now() - this.snapshot.usage.observedAt <= 300_000;
    const language = this.language(actionId);
    return {
      observedValue: window ? `${Math.round(window.remainingPercent)}%` : null,
      detail: language === "ja"
        ? (kind === "five-hour" ? `5時間・${fresh ? "残り" : "前回値"}` : `週間・${fresh ? "残り" : "前回値"}`)
        : (kind === "five-hour" ? `5H ${fresh ? "remaining" : "last observed"}` : `Week ${fresh ? "remaining" : "last observed"}`),
      ...(!fresh && window ? { state: "stale" as const } : {}),
    };
  }

  private agentMotionEnabled(actionId: string): boolean {
    // Keep observed task status, but don't animate behind a terminal error:
    // that would look like the failed window switch was still pending.
    return this.actionPreferences.get(actionId)?.animation !== false
      && this.operationFeedback.get(actionId)?.phase !== "error";
  }

  private async renderAgent({ action, slot }: AgentRegistration): Promise<void> {
    const snapshot = this.snapshot;
    const snapshotRevision = this.snapshotRevision;
    const agent = snapshot?.slots[slot];
    const incarnation = this.actionIncarnations.get(action.id) ?? 0;
    const threadKey = agent?.threadKey;
    const renderedBinding = this.renderedAgentBindings.get(action.id);
    const sameRenderedIdentity = renderedBinding?.action === action
      && renderedBinding.incarnation === incarnation
      && renderedBinding.slot === slot
      && renderedBinding.threadKey === threadKey;
    if (this.currentKeyAction(action.id) === action
      && (this.actionIncarnations.get(action.id) ?? 0) === incarnation
      && !sameRenderedIdentity) {
      // A changed task identity must be invalid until its exact image/title
      // pair commits. Same-task animation/contact redraws keep the existing
      // binding usable while their SDK write is in flight.
      this.renderedAgentBindings.delete(action.id);
      // Equal titles/status can produce equal pixels for different tasks.
      // A new identity must still complete its own SDK write before binding.
      this.lastImages.delete(action.id);
    }
    const unavailable = this.health.state === "degraded" ? "Signals unavailable" : "Not assigned";
    const title = agent?.title ?? (agent?.threadKey && this.health.state === "ready"
      ? this.language(action.id) === "ja" ? "名称未取得" : "TITLE UNAVAILABLE"
      : unavailable);
    await this.setImage(action, this.withOperationFeedback(action.id, renderAgentKey(
      slot,
      title,
      agent ? visualStatusFromMicro(agent.status) : "empty",
      agent?.selected ?? false,
      this.agentMotionEnabled(action.id) ? this.frame(action.id) : 0,
      this.theme(action.id),
      undefined,
      this.health.state,
      agent?.contextUsedPercent,
      this.showContextRings,
      this.language(action.id),
      {
        ...(agent?.metadataAvailability ? { metadataAvailability: agent.metadataAvailability } : {}),
        ...(agent?.goalStatus ? { goalStatus: agent.goalStatus } : {}),
        ...(agent?.pendingQuestion != null ? { pendingQuestion: agent.pendingQuestion } : {})
      }
    )), () => {
      if (!threadKey) {
        this.renderedAgentBindings.delete(action.id);
        return;
      }
      this.renderedAgentBindings.set(action.id, {
        action,
        incarnation,
        snapshotRevision,
        slot,
        threadKey,
      });
    });
  }

  private async renderMicroAction({ action, slot }: MicroActionRegistration): Promise<void> {
    const layout = this.snapshot?.layout;
    const binding = layout ? resolveEffectivePhysicalSlot(layout, slot) : undefined;
    const keycapId = binding?.keycapId;
    const theme = this.theme(action.id);
    if (this.health.state !== "ready") {
      await this.setImage(action, this.withOperationFeedback(action.id, renderFallbackKeycap("未接続", theme, this.language(action.id))));
    } else if (keycapId) {
      await this.setImage(action, this.withOperationFeedback(action.id, await this.keycapImage(keycapId, theme, this.language(action.id))));
    } else if (slot === "ACT11" && layout?.separateMicrophoneKeys === false) {
      await this.setImage(action, this.withOperationFeedback(action.id, renderFallbackKeycap("ACT11 無効", theme, this.language(action.id))));
    } else {
      await this.setImage(action, this.withOperationFeedback(action.id, renderFallbackKeycap("未割当", theme, this.language(action.id))));
    }
  }

  private async renderFixedAction({ action, id, source }: FixedIconRegistration): Promise<void> {
    const theme = this.theme(action.id);
    const image = this.health.state !== "ready" && id !== "new-task"
      ? renderFallbackKeycap("未接続", theme, this.language(action.id))
      : source.kind === "builtin"
      ? renderBuiltinKeycap(source.name, theme, this.language(action.id))
      : await this.keycapImage(source.keycapId, theme, this.language(action.id));
    await this.setImage(action, this.withOperationFeedback(action.id, image));
  }

  private async renderUsageLimit({ action, mode }: UsageLimitRegistration): Promise<void> {
    const window = selectUsageWindow(this.snapshot?.usage, mode);
    const requestedKind: UsageWindowKind = mode === "auto" ? (window?.kind ?? "other") : mode;
    await this.setImage(action, this.withOperationFeedback(action.id, renderUsageLimitKey(window, requestedKind, this.theme(action.id), this.health.state, this.usageFreshness(), this.language(action.id))));
  }

  private async renderUsageOverview(action: KeyAction): Promise<void> {
    await this.setImage(action, this.withOperationFeedback(action.id, renderUsageOverviewKey(
      this.snapshot?.usage?.windows ?? [], this.theme(action.id), this.health.state, this.usageFreshness(), this.language(action.id))));
  }

  private async renderContextCompaction({ action }: ContextCompactionRegistration): Promise<void> {
    const feedback = this.contextCompactionFeedback.get(action.id);
    const state = feedback?.state
      ?? (this.health.state !== "ready"
        ? healthToContextDisplayState(this.health.state)
        : Number.isFinite(this.snapshot?.activeContextUsedPercent) ? "ready" : "unknown");
    await this.setImage(action, this.withOperationFeedback(action.id, renderContextCompactionKey({
      ...(this.snapshot?.activeContextUsedPercent == null ? {} : { contextUsedPercent: this.snapshot.activeContextUsedPercent }),
      ...(this.snapshot?.activeContextRevision == null ? {} : { contextRevision: this.snapshot.activeContextRevision }),
      health: this.health.state,
      state,
      ...(feedback?.detail ? { detail: feedback.detail } : {}),
      theme: this.theme(action.id),
      language: this.language(action.id),
      animationFrame: this.frame(action.id)
    })));
  }

  private async renderRateLimitReset(action: KeyAction): Promise<void> {
    const startedAt = this.resetHolds.get(action.id);
    const progress = startedAt == null ? 0 : Math.min(1, (Date.now() - startedAt) / RESET_HOLD_MS);
    await this.setImage(action, this.withOperationFeedback(action.id, renderRateLimitResetKey(
      this.snapshot?.usage?.resetCreditsAvailable ?? null,
      progress,
      this.theme(action.id),
      this.health.state,
      { state: this.rateLimitResetDisplayState(startedAt != null), ...(startedAt == null ? {} : { detail: this.language(action.id) === "ja" ? "長押し中" : "HOLDING" }) },
      this.language(action.id),
      this.frame(action.id)
    )));
  }

  private usageFreshness(): UsageFreshness {
    const observedAt = this.snapshot?.usage?.observedAt;
    return observedAt == null ? {} : { observedAt };
  }

  private rateLimitResetDisplayState(holding: boolean): DisplayLifecycleState {
    if (this.health.state === "connecting") return "connecting";
    if (this.health.state === "offline") return "offline";
    if (this.health.state === "degraded") return "unavailable";
    const observedAt = this.snapshot?.usage?.observedAt;
    if (observedAt == null) return "unknown";
    if (Date.now() - observedAt > 5 * 60 * 1000) return "stale";
    return holding ? "holding" : "ready";
  }

  private async renderAnimatedAction(actionId: string, render: () => Promise<void>): Promise<void> {
    const owner = this.currentKeyAction(actionId) ?? this.plusDials.get(actionId)?.action ?? render;
    await this.animatedActions.request(actionId, owner, render, (latest) => latest());
  }

  private async renderAnimated(): Promise<void> {
    const agents = [...this.agents.values()].filter(({ slot, action }) => {
      if (!this.agentMotionEnabled(action.id)) return false;
      const agent = this.snapshot?.slots[slot];
      const status = agent ? visualStatusFromMicro(agent.status) : "empty";
      return status === "thinking" || status === "input" || (this.health.state === "ready" && agent?.pendingQuestion === true);
    });
    const rotatingDials = [...this.plusDials.values()].filter(({ kind, action }) => {
      return kind !== "agents" && this.lastPhysicalDialRotations.has(action.id);
    }).map((registration) => {
      return this.renderAnimatedAction(registration.action.id, () => this.renderSafely("E_RENDER_PLUS_DIAL", registration.action.id, async () => {
        await this.renderPlusDial(registration);
      }));
    });
    await Promise.all([
      ...agents.map((entry) => this.renderAnimatedAction(entry.action.id, () => this.renderSafely("E_RENDER_AGENT", entry.action.id, () => this.renderAgent(entry)))),
      ...[...this.plusDials.values()].filter(({ kind, action }) => {
        const status = visualStatusFromMicro(this.snapshot?.slots[this.plusAgentSlot]?.status ?? "off");
        return kind === "agents" && this.actionPreferences.get(action.id)?.animation !== false && (status === "thinking" || status === "input");
      }).map((entry) => this.renderAnimatedAction(entry.action.id, () => this.renderSafely("E_RENDER_PLUS_DIAL", entry.action.id, () => this.renderPlusDial(entry)))),
      ...[...this.operationFeedback].filter(([id, state]) => this.actionPreferences.get(id)?.animation !== false && (state.phase === "held" || state.phase === "pending"))
        .map(([id]) => this.renderAnimatedAction(id, () => this.renderSafely("E_RENDER_ANIMATED_ACTION", id, async () => {
          const dial = this.plusDials.get(id);
          if (dial) await this.renderPlusDial(dial);
          else await this.renderCurrentKey(id);
        }))),
      ...[...this.contextCompactionFeedback].filter(([id, feedback]) => feedback.state === "pending" && this.actionPreferences.get(id)?.animation !== false)
        .map(([id]) => this.renderAnimatedAction(id, () => this.renderSafely("E_RENDER_CONTEXT_COMPACTION", id, () => this.renderContextCompactionForId(id)))),
      ...[...this.keyContacts].map(([id, contact]) => this.renderAnimatedAction(id, () => this.renderSafely("E_RENDER_ANIMATED_ACTION", id, async () => {
        if (this.currentKeyAction(id) !== contact.owner) {
          if (this.keyContacts.get(id) === contact) this.keyContacts.delete(id);
          return;
        }
        await this.renderCurrentKey(id);
      }))),
      ...rotatingDials,
      ...[...this.resetHolds.keys()].map(async (id) => {
        const action = this.rateLimitResetActions.get(id);
        if (action) await this.renderAnimatedAction(action.id, () => this.renderSafely("E_RENDER_RATE_RESET", action.id, () => this.renderRateLimitReset(action)));
      })
    ]);
  }

  private async setImage(action: KeyAction, image: string, onCommit?: () => void): Promise<void> {
    if (this.currentKeyAction(action.id) !== action) return;
    const incarnation = this.actionIncarnations.get(action.id) ?? 0;
    const preferences = this.actionPreferences.get(action.id);
    if (preferences) image = customizeKeyImage(image, preferences);
    const contact = this.keyContacts.get(action.id);
    const expiredContact = contact?.owner === action
      && !image.includes('data-key-contact%3D%22')
      && !image.includes('data-key-contact="')
      && Date.now() - contact.startedAt >= KEY_CONTACT_DURATION_MS ? contact : undefined;
    const requestedImage = { value: image, ...(expiredContact ? { expiredContact } : {}) };
    await this.keyRenders.request(action.id, incarnation, requestedImage, async (latest) => {
      if (this.currentKeyAction(action.id) !== action || (this.actionIncarnations.get(action.id) ?? 0) !== incarnation) return;
      if (this.lastImages.get(action.id) === latest.value) {
        onCommit?.();
        this.clearExpiredKeyContact(action.id, latest.expiredContact);
        return;
      }
      // The SDK can accept setImage while rejecting the paired setTitle. Do
      // not let lastImages claim the old pixels are still on hardware after
      // that partial write; the next render must retry the image.
      this.lastImages.delete(action.id);
      const [imageResult, titleResult] = await Promise.allSettled([
        action.setImage(latest.value),
        action.setTitle(""),
      ]);
      if (imageResult.status === "rejected") throw imageResult.reason;
      if (titleResult.status === "rejected") throw titleResult.reason;
      const currentAction = this.currentKeyAction(action.id);
      if (currentAction !== action || (this.actionIncarnations.get(action.id) ?? 0) !== incarnation) {
        if (currentAction) {
          this.lastImages.delete(action.id);
          await this.renderCurrentKey(action.id);
        }
        return;
      }
      this.lastImages.set(action.id, latest.value);
      onCommit?.();
      this.clearExpiredKeyContact(action.id, latest.expiredContact);
    });
  }

  private clearExpiredKeyContact(actionId: string, contact: KeyContact | undefined): void {
    if (contact && this.keyContacts.get(actionId) === contact) this.keyContacts.delete(actionId);
  }

  private currentKeyAction(actionId: string): KeyAction | undefined {
    return this.agents.get(actionId)?.action
      ?? this.microActions.get(actionId)?.action
      ?? this.fixedActions.get(actionId)?.action
      ?? this.usageLimitActions.get(actionId)?.action
      ?? this.usageOverviewActions.get(actionId)
      ?? this.contextCompactionActions.get(actionId)?.action
      ?? this.rateLimitResetActions.get(actionId);
  }

  isCurrentAction(action: ActionIdentity): boolean {
    const current = this.currentKeyAction(action.id) ?? this.plusDials.get(action.id)?.action;
    if (current) return current === action;
    // Preserve alerts for an input delivered before controller registration.
    // Once an id has participated in lifecycle, absence means it disappeared.
    return !this.actionIncarnations.has(action.id);
  }

  private async renderCurrentKey(actionId: string): Promise<void> {
    const agent = this.agents.get(actionId);
    if (agent) return this.renderAgent(agent);
    const microAction = this.microActions.get(actionId);
    if (microAction) return this.renderMicroAction(microAction);
    const fixed = this.fixedActions.get(actionId);
    if (fixed) return this.renderFixedAction(fixed);
    const usage = this.usageLimitActions.get(actionId);
    if (usage) return this.renderUsageLimit(usage);
    const overview = this.usageOverviewActions.get(actionId);
    if (overview) return this.renderUsageOverview(overview);
    const contextCompaction = this.contextCompactionActions.get(actionId);
    if (contextCompaction) return this.renderContextCompaction(contextCompaction);
    const reset = this.rateLimitResetActions.get(actionId);
    if (reset) await this.renderRateLimitReset(reset);
  }

  private markPageLifecycle<T>(
    registrations: Map<string, T>,
    action: ActionIdentity,
    registeredAction: (registration: T) => ActionIdentity,
  ): void {
    const current = registrations.get(action.id);
    if (current && registeredAction(current) === action) return;
    this.advanceActionIncarnation(action.id);
    if (!current && this.visibleActionIds.size === 0) this.microBridge.advancePageEpoch();
    this.visibleActionIds.add(action.id);
  }

  private unregisterWithPageLifecycle<T>(
    action: ActionIdentity,
    registrations: Map<string, T>,
    registeredAction: (registration: T) => ActionIdentity,
  ): boolean {
    const current = registrations.get(action.id);
    if (!current || registeredAction(current) !== action) return false;
    this.unmarkPageLifecycle(registrations, action.id);
    registrations.delete(action.id);
    this.advanceActionIncarnation(action.id);
    return true;
  }

  private unmarkPageLifecycle<T>(registrations: Map<string, T>, actionId: string): void {
    if (!registrations.has(actionId)) return;
    this.visibleActionIds.delete(actionId);
    if (this.visibleActionIds.size === 0) this.microBridge.advancePageEpoch();
  }

  private advanceActionIncarnation(actionId: string): void {
    this.actionIncarnations.set(actionId, (this.actionIncarnations.get(actionId) ?? 0) + 1);
    this.feedbackSequences.set(actionId, (this.feedbackSequences.get(actionId) ?? 0) + 1);
    this.feedbackRenderQueues.delete(actionId);
    this.keyRenders.detach(actionId);
    this.lastPhysicalDialRotations.delete(actionId);
    this.lastPhysicalDialDirections.delete(actionId);
    this.lastImages.delete(actionId);
    this.operationFeedback.delete(actionId);
    this.retainedPressResults.delete(actionId);
    this.pressFeedbackTokens.delete(actionId);
    this.renderedAgentBindings.delete(actionId);
    this.keyContacts.delete(actionId);
    this.clearContextCompactionFeedbackTimer(actionId);
    this.contextCompactionFeedback.delete(actionId);
    this.resetFeedbackTokens.delete(actionId);
    this.displayOverrideOwners.delete(actionId);
    this.displayPttOwners.delete(actionId);
  }

  private scheduleRefresh(): void {
    if (this.stopped) return;
    this.poll = setTimeout(async () => {
      try { await this.refresh(); }
      finally { this.scheduleRefresh(); }
    }, 1_200);
  }

  private wakeAnimation(): void {
    if (!this.animation || this.animationDelay <= 33) return;
    clearTimeout(this.animation);
    this.scheduleAnimation();
  }

  private scheduleAnimation(): void {
    if (this.stopped) return;
    const interacting = this.lastPhysicalDialRotations.size > 0
      || this.keyContacts.size > 0
      || [...this.operationFeedback].some(([id, state]) => this.actionPreferences.get(id)?.animation !== false
        && (state.phase === "held" || state.phase === "pending"))
      || [...this.contextCompactionFeedback].some(([id, feedback]) => this.actionPreferences.get(id)?.animation !== false
        && feedback.state === "pending")
      || [...this.agents.values()].some(({ slot, action }) => this.agentMotionEnabled(action.id)
        && (['thinking', 'input'].includes(visualStatusFromMicro(this.snapshot?.slots[slot]?.status ?? 'off'))
          || this.snapshot?.slots[slot]?.pendingQuestion === true))
      || [...this.plusDials.values()].some(({ kind, action }) => kind === 'agents' && this.actionPreferences.get(action.id)?.animation !== false
        && ['thinking', 'input'].includes(visualStatusFromMicro(this.snapshot?.slots[this.plusAgentSlot]?.status ?? 'off')))
      || this.resetHolds.size > 0;
    this.animationDelay = interacting ? 33 : 200;
    this.animation = setTimeout(async () => {
      this.animation = undefined;
      this.animationFrame = ((Date.now() - this.animationOrigin) / 200) % 12;
      this.scheduleAnimation();
      await this.renderAnimated();
    }, this.animationDelay);
  }

  private keycapImage(keycapId: string, theme: "light" | "dark", language: "ja" | "en"): Promise<string> {
    const catalog = renderCatalogKeycap(keycapId, theme, language);
    if (catalog) return Promise.resolve(catalog);
    const cacheKey = `${theme}:${language}:${keycapId}`;
    const existing = this.keycapImages.get(cacheKey);
    if (existing) return existing;
    const pending = readUserIconSvg(USER_ICON_ROOT, keycapId)
      .then((svg) => renderImportedKeycap(svg, theme))
      .catch(() => renderFallbackKeycap(keycapId, theme, language));
    this.keycapImages.set(cacheKey, pending);
    return pending;
  }
}

function truncateFeedback(value: string, limit: number): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return clean.length > limit ? `${clean.slice(0, Math.max(0, limit - 1))}…` : clean;
}

/** The verified renderer snapshot has no current-effort field, so report only the requested operation. */
export function reasoningDialValue(health: string, adjustment?: ReasoningAdjustment, current?: string | null): string {
  const operation = adjustment === "increase" ? "上げる操作を送信"
    : adjustment === "decrease" ? "下げる操作を送信" : "操作待ち";
  const currentValue = current ? truncateFeedback(current, 12) : "未取得";
  return `${health} · 現在値 ${currentValue} · ${operation}`;
}

function localizedDialFeedbackStatus(status: ReturnType<typeof renderPlusDialFeedback>["status"]): string {
  switch (status) {
    case "ready": return "準備完了";
    case "pressed": return "押下中";
    case "pending": return "確認中";
    case "recording": return "録音中";
    case "confirmed": return "確認済み";
    case "error": return "失敗";
    case "stale": return "期限切れ";
    case "offline": return "未接続";
    case "connecting": return "接続中";
    case "unknown": return "不明";
    case "unavailable": return "利用不可";
  }
}

function healthToContextDisplayState(health: HostHealth["state"]): DisplayLifecycleState {
  switch (health) {
    case "ready": return "ready";
    case "connecting": return "connecting";
    case "offline": return "offline";
    case "degraded": return "unavailable";
  }
}
