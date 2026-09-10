import { SingletonAction, type DidReceiveSettingsEvent, type WillAppearEvent } from "@elgato/streamdeck";
import { EXCLUDED_KEYCAP_IDS, OFFICIAL_KEYCAP_IDS, type OfficialKeycapId } from "./keycaps.js";

export type ActionLanguage = "ja" | "en";
/** How a task-slot press should route a task that is not open yet. */
export type UnopenedTaskBehavior = "current-window" | "new-window";
/** Safe actions that can be triggered from an Encoder touch gesture. */
export type DialGestureBehavior = "none" | "press";
export type DialGesturePreferences = {
  touch: DialGestureBehavior;
  longPress: DialGestureBehavior;
};
export type DisplayPressBehavior =
  | "none"
  | "disabled"
  | "refresh"
  | "focus"
  | "ptt"
  | "command"
  | "model-next"
  | "model-previous"
  | "reasoning-increase"
  | "reasoning-decrease";

export type ActionPreferences = {
  language: ActionLanguage;
  focusBeforeAction: boolean;
  unopenedTaskBehavior: UnopenedTaskBehavior;
  label: string;
  textSize: "normal" | "large";
  showDetails: boolean;
  theme: "auto" | "dark" | "light";
  animation: boolean;
  reverseDial: boolean;
  dialStep: 1 | 2 | 3;
  pressBehavior: DisplayPressBehavior;
  pressCommand: OfficialKeycapId | null;
};

export type ActionPreferenceSettings = {
  language?: unknown;
  focusBeforeAction?: unknown;
  unopenedTaskBehavior?: unknown;
  label?: unknown;
  textSize?: unknown;
  showDetails?: unknown;
  theme?: unknown;
  animation?: unknown;
  reverseDial?: unknown;
  dialStep?: unknown;
  pressBehavior?: unknown;
  pressCommand?: unknown;
  /** New per-dial gesture settings. Kept optional for older profile exports. */
  dialTouchBehavior?: unknown;
  dialLongPressBehavior?: unknown;
  gestures?: unknown;
};

export const DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS = [...EXCLUDED_KEYCAP_IDS, "MIC", "MIC1"] as const;

const DISPLAY_PRESS_COMMAND_IDS = new Set<string>(OFFICIAL_KEYCAP_IDS.filter(
  (id) => !(DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS as readonly string[]).includes(id),
));

/**
 * Normalize the touch strip settings for an Encoder action.
 *
 * `onTouchTap` is the SDK event for both a tap and a held touch; the
 * `hold` bit is what selects the two settings below. Older Codex Micro
 * profiles only contain descriptive `gestures.dialLongPress` metadata, so
 * an enabled legacy binding maps to the safe paired dial press behavior.
 */
export function parseDialGesturePreferences(settings: unknown): DialGesturePreferences {
  const source = settings != null && typeof settings === "object" && !Array.isArray(settings)
    ? settings as ActionPreferenceSettings
    : {};
  const gestures = source.gestures != null && typeof source.gestures === "object" && !Array.isArray(source.gestures)
    ? source.gestures as Record<string, unknown>
    : {};
  return {
    touch: normalizeDialGesture(source.dialTouchBehavior, gestures.touchTap, "press"),
    longPress: normalizeDialGesture(source.dialLongPressBehavior, gestures.dialLongPress ?? gestures.touchLong, "none"),
  };
}

function normalizeDialGesture(explicit: unknown, legacy: unknown, fallback: DialGestureBehavior): DialGestureBehavior {
  if (explicit === "none" || explicit === "press") return explicit;
  if (explicit !== undefined) return fallback;
  if (legacy != null && typeof legacy === "object" && !Array.isArray(legacy)) {
    const record = legacy as Record<string, unknown>;
    if (record.enabled === false) return "none";
    if (record.behavior === "none" || record.behavior === "press") return record.behavior;
    return "press";
  }
  return fallback;
}

type ActionPreferenceController = {
  setActionPreferences(actionId: string, preferences: ActionPreferences): void;
};

export function parseActionPreferences(settings: unknown): ActionPreferences {
  const source: ActionPreferenceSettings = settings != null && typeof settings === "object" && !Array.isArray(settings)
    ? settings as ActionPreferenceSettings
    : {};
  const rawLabel = typeof source.label === "string"
    ? source.label.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()
    : "";
  return {
    language: source.language === "en" ? "en" : "ja",
    focusBeforeAction: source.focusBeforeAction === true,
    unopenedTaskBehavior: source.unopenedTaskBehavior === "new-window" ? "new-window" : "current-window",
    label: Array.from(rawLabel).slice(0, 24).join(""),
    textSize: source.textSize === "large" ? "large" : "normal",
    showDetails: source.showDetails !== false,
    theme: source.theme === "dark" || source.theme === "light" ? source.theme : "auto",
    animation: source.animation !== false,
    reverseDial: source.reverseDial === true,
    dialStep: source.dialStep === 2 || source.dialStep === 3 ? source.dialStep : 1,
    pressBehavior: source.pressBehavior === "disabled"
      || source.pressBehavior === "refresh"
      || source.pressBehavior === "focus"
      || source.pressBehavior === "ptt"
      || source.pressBehavior === "command"
      || source.pressBehavior === "model-next"
      || source.pressBehavior === "model-previous"
      || source.pressBehavior === "reasoning-increase"
      || source.pressBehavior === "reasoning-decrease"
      ? source.pressBehavior
      : "none",
    pressCommand: typeof source.pressCommand === "string" && DISPLAY_PRESS_COMMAND_IDS.has(source.pressCommand)
      ? source.pressCommand as OfficialKeycapId
      : null,
  };
}

/** Synchronizes per-instance settings for every key and dial action. */
export abstract class PreferenceAction extends SingletonAction {
  protected constructor(private readonly preferenceController: ActionPreferenceController) { super(); }

  protected syncActionPreferences(ev: WillAppearEvent | DidReceiveSettingsEvent): void {
    this.preferenceController.setActionPreferences(ev.action.id, parseActionPreferences(ev.payload.settings));
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.syncActionPreferences(ev);
  }
}
