import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type DialDownEvent,
  type DialRotateEvent,
  type DialUpEvent,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { beginActionFeedback, currentActionFeedback, showAlertIfCurrent, type ActionFeedbackToken } from "./action-feedback.js";
import { parseDialGesturePreferences, PreferenceAction } from "./action-preferences.js";
import { safeDialFailureCode, type DeckController } from "./controller.js";
import type { MicroPlusDialKind } from "./types.js";

type DialInputOwner = "physical" | "touch";

type DialInputState = {
  owner: DialInputOwner;
  down: Promise<void>;
  release?: Promise<void>;
};

abstract class MicroPlusDialAction extends PreferenceAction {
  protected constructor(
    private readonly controller: DeckController,
    private readonly kind: MicroPlusDialKind,
    private readonly label: string,
  ) {
    super(controller);
  }

  /** Own one dial input source at a time so physical and touch events cannot cross-release each other. */
  private readonly activeDialInputs = new WeakMap<object, DialInputState>();

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isDial()) this.controller.registerPlusDial(this.kind, ev.action);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.syncActionPreferences(ev);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    beginActionFeedback(ev.action);
    const actionId = ev.action.id;
    const state = this.activeDialInputs.get(ev.action);
    if (state) {
      try { await this.releaseDialInput(actionId, state); }
      catch (error) { streamDeck.logger.error(`${this.label} dial disappearance release failed (${safeDialFailureCode(error)}).`); }
      finally {
        if (this.activeDialInputs.get(ev.action) === state) this.activeDialInputs.delete(ev.action);
      }
    } else {
      // Preserve the existing safety release for a lifecycle event that arrives
      // after the physical Up has already cleared the owner.
      try { await this.controller.plusDialUp(actionId); }
      catch (error) { streamDeck.logger.error(`${this.label} dial disappearance release failed (${safeDialFailureCode(error)}).`); }
    }
    this.controller.unregisterPlusDial(ev.action);
  }

  override async onDialDown(ev: DialDownEvent): Promise<void> {
    const actionId = ev.action.id;
    if (this.activeDialInputs.has(ev.action)) return;
    const feedbackToken = beginActionFeedback(ev.action);
    const state: DialInputState = { owner: "physical", down: Promise.resolve() };
    this.activeDialInputs.set(ev.action, state);
    try {
      state.down = Promise.resolve(this.controller.plusDialDown(actionId));
      await state.down;
    } catch (error) {
      if (this.activeDialInputs.get(ev.action) === state) this.activeDialInputs.delete(ev.action);
      streamDeck.logger.error(`${this.label} dial press failed (${safeDialFailureCode(error)}).`);
      await this.showAlert(ev.action, feedbackToken);
    }
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    const actionId = ev.action.id;
    const state = this.activeDialInputs.get(ev.action);
    if (!state || state.owner !== "physical") return;
    const feedbackToken = currentActionFeedback(ev.action);
    try {
      await this.releaseDialInput(actionId, state);
    } catch (error) {
      streamDeck.logger.error(`${this.label} dial release failed (${safeDialFailureCode(error)}).`);
      await this.showAlert(ev.action, feedbackToken);
    } finally {
      if (this.activeDialInputs.get(ev.action) === state) this.activeDialInputs.delete(ev.action);
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      await this.controller.plusDialRotate(ev.action.id, ev.payload.ticks);
    } catch (error) {
      streamDeck.logger.error(`${this.label} dial rotation failed (${safeDialFailureCode(error)}).`);
      await this.showAlert(ev.action, feedbackToken);
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    const actionId = ev.action.id;
    if (this.activeDialInputs.has(ev.action)) return;
    const preferences = parseDialGesturePreferences(ev.payload.settings);
    const behavior = ev.payload.hold ? preferences.longPress : preferences.touch;
    if (behavior === "none") return;
    const feedbackToken = beginActionFeedback(ev.action);

    const state: DialInputState = { owner: "touch", down: Promise.resolve() };
    this.activeDialInputs.set(ev.action, state);
    try {
      // A touch gesture is a one-shot interaction. Pair the existing dial
      // down/up API so agent/native inputs cannot remain held after a touch.
      state.down = Promise.resolve(this.controller.plusDialDown(actionId));
      await this.releaseDialInput(actionId, state);
    } catch (error) {
      streamDeck.logger.error(`${this.label} ${ev.payload.hold ? "long-touch" : "touch"} failed (${safeDialFailureCode(error)}).`);
      await this.showAlert(ev.action, feedbackToken);
    } finally {
      if (this.activeDialInputs.get(ev.action) === state) this.activeDialInputs.delete(ev.action);
    }
  }

  private releaseDialInput(actionId: string, state: DialInputState): Promise<void> {
    if (!state.release) {
      state.release = (async () => {
        // Serializing release behind down is necessary when the SDK sends a
        // physical Up while the native down operation is still in flight.
        await state.down;
        await this.controller.plusDialUp(actionId);
      })();
    }
    return state.release;
  }

  private async showAlert(action: { id: string; showAlert(): Promise<void> }, token: ActionFeedbackToken): Promise<void> {
    try { await showAlertIfCurrent(this.controller, action, token); }
    catch { streamDeck.logger.warn(`${this.label} dial alert unavailable (E_DIAL_ALERT).`); }
  }
}

/** Selects one of the six native Codex Micro agent slots, then activates it on press. */
@action({ UUID: "com.dualform.agikeys.dial-agent" })
export class PlusAgentsDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "agents", "Agent");
  }
}

/** Uses the native MIND+/MIND- reasoning actions and native encoder click. */
@action({ UUID: "com.dualform.agikeys.dial-reasoning" })
export class PlusReasoningDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "reasoning", "Reasoning");
  }
}

/** Sends the native Micro left/right navigation path; its semantic meaning is settings-dependent. */
@action({ UUID: "com.dualform.agikeys.dial-conversation" })
export class PlusConversationDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "navigation", "左右操作");
  }
}

/** Selects a configured Codex command on rotation and invokes it on press. */
@action({ UUID: "com.dualform.agikeys.dial-commands" })
export class PlusCommandsDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "commands", "コマンド");
  }
}

/** Selects a usage window on rotation and refreshes the usage snapshot on press. */
@action({ UUID: "com.dualform.agikeys.dial-usage" })
export class PlusUsageDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "usage", "使用量");
  }
}

/** Opens the native model picker and navigates its verified menu on rotation. */
@action({ UUID: "com.dualform.agikeys.dial-model" })
export class PlusModelDial extends MicroPlusDialAction {
  constructor(controller: DeckController) {
    super(controller, "model", "モデル");
  }
}
