import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  codexDebugTargetKey,
  discoverDebugPort,
  enumerateCodexMainTargets,
  FOREGROUND_RENDERER_PROBE_EXPRESSION,
  fetchJson,
  resolveForegroundCodexTarget,
  selectCodexObservationTarget,
  type DebugTarget,
  type RendererFocusState,
} from "./codex-debug-discovery.js";
export {
  enumerateCodexMainTargets,
  FOREGROUND_RENDERER_PROBE_EXPRESSION,
  listenerBelongsToProcess,
  parseCodexDebugProcesses,
  resolveForegroundCodexTarget,
  resolveMacCodexDebugPort,
  selectCodexMainTarget,
  type CodexDebugProcess,
  type RendererFocusState,
} from "./codex-debug-discovery.js";
import { resolveEffectivePhysicalSlot } from "./effective-layout.js";
import {
  AgentWindowCreationGuard,
  assertAgentSourceUnchanged,
  localAgentWindowPath,
  selectAgentWindowFromCompleteScan,
  type AgentWindowObservation,
} from "./agent-window-routing.js";
import {
  AGENT_WINDOW_PROBE_EXPRESSION,
  CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION,
  readAgentWindowProbe,
  type AgentWindowProbe,
} from "./agent-window-probe.js";
import type { UnopenedTaskBehavior } from "./action-preferences.js";
import { OFFICIAL_KEYCAP_IDS, type OfficialKeycapId } from "./keycaps.js";
import {
  CONTENT_FREE_COMMANDS,
  contentFreeSurface,
  installMarkdownCopyObserver,
  NATIVE_UI_KEYCAPS,
  observeContentFreeResult,
  observeNativeUiResult,
  type ContentFreeCommand,
  type ContentFreeSurface,
  type NativeUiKeycap,
  type NativeUiSurface,
} from "./command-result-observer.js";
import { CodexSessionOwnershipIndex } from "./session-ownership.js";
import { trustedRendererAssetUrls, validateLoopbackWebSocketUrl } from "./renderer-security.js";
import {
  DRAFT_TRANSFER_FAILURE_CODES,
  focusSelectedComposerForPtt,
  MODEL_PICKER_FAILURE_CODES,
  matchesActiveThreadSelection,
  moveSideDraftToMainInDocument,
  readAgentSlotMetadata,
  agentSlotMetadataNamespace,
  readFocusedModelCandidate,
  readNativeUiSurface,
  readNativeCurrentModel,
  selectActiveComposerState,
  selectBoundModelPicker,
  selectNativeCommandRunner,
  selectNativeCommandScope,
  selectNativeModelPickerOwner,
  selectVerifiedOpenedSideChat,
} from "./renderer-runtime.js";
export {
  DRAFT_TRANSFER_FAILURE_CODES,
  focusSelectedComposerForPtt,
  MODEL_PICKER_FAILURE_CODES,
  matchesActiveThreadSelection,
  moveSideDraftToMainInDocument,
  readAgentSlotMetadata,
  agentSlotMetadataNamespace,
  readFocusedModelCandidate,
  readNativeUiSurface,
  readNativeCurrentModel,
  selectActiveComposerState,
  selectBoundModelPicker,
  selectNativeCommandRunner,
  selectNativeCommandScope,
  selectNativeModelPickerOwner,
  selectVerifiedOpenedSideChat,
  type ActiveComposerState,
  type AgentSlotMetadata,
  type ModelPickerFailureCode,
  type NativeCurrentModel,
  type NativeUiRoute,
  type NativeUiSurface,
} from "./renderer-runtime.js";
import { readResetAttempt, writeResetAttempt } from "./reset-outcome-store.js";
import type { PersistedResetAttempt } from "./reset-outcome-store.js";
import type {
  MicroActionSlot,
  MicroDirection,
  MicroSnapshot,
  MutationConfirmation,
  OperationRequest,
  PhysicalInputPhase,
  RateLimitResetOutcome,
  ReasoningAdjustment
} from "./types.js";
import {
  OperationIntegrityGuard,
  assertFreshActiveThread,
  assertFreshOperationTarget,
  integrityError,
} from "./operation-integrity.js";
export { OperationIntegrityGuard, assertFreshActiveThread, assertFreshOperationTarget } from "./operation-integrity.js";

type CdpResponse = {
  id?: number;
  result?: { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
  error?: { message?: string };
};

type OperationTargetLease = {
  socket: WebSocket;
  targetIdentity: string;
  connectionEpoch: number;
};

const AGENT_ACTIVATION_TIMEOUT_MS = 1500;
const AGENT_ACTIVATION_POLL_MS = 25;
const AGENT_ACTIVATION_TARGET_TRANSITION_CODES = new Set([
  "E_CONNECTION_STALE",
  "E_FOREGROUND_TARGET_STALE",
  "E_FOREGROUND_TARGET_UNAVAILABLE",
  "E_RELEASE_TARGET_GONE",
  "E_TARGET_STALE",
]);

function agentActivationExpression(threadKey: string, alreadyActive: boolean, timeoutMs: number): string {
  return `(async () => {
      const threadKey = ${JSON.stringify(threadKey)};
      const alreadyActive = ${JSON.stringify(alreadyActive)};
      const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
      const isForeground = () => document.hasFocus() && document.visibilityState === "visible";
      const matchesActiveThread = () => alreadyActive
        ? isForeground() && resolveActiveComposer(document).activeThreadKey === threadKey
        : isForeground() && (${matchesActiveThreadSelection.toString()})(document, threadKey, resolveActiveComposer);
      const waitForActive = async (duration) => {
        const deadline = Date.now() + duration;
        while (Date.now() < deadline) {
          if (matchesActiveThread()) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return matchesActiveThread();
      };
      return waitForActive(${Math.max(1, Math.floor(timeoutMs))});
    })()`;
}


import { RENDERER_FAILURE_CODES, RESET_FAILURE_CODES } from "./failure-codes.js";
export { RENDERER_FAILURE_CODES, RESET_FAILURE_CODES } from "./failure-codes.js";

const RENDERER_FAILURE_CODE_SET: ReadonlySet<string> = new Set(RENDERER_FAILURE_CODES);

/** Preserve only non-content renderer codes that are safe to expose in local diagnostics. */
export function rendererFailureCode(response: CdpResponse): string | undefined {
  const details = response.result?.exceptionDetails;
  if (!details) return undefined;
  const candidates = [details.text, details.exception?.description];
  for (const candidate of candidates) {
    const firstLine = candidate?.split("\n", 1)[0]?.trim() ?? "";
    const code = /^(?:Uncaught \(in promise\) )?(?:Error: )?(E_[A-Z0-9_]+)$/.exec(firstLine)?.[1];
    if (code && RENDERER_FAILURE_CODE_SET.has(code)) return code;
  }
  return undefined;
}

function isFocusedVisibleRenderer(value: unknown): value is RendererFocusState {
  const state = value as Partial<RendererFocusState> | null;
  return state?.hasFocus === true && state.visibilityState === "visible";
}

/** Fail closed at the final synchronous boundary before a renderer mutation. */
export function assertFocusedVisibleRendererForMutation(documentLike: {
  hasFocus(): boolean;
  visibilityState: string;
}): void {
  if (!documentLike.hasFocus() || documentLike.visibilityState !== "visible") {
    throw new Error("E_FOREGROUND_TARGET_STALE");
  }
}

export function assertOperationTargetIdentity(
  operation: OperationRequest,
  targetIdentity: string,
  connectionEpoch: number
): void {
  if (operation.targetIdentity !== targetIdentity || operation.connectionEpoch !== connectionEpoch) {
    throw integrityError("E_TARGET_STALE");
  }
}

async function probeDebugTargetFocus(target: DebugTarget, port: number): Promise<RendererFocusState | undefined> {
  if (!target.webSocketDebuggerUrl) return undefined;
  let debuggerUrl: string;
  try {
    debuggerUrl = validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl, port);
  } catch {
    return undefined;
  }
  return await new Promise<RendererFocusState | undefined>((resolve) => {
    const socket = new WebSocket(debuggerUrl);
    let settled = false;
    const finish = (value?: RendererFocusState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 1500);
    socket.once("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression: FOREGROUND_RENDERER_PROBE_EXPRESSION, returnByValue: true }
    })));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw)) as CdpResponse;
        if (message.id !== 1 || message.error || message.result?.exceptionDetails) return;
        const value = message.result?.result?.value;
        finish(isFocusedVisibleRenderer(value) ? value : undefined);
      } catch {
        finish();
      }
    });
    socket.once("error", () => finish());
    socket.once("close", () => finish());
  });
}

export async function sendDebugTargetCommand<T>(
  target: DebugTarget,
  port: number,
  method: string,
  params: object = {},
  timeoutMs = 7000,
): Promise<T> {
  if (!target.webSocketDebuggerUrl) throw integrityError("E_FOREGROUND_TARGET_UNAVAILABLE");
  const debuggerUrl = validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl, port);
  return await new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(debuggerUrl);
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => undefined);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error("Codex-Runtime-Antwort hat zu lange gedauert.")), timeoutMs);
    socket.once("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(String(raw)) as CdpResponse;
        if (message.id !== 1) return;
        if (message.error) return finish(integrityError("E_CDP_PROTOCOL"));
        if (message.result?.exceptionDetails) {
          return finish(integrityError(rendererFailureCode(message) ?? "E_RENDERER_EVALUATION"));
        }
        const value = method === "Runtime.evaluate"
          ? message.result?.result?.value as T
          : message.result as T;
        finish(undefined, value);
      } catch {
        finish(integrityError("E_CDP_PROTOCOL"));
      }
    });
    socket.once("error", () => finish(integrityError("E_DEBUG_WEBSOCKET_CONNECT")));
    socket.once("close", () => finish(integrityError("E_RELEASE_TARGET_GONE")));
  });
}

export type AgentWindowRoutingTransport = {
  discoverPort(): Promise<number>;
  listTargets(port: number): Promise<DebugTarget[]>;
  command<T>(target: DebugTarget, port: number, method: string, params?: object, timeoutMs?: number): Promise<T>;
};

const DEFAULT_AGENT_WINDOW_ROUTING_TRANSPORT: AgentWindowRoutingTransport = {
  discoverPort: () => discoverDebugPort(),
  listTargets: (port) => fetchJson<DebugTarget[]>(`http://127.0.0.1:${port}/json/list`),
  command: sendDebugTargetCommand,
};

/** Refuse to use Electron's stale initialRoute query as live window identity. */
export function selectBridgeObservationTarget(
  targets: DebugTarget[],
  foreground: DebugTarget | undefined,
  lastTargetKey = "",
): DebugTarget | undefined {
  const candidates = enumerateCodexMainTargets(targets);
  const hasCurrentStickyTarget = Boolean(lastTargetKey)
    && candidates.some((candidate) => codexDebugTargetKey(candidate) === lastTargetKey);
  if (!foreground && candidates.length > 1 && !hasCurrentStickyTarget) return undefined;
  return selectCodexObservationTarget(targets, foreground, lastTargetKey);
}


export type AgentDispatchPlan = { kind: "native"; slot: number; threadKey: string };

type LeasedNativeInputId =
  | "AG00" | "AG01" | "AG02" | "AG03" | "AG04" | "AG05"
  | "ACT06" | "ACT07" | "ACT08" | "ACT09" | "ACT12";

type LeasedNativeInput = {
  operation: OperationRequest;
  socket: WebSocket;
  releaseAttempted: boolean;
  releaseEvent: { key: LeasedNativeInputId; act: 0; slot: number | null; threadKey: string | null };
};

function isLeasedNativeInputId(value: string): value is LeasedNativeInputId {
  return /^AG0[0-5]$/u.test(value) || /^ACT(?:0[6-9]|12)$/u.test(value);
}

export function resolveAgentDispatch(
  snapshot: MicroSnapshot,
  requestedSlot: number,
  expectedThreadKey?: string
): AgentDispatchPlan {
  const requested = snapshot.slots.find((item) => item.id === requestedSlot);
  if (!requested?.threadKey) throw new Error(`Agent slot ${requestedSlot + 1} has no stable thread identity.`);
  if (expectedThreadKey && requested.threadKey !== expectedThreadKey) {
    throw new Error(`Agent slot ${requestedSlot + 1} changed before dispatch; reselect the task.`);
  }
  return { kind: "native", slot: requestedSlot, threadKey: requested.threadKey };
}

export const CURRENT_NATIVE_BRIDGE_SHA256 = "e1d0c6735f800771786f74cc358709fae55ebcf2df497389945d8ea821dc7cb5";
export const CURRENT_APP_INITIAL_SHA256 = "73594359b28d81b6fcc9a52aac808f6a2e9fc32ced661adb3e23d297827b9285";
export const CURRENT_APP_PRIMARY_SHA256 = "35d81a22c75f5a44b58baee0c0045ba6bb36cc9b387f43fab82178b4a2236849";
export const CURRENT_MICRO_COMMANDS_SHA256 = "04ba51ff62ad90c744b4870ee8308fb1f1375cceb37ae2ffc9158cbe07cedde9";
export const CURRENT_MICRO_LAYOUT_ASSET = "codex-micro-layout-aced36735c61.js";
export const CURRENT_MICRO_LAYOUT_SHA256 = "7ee5d329de13768e246e99193bb4813ecf54b512ebf6f0a9ccfda38fe53f334c";
// Audited against installed Codex 26.903.61454. Only model UI and explicitly listed keycaps
// use this contract; other operations retain their separately audited pins.
export const DIAL_RUNTIME_26903 = {
  primary: "0aa689053d9e32d7286dfb1d85ac62cadc3858086335518f15b1f97604eb61e9",
  bridge: "453a1b06114708bc37b5a889c583dc2b5b19887cd9d95d42e82a1dd15ce9a3ce",
  initial: "c87b94027faefdc31cc165975dc0f14b28e3f6d922f6a5188756c8f570f2b3d7",
  commands: "7ab9684b8daf493552e08e9be7db0ed235b17c6e9d1dec49f6b339e0f1421e84",
  layoutAsset: "codex-micro-layout-7db62f4a0fe5.js",
  layout: "b639ace41c685a334271a5a27f3d426cd639993bfb166f4c43825ecb06abd9b7",
} as const;
export const REVIEWED_STANDALONE_KEYCAPS_26903: Partial<Record<OfficialKeycapId, { type: string; url?: string; text?: string }>> = {
  OAI: { type: "external-url", url: "https://developers.openai.com" },
  YOLO: { type: "composer-text", text: ":yolo:" },
  YEET: { type: "composer-text", text: ":yeet:" },
};

export const REVIEWED_KEYCAP_COMMANDS_26903: Partial<Record<OfficialKeycapId, { command: string; requiredAccess: string | null }>> = {
  FAST: { command: "composer.toggleFastMode", requiredAccess: null },
  "MIND+": { command: "composer.increaseReasoningEffort", requiredAccess: null },
  "MIND-": { command: "composer.decreaseReasoningEffort", requiredAccess: null },
  TERM: { command: "toggleTerminal", requiredAccess: "codexLocal" },
  DIFF: { command: "toggleReviewTab", requiredAccess: "codexLocal" },
  NAV: { command: "openBrowserTab", requiredAccess: null },
  SETUP: { command: "settings", requiredAccess: null },
  APPS: { command: "openSkills", requiredAccess: "codexLocal" },
  NEW: { command: "newTask", requiredAccess: null },
  SPLIT: { command: "forkThread", requiredAccess: null },
  DEL: { command: "archiveThread", requiredAccess: null },
  LAB: { command: "settings", requiredAccess: null },
  DWN: { command: "copyConversationMarkdown", requiredAccess: null },
  PARTY: { command: "openSideChat", requiredAccess: "codexLocal" },
  TIME: { command: "manageTasks", requiredAccess: null },
  FOLD: { command: "openFolder", requiredAccess: "codexOrWorkLocal" },
  GIT: { command: "git.commit", requiredAccess: "codexLocal" },
  APPR: { command: "approval.approve", requiredAccess: null },
  REJ: { command: "approval.decline", requiredAccess: null },
  CODEX: { command: "composer.submit", requiredAccess: null },
  BUG: { command: "feedback", requiredAccess: null },
  MAGIC: { command: "toggleThreadPin", requiredAccess: null },
  PLAY: { command: "environmentAction1", requiredAccess: null },
  BRCH: { command: "git.createDraftPullRequest", requiredAccess: null },
  BRANCH: { command: "git.createBranch", requiredAccess: null },
  MRG: { command: "git.mergePullRequest", requiredAccess: null },
  PR: { command: "git.createPullRequest", requiredAccess: "codexLocal" },
  PAINT: { command: "composer.addPhotos", requiredAccess: null },
  UPL: { command: "composer.addFiles", requiredAccess: null },
};
export const ALLOWED_NATIVE_EXTERNAL_URLS = ["https://developers.openai.com/"] as const;

/**
 * Format a renderer URL for local diagnostics without copying URL credentials
 * or opaque query/hash data into the plugin log. The original URL remains
 * available to the connection code; this helper is only for log presentation.
 */
export function safeRendererTargetLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.protocol || !parsed.hostname) return "renderer";
    return `${parsed.protocol}//${parsed.host}${parsed.pathname || "/"}`;
  } catch {
    return "renderer";
  }
}

const INPUT_ONLY_DEVICE_STATE = {
  type: "codex-micro-device-state-changed",
  // This synthetic event mounts Codex's native input handlers. It does not
  // represent a measured hardware connection, battery, or lighting plane.
  state: { status: "connected", error: null, controlPlaneStatus: "unavailable", battery: null }
};

export const REASONING_KEYCAP_IDS: Record<ReasoningAdjustment, "MIND+" | "MIND-"> = {
  decrease: "MIND-",
  increase: "MIND+"
};

/** Native Micro's physical encoder click key. ENC is not a valid click event. */
export const NATIVE_ENCODER_CLICK_KEY = "ENC_CLK" as const;

/** Accept only an observed native query update time; absence must stay unknown. */
export function verifiedUsageObservedAt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

type NativeMicroHostBus = {
  dispatchHostMessage(message: unknown): unknown;
};

type NativeExternalUrlOpener = (options: {
  href: string;
  initiator: string;
}) => unknown;

type NativeComposerTextController = {
  view: { isDestroyed?: boolean; dom: Element };
  getPersistedText(): string;
  setText(text: string): void;
  focus(): void;
};

/** Select the exact host-message owner imported by the current native Micro bridge. */
export function selectNativeMicroHostBus(
  namespace: Record<string, unknown>,
  observedAppInitialSha256: string,
  expectedAppInitialSha256: string,
): NativeMicroHostBus | undefined {
  if (observedAppInitialSha256 !== expectedAppInitialSha256) return undefined;
  const candidate = namespace.Kun as Partial<NativeMicroHostBus> | undefined;
  return candidate && typeof candidate.dispatchHostMessage === "function"
    ? candidate as NativeMicroHostBus
    : undefined;
}

/** Select the exact external-link opener imported by the current native Micro bridge. */
export function selectNativeExternalUrlOpener(
  namespace: Record<string, unknown>,
  observedAppInitialSha256: string,
  expectedAppInitialSha256: string,
): NativeExternalUrlOpener | undefined {
  if (observedAppInitialSha256 !== expectedAppInitialSha256) return undefined;
  const candidate = namespace.d2t;
  return typeof candidate === "function" ? candidate as NativeExternalUrlOpener : undefined;
}

/** Canonicalize an absolute HTTPS URL and accept only an exact product allowlist entry. */
export function allowlistedNativeExternalUrl(
  raw: unknown,
  allowedUrls: readonly string[],
): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return undefined;
  let candidate: URL;
  try { candidate = new URL(raw); }
  catch { return undefined; }
  if (candidate.protocol !== "https:" || candidate.username || candidate.password) return undefined;
  return allowedUrls.includes(candidate.href) ? candidate.href : undefined;
}

/**
 * Resolve the unique committed composer controller for content-free mutation
 * readback. The controller text never leaves the renderer expression.
 */
