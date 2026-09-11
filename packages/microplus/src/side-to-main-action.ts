import streamDeck, { action, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';
import { beginActionFeedback, safeActionFailureCode, showAlertIfCurrent } from './action-feedback.js';
import { PreferenceAction } from './action-preferences.js';
import type { DeckController } from './controller.js';

@action({ UUID: 'com.dualform.agikeys.side-to-main' })
export class SideToMainAction extends PreferenceAction {
  constructor(private readonly controller: DeckController) { super(controller); }
  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) this.controller.registerFixedAction('side-to-main', ev.action, { kind: 'builtin', name: 'side-to-main' });
  }
  override onWillDisappear(ev: WillDisappearEvent): void {
    this.controller.unregisterFixedAction(ev.action);
  }
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const feedbackToken = beginActionFeedback(ev.action);
    try { await this.controller.moveSideDraftToMain(ev.action.id); }
    catch (error) {
      streamDeck.logger.error(`Side draft transfer failed (${safeActionFailureCode(error)}).`);
      await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }
}
