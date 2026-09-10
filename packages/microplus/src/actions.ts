import streamDeck, { action, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { beginActionFeedback, currentActionFeedback, safeActionFailureCode, showAlertIfCurrent, showOkIfCurrent, type ActionFeedbackToken } from "./action-feedback.js";
import { PreferenceAction } from "./action-preferences.js";
import type { DeckController, FixedIconSource } from "./controller.js";
import type { OfficialKeycapId } from "./keycaps.js";
import type { MicroActionSlot, MicroDirection, ReasoningAdjustment } from "./types.js";
import { parseUsageLimitMode } from "./usage.js";
export { SideToMainAction } from './side-to-main-action.js';
export { GlobalDictationAction } from './global-dictation-action.js';
export { ContextCompactionAction } from './context-compaction-action.js';

abstract class AgentAction extends PreferenceAction {
  constructor(private readonly controller: DeckController, private readonly slot: number) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerAgent(this.slot, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.release(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterAgent(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      const configured = this.controller.pressConfiguredDisplayAction(ev.action.id);
      if (configured) await configured;
      else await this.controller.pressAgent(ev.action.id, this.slot);
    }
    catch (error) {
      streamDeck.logger.error(`Agent key ${this.slot + 1} press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.release(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async release(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try {
      const configured = this.controller.releaseConfiguredDisplayAction(ev.action.id);
      if (configured) await configured;
      else await this.controller.releaseInput(ev.action.id);
    }
    catch (error) {
      streamDeck.logger.error(`Agent key ${this.slot + 1} release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

@action({ UUID: "io.local.codexdeck.microplus.agent-1" }) export class Agent1 extends AgentAction { constructor(c: DeckController) { super(c, 0); } }
@action({ UUID: "io.local.codexdeck.microplus.agent-2" }) export class Agent2 extends AgentAction { constructor(c: DeckController) { super(c, 1); } }
@action({ UUID: "io.local.codexdeck.microplus.agent-3" }) export class Agent3 extends AgentAction { constructor(c: DeckController) { super(c, 2); } }
@action({ UUID: "io.local.codexdeck.microplus.agent-4" }) export class Agent4 extends AgentAction { constructor(c: DeckController) { super(c, 3); } }
@action({ UUID: "io.local.codexdeck.microplus.agent-5" }) export class Agent5 extends AgentAction { constructor(c: DeckController) { super(c, 4); } }
@action({ UUID: "io.local.codexdeck.microplus.agent-6" }) export class Agent6 extends AgentAction { constructor(c: DeckController) { super(c, 5); } }

abstract class MicroKeyAction extends PreferenceAction {
  constructor(private readonly controller: DeckController, private readonly slot: MicroActionSlot) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerMicroAction(this.slot, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.releaseOnce(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterMicroAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      await this.controller.pressMicroAction(ev.action.id, this.slot);
    }
    catch (error) {
      streamDeck.logger.error(`Micro action ${this.slot} press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.releaseOnce(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async releaseOnce(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try {
      await this.controller.releaseInput(ev.action.id);
    }
    catch (error) {
      streamDeck.logger.error(`Micro action ${this.slot} release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

abstract class JoystickAction extends PreferenceAction {
  constructor(
    private readonly controller: DeckController,
    private readonly direction: MicroDirection,
    private readonly icon: FixedIconSource
  ) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction(`joystick-${this.direction}`, ev.action, this.icon);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.release(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterFixedAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.pressJoystick(ev.action.id, this.direction); }
    catch (error) {
      streamDeck.logger.error(`Joystick ${this.direction} press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.release(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async release(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try { await this.controller.releaseInput(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Joystick ${this.direction} release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

class EncoderAction extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction("reasoning", ev.action, { kind: "builtin", name: "encoder" });
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.release(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterFixedAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.pressEncoder(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Reasoning encoder press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.release(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async release(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try { await this.controller.releaseInput(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Reasoning encoder release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

abstract class ReasoningAdjustmentAction extends PreferenceAction {
  private readonly presses = new Map<string, { timer?: NodeJS.Timeout }>();

  constructor(private readonly controller: DeckController, private readonly direction: ReasoningAdjustment) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) {
      this.controller.registerFixedAction(`reasoning-${this.direction}`, ev.action, {
        kind: "local",
        keycapId: this.direction === "increase" ? "MIND+" : "MIND-"
      });
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    if (this.presses.has(ev.action.id)) return;
    const press: { timer?: NodeJS.Timeout } = {};
    this.presses.set(ev.action.id, press);
    await this.send(ev);
    if (this.presses.get(ev.action.id) === press) press.timer = setTimeout(() => void this.repeat(ev), 500);
  }

  override onKeyUp(ev: KeyUpEvent): void { this.stop(ev.action.id); }
  override onWillDisappear(ev: WillDisappearEvent): void {
    beginActionFeedback(ev.action);
    this.stop(ev.action.id);
    this.controller.unregisterFixedAction(ev.action);
  }

  private async repeat(ev: KeyDownEvent): Promise<void> {
    const press = this.presses.get(ev.action.id);
    if (!press) return;
    await this.send(ev);
    if (this.presses.get(ev.action.id) === press) press.timer = setTimeout(() => void this.repeat(ev), 300);
  }

  private async send(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.adjustReasoning(this.direction, ev.action.id); }
    catch (error) {
      this.stop(ev.action.id);
      streamDeck.logger.error(`Reasoning ${this.direction} failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  private stop(actionId: string): void {
    const press = this.presses.get(actionId);
    if (press?.timer) clearTimeout(press.timer);
    this.presses.delete(actionId);
  }
}

abstract class DirectKeycapAction extends PreferenceAction {
  constructor(private readonly controller: DeckController, private readonly keycapId: OfficialKeycapId) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction(`keycap-${this.keycapId}`, ev.action, { kind: "local", keycapId: this.keycapId });
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    beginActionFeedback(ev.action);
    this.controller.unregisterFixedAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.runKeycap(this.keycapId, ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Keycap ${this.keycapId} failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

/** Semantic PTT resolves the effective live microphone assignment on press. */
abstract class VoiceKeycapAction extends PreferenceAction {
  constructor(
    private readonly controller: DeckController,
    private readonly keycapId: OfficialKeycapId
  ) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction(`keycap-${this.keycapId}`, ev.action, { kind: "local", keycapId: this.keycapId });
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.releaseOnce(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterFixedAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      const slot = this.controller.resolveMicrophoneSlot(ev.action.id);
      await this.controller.pressMicroAction(ev.action.id, slot);
    }
    catch (error) {
      streamDeck.logger.error(`Micro voice keycap ${this.keycapId} press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.releaseOnce(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async releaseOnce(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try {
      await this.controller.releaseInput(ev.action.id);
    }
    catch (error) {
      streamDeck.logger.error(`Micro voice keycap ${this.keycapId} release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

@action({ UUID: "io.local.codexdeck.microplus.fast" }) export class Fast extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT06"); } }
@action({ UUID: "io.local.codexdeck.microplus.approve" }) export class Approve extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT07"); } }
@action({ UUID: "io.local.codexdeck.microplus.decline" }) export class Decline extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT08"); } }
@action({ UUID: "io.local.codexdeck.microplus.fork" }) export class Fork extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT09"); } }
@action({ UUID: "io.local.codexdeck.microplus.dictation" }) export class Dictation extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT10"); } }
@action({ UUID: "io.local.codexdeck.microplus.act11" }) export class Act11 extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT11"); } }
@action({ UUID: "io.local.codexdeck.microplus.send" }) export class Send extends MicroKeyAction { constructor(c: DeckController) { super(c, "ACT12"); } }
@action({ UUID: "io.local.codexdeck.microplus.plan" }) export class Plan extends JoystickAction { constructor(c: DeckController) { super(c, "up", { kind: "builtin", name: "up" }); } }
@action({ UUID: "io.local.codexdeck.microplus.back" }) export class Back extends JoystickAction { constructor(c: DeckController) { super(c, "left", { kind: "builtin", name: "back" }); } }
@action({ UUID: "io.local.codexdeck.microplus.forward" }) export class Forward extends JoystickAction { constructor(c: DeckController) { super(c, "right", { kind: "builtin", name: "forward" }); } }
@action({ UUID: "io.local.codexdeck.microplus.sidebar" }) export class Sidebar extends JoystickAction { constructor(c: DeckController) { super(c, "down", { kind: "builtin", name: "sidebar" }); } }
@action({ UUID: "io.local.codexdeck.microplus.reasoning" }) export class Reasoning extends EncoderAction {}
@action({ UUID: "io.local.codexdeck.microplus.reasoning-down" }) export class ReasoningDown extends ReasoningAdjustmentAction { constructor(c: DeckController) { super(c, "decrease"); } }
@action({ UUID: "io.local.codexdeck.microplus.reasoning-up" }) export class ReasoningUp extends ReasoningAdjustmentAction { constructor(c: DeckController) { super(c, "increase"); } }

@action({ UUID: "io.local.codexdeck.microplus.keycap-fast" }) export class KeycapFast extends DirectKeycapAction { constructor(c: DeckController) { super(c, "FAST"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-approve" }) export class KeycapApprove extends DirectKeycapAction { constructor(c: DeckController) { super(c, "APPR"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-reject" }) export class KeycapReject extends DirectKeycapAction { constructor(c: DeckController) { super(c, "REJ"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-split" }) export class KeycapSplit extends DirectKeycapAction { constructor(c: DeckController) { super(c, "SPLIT"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-mic" }) export class KeycapMic extends VoiceKeycapAction { constructor(c: DeckController) { super(c, "MIC"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-mic-single" }) export class KeycapMicSingle extends VoiceKeycapAction { constructor(c: DeckController) { super(c, "MIC1"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-new-task" }) export class KeycapNewTask extends DirectKeycapAction { constructor(c: DeckController) { super(c, "NEW"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-reasoning-up" }) export class KeycapReasoningUp extends DirectKeycapAction { constructor(c: DeckController) { super(c, "MIND+"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-reasoning-down" }) export class KeycapReasoningDown extends DirectKeycapAction { constructor(c: DeckController) { super(c, "MIND-"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-codex" }) export class KeycapCodex extends DirectKeycapAction { constructor(c: DeckController) { super(c, "CODEX"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-bug" }) export class KeycapBug extends DirectKeycapAction { constructor(c: DeckController) { super(c, "BUG"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-openai-docs" }) export class KeycapOpenAiDocs extends DirectKeycapAction { constructor(c: DeckController) { super(c, "OAI"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-terminal" }) export class KeycapTerminal extends DirectKeycapAction { constructor(c: DeckController) { super(c, "TERM"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-download" }) export class KeycapDownload extends DirectKeycapAction { constructor(c: DeckController) { super(c, "DWN"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-archive" }) export class KeycapArchive extends DirectKeycapAction { constructor(c: DeckController) { super(c, "DEL"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-browser" }) export class KeycapBrowser extends DirectKeycapAction { constructor(c: DeckController) { super(c, "NAV"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-pin" }) export class KeycapPin extends DirectKeycapAction { constructor(c: DeckController) { super(c, "MAGIC"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-diff" }) export class KeycapDiff extends DirectKeycapAction { constructor(c: DeckController) { super(c, "DIFF"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-play" }) export class KeycapPlay extends DirectKeycapAction { constructor(c: DeckController) { super(c, "PLAY"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-git-commit" }) export class KeycapGitCommit extends DirectKeycapAction { constructor(c: DeckController) { super(c, "GIT"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-branch" }) export class KeycapBranch extends DirectKeycapAction { constructor(c: DeckController) { super(c, "BRCH"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-create-branch" }) export class KeycapCreateBranch extends DirectKeycapAction { constructor(c: DeckController) { super(c, "BRANCH"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-merge" }) export class KeycapMerge extends DirectKeycapAction { constructor(c: DeckController) { super(c, "MRG"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-pull-request" }) export class KeycapPullRequest extends DirectKeycapAction { constructor(c: DeckController) { super(c, "PR"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-add-photos" }) export class KeycapAddPhotos extends DirectKeycapAction { constructor(c: DeckController) { super(c, "PAINT"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-lab" }) export class KeycapLab extends DirectKeycapAction { constructor(c: DeckController) { super(c, "LAB"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-side-chat" }) export class KeycapSideChat extends DirectKeycapAction { constructor(c: DeckController) { super(c, "PARTY"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-tasks" }) export class KeycapTasks extends DirectKeycapAction { constructor(c: DeckController) { super(c, "TIME"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-settings" }) export class KeycapSettings extends DirectKeycapAction { constructor(c: DeckController) { super(c, "SETUP"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-open-folder" }) export class KeycapOpenFolder extends DirectKeycapAction { constructor(c: DeckController) { super(c, "FOLD"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-add-files" }) export class KeycapAddFiles extends DirectKeycapAction { constructor(c: DeckController) { super(c, "UPL"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-skills" }) export class KeycapSkills extends DirectKeycapAction { constructor(c: DeckController) { super(c, "APPS"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-yolo" }) export class KeycapYolo extends DirectKeycapAction { constructor(c: DeckController) { super(c, "YOLO"); } }
@action({ UUID: "io.local.codexdeck.microplus.keycap-yeet" }) export class KeycapYeet extends DirectKeycapAction { constructor(c: DeckController) { super(c, "YEET"); } }

@action({ UUID: "io.local.codexdeck.microplus.new-task" })
export class NewTask extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction("new-task", ev.action, { kind: "local", keycapId: "NEW" });
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.controller.unregisterFixedAction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.createTask(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`New task failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

@action({ UUID: "io.local.codexdeck.microplus.usage-limit" })
export class UsageLimit extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerUsageLimit(ev.action, parseUsageLimitMode(ev.payload.settings.mode));
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.updateUsageLimitMode(ev.action, parseUsageLimitMode(ev.payload.settings.mode));
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.releaseOverride(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterUsageLimit(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      const configured = this.controller.pressConfiguredDisplayAction(ev.action.id);
      if (configured) await configured;
      else await this.controller.pressDisplayAction(ev.action.id);
    }
    catch (error) {
      streamDeck.logger.error(`Usage limit press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.releaseOverride(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async releaseOverride(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try { await this.controller.releaseConfiguredDisplayAction(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Usage limit release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

@action({ UUID: "io.local.codexdeck.microplus.usage-overview" })
export class UsageOverview extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerUsageOverview(ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.releaseOverride(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterUsageOverview(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      const configured = this.controller.pressConfiguredDisplayAction(ev.action.id);
      if (configured) await configured;
      else await this.controller.pressDisplayAction(ev.action.id);
    }
    catch (error) {
      streamDeck.logger.error(`Usage overview press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    await this.releaseOverride(ev, "key-up", currentActionFeedback(ev.action));
  }

  private async releaseOverride(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try { await this.controller.releaseConfiguredDisplayAction(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Usage overview release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}

@action({ UUID: "io.local.codexdeck.microplus.rate-limit-reset" })
export class RateLimitReset extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerRateLimitReset(ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.releaseConfiguredDisplayAction(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Rate-limit reset override release failed during disappearance (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
    this.controller.unregisterRateLimitReset(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    const configured = this.controller.pressConfiguredDisplayAction(ev.action.id);
    if (!configured) {
      this.controller.beginRateLimitReset(ev.action);
      return;
    }
    try { await configured; }
    catch (error) {
      streamDeck.logger.error(`Rate-limit reset override press failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const feedbackToken = currentActionFeedback(ev.action);
    try {
      const configured = this.controller.releaseConfiguredDisplayAction(ev.action.id);
      if (configured) {
        await configured;
        return;
      }
      if (await this.controller.finishRateLimitReset(ev.action) && ev.action.isKey()) {
        await showOkIfCurrent(this.controller, ev.action, feedbackToken);
      }
    } catch (error) {
      streamDeck.logger.error(`Rate-limit reset failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}