export function selectNativeComposerTextController(
  composerRoot: Element | null,
): NativeComposerTextController | undefined {
  if (!composerRoot || composerRoot.isConnected !== true) return undefined;
  const fiberKeys = Object.getOwnPropertyNames(composerRoot).filter((key) => key.startsWith("__reactFiber$"));
  if (fiberKeys.length !== 1) return undefined;
  let attachedFiber: any = (composerRoot as any)[fiberKeys[0]!];
  if (!attachedFiber) return undefined;
  let attachedRoot = attachedFiber;
  while (attachedRoot.return) attachedRoot = attachedRoot.return;
  const committedRoot = attachedRoot.stateNode?.current;
  if (!committedRoot || attachedRoot.tag !== 3 || committedRoot.tag !== 3
    || committedRoot.stateNode !== attachedRoot.stateNode) return undefined;

  const queue: any[] = [committedRoot];
  const seen = new Set<any>();
  let hostFiber: any = null;
  while (queue.length && seen.size < 30000) {
    const fiber = queue.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    if (fiber.stateNode === composerRoot) {
      if (hostFiber) return undefined;
      hostFiber = fiber;
    }
    for (let child = fiber.child; child; child = child.sibling) queue.push(child);
  }
  if (!hostFiber) return undefined;

  const candidates: NativeComposerTextController[] = [];
  queue.length = 0;
  seen.clear();
  for (let child = hostFiber.child; child; child = child.sibling) queue.push(child);
  while (queue.length && seen.size < 5000) {
    const fiber = queue.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const candidate = fiber.memoizedProps?.composerController as NativeComposerTextController | undefined;
    if (candidate && !candidates.includes(candidate)
      && typeof candidate.getPersistedText === "function"
      && typeof candidate.setText === "function"
      && typeof candidate.focus === "function"
      && candidate.view?.dom
      && !candidate.view.isDestroyed
      && composerRoot.contains(candidate.view.dom)) candidates.push(candidate);
    for (let child = fiber.child; child; child = child.sibling) queue.push(child);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Verify that the native controller performed one lossless insertion. */
export function isExactComposerTextInsertion(
  before: string,
  after: string,
  inserted: string,
): boolean {
  if (!inserted || after.length !== before.length + inserted.length) return false;
  for (let index = 0; index <= before.length; index += 1) {
    if (after.slice(0, index) === before.slice(0, index)
      && after.slice(index, index + inserted.length) === inserted
      && after.slice(index + inserted.length) === before.slice(index)) return true;
  }
  return false;
}


/**
 * Commands whose meaning is tied to the task/composer visible at key-down.
 * The renderer rechecks this identity immediately before invoking the action.
 */
export const VIEW_SCOPED_KEYCAP_IDS = [
  "FAST", "APPR", "REJ", "SPLIT", "MIND+", "MIND-", "CODEX", "TERM", "DWN", "DEL",
  "MAGIC", "DIFF", "PLAY", "GIT", "BRCH", "BRANCH", "MRG", "PR", "PAINT", "PARTY", "UPL", "YOLO", "YEET"
] as const satisfies readonly OfficialKeycapId[];

type ActiveViewTransition = "forked" | "archived" | "new-task";

type OperationPostcondition = {
  kind: "side-chat-opened";
  activeThreadKey: string;
  activeComposerKey: string;
  sideComposerKey: string;
} | {
  kind: "external-url-dispatched";
  activeThreadKey: null;
  activeComposerKey: null;
} | {
  kind: "composer-text-inserted";
  activeThreadKey: string | null;
  activeComposerKey: string;
} | {
  kind: "active-view-transition";
  transition: ActiveViewTransition;
  fromActiveThreadKey: string | null;
  fromActiveComposerKey: string | null;
  activeThreadKey: string | null;
  activeComposerKey: string | null;
} | {
  kind: "native-ui-changed";
  keycapId: NativeUiKeycap;
  before: NativeUiSurface;
  after: NativeUiSurface;
};

function isNativeUiSurface(value: unknown): value is NativeUiSurface {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeUiSurface>;
  const route = candidate.route;
  const validRoute = route === null || route === "settings" || route === "codex-micro-settings"
    || route === "skills" || route === "other";
  return validRoute
    && typeof candidate.terminalVisible === "boolean"
    && typeof candidate.reviewVisible === "boolean"
    && typeof candidate.browserTabCount === "number"
    && Number.isSafeInteger(candidate.browserTabCount)
    && candidate.browserTabCount >= 0;
}

const KEYCAP_ACTIVE_VIEW_TRANSITIONS: Partial<Record<OfficialKeycapId, {
  command: string;
  transition: ActiveViewTransition;
}>> = {
  SPLIT: { command: "forkThread", transition: "forked" },
  DEL: { command: "archiveThread", transition: "archived" },
  NEW: { command: "newTask", transition: "new-task" },
};

const SNAPSHOT_EXPRESSION = `(async () => {
  const verifiedUsageObservedAt = (${verifiedUsageObservedAt.toString()});
  const discoveredUrls = [...new Set([
    ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
    ...performance.getEntriesByType('resource').map((entry) => entry.name)
  ])];
  const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
  const slotSignalsUrl = urls.find((url) => url.includes('/assets/codex-micro-slot-signals-'));
  if (!slotSignalsUrl) throw new Error('Codex Micro slot signals are not loaded.');

  const namespaces = [];
  for (const url of urls) {
    try { namespaces.push(await import(url)); } catch {}
  }
  const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
  const definitions = exportedValues.find((candidate) =>
    candidate && typeof candidate === 'object' &&
    candidate.layout?.key === 'codex-micro-layout' &&
    candidate.agentSource?.key === 'codex-micro-agent-source'
  );
  if (!definitions) throw new Error('Codex Micro settings definitions were not found.');

  const bus = exportedValues.find((candidate) => candidate && typeof candidate === 'object' && candidate.handlers instanceof Map && (typeof candidate.dispatchHostMessage === 'function' || typeof candidate.dispatchMessage === 'function'));
  if (!bus) throw new Error('Codex VS Code event bus was not found.');
  const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
  if ((bus.handlers.get('codex-micro-hid-event')?.size ?? 0) === 0) {
    dispatch.call(bus, ${JSON.stringify(INPUT_ONLY_DEVICE_STATE)});
  }
  const root = document.getElementById('root');
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith('__reactContainer$'));
  if (!root || !reactKey) throw new Error('Codex React root was not found.');

  const slotSignals = await import(slotSignalsUrl);
  const resolvers = Object.values(slotSignals).filter((candidate) =>
    candidate && typeof candidate === 'object' &&
    typeof candidate.resolve === 'function' &&
    typeof candidate.createSubscriberAtom === 'function'
  );
  if (resolvers.length === 0) throw new Error('Codex Micro slot resolver was not found.');

  let queue = [root[reactKey]];
  const seen = new Set();
  const queryClients = new Set();
  let found = null;
  while (queue.length && seen.size < 30000 && !found) {
    const fiber = queue.pop();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);
    const maps = [];
    const contextValues = [fiber.memoizedProps?.value];
    let dependency = fiber.dependencies?.firstContext;
    while (dependency) {
      contextValues.push(dependency.memoizedValue);
      dependency = dependency.next;
    }
    for (const value of contextValues) {
      if (value instanceof Map) maps.push(value);
      if (value && typeof value.getQueryCache === 'function' && typeof value.getQueryData === 'function') queryClients.add(value);
    }
    for (const chain of maps) {
      for (const node of chain.values()) {
        if (!node?.store || typeof node.store.get !== 'function') continue;
        for (const resolver of resolvers) {
          try {
            const atom = resolver.resolve(node, chain);
            const slots = node.store.get(atom);
            if (Array.isArray(slots) && slots.length === 6 && slots.every((slot, index) => slot?.id === index)) {
              found = { chain, node, slots };
              break;
            }
          } catch {}
        }
        if (found) break;
      }
      if (found) break;
    }
    queue.push(fiber.child, fiber.sibling);
  }
  if (!found) throw new Error('Codex Micro slot store was not found.');

  let layout = definitions.layout.default;
  let agentSource = definitions.agentSource.default;
  let lightingAutoOff = definitions.lightingAutoOff?.default ?? '3-minutes';

  let settingsResolved = false;
  const directSettingReader = exportedValues.find((candidate) => {
    if (typeof candidate !== 'function' || candidate.length !== 1) return false;
    const source = Function.prototype.toString.call(candidate);
    return source.includes('get-setting') && source.includes('.default');
  });
  if (directSettingReader) {
    try {
      const candidateLayout = await directSettingReader(definitions.layout);
      const candidateAgentSource = await directSettingReader(definitions.agentSource);
      const candidateLightingAutoOff = definitions.lightingAutoOff
        ? await directSettingReader(definitions.lightingAutoOff)
        : lightingAutoOff;
      if (
        candidateLayout?.version === 1 &&
        typeof candidateLayout.slots === 'object' &&
        ['pinned', 'recent', 'priority', 'custom'].includes(candidateAgentSource)
      ) {
        layout = candidateLayout;
        agentSource = candidateAgentSource;
        if (typeof candidateLightingAutoOff === 'string') lightingAutoOff = candidateLightingAutoOff;
        settingsResolved = true;
      }
    } catch {}
  }

  if (!settingsResolved) {
    const settingReaders = exportedValues.filter((candidate) => {
      if (typeof candidate !== 'function' || candidate.length !== 2) return false;
      const source = Function.prototype.toString.call(candidate);
      return source.includes('.key') && source.includes('.default');
    });
    const getStoreValue = found.node.store.get.bind(found.node.store);
    for (const readSetting of settingReaders) {
      try {
        const candidateLayout = await readSetting(getStoreValue, definitions.layout);
        const candidateAgentSource = await readSetting(getStoreValue, definitions.agentSource);
        const candidateLightingAutoOff = definitions.lightingAutoOff
          ? await readSetting(getStoreValue, definitions.lightingAutoOff)
          : lightingAutoOff;
        if (candidateLayout?.version !== 1 || typeof candidateLayout.slots !== 'object') continue;
        if (!['pinned', 'recent', 'priority', 'custom'].includes(candidateAgentSource)) continue;
        layout = candidateLayout;
        agentSource = candidateAgentSource;
        if (typeof candidateLightingAutoOff === 'string') lightingAutoOff = candidateLightingAutoOff;
        break;
      } catch {}
    }
  }
  const toEpoch = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 100000000000 ? value * 1000 : value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };
  const appInitialUrls = urls.filter((url) => new URL(url).pathname.slice('/assets/'.length).startsWith('app-initial-'));
  let appInitial = null;
  let metadataCurrentRuntime = false;
  if (appInitialUrls.length === 1) {
    try {
      const appInitialUrl = appInitialUrls[0];
      const verificationCache = globalThis.__codexDeckVerifiedMetadataInitial26903 ??= new Map();
      let sha256 = verificationCache.get(appInitialUrl);
      if (sha256 == null) {
        const source = await fetch(appInitialUrl).then((response) => response.text());
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        verificationCache.set(appInitialUrl, sha256);
      }
      metadataCurrentRuntime = sha256 === ${JSON.stringify(DIAL_RUNTIME_26903.initial)};
      if (metadataCurrentRuntime) {
        const signalUrls = urls.filter((url) => new URL(url).pathname.startsWith('/assets/codex-micro-slot-signals-'));
        if (signalUrls.length !== 1) metadataCurrentRuntime = false;
        else {
          let signalHash = verificationCache.get(signalUrls[0]);
          if (signalHash == null) {
            const signalSource = await fetch(signalUrls[0]).then((response) => response.text());
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signalSource));
            signalHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            verificationCache.set(signalUrls[0], signalHash);
          }
          metadataCurrentRuntime = signalHash === 'e8089d7f8ebbc4dd76e38913c3d28ded0beb934c02e4c97f8930f1adacbf3c4d';
        }
      }
      if (metadataCurrentRuntime || sha256 === ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)}) appInitial = await import(appInitialUrl);
    } catch {}
  }
  const appPrimaryUrls = urls.filter((url) => new URL(url).pathname.slice('/assets/'.length).startsWith('app-primary-'));
  let appPrimaryVerified = false;
  if (appPrimaryUrls.length === 1) {
    try {
      const appPrimaryUrl = appPrimaryUrls[0];
      const verificationCache = globalThis.__codexDeckVerifiedAppPrimary26903 ??= new Map();
      let verified = verificationCache.get(appPrimaryUrl);
      if (verified == null) {
        const source = await fetch(appPrimaryUrl).then((response) => response.text());
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        verified = ${JSON.stringify([CURRENT_APP_PRIMARY_SHA256, DIAL_RUNTIME_26903.primary])}.includes(sha256);
        verificationCache.set(appPrimaryUrl, verified);
      }
      appPrimaryVerified = verified === true;
    } catch {}
  }
  const readSlotMetadata = (${readAgentSlotMetadata.toString()});
  const resolveMetadataComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
  const selectMetadataScope = (${selectNativeCommandScope.toString()});
  const metadataComposer = resolveMetadataComposer(document);
  const metadataScope = appInitial ? selectMetadataScope(
    document,
    metadataComposer.root,
    metadataCurrentRuntime ? appInitial.t3t : appInitial.V1t,
    metadataCurrentRuntime ? appInitial.iKt : appInitial.QHt,
    metadataCurrentRuntime ? appInitial.pR : appInitial.AL,
    false,
    true
  ) : null;
  const metadataNamespace = appInitial ? (${agentSlotMetadataNamespace.toString()})(appInitial, metadataCurrentRuntime) : null;
  const slots = found.slots.map((slot) => {
    const metadata = appInitial && metadataScope
      ? readSlotMetadata(slot, metadataScope, metadataNamespace)
      : { metadataAvailability: 'unavailable' };
    return {
      ...slot,
      ...metadata,
      activityAt: toEpoch(slot.activityAt) ?? toEpoch(slot.updatedAt) ?? toEpoch(slot.lastActivityAt) ??
        toEpoch(slot.thread?.updatedAt) ?? toEpoch(slot.task?.updatedAt)
    };
  });

  let usage;
  for (const client of queryClients) {
    try {
      const query = client.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const refreshKey = Symbol.for('codex-deck-rate-limit-refresh-at');
      const now = Date.now();
      const dataUpdatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const lastRefreshAttempt = Number(globalThis[refreshKey]) || 0;
      if (query && typeof query.fetch === 'function' && now - dataUpdatedAt >= 15000 && now - lastRefreshAttempt >= 15000) {
        globalThis[refreshKey] = now;
        // Rate-limit refresh is network-backed and must never hold agent status,
        // selection, or lighting behind its response. A later snapshot reads
        // the refreshed query cache once this best-effort request completes.
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== 'object') continue;
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== 'object') return null;
        const used = Number(window.used_percent);
        if (!Number.isFinite(used)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? 'five-hour'
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? 'weekly'
            : 'other';
        const usedPercent = Math.min(100, Math.max(0, used));
        return {
          id: kind === 'other' ? role + '-' + String(minutes ?? 'unknown') : kind,
          kind,
          usedPercent,
          remainingPercent: 100 - usedPercent,
          windowDurationMins: minutes,
          resetsAt: toEpoch(window.reset_at) ?? null
        };
      };
      const windows = [
        normalizeWindow(rateLimit.primary_window, 'primary'),
        normalizeWindow(rateLimit.secondary_window, 'secondary')
      ].filter(Boolean);
      const available = Number(data.rate_limit_reset_credits?.available_count);
      const applicable = Number(data.rate_limit_reset_credits?.applicable_available_count);
      const observedAt = verifiedUsageObservedAt(query.state?.dataUpdatedAt);
      usage = {
        windows,
        ...(observedAt == null ? {} : { observedAt }),
        resetCreditsAvailable: Number.isFinite(available) ? Math.max(0, Math.floor(available)) : null,
        resetCreditsApplicable: Number.isFinite(applicable) ? Math.max(0, Math.floor(applicable)) : null
      };
      break;
    } catch {}
  }

  const html = document.documentElement;
  const body = document.body;
  const themeWords = [
    html.dataset.theme,
    html.dataset.colorScheme,
    html.className,
    body?.dataset?.theme,
    body?.className,
    getComputedStyle(html).colorScheme
  ].filter(Boolean).join(' ').toLowerCase();
  const explicitDark = /(^|[\\s_-])dark($|[\\s_-])/.test(themeWords);
  const explicitLight = /(^|[\\s_-])light($|[\\s_-])/.test(themeWords);
  const backgrounds = [body, document.getElementById('root'), html]
    .filter(Boolean)
    .map((element) => getComputedStyle(element).backgroundColor)
    .map((value) => value.match(/rgba?\\(([^)]+)\\)/)?.[1]?.split(',').map(Number))
    .filter((channels) => channels?.length >= 3 && (channels.length < 4 || channels[3] > 0));
  const background = backgrounds[0];
  const luminance = background
    ? (0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]) / 255
    : null;
  const theme = explicitDark || (!explicitLight && (luminance != null ? luminance < 0.42 : matchMedia('(prefers-color-scheme: dark)').matches))
    ? 'dark'
    : 'light';
  const activeThreadElement = document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active="true"]')
    ?? document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]');
  const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
  const activeComposer = resolveActiveComposer(document);
  const rawActiveThreadKey = activeComposer.activeThreadKey;
  const readWindowProbe = (${readAgentWindowProbe.toString()});
  const windowProbe = readWindowProbe(document, resolveActiveComposer, activeComposer);
  const activeThreadKey = windowProbe.identityAvailable
    ? windowProbe.activeThreadKey
    : rawActiveThreadKey;
  const activeMetadata = appInitial && metadataScope && activeThreadKey
    ? readSlotMetadata({ threadKey: activeThreadKey }, metadataScope, metadataNamespace)
    : { metadataAvailability: 'unavailable' };
  const activeThreadTitle = activeThreadElement
    ? (activeThreadElement.getAttribute('aria-label') ?? activeThreadElement.textContent ?? '').trim().slice(0, 240) || undefined
    : undefined;
  const composerRoot = activeComposer.root;
  const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
  if (composerRoot && !composerIds.ids.has(composerRoot)) composerIds.ids.set(composerRoot, 'composer-' + (++composerIds.next));
  const activeComposerKey = composerRoot ? composerIds.ids.get(composerRoot) : undefined;
  const markdownCopyTracker = globalThis[Symbol.for('codexDeckMarkdownCopyTracker')];
  const markdownCopyRevision = activeThreadKey
    && markdownCopyTracker?.threadKey === activeThreadKey
    && typeof markdownCopyTracker.revision === 'number'
    && Number.isFinite(markdownCopyTracker.revision)
    ? markdownCopyTracker.revision
    : undefined;
  const reasoningTriggers = composerRoot ? [...composerRoot.querySelectorAll(
    '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
  )] : [];
  const reasoningTrigger = reasoningTriggers.length === 1 ? reasoningTriggers[0] : null;
  const rawReasoningEffort = reasoningTrigger?.getAttribute('data-selected-reasoning-effort') ?? null;
  const reasoningEffort = rawReasoningEffort && /^[a-z][a-z0-9_-]{0,32}$/.test(rawReasoningEffort)
    ? rawReasoningEffort
    : null;
  const selectModelOwner = (${selectNativeModelPickerOwner.toString()});
  const readCurrentModel = (${readNativeCurrentModel.toString()});
  const currentModel = readCurrentModel(composerRoot, reasoningTrigger, appPrimaryVerified, selectModelOwner);
  const modelLabel = currentModel?.modelLabel ?? null;
  const selectPicker = (${selectBoundModelPicker.toString()});
  const boundModelPicker = selectPicker(document, composerRoot);
  const modelPickerOpen = boundModelPicker != null;
  const modelCandidateLabel = (${readFocusedModelCandidate.toString()})(boundModelPicker, document.activeElement);
  const composerReadback = activeComposerKey && reasoningTrigger
    ? {
        ...(activeThreadKey ? { activeThreadKey } : {}),
        currentModelId: currentModel?.modelId ?? null,
        modelLabel,
        modelSelectionMode: currentModel?.selectionMode ?? null,
        modelPickerOpen,
        modelCandidateLabel,
        reasoningEffort,
        fastEnabled: null,
        dictationPhase: 'unavailable',
        observedAt: Date.now()
      }
    : undefined;

  return {
    slots,
    activeThreadKey,
    activeThreadTitle,
    activeComposerKey,
    ...(activeMetadata.approvalPending === undefined ? {} : { approvalPending: activeMetadata.approvalPending }),
    ...(activeMetadata.threadPinned === undefined ? {} : { threadPinned: activeMetadata.threadPinned }),
    ...(composerReadback ? { composerReadback } : {}),
    ...(markdownCopyRevision === undefined ? {} : { markdownCopyRevision }),
    layout,
    agentSource,
    lightingAutoOff,
    theme,
    ...(usage ? { usage } : {})
  };
})()`;

export class CodexMicroRendererBridge {
  private socket: WebSocket | undefined;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: CdpResponse) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; socket: WebSocket }>();
  private connecting: Promise<void> | undefined;
  private readonly sessionOwnership = new CodexSessionOwnershipIndex();
  private readonly evaluationNamespace = randomUUID();
  private readonly operationGuard = new OperationIntegrityGuard();
  private readonly operationTargetLeases = new Map<string, OperationTargetLease>();
  private readonly heldNativeInputOperations = new Map<LeasedNativeInputId, LeasedNativeInput>();
  /** A close event proves this renderer session can no longer consume a release. */
  private readonly endedRendererSessions = new WeakSet<WebSocket>();
  private readonly agentWindowCreationGuard = new AgentWindowCreationGuard();
  private readonly attemptedPttReleases = new Set<"ACT10" | "ACT11">();
  private readonly heldPttOperations = new Map<"ACT10" | "ACT11", { operation: OperationRequest; socket: WebSocket }>();
  private readonly resetOutcomes = new Map<string, RateLimitResetOutcome>();
  private readonly resetInFlight = new Map<string, Promise<RateLimitResetOutcome>>();
  private activeResetAttempt: Promise<RateLimitResetOutcome> | undefined;
  private connectionEpoch = 0;
  private pageEpoch = 0;
  private targetIdentity = "";
  private connectedTargetKey = "";
  private lastTargetKey = "";
  private lastSnapshot: MicroSnapshot | undefined;
  private snapshotSequence = 0;
  private adoptedSnapshotSequence = 0;
  private closed = false;

  constructor(
    private readonly log: (message: string) => void,
    private readonly resetStore: {
      read(): Promise<PersistedResetAttempt | undefined>;
      write(value: PersistedResetAttempt): Promise<void>;
    } = { read: () => readResetAttempt(), write: (value) => writeResetAttempt(value) },
    private readonly agentWindowRouting: AgentWindowRoutingTransport = DEFAULT_AGENT_WINDOW_ROUTING_TRANSPORT,
  ) {}

  advancePageEpoch(): void {
    this.pageEpoch += 1;
    // A page transition changes the physical input surface. Discard the old
    // comparison baseline so the first input on the newly visible page is
    // calibrated from a fresh renderer snapshot instead of failing stale.
    this.lastSnapshot = undefined;
    this.operationGuard.reset();
  }

  async refresh(forceActiveContext = false): Promise<MicroSnapshot> {
    const sequence = ++this.snapshotSequence;
    let observationSocket: WebSocket | undefined;
    try {
      await this.ensureObservationTarget();
      observationSocket = this.socket;
      if (!observationSocket || observationSocket.readyState !== WebSocket.OPEN) {
        throw integrityError("E_FOREGROUND_TARGET_UNAVAILABLE");
      }
      const observationTargetIdentity = this.targetIdentity;
      const observationConnectionEpoch = this.connectionEpoch;
      const observationPageEpoch = this.pageEpoch;
      const nativeSnapshot = await this.evaluate<MicroSnapshot>(SNAPSHOT_EXPRESSION);
      const annotated = await this.sessionOwnership.annotate(nativeSnapshot);
      const activeContext = forceActiveContext
        ? await this.sessionOwnership.refreshActiveThreadContextUsage(annotated)
        : this.sessionOwnership.getActiveThreadContextUsage(annotated);
      const snapshot: MicroSnapshot = {
        ...annotated,
        ...(activeContext ? {
          activeContextUsedPercent: activeContext.contextUsedPercent,
          activeContextRevision: activeContext.contextRevision,
        } : {}),
        connectionEpoch: observationConnectionEpoch,
        pageEpoch: observationPageEpoch,
        mappingFingerprint: mappingFingerprint(annotated),
        targetIdentity: observationTargetIdentity
      };
      if (this.socket !== observationSocket
        || this.targetIdentity !== observationTargetIdentity
        || this.connectionEpoch !== observationConnectionEpoch
        || this.pageEpoch !== observationPageEpoch) {
        throw integrityError("E_CONNECTION_STALE");
      }
      if (sequence > this.adoptedSnapshotSequence) {
        this.lastSnapshot = snapshot;
        this.adoptedSnapshotSequence = sequence;
      }
      return snapshot;
    } catch (error) {
      // Evaluation/annotation failures do not prove that an OPEN renderer
      // socket is dead. Socket close/error events own connection teardown.
      if (observationSocket && observationSocket.readyState !== WebSocket.OPEN) {
        this.disconnect(observationSocket);
      }
      throw error;
    }
  }

  /** Await the renderer's existing native usage query, then read its updated cache. */
  async refreshUsage(): Promise<MicroSnapshot> {
    await this.ensureConnected();
    await this.evaluate<boolean>(`(async () => {
      const root = document.getElementById('root');
      const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith('__reactContainer$'));
      if (!root || !reactKey) throw new Error('E_RENDERER_EVALUATION');
      const queue = [root[reactKey]];
      const seen = new Set();
      const clients = new Set();
      while (queue.length && seen.size < 30000) {
        const fiber = queue.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const values = [fiber.memoizedProps?.value];
        let dependency = fiber.dependencies?.firstContext;
        while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
        for (const value of values) {
          if (value && typeof value.getQueryCache === 'function' && typeof value.getQueryData === 'function') {
            clients.add(value);
          }
        }
        queue.push(fiber.child, fiber.sibling);
      }
      const matches = [];
      for (const client of clients) {
        const query = client.getQueryCache().getAll().find((candidate) =>
          JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
        );
        if (query && typeof query.fetch === 'function') matches.push(query);
      }
      if (matches.length !== 1) throw new Error('E_RENDERER_EVALUATION');
      await matches[0].fetch();
      const state = matches[0].state;
      if (!state?.data?.rate_limit || !Number.isFinite(Number(state.dataUpdatedAt)) || Number(state.dataUpdatedAt) <= 0) {
        throw new Error('E_RENDERER_EVALUATION');
      }
      return true;
    })()`);
    return await this.refresh();
  }

  async sendAgent(
    slot: number,
    act: 0 | 1,
    expectedThreadKey?: string,
    _unopenedTaskBehavior: UnopenedTaskBehavior = "current-window",
  ): Promise<void> {
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) throw new Error(`Ungültiger Micro-Agent-Slot: ${slot}`);
    const physicalId = `AG0${slot}` as LeasedNativeInputId;
    // Native Micro mode always selects within the bound recent window.
    // Retain the legacy argument for saved settings/callers, but never route
    // to an existing or new window. Release stays on the accepting renderer.
    if (act === 0) {
      await this.releaseLeasedNativeInput(physicalId);
      return;
    }
    const expected = this.lastSnapshot;
    const snapshot = await this.refresh();
    if (expected) assertFreshOperationTarget(expected, snapshot);
    let plan = resolveAgentDispatch(snapshot, slot, expectedThreadKey);

    const operation = await this.beginOperation(`AG0${plan.slot}`, "down", snapshot);
    // beginOperation may have followed a foreground window change. Re-read the
    // assignment from the snapshot that was actually bound to this operation;
    // never combine an old slot/thread plan with a new renderer target.
    const boundSnapshot = this.lastSnapshot ?? snapshot;
    try {
      const boundPlan = resolveAgentDispatch(boundSnapshot, slot, expectedThreadKey);
      if (boundPlan.slot !== plan.slot || boundPlan.threadKey !== plan.threadKey) {
        throw integrityError("E_MAPPING_STALE");
      }
      plan = boundPlan;
    } catch (error) {
      // No renderer lease or CDP evaluation exists yet. Retire the down that
      // beginOperation registered so a corrected next press is dispatchable.
      this.operationGuard.cancelUnsentDown(operation);
      throw error;
    }
    const alreadyActive = boundSnapshot.activeThreadKey === plan.threadKey;

    const heldSocket = this.reserveLeasedNativeInput(operation, {
      key: physicalId,
      act: 0,
      slot: plan.slot,
      threadKey: plan.threadKey,
    });
    this.leaseOperationTarget(operation);
    let downCdpSubmitted = false;
    try {
      await this.withOperationTargetLease(operation, async () => {
        await this.dispatch("codex-micro-hid-event", {
          event: { key: `AG0${plan.slot}`, act, slot: plan.slot, threadKey: plan.threadKey }
        }, "codex-micro-hid-event", operation, heldSocket, () => { downCdpSubmitted = true; });
        // Keep both acknowledgement and task readback in this renderer. A
        // foreground change cannot turn a different window into success.
        await this.observeOperation(operation);
        await this.observeThreadActivated(plan.threadKey, alreadyActive);
      });
    } catch (error) {
      this.cancelDefinitelyUnsentNativeInput(operation, downCdpSubmitted, error);
      throw error;
    }

    this.sessionOwnership.markOpened(plan.threadKey);
  }

  private reserveLeasedNativeInput(
    operation: OperationRequest,
    releaseEvent: LeasedNativeInput["releaseEvent"],
  ): WebSocket {
    if (!isLeasedNativeInputId(operation.physicalId) || operation.phase !== "down") {
      throw integrityError("E_INVALID_PHASE");
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.operationGuard.cancelUnsentDown(operation);
      throw integrityError("E_RELEASE_TARGET_GONE");
    }
    if (this.heldNativeInputOperations.has(operation.physicalId)) {
      this.operationGuard.cancelUnsentDown(operation);
      throw integrityError("E_DUPLICATE_DOWN");
    }
    this.heldNativeInputOperations.set(operation.physicalId, {
      operation,
      socket,
      releaseAttempted: false,
      releaseEvent,
    });
    return socket;
  }

  private cancelDefinitelyUnsentNativeInput(
    operation: OperationRequest,
    cdpSubmitted: boolean,
    error: unknown,
  ): void {
    if (!isLeasedNativeInputId(operation.physicalId)) return;
    const definitelyPredispatch = !cdpSubmitted
      || (error instanceof Error
        && (error as Error & { codexDeckPredispatch?: boolean }).codexDeckPredispatch === true);
    const held = this.heldNativeInputOperations.get(operation.physicalId);
    if (!definitelyPredispatch || held?.operation !== operation) return;
    this.heldNativeInputOperations.delete(operation.physicalId);
    this.operationGuard.cancelUnsentDown(operation);
  }

  private async releaseLeasedNativeInput(physicalId: LeasedNativeInputId): Promise<void> {
    const held = this.heldNativeInputOperations.get(physicalId);
    if (!held) return;
    if (this.endedRendererSessions.has(held.socket)) {
      // The renderer close event proves this exact session cannot receive the
      // up. Retire only the local lease and still report failure to the caller.
      this.heldNativeInputOperations.delete(physicalId);
      throw integrityError("E_RELEASE_TARGET_GONE");
    }
    if (held.releaseAttempted) throw integrityError("E_RELEASE_ALREADY_ATTEMPTED");
    held.releaseAttempted = true;
    const operation = this.continueLeasedNativeInputOperation(held.operation);
    try {
      await this.dispatch(
        "codex-micro-hid-event",
        { event: held.releaseEvent },
        "codex-micro-hid-event",
        operation,
        held.socket,
      );
    } catch (error) {
      if (this.endedRendererSessions.has(held.socket)) {
        this.heldNativeInputOperations.delete(physicalId);
        throw error;
      }
      if (error instanceof Error
        && (error as Error & { codexDeckPredispatch?: boolean }).codexDeckPredispatch === true) {
        held.releaseAttempted = false;
      }
      throw error;
    }
    if (held.operation.targetIdentity === this.targetIdentity) {
      this.operationGuard.completeLeasedRelease(
        held.operation,
        operation,
        this.connectionEpoch,
        this.pageEpoch,
      );
    }
    this.heldNativeInputOperations.delete(physicalId);
    if (held.socket !== this.socket
      && !this.isRetainedReleaseSocket(held.socket)
      && held.socket.readyState === WebSocket.OPEN) held.socket.close();
  }

  private continueLeasedNativeInputOperation(held: OperationRequest): OperationRequest {
    const operation = {
      ...held,
      requestId: randomUUID(),
      operationId: randomUUID(),
      phase: "up",
    } satisfies OperationRequest;
    const leaseGuard = new OperationIntegrityGuard();
    leaseGuard.accept(held, held.connectionEpoch, held.pageEpoch);
    leaseGuard.accept(operation, held.connectionEpoch, held.pageEpoch);
    return operation;
  }

  // Retained experimental route, not used by the public slot input path.
  private async routeAgentToWindow(
    threadKey: string,
    sourceSnapshot: MicroSnapshot,
    unopenedTaskBehavior: UnopenedTaskBehavior,
    localWindowPath: string,
  ): Promise<boolean> {
    const port = await this.agentWindowRouting.discoverPort();
    const targets = enumerateCodexMainTargets(
      await this.agentWindowRouting.listTargets(port),
    );
    const sourceTarget = targets.find((target) => codexDebugTargetKey(target) === this.connectedTargetKey);
    if (!sourceTarget) throw integrityError("E_TARGET_STALE");

    const observations = (await Promise.all(targets.map(async (target) => {
      try {
        const probe = await this.agentWindowRouting.command<AgentWindowProbe>(target, port, "Runtime.evaluate", {
          expression: AGENT_WINDOW_PROBE_EXPRESSION,
          returnByValue: true,
        });
        if (!probe.identityAvailable) return null;
        return {
          target,
          probe,
          observation: {
            targetKey: codexDebugTargetKey(target),
            activeThreadKey: probe.activeThreadKey,
            focusedVisible: probe.focusedVisible,
          } satisfies AgentWindowObservation,
        };
      } catch { return null; }
    }))).filter((item): item is NonNullable<typeof item> => item != null);
    let selection;
    try {
      selection = selectAgentWindowFromCompleteScan(
        targets.length,
        observations.map(({ observation }) => observation),
        threadKey,
        this.connectedTargetKey,
      );
    } catch (error) {
      this.log("Agent window routing failed phase=scan.");
      throw error;
    }
    this.log(`Agent window scan total=${targets.length} readable=${observations.length} matches=${observations.filter(({ observation }) => observation.activeThreadKey === threadKey).length} selection=${selection.kind}.`);
    if (selection.kind === "existing") {
      const selected = observations.find(({ observation }) => observation.targetKey === selection.targetKey);
      if (!selected) throw new Error("E_AGENT_WINDOW_UNVERIFIED");
      try {
        if (!selected.observation.focusedVisible) {
          await this.agentWindowRouting.command(selected.target, port, "Page.bringToFront");
          this.log("Agent window activation command acknowledged.");
        }
        await this.waitForAgentWindowTarget(selected.target, port, threadKey);
      } catch (error) {
        this.log("Agent window routing failed phase=focus.");
        throw error;
      }
      if (selection.targetKey !== codexDebugTargetKey(sourceTarget)) {
        try {
          await this.confirmAgentSourceUnchanged(
            sourceTarget,
            port,
            sourceSnapshot.activeThreadKey ?? null,
            sourceSnapshot.activeComposerKey ?? null,
          );
        } catch (error) {
          this.log("Agent window routing failed phase=source.");
          throw error;
        }
      }
      try {
        await this.connect({ port, target: selected.target, requireFocused: true });
        await this.confirmAgentWindowTarget(selected.target, port, threadKey);
      } catch (error) {
        this.log("Agent window routing failed phase=connect.");
        throw error;
      }
      if (selection.targetKey !== codexDebugTargetKey(sourceTarget)) {
        try {
          await this.confirmAgentSourceUnchanged(
            sourceTarget,
            port,
            sourceSnapshot.activeThreadKey ?? null,
            sourceSnapshot.activeComposerKey ?? null,
          );
        } catch (error) {
          this.log("Agent window routing failed phase=source.");
          throw error;
        }
      }
      this.agentWindowCreationGuard.confirm(threadKey);
      return true;
    }
    if (unopenedTaskBehavior === "current-window") return false;

    if (!sourceSnapshot.activeThreadKey && !sourceSnapshot.activeComposerKey) {
      throw new Error("E_AGENT_SOURCE_UNVERIFIED");
    }
    this.agentWindowCreationGuard.begin(threadKey);
    try {
      await this.openAgentInNewWindow(sourceTarget, port, localWindowPath);
    } catch (error) {
      this.log("Agent window routing failed phase=focus.");
      throw error;
    }
    const deadline = Date.now() + AGENT_ACTIVATION_TIMEOUT_MS;
    let lastFailurePhase: "focus" | "source" | "connect" = "focus";
    let lastDeepFailure: unknown;
    while (Date.now() < deadline) {
      const refreshedTargets = enumerateCodexMainTargets(
        await this.agentWindowRouting.listTargets(port),
      );
      for (const target of refreshedTargets) {
        if (codexDebugTargetKey(target) === codexDebugTargetKey(sourceTarget)) continue;
        lastFailurePhase = "focus";
        try {
          await this.confirmAgentWindowTarget(target, port, threadKey);
        } catch { continue; }
        try {
          await this.confirmAgentSourceUnchanged(
            sourceTarget,
            port,
            sourceSnapshot.activeThreadKey ?? null,
            sourceSnapshot.activeComposerKey ?? null,
          );
        } catch (error) {
          lastFailurePhase = "source";
          lastDeepFailure = error;
          continue;
        }
        try {
          await this.connect({ port, target, requireFocused: true });
          await this.confirmAgentWindowTarget(target, port, threadKey);
          await this.confirmAgentSourceUnchanged(
            sourceTarget,
            port,
            sourceSnapshot.activeThreadKey ?? null,
            sourceSnapshot.activeComposerKey ?? null,
          );
          this.agentWindowCreationGuard.confirm(threadKey);
          return true;
        } catch (error) {
          lastFailurePhase = "connect";
          lastDeepFailure = error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, AGENT_ACTIVATION_POLL_MS));
    }
    this.log(`Agent window routing failed phase=${lastFailurePhase}.`);
    if (lastDeepFailure) throw lastDeepFailure;
    throw new Error("E_AGENT_WINDOW_UNVERIFIED");
  }

  private async confirmAgentWindowTarget(
    target: DebugTarget,
    port: number,
    threadKey: string,
    observeProbe?: (probe: AgentWindowProbe) => void,
  ): Promise<void> {
    const probe = await this.agentWindowRouting.command<AgentWindowProbe>(target, port, "Runtime.evaluate", {
      expression: AGENT_WINDOW_PROBE_EXPRESSION,
      returnByValue: true,
    });
    observeProbe?.(probe);
    if (!probe.identityAvailable || probe.activeThreadKey !== threadKey || !probe.focusedVisible) {
      throw new Error("E_AGENT_WINDOW_UNVERIFIED");
    }
  }

  private async waitForAgentWindowTarget(target: DebugTarget, port: number, threadKey: string): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + AGENT_ACTIVATION_TIMEOUT_MS;
    let attempts = 0;
    let lastProbe: AgentWindowProbe | undefined;
    while (Date.now() < deadline) {
      try {
        attempts += 1;
        await this.confirmAgentWindowTarget(target, port, threadKey, (probe) => { lastProbe = probe; });
        return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, AGENT_ACTIVATION_POLL_MS));
    }
    this.log(`Agent window focus unverified attempts=${attempts} elapsedMs=${Date.now() - startedAt} probeReceived=${lastProbe != null} identityAvailable=${lastProbe?.identityAvailable === true} taskMatches=${lastProbe?.activeThreadKey === threadKey} focusedVisible=${lastProbe?.focusedVisible === true}.`);
    throw new Error("E_AGENT_WINDOW_UNVERIFIED");
  }

  private async confirmAgentSourceUnchanged(
    sourceTarget: DebugTarget,
    port: number,
    expectedThreadKey: string | null,
    expectedComposerKey: string | null,
  ): Promise<void> {
    const probe = await this.agentWindowRouting.command<AgentWindowProbe>(sourceTarget, port, "Runtime.evaluate", {
      expression: AGENT_WINDOW_PROBE_EXPRESSION,
      returnByValue: true,
    });
    if (!probe.identityAvailable) throw new Error("E_AGENT_SOURCE_UNVERIFIED");
    assertAgentSourceUnchanged(
      expectedThreadKey,
      probe.activeThreadKey,
      expectedComposerKey,
      probe.activeComposerKey,
    );
  }

  private async openAgentInNewWindow(sourceTarget: DebugTarget, port: number, path: string): Promise<void> {
    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      const appInitialUrls = urls.filter((url) => new URL(url).pathname.slice('/assets/'.length).startsWith('app-initial-'));
      if (appInitialUrls.length !== 1) throw new Error('E_MICRO_EVENT_BUS_UNAVAILABLE');
      const appInitialUrl = appInitialUrls[0];
      const source = await fetch(appInitialUrl).then((response) => response.text());
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
      const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (sha256 !== ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)}) throw new Error('E_MICRO_STANDALONE_RUNTIME_CHANGED');
      const appInitial = await import(appInitialUrl);
      const bus = appInitial.Kun;
      if (!bus || (typeof bus.dispatchMessage !== 'function' && typeof bus.dispatchHostMessage !== 'function')) {
        throw new Error('E_MICRO_EVENT_BUS_UNAVAILABLE');
      }
      assertMutationForeground(document);
      if (typeof bus.dispatchMessage === 'function') {
        bus.dispatchMessage('open-in-new-window', { path: ${JSON.stringify(path)} });
      } else {
        bus.dispatchHostMessage({ type: 'open-in-new-window', path: ${JSON.stringify(path)} });
      }
      return true;
    })()`;
    if (await this.agentWindowRouting.command<boolean>(sourceTarget, port, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }) !== true) throw new Error("E_AGENT_WINDOW_UNVERIFIED");
  }

  private async observeThreadActivated(threadKey: string, alreadyActive = false): Promise<void> {
    const deadline = Date.now() + AGENT_ACTIVATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        // sendAgent retains its target lease until this readback completes.
        // Refresh updates the task in that renderer without following another.
        const snapshot = await this.refresh();
        if (localAgentWindowPath(threadKey) && snapshot.activeThreadKey === threadKey) {
          const focus = await this.evaluate<RendererFocusState>(FOREGROUND_RENDERER_PROBE_EXPRESSION);
          if (isFocusedVisibleRenderer(focus)) return;
        }
        const active = await this.evaluate<boolean>(agentActivationExpression(
          threadKey,
          alreadyActive,
          Math.min(AGENT_ACTIVATION_POLL_MS, Math.max(1, deadline - Date.now())),
        ));
        if (active) return;
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (!AGENT_ACTIVATION_TARGET_TRANSITION_CODES.has(code)) throw error;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(AGENT_ACTIVATION_POLL_MS, remaining)));
    }
    throw new Error("E_AGENT_ACTIVATION_UNCHANGED");
  }

  async sendAction(slot: MicroActionSlot, act: 0 | 1): Promise<MutationConfirmation | void> {
    const isPttSlot = slot === "ACT10" || slot === "ACT11";
    if (act === 0 && !isPttSlot) {
      await this.releaseLeasedNativeInput(slot);
      return;
    }
    if (act === 1 && isPttSlot && this.heldPttOperations.has(slot)) {
      throw integrityError("E_DUPLICATE_DOWN");
    }
    const operation = await this.beginOperation(
      slot,
      act === 1 ? "down" : "up",
      undefined,
      false,
      act === 1 && ((snapshot) => {
        if (isPttSlot) return true;
        const keycapId = resolveEffectivePhysicalSlot(snapshot.layout, slot)?.keycapId as OfficialKeycapId | undefined;
        return Boolean(keycapId && (VIEW_SCOPED_KEYCAP_IDS as readonly OfficialKeycapId[]).includes(keycapId));
      })
    );
    const execute = async () => {
    const effectiveKeycapId = this.lastSnapshot
      ? resolveEffectivePhysicalSlot(this.lastSnapshot.layout, slot)?.keycapId
      : undefined;
    const submitBefore = act === 1 && effectiveKeycapId === "CODEX"
      ? contentFreeSurface(this.lastSnapshot)
      : undefined;
    const heldSocket = act === 1 && isPttSlot ? this.socket : undefined;
    const leasedNativeSocket = act === 1 && !isPttSlot
      ? this.reserveLeasedNativeInput(operation, {
          key: slot,
          act: 0,
          slot: null,
          threadKey: null,
        })
      : undefined;
    if (act === 1 && isPttSlot && (!heldSocket || heldSocket.readyState !== WebSocket.OPEN)) {
      this.operationGuard.cancelUnsentDown(operation);
      throw integrityError("E_RELEASE_TARGET_GONE");
    }
    if (act === 1 && isPttSlot && heldSocket) {
      // Reserve the immutable down target before dispatch. Once the CDP
      // evaluation is submitted, a rejected response cannot prove that the
      // renderer did not accept the hold, so rollback must still issue one up
      // against this exact socket and operation.
      if (this.heldPttOperations.has(slot)) {
        this.operationGuard.cancelUnsentDown(operation);
        throw integrityError("E_DUPLICATE_DOWN");
      }
      this.attemptedPttReleases.delete(slot);
      this.heldPttOperations.set(slot, { operation, socket: heldSocket });
    }
    let downCdpSubmitted = false;
    try {
      await this.dispatch(
        "codex-micro-hid-event",
        { event: { key: slot, act, slot: null, threadKey: null } },
        "codex-micro-hid-event",
        operation,
        heldSocket ?? leasedNativeSocket,
        () => { downCdpSubmitted = true; },
      );
    } catch (error) {
      // Local target/socket checks run before CDP submission and prove that the
      // renderer could not see the down. Every failure after submission stays
      // ambiguous and keeps the exact release lease.
      const definitelyPredispatch = !downCdpSubmitted
        || (error instanceof Error
          && (error as Error & { codexDeckPredispatch?: boolean }).codexDeckPredispatch === true);
      if (act === 1 && isPttSlot && definitelyPredispatch
        && this.heldPttOperations.get(slot)?.operation === operation) {
        this.heldPttOperations.delete(slot);
        this.operationGuard.cancelUnsentDown(operation);
      }
      if (act === 1 && !isPttSlot) {
        this.cancelDefinitelyUnsentNativeInput(operation, downCdpSubmitted, error);
      }
      throw error;
    }
    const confirmation = await this.observeOperation(operation);
    if (submitBefore) {
      // The native dispatcher acknowledges handling, not submission success.
      // Preserve an unknown semantic result without failing the physical down:
      // its captured release lease must remain held until the user's key-up.
      return await this.observeContentFreeCommand("CODEX", operation, submitBefore, confirmation);
    }
    };
    // PTT and native state-clear inputs keep their own down/up release leases;
    // non-PTT mutation observation still uses the shorter result lease here.
    return isPttSlot ? await execute() : await this.withOperationTargetLease(operation, execute);
  }

  async releaseAction(
    slot: "ACT10" | "ACT11",
    options: { onlyIfHeld?: boolean } = {},
  ): Promise<void> {
    if (options.onlyIfHeld && !this.heldPttOperations.has(slot)) return;
    const held = this.heldPttOperations.get(slot);
    if (held && this.endedRendererSessions.has(held.socket)) {
      this.heldPttOperations.delete(slot);
      this.attemptedPttReleases.delete(slot);
      throw integrityError("E_RELEASE_TARGET_GONE");
    }
    if (this.attemptedPttReleases.has(slot)) throw integrityError("E_RELEASE_ALREADY_ATTEMPTED");
    this.attemptedPttReleases.add(slot);
    let operation: OperationRequest;
    try {
      if (held) {
        operation = this.continuePttOperation(held.operation);
      } else {
        try {
          operation = await this.beginOperation(slot, "up");
        } catch {
        // No native event has been dispatched when beginOperation fails. Rebase
        // once on the current renderer state and issue the PTT-only safety-up.
          operation = await this.beginOperation(slot, "safety-up", undefined, true);
        }
      }
    } catch (error) {
      // Both failures happened before dispatch, so a later physical release may
      // safely try again. Keep the reservation for every ambiguous later stage.
      this.attemptedPttReleases.delete(slot);
      throw error;
    }
    let releaseConfirmed = false;
    try {
      await this.dispatch(
        "codex-micro-hid-event",
        { event: { key: slot, act: 0, slot: null, threadKey: null } },
        "codex-micro-hid-event",
        operation,
        held?.socket,
      );
      // A held release may intentionally target its now-background renderer.
      // The dispatch acknowledgement is the last safe content-free observer;
      // a fresh snapshot would bind to the new foreground window.
      if (!held) await this.observeOperation(operation);
      if (held?.operation.targetIdentity === this.targetIdentity) {
        this.operationGuard.completeLeasedRelease(
          held.operation,
          operation,
          this.connectionEpoch,
          this.pageEpoch,
        );
      }
      releaseConfirmed = true;
    } catch (error) {
      if (held && this.endedRendererSessions.has(held.socket)) {
        this.heldPttOperations.delete(slot);
        this.attemptedPttReleases.delete(slot);
      }
      throw error;
    } finally {
      // A rejected CDP response is ambiguous: the renderer may already have
      // consumed the up. Preserve both the lease and attempted marker so later
      // cleanup reports the same uncertainty without dispatching another up.
      if (releaseConfirmed) {
        this.heldPttOperations.delete(slot);
        if (held?.socket && held.socket !== this.socket
          && !this.isRetainedReleaseSocket(held.socket)
          && held.socket.readyState === WebSocket.OPEN) held.socket.close();
      }
    }
  }

  private continuePttOperation(held: OperationRequest): OperationRequest {
    const operation = {
      ...held,
      requestId: randomUUID(),
      operationId: randomUUID(),
      phase: "up",
    } satisfies OperationRequest;
    // A renderer rebind resets the current operation guard and advances its
    // epochs, but the native hold still belongs to the old renderer. Validate
    // the down/up pair against the immutable lease epochs so the release can
    // only reach the socket that accepted the down event.
    const leaseGuard = new OperationIntegrityGuard();
    leaseGuard.accept(held, held.connectionEpoch, held.pageEpoch);
    leaseGuard.accept(operation, held.connectionEpoch, held.pageEpoch);
    return operation;
  }

  async sendJoystick(direction: MicroDirection, distance: 0 | 1): Promise<void> {
    const angle: Record<MicroDirection, number> = { up: 0.75, right: 0, down: 0.25, left: 0.5 };
    const operation = await this.beginOperation(`JOY_${direction.toUpperCase()}`, distance === 1 ? "down" : "up", undefined, false, distance === 1);
    return await this.withOperationTargetLease(operation, async () => {
    await this.dispatch("codex-micro-joystick-event", { event: { angle: angle[direction], distance } }, "codex-micro-joystick-event", operation);
    await this.observeOperation(operation);
    });
  }

  async sendEncoder(act: 0 | 1): Promise<void> {
    const operation = await this.beginOperation(NATIVE_ENCODER_CLICK_KEY, act === 1 ? "down" : "up", undefined, false, act === 1);
    return await this.withOperationTargetLease(operation, async () => {
    await this.dispatch("codex-micro-hid-event", { event: { key: NATIVE_ENCODER_CLICK_KEY, act, slot: null, threadKey: null } }, "codex-micro-hid-event", operation);
    await this.observeOperation(operation);
    });
  }

  async adjustReasoning(direction: ReasoningAdjustment): Promise<MutationConfirmation> {
    return await this.runKeycap(REASONING_KEYCAP_IDS[direction]);
  }

  async rotateModelPicker(direction: ReasoningAdjustment): Promise<MutationConfirmation> {
    return await this.runModelPickerInteraction("rotate", direction);
  }

  async pressModelPicker(): Promise<MutationConfirmation> {
    return await this.runModelPickerInteraction("press");
  }

  async moveSideDraftToMain(): Promise<MutationConfirmation> {
    const operation = await this.beginOperation("KEYCAP_SIDE_TO_MAIN", "invoke");
    return await this.withOperationTargetLease(operation, async () => {
    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      const moduleUrl = (prefix) => {
        const matches = urls.filter((value) => new URL(value).pathname.slice('/assets/'.length).startsWith(prefix));
        return matches.length === 1 ? matches[0] : null;
      };
      const appInitialUrl = moduleUrl('app-initial-');
      const appPrimaryUrl = moduleUrl('app-primary-');
      if (!appInitialUrl || !appPrimaryUrl) throw new Error('E_DRAFT_TRANSFER_ASSET_UNAVAILABLE');
      const [appInitialSource, appPrimarySource] = await Promise.all([
        fetch(appInitialUrl).then((response) => response.text()),
        fetch(appPrimaryUrl).then((response) => response.text())
      ]);
      const sha256 = async (source) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      };
      const [appInitialSha256, appPrimarySha256] = await Promise.all([
        sha256(appInitialSource), sha256(appPrimarySource)
      ]);
      if (appInitialSha256 !== ${JSON.stringify(DIAL_RUNTIME_26903.initial)}
        || appPrimarySha256 !== ${JSON.stringify(DIAL_RUNTIME_26903.primary)}) {
        throw new Error('E_DRAFT_TRANSFER_ASSET_CHANGED');
      }
      const appInitial = await import(appInitialUrl);
      const selectScope = (${selectNativeCommandScope.toString()});
      const moveDraft = (${moveSideDraftToMainInDocument.toString()});
      assertMutationForeground(document);
      const outcome = moveDraft(
        document,
        selectScope,
        appInitial.t3t,
        appInitial.iKt,
        appInitial.pR
      );
      if (outcome !== 'moved') throw new Error('E_DRAFT_TRANSFER_UNOBSERVED');
      return ${JSON.stringify(operation.operationId)};
    })()`;
    const observedOperationId = await this.evaluate<string>(expression);
    if (observedOperationId !== operation.operationId) throw integrityError("E_OPERATION_UNOBSERVED");
    this.log(`MicroPlus side draft transfer readback verified operationId=${operation.operationId}`);
    const confirmation = await this.observeOperation(operation);
    return { ...confirmation, semanticOutcome: "confirmed" };
    });
  }

  /** Compact the currently foreground local task through Codex's pinned native manager. */
  async compactActiveThread(): Promise<MutationConfirmation> {
    const operation = await this.beginOperation("CONTEXT_COMPACT", "invoke", undefined, false, true);
    return await this.withOperationTargetLease(operation, async () => {
    const before = this.lastSnapshot;
    if (!before?.activeThreadKey?.startsWith("local:") || !operation.activeThreadKey || !operation.activeComposerKey) {
      throw integrityError("E_CONTEXT_COMPACTION_UNAVAILABLE");
    }
    const activeSessionId = before.activeThreadKey.slice("local:".length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeSessionId)) {
      throw integrityError("E_CONTEXT_COMPACTION_UNAVAILABLE");
    }
    const activeHostSessions = before.hostSessions?.filter((session) => session.threadId === activeSessionId) ?? [];
    if (activeHostSessions.length === 1 && activeHostSessions[0]?.status === "working") {
      throw integrityError("E_CONTEXT_COMPACTION_BUSY");
    }
    const activeHostSession = activeHostSessions.length === 1 ? activeHostSessions[0] : undefined;
    const beforePercent = before.activeContextUsedPercent;
    const beforeRevision = before.activeContextRevision;
    if (activeHostSession?.status !== "idle"
      || typeof beforePercent !== "number" || !Number.isFinite(beforePercent) || beforePercent < 0 || beforePercent > 100
      || typeof beforeRevision !== "number" || !Number.isFinite(beforeRevision) || beforeRevision < 0) {
      throw integrityError("E_CONTEXT_COMPACTION_UNAVAILABLE");
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw integrityError("E_FOREGROUND_TARGET_STALE");
    assertOperationTargetIdentity(operation, this.targetIdentity, this.connectionEpoch);
    const expectedThreadKey = operation.activeThreadKey;
    const expectedComposerKey = operation.activeComposerKey;
    const assertPinnedContextTarget = (snapshot?: MicroSnapshot): void => {
      if (this.socket !== socket) throw integrityError("E_TARGET_STALE");
      assertOperationTargetIdentity(operation, this.targetIdentity, this.connectionEpoch);
      if (!snapshot) return;
      if (snapshot.targetIdentity !== operation.targetIdentity) throw integrityError("E_TARGET_STALE");
      if (snapshot.activeThreadKey !== expectedThreadKey) throw integrityError("E_ACTIVE_THREAD_STALE");
      if (snapshot.activeComposerKey !== expectedComposerKey) throw integrityError("E_ACTIVE_COMPOSER_STALE");
    };
    assertPinnedContextTarget(before);

    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      assertMutationForeground(document);
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      const moduleUrl = (prefix) => {
        const matches = urls.filter((value) => new URL(value).pathname.slice('/assets/'.length).startsWith(prefix));
        return matches.length === 1 ? matches[0] : null;
      };
      const appInitialUrl = moduleUrl('app-initial-');
      const appPrimaryUrl = moduleUrl('app-primary-');
      if (!appInitialUrl || !appPrimaryUrl) throw new Error('E_CONTEXT_COMPACTION_UNAVAILABLE');
      const [appInitialSource, appPrimarySource] = await Promise.all([
        fetch(appInitialUrl).then((response) => response.text()),
        fetch(appPrimaryUrl).then((response) => response.text())
      ]);
      const sha256 = async (source) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      };
      const [appInitialSha256, appPrimarySha256] = await Promise.all([
        sha256(appInitialSource), sha256(appPrimarySource)
      ]);
      if (appInitialSha256 !== ${JSON.stringify(DIAL_RUNTIME_26903.initial)}
        || appPrimarySha256 !== ${JSON.stringify(DIAL_RUNTIME_26903.primary)}) {
        throw new Error('E_CONTEXT_COMPACTION_UNAVAILABLE');
      }
      const appInitial = await import(appInitialUrl);
      const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
      const active = resolveActiveComposer(document);
      const expectedThreadKey = ${JSON.stringify(operation.activeThreadKey)};
      const expectedComposerKey = ${JSON.stringify(operation.activeComposerKey)};
      const rawConversationId = active.root?.querySelector('[data-above-composer-conversation-id]')
        ?.getAttribute('data-above-composer-conversation-id') ?? null;
      const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
      if (active.root && !composerIds.ids.has(active.root)) composerIds.ids.set(active.root, 'composer-' + (++composerIds.next));
      if (!active.root || active.activeThreadKey !== expectedThreadKey
        || composerIds.ids.get(active.root) !== expectedComposerKey
        || !rawConversationId || expectedThreadKey !== 'local:' + rawConversationId) {
        throw new Error('E_ACTIVE_THREAD_STALE');
      }
      const selectComposerController = (${selectNativeComposerTextController.toString()});
      const composerController = selectComposerController(active.root);
      if (!composerController) throw new Error('E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE');
      if (composerController.getPersistedText().length !== 0) throw new Error('E_CONTEXT_COMPACTION_DRAFT_NOT_EMPTY');
      const selectScope = (${selectNativeCommandScope.toString()});
      const scope = selectScope(document, active.root, appInitial.t3t, appInitial.iKt, appInitial.pR, false);
      if (!scope) throw new Error('E_CONTEXT_COMPACTION_SCOPE_UNAVAILABLE');
      const managerBinding = scope.get(appInitial.VTt, rawConversationId);
      const manager = typeof appInitial.$4t === 'function' ? appInitial.$4t(scope, managerBinding) : null;
      if (!manager || typeof manager.compactThread !== 'function') {
        throw new Error('E_CONTEXT_COMPACTION_MANAGER_UNAVAILABLE');
      }
      assertMutationForeground(document);
      await manager.compactThread(rawConversationId);
      const afterActive = resolveActiveComposer(document);
      const afterRawConversationId = afterActive.root?.querySelector('[data-above-composer-conversation-id]')
        ?.getAttribute('data-above-composer-conversation-id') ?? null;
      if (afterActive.root && !composerIds.ids.has(afterActive.root)) composerIds.ids.set(afterActive.root, 'composer-' + (++composerIds.next));
      if (!afterActive.root || afterActive.activeThreadKey !== expectedThreadKey
        || composerIds.ids.get(afterActive.root) !== expectedComposerKey
        || afterRawConversationId !== rawConversationId) {
        throw new Error('E_ACTIVE_THREAD_STALE');
      }
      return ${JSON.stringify(operation.operationId)};
    })()`;
    const observedOperationId = await this.evaluateOnSocket<string>(socket, expression, 30_000);
    if (observedOperationId !== operation.operationId) throw integrityError("E_OPERATION_UNOBSERVED");
    assertPinnedContextTarget();

    const deadline = Date.now() + 8_000;
    let after: MicroSnapshot | undefined;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      assertPinnedContextTarget();
      after = await this.refresh(true);
      assertPinnedContextTarget(after);
      assertFreshOperationTarget(before, after);
      if (after.activeContextRevision != null && after.activeContextRevision > beforeRevision
        && after.activeContextUsedPercent != null && after.activeContextUsedPercent < beforePercent) {
        this.log(`Context compaction confirmed operationId=${operation.operationId}`);
        return { dispatch: "accepted", metadata: "matched", semanticOutcome: "confirmed", observedSnapshot: after };
      }
    }
    this.log(`Context compaction result unverified operationId=${operation.operationId}`);
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified", ...(after ? { observedSnapshot: after } : {}) };
    });
  }

  private async runModelPickerInteraction(
    interaction: "rotate" | "press",
    direction?: ReasoningAdjustment
  ): Promise<MutationConfirmation> {
    const physicalId = interaction === "press" ? NATIVE_ENCODER_CLICK_KEY
      : direction === "increase" ? "ENC_CW" : "ENC_CC";
    const operation = await this.beginOperation(physicalId, "invoke", undefined, false, true);
    return await this.withOperationTargetLease(operation, async () => {
    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
      const selectPicker = (${selectBoundModelPicker.toString()});
      const expectedActiveThreadKey = ${JSON.stringify(operation.activeThreadKey ?? null)};
      const expectedActiveComposerKey = ${JSON.stringify(operation.activeComposerKey ?? null)};
      const assertBoundComposer = () => {
        const current = resolveActiveComposer(document);
        if (expectedActiveThreadKey && current.activeThreadKey !== expectedActiveThreadKey) throw new Error('E_ACTIVE_THREAD_STALE');
        const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
        if (current.root && !composerIds.ids.has(current.root)) composerIds.ids.set(current.root, 'composer-' + (++composerIds.next));
        if (expectedActiveComposerKey && (!current.root || composerIds.ids.get(current.root) !== expectedActiveComposerKey)) {
          throw new Error('E_ACTIVE_COMPOSER_STALE');
        }
        return current.root;
      };
      let composerRoot = assertBoundComposer();
      if (${JSON.stringify(interaction)} === 'rotate') {
        const discoveredUrls = [...new Set([
          ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
          ...performance.getEntriesByType('resource').map((entry) => entry.name)
        ])];
        const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
        const primaryUrls = urls.filter((value) =>
          new URL(value).pathname.slice('/assets/'.length).startsWith('app-primary-'));
        if (primaryUrls.length !== 1) throw new Error('E_MODEL_PICKER_PRIMARY_ASSET');
        const primaryUrl = primaryUrls[0];
        const verificationCache = globalThis.__codexDeckVerifiedAppPrimary26903 ??= new Map();
        let primaryVerified = verificationCache.get(primaryUrl);
        if (primaryVerified == null) {
          const source = await fetch(primaryUrl).then((response) => response.text());
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
          const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
          primaryVerified = ${JSON.stringify([CURRENT_APP_PRIMARY_SHA256, DIAL_RUNTIME_26903.primary])}.includes(sha256);
          verificationCache.set(primaryUrl, primaryVerified);
        }
        if (primaryVerified !== true) throw new Error('E_MODEL_PICKER_PRIMARY_ASSET');
        const selectModelOwner = (${selectNativeModelPickerOwner.toString()});
        const readCurrentModel = (${readNativeCurrentModel.toString()});
        const selectTrigger = (root) => {
          const triggers = root ? [...root.querySelectorAll(
            '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
          )] : [];
          if (triggers.length !== 1) throw new Error(triggers.length === 0
            ? 'E_MODEL_PICKER_NO_TRIGGER' : 'E_MODEL_PICKER_OPEN_TRIGGER_COUNT');
          return triggers[0];
        };
        const resolveFreshOwner = () => {
          composerRoot = assertBoundComposer();
          const trigger = selectTrigger(composerRoot);
          const owner = selectModelOwner(composerRoot, trigger, true);
          const current = readCurrentModel(composerRoot, trigger, true, selectModelOwner);
          if (!owner || !current) throw new Error('E_MODEL_PICKER_CURRENT_MODEL');
          return { owner, current };
        };
        const isValidModelId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
        const candidatesFor = (owner) => {
          if (!Array.isArray(owner.modelOptions)) throw new Error('E_MODEL_PICKER_ROW_MODEL');
          const preservedEffort = owner.reasoningEffort;
          if (typeof preservedEffort !== 'string' || !/^[a-z][a-z0-9_-]{0,32}$/.test(preservedEffort)) {
            throw new Error('E_MODEL_PICKER_EFFORT_PRESERVATION');
          }
          const enabled = owner.modelOptions.flatMap((option) => {
            const model = option?.model;
            return model && isValidModelId(model.model) && option.disabledReason == null
              ? [{ kind: 'model', modelId: model.model, model }]
              : [];
          });
          if (new Set(enabled.map((candidate) => candidate.modelId)).size !== enabled.length) {
            throw new Error('E_MODEL_PICKER_ROW_MODEL');
          }
          const explicit = enabled.filter((candidate) => Array.isArray(candidate.model.supportedReasoningEfforts)
            && candidate.model.supportedReasoningEfforts.some((effort) => effort?.reasoningEffort === preservedEffort));
          if (enabled.length > 0 && explicit.length === 0) {
            throw new Error('E_MODEL_PICKER_EFFORT_PRESERVATION');
          }
          const advanced = owner.hasWorkModeAccess === true
            && owner.showReasoningEffortControls === true;
          return { advanced, preservedEffort, values: explicit };
        };
        const initial = resolveFreshOwner();
        const initialCandidates = candidatesFor(initial.owner);
        if (initialCandidates.values.length === 0) throw new Error('E_MODEL_PICKER_MODEL_ROW');
        const currentIndex = initialCandidates.values.findIndex((candidate) => candidate.modelId === initial.current.modelId);
        if (currentIndex < 0) throw new Error('E_MODEL_PICKER_CURRENT_MODEL');
        const targetIndex = currentIndex;
        const offset = ${JSON.stringify(direction)} === 'increase' ? 1 : -1;
        const nextIndex = initialCandidates.advanced
          ? (targetIndex + offset + initialCandidates.values.length) % initialCandidates.values.length
          : Math.max(0, Math.min(initialCandidates.values.length - 1, targetIndex + offset));
        const expected = initialCandidates.values[nextIndex];
        if (!expected) throw new Error('E_MODEL_PICKER_MODEL_ROW');
        if (nextIndex === targetIndex) return ${JSON.stringify(operation.operationId)};

        const fresh = resolveFreshOwner();
        if (fresh.current.modelId !== initial.current.modelId
          || fresh.current.selectionMode !== initial.current.selectionMode
          || fresh.owner.reasoningEffort !== initialCandidates.preservedEffort) {
          throw new Error('E_MODEL_PICKER_CURRENT_MODEL');
        }
        const freshCandidates = candidatesFor(fresh.owner);
        const freshExpected = freshCandidates.values[nextIndex];
        if (freshCandidates.advanced !== initialCandidates.advanced
          || freshCandidates.preservedEffort !== initialCandidates.preservedEffort || !freshExpected
          || freshExpected.kind !== expected.kind || freshExpected.modelId !== expected.modelId) {
          throw new Error('E_MODEL_PICKER_ROW_MODEL');
        }
        const owner = fresh.owner;
        if (owner.disabled === true || owner.modelOptionsDisabled === true
          || (freshCandidates.advanced && owner.menuFooter != null)
          || owner.daybreak?.disabled === true || owner.daybreak?.isSaving) {
          throw new Error('E_MODEL_PICKER_COMMIT_BLOCKED');
        }
        {
          const option = owner.modelOptions.find((candidate) => candidate?.model?.model === expected.modelId);
          if (!option || option.disabledReason != null || typeof owner.onSelectModel !== 'function') {
            throw new Error('E_MODEL_PICKER_ROW_MODEL');
          }
          const invokesModelSelection = !freshCandidates.advanced
            || expected.modelId !== fresh.current.modelId
            || expected.modelId === owner.lockedModelSlug;
          if (invokesModelSelection) {
            if (typeof owner.onBeforeSelectModel === 'function') {
              assertMutationForeground(document);
              if (owner.onBeforeSelectModel(expected.modelId) === false) {
                throw new Error('E_MODEL_PICKER_COMMIT_BLOCKED');
              }
            }
            assertMutationForeground(document);
            const result = owner.onSelectModel(expected.modelId, initialCandidates.preservedEffort);
            if (result && typeof result.then === 'function') void result.catch(() => {});
          }
          const completion = freshCandidates.advanced ? owner.onSelectModelOption : owner.onSelectComplete;
          if (typeof completion === 'function') {
            assertMutationForeground(document);
            const completionResult = completion();
            if (completionResult && typeof completionResult.then === 'function') void completionResult.catch(() => {});
          }
        }
        const commitDeadline = Date.now() + 800;
        while (true) {
          const observedState = resolveFreshOwner();
          if (observedState.owner.reasoningEffort !== initialCandidates.preservedEffort) {
            throw new Error('E_MODEL_PICKER_EFFORT_PRESERVATION');
          }
          const observed = observedState.current;
          const committed = observed.selectionMode === 'model' && observed.modelId === expected.modelId;
          if (committed) break;
          if (Date.now() >= commitDeadline) throw new Error('E_MODEL_PICKER_COMMIT_UNCHANGED');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return ${JSON.stringify(operation.operationId)};
      }
      let pickerSelectorFailure = 'E_MODEL_PICKER_OPEN_TIMEOUT';
      const selectCurrentPicker = () => selectPicker(document, composerRoot, (code) => {
        pickerSelectorFailure = code;
      });
      let picker = selectCurrentPicker();
      const pickerTrigger = composerRoot?.querySelector('[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]');
      const pickerDeclaredOpen = pickerTrigger?.getAttribute('aria-expanded') === 'true'
        || pickerTrigger?.getAttribute('data-state') === 'open'
        || pickerTrigger?.hasAttribute('data-composer-navigation-open');
      if (!picker && pickerDeclaredOpen) throw new Error(pickerSelectorFailure);
      const wasOpen = picker != null;
      if (!picker) {
        const discoveredUrls = [...new Set([
          ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
          ...performance.getEntriesByType('resource').map((entry) => entry.name)
        ])];
        const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
        const moduleUrl = (prefix) => {
          const matches = urls.filter((value) => new URL(value).pathname.slice('/assets/'.length).startsWith(prefix));
          return matches.length === 1 ? matches[0] : null;
        };
        const bridgeUrl = moduleUrl('codex-micro-bridge-');
        const appInitialUrl = moduleUrl('app-initial-');
        const commandsUrl = moduleUrl('codex-micro-commands-');
        if (!bridgeUrl || !appInitialUrl || !commandsUrl) throw new Error('E_COMMAND_RUNNER_INCOMPATIBLE');
        const [bridgeSource, appInitialSource, commandsSource] = await Promise.all([
          fetch(bridgeUrl).then((response) => response.text()),
          fetch(appInitialUrl).then((response) => response.text()),
          fetch(commandsUrl).then((response) => response.text())
        ]);
        const sha256 = async (source) => {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
          return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const [bridgeSha256, appInitialSha256, commandsSha256] = await Promise.all([
          sha256(bridgeSource), sha256(appInitialSource), sha256(commandsSource)
        ]);
        const reviewedDialRuntime = ${JSON.stringify(DIAL_RUNTIME_26903)};
        const currentDialRuntime = bridgeSha256 === reviewedDialRuntime.bridge
          && appInitialSha256 === reviewedDialRuntime.initial
          && commandsSha256 === reviewedDialRuntime.commands;
        if (!currentDialRuntime && (bridgeSha256 !== ${JSON.stringify(CURRENT_NATIVE_BRIDGE_SHA256)}
          || appInitialSha256 !== ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)}
          || commandsSha256 !== ${JSON.stringify(CURRENT_MICRO_COMMANDS_SHA256)})) {
          throw new Error('E_COMMAND_RUNNER_INCOMPATIBLE');
        }
        composerRoot = assertBoundComposer();
        const boundTriggers = [...composerRoot.querySelectorAll(
          '[data-codex-intelligence-trigger][data-composer-navigation-target="reasoning"]'
        )];
        if (boundTriggers.length === 0) throw new Error('E_MODEL_PICKER_NO_TRIGGER');
        if (boundTriggers.length !== 1) throw new Error('E_MODEL_PICKER_OPEN_TRIGGER_COUNT');
        const boundTrigger = boundTriggers[0];
        assertMutationForeground(document);
        boundTrigger.focus({ preventScroll: true });
        assertMutationForeground(document);
        boundTrigger.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Enter',
          key: 'Enter'
        }));
        const deadline = Date.now() + 800;
        while (!picker && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          composerRoot = assertBoundComposer();
          picker = selectCurrentPicker();
        }
        if (!picker) throw new Error(pickerSelectorFailure);
      }
      // A press on a closed picker opens it. A second press commits the row.
      if (${JSON.stringify(interaction)} === 'press' && !wasOpen) return ${JSON.stringify(operation.operationId)};
      composerRoot = assertBoundComposer();
      picker = selectCurrentPicker();
      if (!picker) throw new Error(pickerSelectorFailure);
      let pickerView = picker.querySelector('[data-model-picker-view]');
      if (pickerView && pickerView.getAttribute('data-model-picker-view') !== 'advanced') {
        if (${JSON.stringify(interaction)} !== 'rotate') throw new Error('E_MODEL_PICKER_SIMPLE_PRESS');
        const toggles = [...picker.querySelectorAll('[data-model-picker-view-toggle="true"]')];
        if (toggles.length !== 1) throw new Error('E_MODEL_PICKER_VIEW_TOGGLE');
        const toggle = toggles[0];
        assertMutationForeground(document);
        toggle.focus({ preventScroll: true });
        assertMutationForeground(document);
        toggle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Enter', key: 'Enter' }));
        const viewDeadline = Date.now() + 400;
        while (Date.now() < viewDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          composerRoot = assertBoundComposer();
          picker = selectCurrentPicker();
          pickerView = picker?.querySelector('[data-model-picker-view]') ?? null;
          if (pickerView?.getAttribute('data-model-picker-view') === 'advanced') break;
        }
      }
      let modelSurface = pickerView;
      let modelSelector = '[role="menuitemradio"]:not([data-disabled])';
      let selectedSelector = '[role="menuitemradio"][aria-checked="true"]:not([data-disabled])';
      if (!pickerView) {
        const marker = picker.querySelector('[data-model-picker-model-row]');
        const submenuTrigger = marker?.closest('[role="menuitem"]');
        if (!submenuTrigger || submenuTrigger.hasAttribute('data-disabled')) {
          throw new Error('E_MODEL_PICKER_LEGACY_TRIGGER');
        }
        let submenuId = submenuTrigger.getAttribute('aria-controls');
        let submenu = submenuId ? document.getElementById(submenuId) : null;
        if (!submenu?.matches('[role="menu"][data-state="open"]')) {
          assertMutationForeground(document);
          submenuTrigger.focus({ preventScroll: true });
          assertMutationForeground(document);
          submenuTrigger.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, code: 'ArrowRight', key: 'ArrowRight'
          }));
          const submenuDeadline = Date.now() + 400;
          while (Date.now() < submenuDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            submenuId = submenuTrigger.getAttribute('aria-controls');
            submenu = submenuId ? document.getElementById(submenuId) : null;
            if (submenu?.matches('[role="menu"][data-state="open"]')) break;
          }
        }
        if (!submenu?.matches('[role="menu"][data-state="open"]')) {
          throw new Error('E_MODEL_PICKER_LEGACY_SUBMENU');
        }
        modelSurface = submenu;
        modelSelector = '[role="menuitem"]:not([data-disabled])';
        selectedSelector = '[data-model-selected="true"]:not([data-disabled])';
      } else if (pickerView.getAttribute('data-model-picker-view') !== 'advanced') {
        throw new Error('E_MODEL_PICKER_ADVANCED_VIEW');
      }
      const modelRows = [...modelSurface.querySelectorAll(modelSelector)].filter((row) =>
        row.getAttribute('data-interactive') !== 'false'
          && row.closest('[inert], [hidden], [aria-hidden="true"]') == null
      );
      const selectedModel = modelRows.find((row) => row.matches(selectedSelector)) ?? null;
      const firstModel = modelRows[0] ?? null;
      const active = document.activeElement;
      const activeModel = active instanceof Element && modelSurface.contains(active)
        && modelRows.includes(active) ? active : null;
      const target = activeModel ?? selectedModel ?? firstModel;
      if (!target) throw new Error('E_MODEL_PICKER_MODEL_ROW');
      if (${JSON.stringify(interaction)} === 'press') {
        assertMutationForeground(document);
        target.focus({ preventScroll: true });
        assertMutationForeground(document);
        target.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, code: 'Enter', key: 'Enter'
        }));
        return ${JSON.stringify(operation.operationId)};
      }
      const currentIndex = modelRows.indexOf(target);
      const offset = ${JSON.stringify(direction)} === 'increase' ? 1 : -1;
      const nextIndex = pickerView
        ? (currentIndex + offset + modelRows.length) % modelRows.length
        : Math.max(0, Math.min(modelRows.length - 1, currentIndex + offset));
      const expected = modelRows[nextIndex];
      if (!expected || expected === target) return ${JSON.stringify(operation.operationId)};
      const assertCurrentModelSurface = () => {
        composerRoot = assertBoundComposer();
        picker = selectCurrentPicker();
        if (!picker) throw new Error(pickerSelectorFailure);
        if (pickerView) {
          if (picker.querySelector('[data-model-picker-view="advanced"]') !== modelSurface) {
            throw new Error('E_MODEL_PICKER_ADVANCED_VIEW');
          }
        } else {
          const currentMarker = picker.querySelector('[data-model-picker-model-row]');
          const currentTrigger = currentMarker?.closest('[role="menuitem"]');
          const currentSubmenuId = currentTrigger?.getAttribute('aria-controls');
          const currentSubmenu = currentSubmenuId ? document.getElementById(currentSubmenuId) : null;
          if (currentSubmenu !== modelSurface || !currentSubmenu?.matches('[role="menu"][data-state="open"]')) {
            throw new Error('E_MODEL_PICKER_LEGACY_SUBMENU');
          }
        }
        const currentRows = [...modelSurface.querySelectorAll(modelSelector)].filter((row) =>
          row.getAttribute('data-interactive') !== 'false'
            && row.closest('[inert], [hidden], [aria-hidden="true"]') == null
        );
        if (!currentRows.includes(expected)) throw new Error('E_MODEL_PICKER_MODEL_ROW');
      };
      assertMutationForeground(document);
      expected.focus({ preventScroll: true });
      const focusDeadline = Date.now() + 200;
      while (true) {
        assertCurrentModelSurface();
        if (document.activeElement === expected) break;
        if (Date.now() >= focusDeadline) throw new Error('E_MODEL_PICKER_FOCUS_UNCHANGED');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return ${JSON.stringify(operation.operationId)};
    })()`;
    const observedOperationId = await this.evaluate<string>(expression);
    if (observedOperationId !== operation.operationId) throw integrityError("E_OPERATION_UNOBSERVED");
    this.log(interaction === "rotate"
      ? `MicroPlus model picker rotation state verified operationId=${operation.operationId}`
      : `MicroPlus model picker interaction accepted; semantic outcome unverified operationId=${operation.operationId} interaction=${interaction}`);
    return await this.observeOperation(operation);
    });
  }

  async runKeycap(keycapId: OfficialKeycapId): Promise<MutationConfirmation> {
    if (!OFFICIAL_KEYCAP_IDS.includes(keycapId)) throw new Error(`Unknown Codex Micro keycap: ${keycapId}`);
    const viewScoped = (VIEW_SCOPED_KEYCAP_IDS as readonly OfficialKeycapId[]).includes(keycapId);
    const activeViewTransition = KEYCAP_ACTIVE_VIEW_TRANSITIONS[keycapId];
    const operation = await this.beginOperation(
      `KEYCAP_${keycapId}`,
      "invoke",
      undefined,
      false,
      viewScoped,
      activeViewTransition?.transition === "new-task",
    );
    return await this.withOperationTargetLease(operation, async () => {
    const contentFreeCommand = (CONTENT_FREE_COMMANDS as readonly OfficialKeycapId[]).includes(keycapId)
      ? keycapId as ContentFreeCommand
      : undefined;
    const contentFreeBefore = contentFreeCommand
      ? contentFreeSurface(this.lastSnapshot)
      : undefined;
    const nativeUiKeycap = (NATIVE_UI_KEYCAPS as readonly OfficialKeycapId[]).includes(keycapId)
      ? keycapId as NativeUiKeycap
      : undefined;
    // FOLD opens an OS picker and PARTY has a stronger side-chat observer;
    // only renderer-visible transitions use the generic native UI readback.
    const nativeUiObservationKeycap = nativeUiKeycap && nativeUiKeycap !== "FOLD" && nativeUiKeycap !== "PARTY"
      ? nativeUiKeycap
      : undefined;
    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      const moduleUrl = (prefix) => {
        const matches = urls.filter((value) => new URL(value).pathname.slice('/assets/'.length).startsWith(prefix));
        return matches.length === 1 ? matches[0] : null;
      };
      const layoutUrl = moduleUrl('codex-micro-layout-');
      const bridgeUrl = moduleUrl('codex-micro-bridge-');
      const appInitialUrl = moduleUrl('app-initial-');
      const commandsUrl = moduleUrl('codex-micro-commands-');
      const reviewedKeycapRuntime = ${JSON.stringify((REVIEWED_KEYCAP_COMMANDS_26903[keycapId] || REVIEWED_STANDALONE_KEYCAPS_26903[keycapId]) ? DIAL_RUNTIME_26903 : null)};
      const currentKeycapLayout = !!reviewedKeycapRuntime && !!layoutUrl
        && new URL(layoutUrl).pathname === '/assets/' + reviewedKeycapRuntime.layoutAsset;
      if (!layoutUrl || (!currentKeycapLayout && new URL(layoutUrl).pathname !== '/assets/' + ${JSON.stringify(CURRENT_MICRO_LAYOUT_ASSET)})) {
        throw new Error('E_MICRO_KEYCAP_REGISTRY_UNAVAILABLE');
      }
      const layoutSource = await fetch(layoutUrl).then((response) => response.text());
      const layoutDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(layoutSource));
      const layoutSha256 = [...new Uint8Array(layoutDigest)]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (layoutSha256 !== (currentKeycapLayout ? reviewedKeycapRuntime.layout : ${JSON.stringify(CURRENT_MICRO_LAYOUT_SHA256)})) {
        throw new Error('E_MICRO_KEYCAP_REGISTRY_CHANGED');
      }
      const layout = await import(layoutUrl);
      const keycapGetter = Object.values(layout).find((candidate) => {
        if (typeof candidate !== 'function') return false;
        try { return candidate('FAST')?.id === 'FAST'; } catch { return false; }
      });
      if (typeof keycapGetter !== 'function') throw new Error('E_MICRO_KEYCAP_REGISTRY_CHANGED');
      const keycap = keycapGetter(${JSON.stringify(keycapId)});
      const action = keycap?.action;
      if (!action) throw new Error('E_MICRO_KEYCAP_ACTION_UNAVAILABLE');
      const reviewedStandalone = ${JSON.stringify(REVIEWED_STANDALONE_KEYCAPS_26903[keycapId] ?? null)};
      const currentActionMatches = reviewedStandalone
        ? action.type === reviewedStandalone.type && (reviewedStandalone.type === 'external-url'
          ? action.url === reviewedStandalone.url : action.text === reviewedStandalone.text)
        : action.type === 'command' && action.command === ${JSON.stringify(REVIEWED_KEYCAP_COMMANDS_26903[keycapId]?.command ?? null)};
      if (currentKeycapLayout && !currentActionMatches) {
        throw new Error('E_MICRO_KEYCAP_ACTION_UNAVAILABLE');
      }
      const expectedTransitionCommand = ${JSON.stringify(activeViewTransition?.command ?? null)};
      if (expectedTransitionCommand && (action.type !== 'command' || action.command !== expectedTransitionCommand)) {
        throw new Error('E_MICRO_KEYCAP_ACTION_UNAVAILABLE');
      }
      const expectedNativeUiCommand = ${JSON.stringify(nativeUiKeycap === "LAB" ? "settings" : null)};
      if (expectedNativeUiCommand && (action.type !== 'command' || action.command !== expectedNativeUiCommand)) {
        throw new Error('E_MICRO_KEYCAP_ACTION_UNAVAILABLE');
      }

      const resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
      const readNativeUiSurface = (${readNativeUiSurface.toString()});
      const readActiveComposer = () => resolveActiveComposer(document);
      const requireActiveThread = ${JSON.stringify(viewScoped)} || action.type === 'composer-text';
      const expectedActiveThreadKey = ${JSON.stringify(operation.activeThreadKey ?? null)};
      const expectedActiveComposerKey = ${JSON.stringify(operation.activeComposerKey ?? null)};
      const dispatchCommandOverride = ${JSON.stringify(nativeUiKeycap === "LAB" ? "codexMicroSettings" : null)};
      const dispatchCommand = dispatchCommandOverride ?? action.command;
      const assertActiveThread = () => {
        if (!requireActiveThread) return;
        if (expectedActiveThreadKey) {
          const current = readActiveComposer();
          if (current.activeThreadKey !== expectedActiveThreadKey) throw new Error('E_ACTIVE_THREAD_STALE');
          const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
          if (current.root && !composerIds.ids.has(current.root)) composerIds.ids.set(current.root, 'composer-' + (++composerIds.next));
          if (expectedActiveComposerKey && (!current.root || composerIds.ids.get(current.root) !== expectedActiveComposerKey)) {
            throw new Error('E_ACTIVE_COMPOSER_STALE');
          }
          return;
        }
        const root = readActiveComposer().root;
        const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
        if (root && !composerIds.ids.has(root)) composerIds.ids.set(root, 'composer-' + (++composerIds.next));
        if (!root || composerIds.ids.get(root) !== expectedActiveComposerKey) throw new Error('E_ACTIVE_COMPOSER_STALE');
      };

      if (action.type === 'command') {
        const installClipboardObserver = (${installMarkdownCopyObserver.toString()});
        let commandRunner = null;
        let commandRuntime = null;
        if (bridgeUrl && appInitialUrl && commandsUrl) {
          const [bridgeSource, appInitialSource, commandsSource] = await Promise.all([
            fetch(bridgeUrl).then((response) => response.text()),
            fetch(appInitialUrl).then((response) => response.text()),
            fetch(commandsUrl).then((response) => response.text())
          ]);
          const sha256 = async (source) => {
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
            return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
          };
          const [bridgeSha256, appInitialSha256, commandsSha256] = await Promise.all([
            sha256(bridgeSource), sha256(appInitialSource), sha256(commandsSource)
          ]);
          const [appInitial, commands] = await Promise.all([import(appInitialUrl), import(commandsUrl)]);
          const selectRunner = (${selectNativeCommandRunner.toString()});
          const selectScope = (${selectNativeCommandScope.toString()});
          commandRunner = selectRunner(
            appInitial,
            bridgeSha256,
            appInitialSha256,
            ${JSON.stringify(CURRENT_NATIVE_BRIDGE_SHA256)},
            ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)}
          );
          if (commandsSha256 !== ${JSON.stringify(CURRENT_MICRO_COMMANDS_SHA256)}) commandRunner = null;
          if (currentKeycapLayout) {
            commandRunner = bridgeSha256 === reviewedKeycapRuntime.bridge
              && appInitialSha256 === reviewedKeycapRuntime.initial
              && commandsSha256 === reviewedKeycapRuntime.commands
              && typeof appInitial.W7 === 'function' ? appInitial.W7 : null;
          }
          if (commandRunner) {
            const scopeReferences = currentKeycapLayout
              ? { appScope: appInitial.t3t, access: appInitial.iKt, capability: appInitial.pR }
              : { appScope: appInitial.V1t, access: appInitial.QHt, capability: appInitial.AL };
            commandRuntime = { selectScope, scopeReferences };
            const metadata = typeof commands.n === 'function' ? commands.n(dispatchCommand) : null;
            if (!metadata || metadata.id !== dispatchCommand) throw new Error('E_COMMAND_METADATA_UNAVAILABLE');
            if (currentKeycapLayout && (metadata.requiredAccess ?? null) !== ${JSON.stringify(REVIEWED_KEYCAP_COMMANDS_26903[keycapId]?.requiredAccess ?? null)}) throw new Error('E_COMMAND_ACCESS_REQUIRED');
            if (metadata.requiredAccess != null || dispatchCommand === 'manageTasks') {
              const scope = selectScope(
                document,
                readActiveComposer().root,
                scopeReferences.appScope,
                scopeReferences.access,
                scopeReferences.capability,
                dispatchCommand === 'manageTasks'
              );
              if (!scope) throw new Error('E_COMMAND_SCOPE_UNAVAILABLE');
              if (metadata.requiredAccess != null && !scope.get(scopeReferences.access)) throw new Error('E_COMMAND_ACCESS_REQUIRED');
              if (dispatchCommand === 'manageTasks') {
                const local = scope.get(scopeReferences.capability, { name: 'automations.local' });
                const cloud = scope.get(scopeReferences.capability, { name: 'automations.cloud' });
                if (!local?.isCapable && !cloud?.isCapable) throw new Error('E_COMMAND_CAPABILITY_REQUIRED');
              }
            }
          }
        }
        if (typeof commandRunner !== 'function') throw new Error('E_COMMAND_RUNNER_INCOMPATIBLE');
        // The hashes are a compatibility pin for the current static app assets.
        // They do not attest command semantics or a command-specific outcome.
        assertActiveThread();
        const nativeUiBefore = ${nativeUiObservationKeycap ? "readNativeUiSurface(document)" : "null"};
        let markdownCopyCleanup = () => {};
        let markdownCopyTimer = null;
        if (action.command === 'copyConversationMarkdown') {
          const trackerKey = Symbol.for('codexDeckMarkdownCopyTracker');
          const previous = globalThis[trackerKey];
          const previousRevision = previous && typeof previous.revision === 'number'
            && Number.isFinite(previous.revision) && previous.revision >= 0
            ? Math.floor(previous.revision)
            : 0;
          const generation = previous && typeof previous.generation === 'number'
            && Number.isFinite(previous.generation)
            ? previous.generation + 1
            : 1;
          const tracker = {
            threadKey: expectedActiveThreadKey,
            revision: previousRevision,
            generation,
          };
          globalThis[trackerKey] = tracker;
          markdownCopyCleanup = installClipboardObserver(globalThis.navigator?.clipboard, () => {
            if (globalThis[trackerKey] !== tracker || tracker.generation !== generation
              || tracker.threadKey !== expectedActiveThreadKey) return;
            tracker.revision += 1;
            if (markdownCopyTimer != null) {
              clearTimeout(markdownCopyTimer);
              markdownCopyTimer = null;
            }
          });
          markdownCopyTimer = setTimeout(() => {
            if (globalThis[trackerKey] === tracker) tracker.threadKey = null;
            markdownCopyCleanup();
            markdownCopyTimer = null;
          }, 2000);
        }
        const originalComposer = readActiveComposer();
        const originalComposerRoots = [...document.querySelectorAll('[data-codex-composer-root]')]
          .filter((root) => root.isConnected === true);
        assertMutationForeground(document);
        const handled = commandRunner(dispatchCommand, 'codex_micro_hid');
        if (!handled) throw new Error('E_COMMAND_INACTIVE');
        const activeViewTransition = ${JSON.stringify(activeViewTransition?.transition ?? null)};
        if (activeViewTransition) {
          const composerIdentity = (root) => {
            const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
            if (root && !composerIds.ids.has(root)) composerIds.ids.set(root, 'composer-' + (++composerIds.next));
            return root ? composerIds.ids.get(root) ?? null : null;
          };
          const fromActiveThreadKey = expectedActiveThreadKey ?? null;
          const fromActiveComposerKey = expectedActiveComposerKey;
          const deadline = Date.now() + 1500;
          let stableSignature = null;
          let stableReads = 0;
          while (Date.now() < deadline) {
            const current = readActiveComposer();
            const activeThreadKey = current.activeThreadKey ?? null;
            const activeComposerKey = composerIdentity(current.root);
            const identityChanged = activeThreadKey !== fromActiveThreadKey
              || activeComposerKey !== fromActiveComposerKey;
            const expectedTransition = activeViewTransition === 'forked'
              ? Boolean(fromActiveThreadKey && activeThreadKey && activeThreadKey !== fromActiveThreadKey)
              : activeViewTransition === 'archived'
                ? Boolean(fromActiveThreadKey && activeThreadKey !== fromActiveThreadKey)
                : identityChanged && Boolean(activeThreadKey || activeComposerKey);
            if (expectedTransition) {
              const signature = JSON.stringify([activeThreadKey, activeComposerKey]);
              stableReads = signature === stableSignature ? stableReads + 1 : 1;
              stableSignature = signature;
              if (stableReads >= 2) {
                return {
                  operationId: ${JSON.stringify(operation.operationId)},
                  postcondition: {
                    kind: 'active-view-transition',
                    transition: activeViewTransition,
                    fromActiveThreadKey,
                    fromActiveComposerKey,
                    activeThreadKey,
                    activeComposerKey
                  }
                };
              }
            } else {
              stableSignature = null;
              stableReads = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error('E_OPERATION_UNOBSERVED');
        }
        if (action.command === 'openSideChat') {
          if (!commandRuntime || !originalComposer.root) throw new Error('E_OPERATION_UNOBSERVED');
          const selectOpenedSideChat = (${selectVerifiedOpenedSideChat.toString()});
          const deadline = Date.now() + 1500;
          let opened = null;
          while (Date.now() < deadline) {
            opened = selectOpenedSideChat(
              document,
              originalComposer.root,
              commandRuntime.selectScope,
              commandRuntime.scopeReferences.appScope,
              commandRuntime.scopeReferences.access,
              commandRuntime.scopeReferences.capability,
              resolveActiveComposer,
              originalComposerRoots
            );
            if (opened) break;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!opened?.root || !expectedActiveThreadKey || !expectedActiveComposerKey) throw new Error('E_OPERATION_UNOBSERVED');
          const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
          if (!composerIds.ids.has(opened.root)) composerIds.ids.set(opened.root, 'composer-' + (++composerIds.next));
          const sideComposerKey = composerIds.ids.get(opened.root);
          if (typeof sideComposerKey !== 'string' || sideComposerKey === expectedActiveComposerKey) {
            throw new Error('E_OPERATION_UNOBSERVED');
          }
          return {
            operationId: ${JSON.stringify(operation.operationId)},
            postcondition: {
              kind: 'side-chat-opened',
              activeThreadKey: expectedActiveThreadKey,
              activeComposerKey: expectedActiveComposerKey,
              sideComposerKey
            }
          };
        }
        if (${JSON.stringify(nativeUiObservationKeycap ?? null)} && nativeUiBefore) {
          const nativeUiKeycap = ${JSON.stringify(nativeUiObservationKeycap ?? null)};
          const nativeUiSignature = (surface) => JSON.stringify([
            surface.route,
            surface.terminalVisible,
            surface.reviewVisible,
            surface.browserTabCount,
          ]);
          const beforeSignature = nativeUiSignature(nativeUiBefore);
          const deadline = Date.now() + 1500;
          let stableSignature = null;
          let stableReads = 0;
          while (Date.now() < deadline) {
            const current = readNativeUiSurface(document);
            const signature = nativeUiSignature(current);
            if (signature !== beforeSignature) {
              stableReads = signature === stableSignature ? stableReads + 1 : 1;
              stableSignature = signature;
              if (stableReads >= 2) {
                return {
                  operationId: ${JSON.stringify(operation.operationId)},
                  postcondition: {
                    kind: 'native-ui-changed',
                    keycapId: nativeUiKeycap,
                    before: nativeUiBefore,
                    after: current,
                  },
                };
              }
            } else {
              stableSignature = null;
              stableReads = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        return ${JSON.stringify(operation.operationId)};
      }

      if (!appInitialUrl) throw new Error('E_MICRO_STANDALONE_RUNTIME_UNAVAILABLE');
      const appInitialSource = await fetch(appInitialUrl).then((response) => response.text());
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(appInitialSource));
      const appInitialSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const standaloneExpectedHash = currentKeycapLayout ? reviewedKeycapRuntime.initial : ${JSON.stringify(CURRENT_APP_INITIAL_SHA256)};
      if (appInitialSha256 !== standaloneExpectedHash) {
        throw new Error('E_MICRO_STANDALONE_RUNTIME_CHANGED');
      }
      const appInitial = await import(appInitialUrl);
      if (action.type === 'external-url') {
        const selectExternalUrlOpener = (${selectNativeExternalUrlOpener.toString()});
        const selectAllowedExternalUrl = (${allowlistedNativeExternalUrl.toString()});
        const externalUrl = selectAllowedExternalUrl(
          action.url,
          ${JSON.stringify(ALLOWED_NATIVE_EXTERNAL_URLS)}
        );
        if (!externalUrl) throw new Error('E_EXTERNAL_URL_NOT_ALLOWED');
        const openExternalUrl = selectExternalUrlOpener(
          currentKeycapLayout ? { d2t: appInitial.A6t } : appInitial,
          appInitialSha256,
          standaloneExpectedHash
        );
        if (!openExternalUrl) throw new Error('E_MICRO_STANDALONE_RUNTIME_UNAVAILABLE');
        assertActiveThread();
        assertMutationForeground(document);
        if (openExternalUrl({ href: externalUrl, initiator: 'open_in_browser_bridge' }) !== true) {
          throw new Error('E_OPERATION_UNOBSERVED');
        }
        return {
          operationId: ${JSON.stringify(operation.operationId)},
          postcondition: {
            kind: 'external-url-dispatched',
            activeThreadKey: null,
            activeComposerKey: null
          }
        };
      }
      if (action.type === 'composer-text') {
        const selectHostBus = (${selectNativeMicroHostBus.toString()});
        const selectComposerController = (${selectNativeComposerTextController.toString()});
        const bus = selectHostBus(
          currentKeycapLayout ? { Kun: appInitial._mn } : appInitial,
          appInitialSha256,
          standaloneExpectedHash
        );
        if (!bus) throw new Error('E_MICRO_STANDALONE_RUNTIME_UNAVAILABLE');
        assertActiveThread();
        const beforeComposer = readActiveComposer();
        const beforeController = selectComposerController(beforeComposer.root);
        if (!beforeComposer.root || !beforeController || !expectedActiveComposerKey) {
          throw new Error('E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE');
        }
        const beforeText = beforeController.getPersistedText();
        if (typeof beforeText !== 'string') throw new Error('E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE');
        assertMutationForeground(document);
        bus.dispatchHostMessage({ type: 'codex-micro-insert-composer-text', text: action.text });
        const isExactInsertion = (${isExactComposerTextInsertion.toString()});
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          assertActiveThread();
          const currentComposer = readActiveComposer();
          if (currentComposer.root !== beforeComposer.root) throw new Error('E_ACTIVE_COMPOSER_STALE');
          const currentController = selectComposerController(currentComposer.root);
          if (!currentController) throw new Error('E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE');
          const afterText = currentController.getPersistedText();
          if (typeof afterText === 'string' && isExactInsertion(beforeText, afterText, action.text)) {
            return {
              operationId: ${JSON.stringify(operation.operationId)},
              postcondition: {
                kind: 'composer-text-inserted',
                activeThreadKey: currentComposer.activeThreadKey ?? null,
                activeComposerKey: expectedActiveComposerKey
              }
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('E_OPERATION_UNOBSERVED');
      }
      throw new Error('This Codex Micro keycap action is not supported as a standalone key.');
    })()`;
    const observed = await this.evaluate<string | { operationId: string; postcondition?: unknown }>(expression);
    const observedOperationId = typeof observed === "string" ? observed : observed?.operationId;
    if (observedOperationId !== operation.operationId) throw integrityError("E_OPERATION_UNOBSERVED");
    const candidate = typeof observed === "object" && observed
      ? observed.postcondition as Partial<OperationPostcondition> | undefined
      : undefined;
    let postcondition: OperationPostcondition | undefined;
    if (candidate?.kind === "side-chat-opened"
      && candidate.activeThreadKey === operation.activeThreadKey
      && candidate.activeComposerKey === operation.activeComposerKey
      && typeof candidate.activeComposerKey === "string"
      && /^composer-[1-9][0-9]{0,9}$/.test(candidate.activeComposerKey)
      && typeof candidate.sideComposerKey === "string"
      && /^composer-[1-9][0-9]{0,9}$/.test(candidate.sideComposerKey)
      && candidate.sideComposerKey !== candidate.activeComposerKey) {
      postcondition = candidate as OperationPostcondition;
    } else if (candidate?.kind === "external-url-dispatched"
      && candidate.activeThreadKey === null
      && candidate.activeComposerKey === null) {
      postcondition = candidate as OperationPostcondition;
    } else if (candidate?.kind === "composer-text-inserted"
      && (candidate.activeThreadKey === null
        || (typeof candidate.activeThreadKey === "string"
          && candidate.activeThreadKey.length > 0
          && candidate.activeThreadKey.length <= 512))
      && typeof candidate.activeComposerKey === "string"
      && candidate.activeComposerKey === operation.activeComposerKey
      && /^composer-[1-9][0-9]{0,9}$/.test(candidate.activeComposerKey)) {
      postcondition = candidate as OperationPostcondition;
    } else if (candidate?.kind === "native-ui-changed"
      && nativeUiObservationKeycap
      && candidate.keycapId === nativeUiObservationKeycap
      && isNativeUiSurface(candidate.before)
      && isNativeUiSurface(candidate.after)) {
      const observation = observeNativeUiResult(
        nativeUiObservationKeycap,
        candidate.before,
        candidate.after,
      );
      if (observation.status === "observed" && observation.semantic === "verified") {
        postcondition = candidate as OperationPostcondition;
      }
    } else if (candidate?.kind === "active-view-transition" && activeViewTransition
      && candidate.transition === activeViewTransition.transition) {
      const nullableThreadKey = (value: unknown): value is string | null => value === null
        || (typeof value === "string" && value.length > 0 && value.length <= 512);
      const nullableComposerKey = (value: unknown): value is string | null => value === null
        || (typeof value === "string" && /^composer-[1-9][0-9]{0,9}$/.test(value));
      const fromActiveThreadKey = operation.activeThreadKey ?? null;
      const fromActiveComposerKey = operation.activeComposerKey ?? null;
      const hasValidIdentities = nullableThreadKey(candidate.fromActiveThreadKey)
        && nullableComposerKey(candidate.fromActiveComposerKey)
        && nullableThreadKey(candidate.activeThreadKey)
        && nullableComposerKey(candidate.activeComposerKey)
        && candidate.fromActiveThreadKey === fromActiveThreadKey
        && candidate.fromActiveComposerKey === fromActiveComposerKey;
      const transitionMatches = hasValidIdentities && (
        candidate.transition === "forked"
          ? Boolean(fromActiveThreadKey && candidate.activeThreadKey && candidate.activeThreadKey !== fromActiveThreadKey)
          : candidate.transition === "archived"
            ? Boolean(fromActiveThreadKey && candidate.activeThreadKey !== fromActiveThreadKey)
            : (candidate.activeThreadKey !== fromActiveThreadKey || candidate.activeComposerKey !== fromActiveComposerKey)
              && Boolean(candidate.activeThreadKey || candidate.activeComposerKey)
      );
      if (transitionMatches) postcondition = candidate as OperationPostcondition;
    }
    if (keycapId === "PARTY" && !postcondition) throw integrityError("E_OPERATION_UNOBSERVED");
    if (activeViewTransition && postcondition?.kind !== "active-view-transition") {
      throw integrityError("E_OPERATION_UNOBSERVED");
    }
    if (keycapId === "OAI" && postcondition?.kind !== "external-url-dispatched") {
      throw integrityError("E_OPERATION_UNOBSERVED");
    }
    if ((keycapId === "YOLO" || keycapId === "YEET") && postcondition?.kind !== "composer-text-inserted") {
      throw integrityError("E_OPERATION_UNOBSERVED");
    }
    if (postcondition?.kind === "external-url-dispatched") {
      this.log(`MicroPlus external URL dispatch verified operationId=${operation.operationId}`);
    } else if (postcondition?.kind === "composer-text-inserted") {
      this.log(`MicroPlus composer text insertion verified operationId=${operation.operationId}`);
    } else if (postcondition?.kind === "native-ui-changed") {
      this.log(`MicroPlus native UI transition verified keycap=${postcondition.keycapId} operationId=${operation.operationId}`);
    }
    const direction = keycapId === "MIND+" ? "increase" : keycapId === "MIND-" ? "decrease" : undefined;
    const confirmation = await this.observeOperation(operation, direction, postcondition);
    if (!postcondition && contentFreeCommand && contentFreeBefore) {
      return await this.observeContentFreeCommand(
        contentFreeCommand,
        operation,
        contentFreeBefore,
        confirmation,
      );
    }
    return confirmation;
    });
  }

  private async observeContentFreeCommand(
    command: ContentFreeCommand,
    operation: OperationRequest,
    before: ContentFreeSurface,
    confirmation: MutationConfirmation,
  ): Promise<MutationConfirmation> {
    let after = confirmation.observedSnapshot ?? this.lastSnapshot;
    const assertFreshResultSnapshot = (snapshot: MicroSnapshot): void => {
      if (snapshot.connectionEpoch !== operation.connectionEpoch) throw integrityError("E_CONNECTION_STALE");
      if (snapshot.pageEpoch !== operation.pageEpoch) throw integrityError("E_PAGE_STALE");
      if (snapshot.mappingFingerprint !== operation.mappingFingerprint) throw integrityError("E_MAPPING_STALE");
      if (snapshot.targetIdentity !== operation.targetIdentity) throw integrityError("E_TARGET_STALE");
    };
    if (after) assertFreshResultSnapshot(after);
    let observation = observeContentFreeResult(command, before, contentFreeSurface(after));
    if (observation.status === "unavailable" || observation.status === "scope-changed") {
      return confirmation;
    }

    const deadline = Date.now() + 1500;
    while (observation.status === "unchanged" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      after = await this.refresh();
      assertFreshResultSnapshot(after);
      observation = observeContentFreeResult(command, before, contentFreeSurface(after));
      if (observation.status === "unavailable" || observation.status === "scope-changed") break;
    }
    if (observation.status !== "observed" || observation.semantic !== "verified" || !after) {
      return confirmation;
    }

    this.log(`MicroPlus content-free result confirmed operationId=${operation.operationId} command=${command} signal=${observation.signal}`);
    return { ...confirmation, semanticOutcome: "confirmed", observedSnapshot: after };
  }

  consumeRateLimitReset(redeemRequestId: string = randomUUID()): Promise<RateLimitResetOutcome> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(redeemRequestId)) throw integrityError("E_INVALID_RESET_REQUEST_ID");
    if (this.activeResetAttempt) return this.activeResetAttempt;
    const attempt = this.consumeRateLimitResetCoordinated(redeemRequestId);
    this.activeResetAttempt = attempt;
    void attempt.finally(() => {
      if (this.activeResetAttempt === attempt) this.activeResetAttempt = undefined;
    }).catch(() => undefined);
    return attempt;
  }

  private async consumeRateLimitResetCoordinated(redeemRequestId: string): Promise<RateLimitResetOutcome> {
    const persisted = await this.resetStore.read();
    if (persisted && !persisted.outcome) redeemRequestId = persisted.redeemRequestId;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(redeemRequestId)) throw integrityError("E_INVALID_RESET_REQUEST_ID");
    if (persisted?.outcome && persisted.redeemRequestId === redeemRequestId) {
      this.resetOutcomes.set(redeemRequestId, persisted.outcome);
    }
    const completed = this.resetOutcomes.get(redeemRequestId);
    if (completed) return completed;
    const pending = this.resetInFlight.get(redeemRequestId);
    if (pending) return pending;

    const attempt = this.consumeRateLimitResetOnce(
      redeemRequestId,
      persisted?.redeemRequestId === redeemRequestId ? persisted.creditId : undefined
    );
    this.resetInFlight.set(redeemRequestId, attempt);
    try {
      const outcome = await attempt;
      this.resetOutcomes.set(redeemRequestId, outcome);
      await this.resetStore.write({ version: 1, redeemRequestId, outcome });
      if (this.resetOutcomes.size > 32) this.resetOutcomes.delete(this.resetOutcomes.keys().next().value!);
      return outcome;
    } finally {
      if (this.resetInFlight.get(redeemRequestId) === attempt) this.resetInFlight.delete(redeemRequestId);
    }
  }

  private async consumeRateLimitResetOnce(redeemRequestId: string, retainedCreditId?: string): Promise<RateLimitResetOutcome> {
    await this.ensureConnected();
    if (!retainedCreditId) {
      retainedCreditId = await this.prepareRateLimitReset(redeemRequestId);
      await this.resetStore.write({ version: 1, redeemRequestId, creditId: retainedCreditId });
    }
    const expression = `(async () => {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      let client = null;
      for (const url of urls) {
        try {
          const namespace = await import(url);
          client = Object.values(namespace).find((candidate) =>
            candidate && typeof candidate === 'object' &&
            typeof candidate.safeGet === 'function' && typeof candidate.safePost === 'function'
          );
          if (client) break;
        } catch {}
      }
      if (!client) throw new Error('Codex usage client is unavailable.');

      const redeemRequestId = ${JSON.stringify(redeemRequestId)};
      const attempts = globalThis.__codexDeckResetAttempts ??= new Map();
      const retained = attempts.get(redeemRequestId);
      if (retained?.outcome) return retained.outcome;
      const creditId = ${JSON.stringify(retainedCreditId)};
      attempts.set(redeemRequestId, { creditId });
      assertMutationForeground(document);
      const result = await client.safePost('/wham/rate-limit-reset-credits/consume', {
        requestBody: { credit_id: creditId, redeem_request_id: redeemRequestId }
      });
      if (result?.code !== 'reset' && result?.code !== 'already_redeemed') {
        throw new Error('Codex rejected the reset credit: ' + String(result?.code ?? 'unknown'));
      }

      let refresh = 'unavailable';
      try {
        const refreshed = await client.safeGet('/wham/usage');
        const root = document.getElementById('root');
        const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith('__reactContainer$'));
        const queue = reactKey ? [root[reactKey]] : [];
        const seen = new Set();
        while (queue.length && seen.size < 30000) {
          const fiber = queue.pop();
          if (!fiber || seen.has(fiber)) continue;
          seen.add(fiber);
          const values = [fiber.memoizedProps?.value];
          let dependency = fiber.dependencies?.firstContext;
          while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
          const queryClient = values.find((value) =>
            value && typeof value.setQueryData === 'function' && typeof value.invalidateQueries === 'function'
          );
          if (queryClient) {
            assertMutationForeground(document);
            queryClient.setQueryData(['rate-limit-status'], refreshed);
            assertMutationForeground(document);
            void queryClient.invalidateQueries({ queryKey: ['rate-limit-reset-credits'] });
            refresh = 'updated';
            break;
          }
          queue.push(fiber.child, fiber.sibling);
        }
      } catch { refresh = 'failed'; }
      const outcome = { code: result.code, refresh, redeemRequestId };
      attempts.set(redeemRequestId, { creditId, outcome });
      if (attempts.size > 32) attempts.delete(attempts.keys().next().value);
      return outcome;
    })()`;
    const outcome = await this.evaluate<RateLimitResetOutcome>(expression);
    if (
      (outcome?.code !== "reset" && outcome?.code !== "already_redeemed") ||
      !["updated", "failed", "unavailable"].includes(outcome?.refresh) ||
      outcome?.redeemRequestId !== redeemRequestId
    ) throw integrityError("E_INVALID_RESET_OUTCOME");
    return outcome;
  }

  private async prepareRateLimitReset(redeemRequestId: string): Promise<string> {
    const expression = `(async () => {
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      let client = null;
      for (const url of urls) {
        try {
          const namespace = await import(url);
          client = Object.values(namespace).find((candidate) => candidate && typeof candidate === 'object' && typeof candidate.safeGet === 'function' && typeof candidate.safePost === 'function');
          if (client) break;
        } catch {}
      }
      if (!client) throw new Error('Codex usage client is unavailable.');
      const summary = await client.safeGet('/wham/usage');
      const applicable = Number(summary?.rate_limit_reset_credits?.applicable_available_count);
      if (Number.isFinite(applicable) && applicable <= 0) throw new Error('No reset credit is currently applicable.');
      const details = await client.safeGet('/wham/rate-limit-reset-credits');
      const credit = Array.isArray(details?.credits)
        ? details.credits.find((candidate) => candidate?.status === 'available' && candidate?.is_supported_by_plan !== false)
        : null;
      if (!credit?.id) throw new Error('No available reset credit was found.');
      return { redeemRequestId: ${JSON.stringify(redeemRequestId)}, creditId: credit.id };
    })()`;
    const prepared = await this.evaluate<{ redeemRequestId?: unknown; creditId?: unknown }>(expression);
    if (prepared?.redeemRequestId !== redeemRequestId || typeof prepared.creditId !== "string" || !/^[A-Za-z0-9_-]{1,240}$/.test(prepared.creditId)) {
      throw integrityError("E_INVALID_RESET_CREDIT");
    }
    return prepared.creditId;
  }

  close(): void {
    this.closed = true;
    const leasedSockets = new Set([
      ...[...this.heldPttOperations.values()].map(({ socket }) => socket),
      ...[...this.heldNativeInputOperations.values()].map(({ socket }) => socket),
    ].filter(Boolean) as WebSocket[]);
    this.disconnect();
    for (const socket of leasedSockets) socket.close();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(integrityError("E_BRIDGE_CLOSED"));
    }
    this.pending.clear();
  }

  private async beginOperation(
    physicalId: string,
    phase: PhysicalInputPhase,
    alreadyFresh?: MicroSnapshot,
    rebase = false,
    bindActiveThread: boolean | ((snapshot: MicroSnapshot) => boolean) = false,
    captureActiveView = false,
  ): Promise<OperationRequest> {
    if (this.heldPttOperations.size > 0 && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
      throw integrityError("E_FOREGROUND_TARGET_STALE");
    }
    const rebound = this.connectedTargetKey ? await this.ensureForegroundMutationTarget() : false;
    const expected = this.lastSnapshot;
    const current = alreadyFresh
      && !rebound
      && alreadyFresh.connectionEpoch === this.connectionEpoch
      && alreadyFresh.targetIdentity === this.targetIdentity
      ? alreadyFresh
      : await this.refresh();
    if (expected && !rebase) assertFreshOperationTarget(expected, current);
    const shouldBindActiveThread = typeof bindActiveThread === "function" ? bindActiveThread(current) : bindActiveThread;
    if (shouldBindActiveThread) {
      if (!current.activeThreadKey && !current.activeComposerKey) throw integrityError("E_ACTIVE_VIEW_UNAVAILABLE");
      if (expected) assertFreshActiveThread(expected, current);
    }
    const request = {
      version: 1,
      requestId: randomUUID(),
      operationId: randomUUID(),
      connectionEpoch: current.connectionEpoch,
      pageEpoch: current.pageEpoch,
      physicalId,
      phase,
      mappingFingerprint: current.mappingFingerprint,
      targetIdentity: current.targetIdentity,
      ...((shouldBindActiveThread || captureActiveView) && current.activeThreadKey ? { activeThreadKey: current.activeThreadKey } : {}),
      ...((shouldBindActiveThread || captureActiveView) && current.activeComposerKey ? { activeComposerKey: current.activeComposerKey } : {})
    } satisfies OperationRequest;
    this.operationGuard.accept(request, this.connectionEpoch, this.pageEpoch);
    // Agent activation can intentionally select a task hosted by another Codex
    // window. Every other mutation must keep its source renderer stable until
    // its observer finishes, so a periodic refresh cannot rebind it mid-flight.
    if (!request.physicalId.startsWith("AG0") && request.physicalId !== "ACT10" && request.physicalId !== "ACT11") {
      this.leaseOperationTarget(request);
    }
    return request;
  }

  private leaseOperationTarget(operation: OperationRequest): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw integrityError("E_FOREGROUND_TARGET_STALE");
    assertOperationTargetIdentity(operation, this.targetIdentity, this.connectionEpoch);
    this.operationTargetLeases.set(operation.operationId, {
      socket,
      targetIdentity: this.targetIdentity,
      connectionEpoch: this.connectionEpoch,
    });
  }

  /** In-flight mutations and PTT keep observation bound to their renderer. */
  private hasActiveTargetLease(): boolean {
    return this.heldPttOperations.size > 0
      || this.operationTargetLeases.size > 0;
  }

  /** Stateless releases retain their source socket without blocking observation rebind. */
  private isRetainedReleaseSocket(socket: WebSocket): boolean {
    return [...this.heldNativeInputOperations.values()].some((held) => held.socket === socket)
      || [...this.heldPttOperations.values()].some((held) => held.socket === socket);
  }

  private async withOperationTargetLease<T>(operation: OperationRequest, run: () => Promise<T>): Promise<T> {
    try {
      const lease = this.operationTargetLeases.get(operation.operationId);
      if (!lease || lease.socket !== this.socket
        || lease.targetIdentity !== this.targetIdentity
        || lease.connectionEpoch !== this.connectionEpoch) {
        throw integrityError("E_TARGET_STALE");
      }
      return await run();
    } finally {
      this.operationTargetLeases.delete(operation.operationId);
    }
  }

  private async observeOperation(
    operation: OperationRequest,
    reasoningDirection?: ReasoningAdjustment,
    postcondition?: OperationPostcondition,
  ): Promise<MutationConfirmation> {
    const beforeComposer = this.lastSnapshot?.composerReadback;
    const beforeMatches = (!operation.activeThreadKey || beforeComposer?.activeThreadKey === operation.activeThreadKey)
      && (!operation.activeComposerKey || this.lastSnapshot?.activeComposerKey === operation.activeComposerKey);
    const beforeReasoning = reasoningDirection && beforeMatches
      ? beforeComposer?.reasoningEffort ?? null
      : null;
    const after = await this.refresh();
    if (after.connectionEpoch !== operation.connectionEpoch) throw integrityError("E_CONNECTION_STALE");
    if (after.pageEpoch !== operation.pageEpoch) throw integrityError("E_PAGE_STALE");
    if (after.mappingFingerprint !== operation.mappingFingerprint) throw integrityError("E_MAPPING_STALE");
    if (after.targetIdentity !== operation.targetIdentity) throw integrityError("E_TARGET_STALE");
    const isPttRelease = (operation.physicalId === "ACT10" || operation.physicalId === "ACT11")
      && (operation.phase === "up" || operation.phase === "safety-up");
    const isActiveViewTransition = postcondition?.kind === "active-view-transition";
    const postconditionActiveThreadKey = postcondition && "activeThreadKey" in postcondition
      ? postcondition.activeThreadKey
      : undefined;
    const postconditionActiveComposerKey = postcondition && "activeComposerKey" in postcondition
      ? postcondition.activeComposerKey
      : undefined;
    const expectedActiveThreadKey = isPttRelease
      ? undefined
      : isActiveViewTransition ? postcondition.activeThreadKey
        : postconditionActiveThreadKey !== undefined ? postconditionActiveThreadKey : operation.activeThreadKey;
    const expectedActiveComposerKey = isPttRelease
      ? undefined
      : isActiveViewTransition ? postcondition.activeComposerKey
        : postconditionActiveComposerKey !== undefined ? postconditionActiveComposerKey : operation.activeComposerKey;
    if (isActiveViewTransition) {
      if ((after.activeThreadKey ?? null) !== expectedActiveThreadKey) throw integrityError("E_ACTIVE_THREAD_STALE");
      if ((after.activeComposerKey ?? null) !== expectedActiveComposerKey) throw integrityError("E_ACTIVE_COMPOSER_STALE");
    } else {
      // A proven native surface transition may unmount the source composer.
      // A different live composer is still a mismatch, as are all transport epochs.
      const allowsAbsentView = postcondition?.kind === "native-ui-changed";
      if (expectedActiveThreadKey && after.activeThreadKey !== expectedActiveThreadKey
        && !(allowsAbsentView && !after.activeThreadKey)) throw integrityError("E_ACTIVE_THREAD_STALE");
      if (expectedActiveComposerKey && after.activeComposerKey !== expectedActiveComposerKey
        && !(allowsAbsentView && !after.activeComposerKey)) throw integrityError("E_ACTIVE_COMPOSER_STALE");
    }
    const afterComposer = after.composerReadback;
    const afterMatches = (!operation.activeThreadKey || afterComposer?.activeThreadKey === operation.activeThreadKey)
      && (!operation.activeComposerKey || after.activeComposerKey === operation.activeComposerKey);
    const afterReasoning = reasoningDirection && afterMatches
      ? afterComposer?.reasoningEffort ?? null
      : null;
    if (beforeReasoning && afterReasoning) {
      const semanticOutcome = beforeReasoning === afterReasoning ? "reasoning-unchanged" : "reasoning-changed";
      this.log(`MicroPlus reasoning outcome ${semanticOutcome} operationId=${operation.operationId}`);
      return {
        dispatch: "accepted", metadata: "matched", semanticOutcome,
        previousReasoningEffort: beforeReasoning, currentReasoningEffort: afterReasoning,
        observedSnapshot: after,
      };
    }
    if (postcondition) {
      this.log(`MicroPlus postcondition confirmed operationId=${operation.operationId} kind=${postcondition.kind}`);
      return { dispatch: "accepted", metadata: "matched", semanticOutcome: "confirmed", observedSnapshot: after };
    }
    this.log(`MicroPlus dispatch metadata confirmed; semantic outcome unverified operationId=${operation.operationId} physicalId=${operation.physicalId} phase=${operation.phase}`);
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified", observedSnapshot: after };
  }

  private async dispatch(
    type: string,
    payload: object,
    requiredHandler: string,
    operation?: OperationRequest,
    operationSocket?: WebSocket,
    onBeforeCdpSubmit?: () => void,
  ): Promise<void> {
    const allowBackgroundPttRelease = Boolean(
      operationSocket
      && operation
      && (operation.physicalId === "ACT10" || operation.physicalId === "ACT11")
      && (operation.phase === "up" || operation.phase === "safety-up"),
    );
    const heldNativeInput = operation && isLeasedNativeInputId(operation.physicalId)
      ? this.heldNativeInputOperations.get(operation.physicalId)
      : undefined;
    const nativeInputEvent = (payload as { event?: { key?: unknown; act?: unknown } }).event;
    const allowBackgroundNativeInputRelease = Boolean(
      operationSocket
      && operation
      && operation.phase === "up"
      && type === "codex-micro-hid-event"
      && requiredHandler === "codex-micro-hid-event"
      && nativeInputEvent?.act === 0
      && nativeInputEvent.key === operation.physicalId
      && heldNativeInput
      && heldNativeInput.socket === operationSocket
      && heldNativeInput.operation.physicalId === operation.physicalId
      && heldNativeInput.operation.targetIdentity === operation.targetIdentity
      && heldNativeInput.operation.connectionEpoch === operation.connectionEpoch,
    );
    const allowBackgroundRelease = allowBackgroundPttRelease || allowBackgroundNativeInputRelease;
    let socket: WebSocket;
    if (operationSocket) {
      if (this.closed) throw integrityError("E_BRIDGE_CLOSED");
      if (operationSocket.readyState !== WebSocket.OPEN) throw integrityError("E_RELEASE_TARGET_GONE");
      if (!allowBackgroundRelease) {
        if (operationSocket !== this.socket) throw integrityError("E_TARGET_STALE");
        if (operation) assertOperationTargetIdentity(operation, this.targetIdentity, this.connectionEpoch);
      }
      socket = operationSocket;
    } else {
      await this.ensureConnected();
      if (operation) assertOperationTargetIdentity(operation, this.targetIdentity, this.connectionEpoch);
      socket = this.socket!;
    }
    const message = { type, ...payload, ...(operation ? { codexDeckOperation: operation } : {}) };
    const expression = `(async () => {
      let mutationDispatchStarted = false;
      try {
      const assertMutationForeground = (${assertFocusedVisibleRendererForMutation.toString()});
      const allowBackgroundRelease = ${JSON.stringify(allowBackgroundRelease)};
      if (!allowBackgroundRelease) assertMutationForeground(document);
      const discoveredUrls = [...new Set([
        ...[...document.querySelectorAll('link[href], script[src]')].map((element) => element.href || element.src),
        ...performance.getEntriesByType('resource').map((entry) => entry.name)
      ])];
      const urls = (${trustedRendererAssetUrls.toString()})(discoveredUrls, location.href);
      let bus = null;
      for (const url of urls) {
        try {
          const namespace = await import(url);
          bus = Object.values(namespace).find((candidate) => candidate && typeof candidate === 'object' && candidate.handlers instanceof Map && (typeof candidate.dispatchHostMessage === 'function' || typeof candidate.dispatchMessage === 'function'));
          if (bus) break;
        } catch {}
      }
      if (!bus) throw new Error('E_MICRO_EVENT_BUS_UNAVAILABLE');
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) {
        if (!allowBackgroundRelease) assertMutationForeground(document);
        dispatch.call(bus, ${JSON.stringify(INPUT_ONLY_DEVICE_STATE)});
      }
      const deadline = Date.now() + 1200;
      while ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) throw new Error('E_MICRO_HANDLER_INACTIVE');
      // Native PTT stop is broadcast to every composer handler. Only the
      // handler whose local hold flag accepted the matching start acts on it,
      // so release must remain deliverable after the visible composer changes.
      const isPttRelease = ${JSON.stringify(Boolean(
        operation
        && (operation.physicalId === "ACT10" || operation.physicalId === "ACT11")
        && (operation.phase === "up" || operation.phase === "safety-up")
      ))};
      const isPttDown = ${JSON.stringify(Boolean(
        operation
        && (operation.physicalId === "ACT10" || operation.physicalId === "ACT11")
        && operation.phase === "down"
      ))};
      const isLeasedNativeStateRelease = ${JSON.stringify(allowBackgroundNativeInputRelease)};
      const isStateRelease = isPttRelease || isLeasedNativeStateRelease;
      const expectedActiveThreadKey = isStateRelease ? null : ${JSON.stringify(operation?.activeThreadKey ?? null)};
      const expectedActiveComposerKey = isStateRelease ? null : ${JSON.stringify(operation?.activeComposerKey ?? null)};
      let resolveActiveComposer = null;
      let verifiedActiveComposer = null;
      const verifyExpectedComposer = () => {
        const activeComposer = resolveActiveComposer(document);
        const activeThreadKey = activeComposer.activeThreadKey ?? null;
        if ((isPttDown && activeThreadKey !== expectedActiveThreadKey)
          || (!isPttDown && expectedActiveThreadKey && activeThreadKey !== expectedActiveThreadKey)) {
          throw new Error('E_ACTIVE_THREAD_STALE');
        }
        if (expectedActiveComposerKey) {
          const root = activeComposer.root;
          const composerIds = globalThis.__codexDeckComposerIds ??= { ids: new WeakMap(), next: 0 };
          if (root && !composerIds.ids.has(root)) composerIds.ids.set(root, 'composer-' + (++composerIds.next));
          if (!root || composerIds.ids.get(root) !== expectedActiveComposerKey) throw new Error('E_ACTIVE_COMPOSER_STALE');
        }
        return activeComposer;
      };
      if (expectedActiveThreadKey || expectedActiveComposerKey) {
        resolveActiveComposer = ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION};
        verifiedActiveComposer = verifyExpectedComposer();
      }
      if (isPttDown) {
        if (!expectedActiveComposerKey || !verifiedActiveComposer?.root) {
          throw new Error('E_ACTIVE_COMPOSER_STALE');
        }
        const focusPttComposer = (${focusSelectedComposerForPtt.toString()});
        focusPttComposer(document, verifiedActiveComposer.root);
        // Focusing can synchronously activate or replace a composer. Re-check
        // both identities and foreground state before the native down exists.
        assertMutationForeground(document);
        verifiedActiveComposer = verifyExpectedComposer();
      }
      if (!allowBackgroundRelease) assertMutationForeground(document);
      mutationDispatchStarted = true;
      dispatch.call(bus, ${JSON.stringify(message)});
      return ${JSON.stringify(operation?.operationId ?? null)};
      } catch (error) {
        if (!mutationDispatchStarted) {
          const code = typeof error?.message === 'string' && /^E_[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'E_RENDERER_EVALUATION';
          return { codexDeckPredispatchFailure: code };
        }
        throw error;
      }
    })()`;
    onBeforeCdpSubmit?.();
    const dispatchResult = await this.evaluateOnSocket<
      string | null | { codexDeckPredispatchFailure?: unknown }
    >(socket, expression);
    if (dispatchResult && typeof dispatchResult === "object") {
      const candidate = dispatchResult.codexDeckPredispatchFailure;
      const code = typeof candidate === "string" && RENDERER_FAILURE_CODE_SET.has(candidate)
        ? candidate
        : "E_RENDERER_EVALUATION";
      const error = integrityError(code);
      Object.defineProperty(error, "codexDeckPredispatch", { value: true });
      throw error;
    }
    const observedOperationId = dispatchResult;
    if (operation && observedOperationId !== operation.operationId) throw integrityError("E_OPERATION_UNOBSERVED");
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw integrityError("E_BRIDGE_CLOSED");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    await this.connect();
  }

  /**
   * Follow an explicit Codex-window focus change without treating another app
   * becoming frontmost as a disconnect. This keeps Stream Deck background
   * observation sticky while making LCD state follow the Codex window the user
   * actually selected.
   */
  private async ensureObservationTarget(): Promise<void> {
    await this.ensureConnected();
    if (!this.connectedTargetKey || this.hasActiveTargetLease()) return;

    try {
      const current = await this.evaluate<RendererFocusState>(FOREGROUND_RENDERER_PROBE_EXPRESSION);
      if (isFocusedVisibleRenderer(current)) return;

      const port = await discoverDebugPort();
      const targets = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const foreground = await resolveForegroundCodexTarget(
        targets,
        (candidate) => probeDebugTargetFocus(candidate, port),
      );
      if (!foreground?.webSocketDebuggerUrl) return;
      if (codexDebugTargetKey(foreground) === this.connectedTargetKey) return;
      if (this.hasActiveTargetLease()) return;

      await this.connect({ port, target: foreground, requireFocused: true });
    } catch {
      // Observation is allowed to stay on the last good renderer while focus
      // is moving. The mutation path performs its own strict final guard.
    }
  }

  private async ensureForegroundMutationTarget(): Promise<boolean> {
    await this.ensureConnected();
    let state: RendererFocusState | undefined;
    try {
      state = await this.evaluate<RendererFocusState>(FOREGROUND_RENDERER_PROBE_EXPRESSION);
    } catch {
      // A held PTT release is leased to this exact socket. Never close or
      // replace it merely because a foreground probe failed.
      if (this.hasActiveTargetLease()) {
        throw integrityError("E_FOREGROUND_TARGET_STALE");
      }
    }
    if (isFocusedVisibleRenderer(state)) return false;
    if (this.hasActiveTargetLease()) {
      throw integrityError("E_FOREGROUND_TARGET_STALE");
    }

    const port = await discoverDebugPort();
    const targets = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${port}/json/list`);
    const target = await resolveForegroundCodexTarget(targets, (candidate) => probeDebugTargetFocus(candidate, port));
    if (!target?.webSocketDebuggerUrl) throw integrityError("E_FOREGROUND_TARGET_UNAVAILABLE");
    const targetKey = codexDebugTargetKey(target);
    const targetChanged = targetKey !== this.connectedTargetKey;
    if (this.hasActiveTargetLease()) {
      throw integrityError("E_FOREGROUND_TARGET_STALE");
    }
    await this.connect({ port, target, requireFocused: true });
    return targetChanged;
  }

  private async connect(required?: { port: number; target: DebugTarget; requireFocused: boolean }): Promise<void> {
    const preceding = this.connecting;
    let attempt!: Promise<void>;
    attempt = (preceding ? preceding.catch(() => undefined) : Promise.resolve())
      .then(async () => {
        if (!required && this.socket?.readyState === WebSocket.OPEN) return;
        await this.connectCandidate(required);
      });
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = undefined;
    }
  }

  private async connectCandidate(required?: { port: number; target: DebugTarget; requireFocused: boolean }): Promise<void> {
    if (this.closed) throw integrityError("E_BRIDGE_CLOSED");
    const port = required?.port ?? await discoverDebugPort();
    let target = required?.target;
    if (!target) {
      const targets = await fetchJson<DebugTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const foreground = await resolveForegroundCodexTarget(targets, (candidate) => probeDebugTargetFocus(candidate, port));
      target = selectBridgeObservationTarget(targets, foreground, this.lastTargetKey);
    }
    if (!target?.webSocketDebuggerUrl) throw integrityError("E_FOREGROUND_TARGET_UNAVAILABLE");
    if (this.closed) throw integrityError("E_BRIDGE_CLOSED");

    const debuggerUrl = validateLoopbackWebSocketUrl(target.webSocketDebuggerUrl, port);
    const socket = new WebSocket(debuggerUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(integrityError("E_DEBUG_WEBSOCKET_TIMEOUT")), 3000);
        socket.once("open", () => { clearTimeout(timer); resolve(); });
        socket.once("error", () => { clearTimeout(timer); reject(integrityError("E_DEBUG_WEBSOCKET_CONNECT")); });
      });
    } catch (error) {
      socket.on("error", () => undefined);
      socket.close();
      throw error;
    }
    if (this.closed) {
      socket.close();
      throw integrityError("E_BRIDGE_CLOSED");
    }
    socket.on("message", (raw) => this.handleMessage(String(raw)));
    socket.on("close", () => {
      this.endedRendererSessions.add(socket);
      this.disconnect(socket);
    });
    socket.on("error", () => this.disconnect(socket));
    const candidateTargetIdentity = createHash("sha256")
      .update(`${target.id ?? ""}\u0000${target.url}\u0000${debuggerUrl}`)
      .digest("hex");
    let state: RendererFocusState;
    try {
      state = await this.evaluateOnSocket<RendererFocusState>(socket, FOREGROUND_RENDERER_PROBE_EXPRESSION);
    } catch (error) {
      this.disconnect(socket);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      throw error;
    }
    if (required?.requireFocused && !isFocusedVisibleRenderer(state)) {
      this.disconnect(socket);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      throw integrityError("E_FOREGROUND_TARGET_STALE");
    }
    if (this.closed) {
      socket.close();
      throw integrityError("E_BRIDGE_CLOSED");
    }
    const previousSocket = this.socket;
    if (previousSocket && previousSocket !== socket && this.hasActiveTargetLease()) {
      socket.close();
      throw integrityError("E_FOREGROUND_TARGET_STALE");
    }
    this.socket = socket;
    this.targetIdentity = candidateTargetIdentity;
    this.connectedTargetKey = codexDebugTargetKey(target);
    this.lastTargetKey = this.connectedTargetKey;
    this.connectionEpoch += 1;
    this.lastSnapshot = undefined;
    this.operationGuard.reset();
    if (previousSocket && previousSocket !== socket
      && !this.isRetainedReleaseSocket(previousSocket)
      && previousSocket.readyState === WebSocket.OPEN) previousSocket.close();
    this.logConnectedTarget(port, target.url);
  }

  private logConnectedTarget(port: number, targetUrl: string): void {
    this.log(`Native Codex-Micro-Brücke verbunden (Port ${port}, ${safeRendererTargetLabel(targetUrl)}).`);
  }

  private evaluate<T = unknown>(expression: string): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(integrityError("E_BRIDGE_DISCONNECTED"));
    return this.evaluateOnSocket<T>(socket, expression);
  }

  private evaluateOnSocket<T = unknown>(socket: WebSocket, expression: string, timeoutMs = 5000): Promise<T> {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(integrityError("E_RELEASE_TARGET_GONE"));
    const id = ++this.nextId;
    // CDP may garbage-collect an awaited Runtime.evaluate promise while a
    // renderer handler or dynamic import is still pending. Keep the exact
    // promise reachable from the renderer until after our own timeout.
    const retainedExpression = retainEvaluationPromise(expression, `${this.evaluationNamespace}-${id}`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(integrityError("E_RENDERER_EVALUATION_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, {
        timer,
        socket,
        reject,
        resolve: (message) => {
          if (message.error) return reject(integrityError("E_CDP_PROTOCOL"));
          const result = message.result;
          if (result?.exceptionDetails) {
            return reject(integrityError(rendererFailureCode(message) ?? "E_RENDERER_EVALUATION"));
          }
          resolve(result?.result?.value as T);
        }
      });
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: retainedExpression, awaitPromise: true, returnByValue: true } }));
    });
  }

  private handleMessage(raw: string): void {
    let message: CdpResponse;
    try { message = JSON.parse(raw) as CdpResponse; }
    catch { return; }
    if (message.id == null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private disconnect(expected?: WebSocket): void {
    if (expected && this.socket !== expected) {
      for (const [id, pending] of this.pending) {
        if (pending.socket !== expected) continue;
        clearTimeout(pending.timer);
        pending.reject(integrityError("E_RELEASE_TARGET_GONE"));
        this.pending.delete(id);
      }
      return;
    }
    const socket = this.socket;
    this.socket = undefined;
    this.connectedTargetKey = "";
    this.lastSnapshot = undefined;
    this.operationGuard.reset();
    const leased = socket && (
      [...this.heldPttOperations.values()].some((value) => value.socket === socket)
      || [...this.heldNativeInputOperations.values()].some((value) => value.socket === socket)
    );
    if (socket && !leased && socket.readyState === WebSocket.OPEN) socket.close();
    for (const [id, pending] of this.pending) {
      if (socket && pending.socket !== socket) continue;
      const { reject, timer } = pending;
      clearTimeout(timer);
      reject(integrityError("E_BRIDGE_DISCONNECTED"));
      this.pending.delete(id);
    }
  }
}

export function retainEvaluationPromise(expression: string, id: string | number): string {
  const key = `codex-deck-${id}`;
  return `(() => {
    const store = globalThis.__codexDeckPendingEvaluations ??= new Map();
    const pending = Promise.resolve((${expression}));
    store.set(${JSON.stringify(key)}, pending);
    setTimeout(() => store.delete(${JSON.stringify(key)}), 10000);
    return pending;
  })()`;
}

function mappingFingerprint(snapshot: Omit<MicroSnapshot, "connectionEpoch" | "pageEpoch" | "mappingFingerprint" | "targetIdentity">): string {
  const mapping = {
    version: snapshot.layout.version,
    slots: snapshot.layout.slots,
    analogStick: snapshot.layout.analogStick,
    agentSource: snapshot.agentSource,
    lightingAutoOff: snapshot.lightingAutoOff
  };
  return createHash("sha256").update(JSON.stringify(mapping)).digest("hex");
}
