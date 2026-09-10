import streamDeck, {
  action,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { beginActionFeedback, currentActionFeedback, safeActionFailureCode, showAlertIfCurrent, type ActionFeedbackToken } from "./action-feedback.js";
import { PreferenceAction } from "./action-preferences.js";
import type { DeckController } from "./controller.js";

/**
 * Shows the active task's observed context usage and requests native context
 * compaction on press. The controller owns lifecycle feedback and the native
 * postcondition; this action only handles Stream Deck lifecycle/events.
 */
@action({ UUID: "io.local.codexdeck.microplus.context-compaction" })
export class ContextCompactionAction extends PreferenceAction {
  constructor(private readonly controller: DeckController) {
    super(controller);
  }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerContextCompaction(ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.releaseOverride(ev, "disappearance", beginActionFeedback(ev.action));
    this.controller.unregisterContextCompaction(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try {
      await this.controller.pressContextCompaction(ev.action.id);
    } catch (error) {
      streamDeck.logger.error(`Context compaction failed (${safeActionFailureCode(error)}).`);
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
    try {
      const configured = this.controller.releaseConfiguredDisplayAction(ev.action.id);
      if (configured) await configured;
    } catch (error) {
      streamDeck.logger.error(`Context compaction override release failed during ${source} (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}
