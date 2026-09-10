export const GLOBAL_DICTATION_MODIFIER_CODES = [
  "MetaLeft", "MetaRight", "AltLeft", "AltRight",
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
] as const;

export type GlobalDictationModifierCode = typeof GLOBAL_DICTATION_MODIFIER_CODES[number];

export type GlobalDictationShortcutCode = GlobalDictationModifierCode
  | `Key${Uppercase<string>}`
  | `Digit${number}`
  | "Space"
  | "Enter"
  | `F${number}`;

export type GlobalDictationShortcut = Readonly<{
  code: GlobalDictationShortcutCode;
  modifiers: readonly GlobalDictationModifierCode[];
}>;

export type GlobalDictationLegacyShortcut =
  | "right-option"
  | "left-option"
  | "right-command"
  | "left-command"
  | "right-control"
  | "left-control"
  | "right-shift"
  | "left-shift";

export type GlobalDictationShortcutSetting = GlobalDictationLegacyShortcut | {
  code: string;
  modifiers: readonly string[];
};

const GLOBAL_DICTATION_SHORTCUT_MODIFIER_SET = new Set<string>(GLOBAL_DICTATION_MODIFIER_CODES);
const GLOBAL_DICTATION_MODIFIER_ORDER = new Map<string, number>(
  GLOBAL_DICTATION_MODIFIER_CODES.map((code, index) => [code, index])
);
const GLOBAL_DICTATION_LEGACY_SHORTCUTS: Record<GlobalDictationLegacyShortcut, GlobalDictationModifierCode> = {
  "right-option": "AltRight",
  "left-option": "AltLeft",
  "right-command": "MetaRight",
  "left-command": "MetaLeft",
  "right-control": "ControlRight",
  "left-control": "ControlLeft",
  "right-shift": "ShiftRight",
  "left-shift": "ShiftLeft",
};

const DEFAULT_GLOBAL_DICTATION_SHORTCUT = immutableGlobalDictationShortcut("AltRight", []);

/**
 * Converts the persisted property-inspector value into a frozen native input
 * contract. Missing settings retain the historical right-Option default;
 * malformed settings fail closed so a profile cannot silently trigger another
 * shortcut.
 */
export function parseGlobalDictationShortcut(settings: unknown): GlobalDictationShortcut {
  const source = settings !== null && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return normalizeGlobalDictationShortcut(source.globalDictationShortcut);
}

export function normalizeGlobalDictationShortcut(value: unknown = undefined): GlobalDictationShortcut {
  if (value === undefined) return DEFAULT_GLOBAL_DICTATION_SHORTCUT;
  if (typeof value === "string") {
    const code = Object.hasOwn(GLOBAL_DICTATION_LEGACY_SHORTCUTS, value)
      ? GLOBAL_DICTATION_LEGACY_SHORTCUTS[value as GlobalDictationLegacyShortcut] : undefined;
    if (code) return immutableGlobalDictationShortcut(code, []);
    throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
  }
  const record = value as { code?: unknown; modifiers?: unknown };
  if (typeof record.code !== "string" || !isSupportedGlobalDictationCode(record.code)
      || !Array.isArray(record.modifiers)) {
    throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
  }
  const modifiers = record.modifiers;
  if (modifiers.some((modifier) => typeof modifier !== "string"
      || !GLOBAL_DICTATION_SHORTCUT_MODIFIER_SET.has(modifier))) {
    throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
  }
  const normalizedModifiers = [...modifiers] as string[];
  if (new Set(normalizedModifiers).size !== normalizedModifiers.length
      || normalizedModifiers.includes(record.code)) {
    throw new Error("E_GLOBAL_DICTATION_SHORTCUT_UNSUPPORTED");
  }
  normalizedModifiers.sort((left, right) =>
    (GLOBAL_DICTATION_MODIFIER_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (GLOBAL_DICTATION_MODIFIER_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
  return immutableGlobalDictationShortcut(
    record.code as GlobalDictationShortcutCode,
    normalizedModifiers as GlobalDictationModifierCode[],
  );
}

export function globalDictationShortcutKey(shortcut: GlobalDictationShortcut): string {
  return `${shortcut.code}|${shortcut.modifiers.join(",")}`;
}

function immutableGlobalDictationShortcut(
  code: GlobalDictationShortcutCode,
  modifiers: readonly GlobalDictationModifierCode[],
): GlobalDictationShortcut {
  return Object.freeze({ code, modifiers: Object.freeze([...modifiers]) });
}

function isGlobalDictationModifierCode(value: string): value is GlobalDictationModifierCode {
  return GLOBAL_DICTATION_SHORTCUT_MODIFIER_SET.has(value);
}

function isSupportedGlobalDictationCode(value: string): value is GlobalDictationShortcutCode {
  return isGlobalDictationModifierCode(value)
    || /^(?:Key[A-Z]|Digit[0-9]|Space|Enter|F(?:[1-9]|1[0-2]))$/u.test(value);
}

