import streamDeck, { action, type DidReceiveSettingsEvent, type KeyAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { beginActionFeedback, currentActionFeedback, showAlertIfCurrent, type ActionFeedbackToken } from "./action-feedback.js";
import {
  parseActionPreferences,
  PreferenceAction,
  streamDeckDisplayLanguage,
  type ActionPreferences,
} from "./action-preferences.js";
import type { DeckController } from "./controller.js";
import {
  globalDictationHold,
  parseGlobalDictationShortcut,
  type GlobalDictationShortcut,
  type RightCommandHold,
} from "./global-dictation.js";
import { customizeKeyImage, KEY_CONTACT_DURATION_MS, renderActionFeedback, renderCatalogKeycap, renderKeyContact } from "./render.js";

type GlobalDictationController = Pick<DeckController, "setActionPreferences" | "prepareAction">
  & Partial<Pick<DeckController, "isCurrentAction">>;
type KeyContact = { phase: "press" | "release"; startedAt: number };
type GlobalDictationFailureCode = typeof GLOBAL_DICTATION_FAILURE_CODES[number] | "E_GLOBAL_DICTATION_NATIVE";
const GLOBAL_DICTATION_FAILURE_CODES = [
  "E_GLOBAL_DICTATION_PERMISSION",
  "E_RIGHT_COMMAND_ALREADY_HELD",
  "E_RIGHT_COMMAND_DOWN_FAILED",
  "E_RIGHT_COMMAND_UP_FAILED",
  "E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED",
  "E_GLOBAL_DICTATION_SHORTCUT_CONFLICT",
  "E_GLOBAL_DICTATION_STOPPED",
  "E_GLOBAL_DICTATION_RUNTIME_UNSAFE",
  "E_GLOBAL_DICTATION_RUNTIME_PERMISSIONS",
  "E_GLOBAL_DICTATION_HELPER_UNSAFE",
  "E_GLOBAL_DICTATION_HELPER_INTEGRITY",
  "E_GLOBAL_DICTATION_HELPER_PERMISSIONS",
  "E_GLOBAL_DICTATION_HELPER_TIMEOUT",
  "E_GLOBAL_DICTATION_HELPER_RELEASE",
  "E_GLOBAL_DICTATION_HELPER_STOP_TIMEOUT",
] as const;
const GLOBAL_DICTATION_FAILURE_CODE_SET = new Set<string>(GLOBAL_DICTATION_FAILURE_CODES);
type VisibleKey = {
  action: KeyAction;
  preferences: ActionPreferences;
  held: boolean;
  desiredPressed: boolean;
  generation: number;
  heldAt: number;
  interval: NodeJS.Timeout | undefined;
  expiry: NodeJS.Timeout | undefined;
  renderInFlight: Promise<void> | undefined;
  requestedRender: { errorCode?: GlobalDictationFailureCode } | undefined;
  contact: KeyContact | undefined;
  holdOwner: string | undefined;
  shortcut: GlobalDictationShortcut | undefined;
};

@action({ UUID: "io.local.codexdeck.microplus.global-dictation" })
export class GlobalDictationAction extends PreferenceAction {
  override readonly manifestId = "io.local.codexdeck.microplus.global-dictation";
  private readonly keys = new Map<string, VisibleKey>();
  private holdSequence = 0;

  constructor(
    private readonly controller: GlobalDictationController,
    private readonly hold: Pick<RightCommandHold, "press" | "release" | "stop"> = globalDictationHold
  ) { super(controller); }

  override onWillAppear(ev: WillAppearEvent): void {
    this.syncActionPreferences(ev);
    if (ev.action.isKey()) {
      const previous = this.keys.get(ev.action.id);
      if (previous) {
        beginActionFeedback(previous.action);
        previous.desiredPressed = false;
        previous.generation += 1;
        this.clearTimers(previous);
        const previousOwner = previous.holdOwner;
        previous.holdOwner = undefined;
        if (previousOwner) {
          void this.hold.release(previousOwner).catch((error) => {
            streamDeck.logger.error(`Global dictation replacement release failed (${failureCode(error)}).`);
          });
        }
      }
      beginActionFeedback(ev.action);
      const key: VisibleKey = {
        action: ev.action,
        preferences: parseActionPreferences(ev.payload.settings, streamDeckDisplayLanguage()),
        held: false,
        desiredPressed: false,
        generation: 0,
        heldAt: 0,
        interval: undefined,
        expiry: undefined,
        renderInFlight: undefined,
        requestedRender: undefined,
        contact: undefined,
        holdOwner: undefined,
        shortcut: parseShortcutSetting(ev.payload.settings)
      };
      this.keys.set(ev.action.id, key);
      void this.requestRender(key);
    }
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.syncActionPreferences(ev);
    const key = this.keys.get(ev.action.id);
    if (!key || !ev.action.isKey()) return;
    key.action = ev.action;
    key.preferences = parseActionPreferences(ev.payload.settings, streamDeckDisplayLanguage());
    key.shortcut = parseShortcutSetting(ev.payload.settings);
    if (key.preferences.animation === false) key.contact = undefined;
    this.stopAnimation(key);
    if (key.held || this.hasLiveContact(key)) this.startAnimation(key);
    void this.requestRender(key);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const key = this.keys.get(ev.action.id);
    if (!key || key.action !== ev.action || key.desiredPressed) return;
    const feedbackToken = beginActionFeedback(ev.action);
    const generation = key ? ++key.generation : 0;
    if (key) key.desiredPressed = true;
    let holdOwner: string | undefined;
    try {
      const shortcut = key?.shortcut;
      if (!shortcut) throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
      await this.controller.prepareAction(ev.action.id);
      if (!key || this.keys.get(ev.action.id) !== key || !key.desiredPressed || key.generation !== generation) return;
      holdOwner = `${ev.action.id}:dictation:${++this.holdSequence}`;
      key.holdOwner = holdOwner;
      await this.hold.press(holdOwner, shortcut);
      if (this.keys.get(ev.action.id) === key && key.desiredPressed
        && key.generation === generation && key.holdOwner === holdOwner) {
        key.held = true;
        key.heldAt = Date.now();
        this.beginContact(key, "press");
        this.startAnimation(key);
        await this.requestRender(key);
      } else {
        if (key.holdOwner === holdOwner) key.holdOwner = undefined;
        await this.hold.release(holdOwner);
      }
    }
    catch (error) {
      const code = failureCode(error);
      streamDeck.logger.error(`Global dictation press failed (${code}).`);
      const current = this.keys.get(ev.action.id);
      if (holdOwner) {
        if (current?.holdOwner === holdOwner) current.holdOwner = undefined;
        try { await this.hold.release(holdOwner); }
        catch (releaseError) {
          streamDeck.logger.error(`Global dictation failed-press release failed (${failureCode(releaseError)}).`);
        }
      }
      if (current && current === key && current.generation === generation && current.desiredPressed) {
        current.held = false;
        current.desiredPressed = false;
        current.contact = undefined;
        this.stopAnimation(current);
        await this.requestRender(current, { errorCode: code });
        this.expireToIdle(current);
      }
      if (ev.action.isKey()) await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const key = this.keys.get(ev.action.id);
    if (!key || key.action !== ev.action) return;
    const feedbackToken = currentActionFeedback(ev.action);
    const holdOwner = key?.holdOwner;
    if (key) {
      key.holdOwner = undefined;
      key.desiredPressed = false;
      key.generation += 1;
    }
    await this.release(ev, "key-up", holdOwner, feedbackToken);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const key = this.keys.get(ev.action.id);
    // The SDK creates a fresh ActionContext for willDisappear; identity is
    // stable only for key gestures, not disappearance notifications.
    if (!key) return;
    beginActionFeedback(key?.action ?? ev.action);
    const holdOwner = key?.holdOwner;
    if (key) {
      key.holdOwner = undefined;
      key.desiredPressed = false;
      key.generation += 1;
      this.clearTimers(key);
    }
    this.keys.delete(ev.action.id);
    try { if (holdOwner) await this.hold.release(holdOwner); }
    catch (error) {
      streamDeck.logger.error(`Global dictation release failed during disappearance (${failureCode(error)}).`);
    }
  }

  private async release(
    ev: KeyUpEvent | WillDisappearEvent,
    source: "key-up" | "disappearance",
    holdOwner: string | undefined,
    feedbackToken: ActionFeedbackToken,
  ): Promise<void> {
    try {
      if (holdOwner) await this.hold.release(holdOwner);
      const key = this.keys.get(ev.action.id);
      if (key && !key.desiredPressed) {
        key.held = false;
        this.stopAnimation(key);
        this.beginContact(key, "release");
        this.startAnimation(key);
        await this.requestRender(key);
      }
    }
    catch (error) {
      streamDeck.logger.error(`Global dictation release failed during ${source} (${failureCode(error)}).`);
      const key = this.keys.get(ev.action.id);
      if (key && !key.desiredPressed) {
        key.held = false;
        key.contact = undefined;
        this.stopAnimation(key);
        await this.requestRender(key, { errorCode: failureCode(error) });
        this.expireToIdle(key);
      }
      if ("isKey" in ev.action && ev.action.isKey()) {
        await showAlertIfCurrent(this.controller, ev.action, feedbackToken);
      }
    }
  }

  private startAnimation(key: VisibleKey): void {
    if (key.preferences.animation === false || key.interval) return;
    key.interval = setInterval(() => {
      if (!key.held && !this.hasLiveContact(key)) { this.stopAnimation(key); return; }
      void this.requestRender(key);
    }, 33);
  }

  private stopAnimation(key: VisibleKey): void {
    if (key.interval) clearInterval(key.interval);
    key.interval = undefined;
  }

  private expireToIdle(key: VisibleKey): void {
    if (key.expiry) clearTimeout(key.expiry);
    key.expiry = setTimeout(() => {
      key.expiry = undefined;
      if (!key.held && this.keys.get(key.action.id) === key) void this.requestRender(key);
    }, KEY_CONTACT_DURATION_MS);
  }

  private beginContact(key: VisibleKey, phase: KeyContact["phase"]): void {
    if (key.expiry) clearTimeout(key.expiry);
    if (key.preferences.animation === false) {
      key.contact = undefined;
      key.expiry = undefined;
      return;
    }
    const contact = { phase, startedAt: Date.now() };
    key.contact = contact;
    key.expiry = setTimeout(() => {
      key.expiry = undefined;
      if (this.keys.get(key.action.id) !== key || key.contact !== contact) return;
      key.contact = undefined;
      if (!key.held) this.stopAnimation(key);
      void this.requestRender(key);
    }, KEY_CONTACT_DURATION_MS);
  }

  private hasLiveContact(key: VisibleKey): boolean {
    return key.contact !== undefined && Date.now() - key.contact.startedAt < KEY_CONTACT_DURATION_MS;
  }

  private clearTimers(key: VisibleKey): void {
    this.stopAnimation(key);
    if (key.expiry) clearTimeout(key.expiry);
    key.expiry = undefined;
    key.contact = undefined;
  }

  private requestRender(key: VisibleKey, requested: { errorCode?: GlobalDictationFailureCode } = {}): Promise<void> {
    key.requestedRender = requested;
    if (!key.renderInFlight) {
      key.renderInFlight = this.drainRenders(key).finally(() => { key.renderInFlight = undefined; });
    }
    return key.renderInFlight;
  }

  private async drainRenders(key: VisibleKey): Promise<void> {
    while (key.requestedRender && this.keys.get(key.action.id) === key) {
      const requested = key.requestedRender;
      key.requestedRender = undefined;
      try { await this.render(key, requested.errorCode); }
      catch (error) {
        key.contact = undefined;
        this.stopAnimation(key);
        if (key.expiry) clearTimeout(key.expiry);
        key.expiry = undefined;
        streamDeck.logger.error(`Global dictation render failed (${failureCode(error)}).`);
      }
    }
  }

  private async render(key: VisibleKey, errorCode?: GlobalDictationFailureCode): Promise<void> {
    const language = key.preferences.language;
    const theme = this.resolveTheme(key);
    const defaultLabel = language === "en" ? "DICTATION" : "音声入力";
    let image = renderCatalogKeycap("MIC", theme, language);
    if (!image) return;
    if (key.held) {
      image = renderActionFeedback(image, {
        phase: "held",
        detail: language === "en" ? "HELD" : "押下中"
      }, theme, language, (Date.now() - key.heldAt) / 33);
    } else if (errorCode) {
      image = renderActionFeedback(image, {
        phase: "error",
        detail: globalDictationFailureDetail(errorCode, language)
      }, theme, language);
    }
    // Apply instance settings after operation feedback so showDetails also
    // governs feedback details created by the current render.
    image = customizeKeyImage(image, {
      label: key.preferences.label || defaultLabel,
      textSize: key.preferences.textSize,
      showDetails: key.preferences.showDetails,
      language
    });
    const contact = key.preferences.animation === false ? undefined : key.contact;
    if (contact) image = renderKeyContact(image, contact.phase, Math.max(0, Date.now() - contact.startedAt), theme);
    await key.action.setImage(image);
  }

  private resolveTheme(key: VisibleKey): "dark" | "light" {
    if (key.preferences.theme === "dark" || key.preferences.theme === "light") return key.preferences.theme;
    const controller = this.controller as GlobalDictationController & {
      /** DeckController keeps this resolver private, but it remains a runtime method. */
      theme?: (actionId: string) => "dark" | "light";
      snapshot?: { theme?: unknown };
    };
    const resolved = controller.theme?.(key.action.id);
    if (resolved === "dark" || resolved === "light") return resolved;
    return controller.snapshot?.theme === "light" ? "light" : "dark";
  }
}

function parseShortcutSetting(settings: unknown): GlobalDictationShortcut | undefined {
  try { return parseGlobalDictationShortcut(settings); }
  catch { return undefined; }
}

function failureCode(error: unknown): GlobalDictationFailureCode {
  if (!(error instanceof Error)) return "E_GLOBAL_DICTATION_NATIVE";
  if (GLOBAL_DICTATION_FAILURE_CODE_SET.has(error.message)) return error.message as GlobalDictationFailureCode;
  if (GLOBAL_DICTATION_FAILURE_CODE_SET.has(error.name)) return error.name as GlobalDictationFailureCode;
  return "E_GLOBAL_DICTATION_NATIVE";
}

function globalDictationFailureDetail(code: GlobalDictationFailureCode, language: "ja" | "en"): string {
  switch (code) {
    case "E_GLOBAL_DICTATION_PERMISSION": return language === "en" ? "ALLOW INPUT CONTROL" : "入力操作の許可が必要";
    case "E_RIGHT_COMMAND_ALREADY_HELD": return language === "en" ? "RIGHT ⌘ IN USE" : "右⌘使用中";
    case "E_RIGHT_COMMAND_DOWN_FAILED": return language === "en" ? "KEY DOWN FAILED" : "押下できません";
    case "E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED": return language === "en" ? "UNSUPPORTED SHORTCUT" : "未対応キー設定";
    case "E_GLOBAL_DICTATION_SHORTCUT_CONFLICT": return language === "en" ? "SHORTCUT IN USE" : "別キー使用中";
    case "E_RIGHT_COMMAND_UP_FAILED":
    case "E_GLOBAL_DICTATION_HELPER_RELEASE":
    case "E_GLOBAL_DICTATION_HELPER_STOP_TIMEOUT": return language === "en" ? "RELEASE UNVERIFIED" : "解除未確認";
    default: return language === "en" ? "HELPER UNAVAILABLE" : "補助機能利用不可";
  }
}
