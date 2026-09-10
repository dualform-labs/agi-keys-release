import { sessionIdFromThreadKey } from "./session-ownership.js";
import type { MicroSnapshot } from "./types.js";

/** Command keycaps whose result observer is intentionally content-free. */
export const CONTENT_FREE_COMMANDS = ["FAST", "APPR", "REJ", "CODEX", "MAGIC", "DWN"] as const;
export type ContentFreeCommand = typeof CONTENT_FREE_COMMANDS[number];

/**
 * Keycaps whose native command changes a renderer-visible UI surface without
 * exposing conversation content. NAV and PARTY are the persisted keycap ids
 * for the browser (BRWS) and side-chat (SIDE) actions respectively.
 */
export const NATIVE_UI_KEYCAPS = ["TERM", "DIFF", "FOLD", "SETUP", "LAB", "APPS", "NAV", "PARTY"] as const;
export type NativeUiKeycap = typeof NATIVE_UI_KEYCAPS[number];

export type NativeUiRoute = "settings" | "codex-micro-settings" | "skills" | "other" | null;

/**
 * Native UI readback is intentionally structural. It contains no URL query,
 * path suffix, browser tab id, file path, title, prompt, or message content.
 */
export type NativeUiSurface = {
  route: NativeUiRoute;
  terminalVisible: boolean;
  reviewVisible: boolean;
  browserTabCount: number;
};

export type NativeUiSignal =
  | "terminal-surface"
  | "review-surface"
  | "folder-picker"
  | "settings-route"
  | "codex-micro-settings-route"
  | "skills-route"
  | "browser-surface"
  | "side-chat";

export type NativeUiObservation = {
  /** `observed` means the declared structural transition was read back. */
  status: "observed" | "unchanged" | "unavailable";
  signal: NativeUiSignal;
  /** OS dialogs and side-chat commands remain unverified without readback. */
  semantic: "verified" | "unverified";
};

export type ContentFreeSignal =
  | "fast-state"
  | "approval-resolution"
  | "thread-activity"
  | "pin-state"
  | "markdown-copy";

export type ContentFreeObservation = {
  /** `observed` means the declared structural transition was read back. */
  status: "observed" | "unchanged" | "unavailable" | "scope-changed";
  signal: ContentFreeSignal;
  /** Approval resolution does not identify which decision took effect. */
  semantic: "verified" | "unverified";
};

/**
 * Readback fields used by the command observer. This type deliberately has no
 * title, prompt, composer text, clipboard bytes, or message payload.
 */
export type ContentFreeSurface = {
  activeThreadKey: string | null;
  activeComposerKey: string | null;
  fastEnabled: boolean | null;
  approvalPending: boolean | null;
  threadStatus: string | null;
  threadActivityAt: number | null;
  threadCompletionRevision: number | null;
  threadPinned: boolean | null;
  markdownCopyRevision: number | null;
};

/**
 * Instrument the renderer's native clipboard API without reading its argument.
 * The native Markdown command writes through `navigator.clipboard.writeText`
 * (or `write` in a capability-enabled renderer). A revision is advanced only
 * after that actual API promise resolves; a handler return or a generic toast
 * is not treated as a copy result. The wrapper removes itself after the first
 * invocation and returns the original API value unchanged.
 */
export function installMarkdownCopyObserver(
  clipboard: {
    writeText?: (...args: unknown[]) => unknown;
    write?: (...args: unknown[]) => unknown;
  } | null | undefined,
  onSuccess: () => void,
): () => void {
  if (!clipboard || typeof onSuccess !== "function") return () => {};

  const restores: Array<() => void> = [];
  const state = {
    restored: false,
    restore(): void {
      if (state.restored) return;
      state.restored = true;
      while (restores.length > 0) restores.pop()?.();
    },
  };

  for (const name of ["writeText", "write"] as const) {
    let original: unknown;
    let descriptor: PropertyDescriptor | undefined;
    try {
      original = clipboard[name];
      descriptor = Object.getOwnPropertyDescriptor(clipboard, name);
    } catch {
      continue;
    }
    if (typeof original !== "function") continue;

    const wrapper = {
      call(this: unknown, ...args: unknown[]): unknown {
        let result: unknown;
        try {
          result = Reflect.apply(original as (...args: unknown[]) => unknown, this, args);
        } catch (error) {
          state.restore();
          throw error;
        }
        // Restore as soon as the native call is made so unrelated later clipboard
        // writes cannot be attributed to this command. The completion callback
        // still observes the original promise without retaining its contents.
        state.restore();
        if (result && typeof (result as { then?: unknown }).then === "function") {
          Promise.resolve(result).then(
            () => { try { onSuccess(); } catch {} },
            () => {},
          );
        } else {
          try { onSuccess(); } catch {}
        }
        return result;
      },
    };
    const wrapped = wrapper.call;

    let installed = false;
    try {
      if (descriptor) {
        if (!descriptor.configurable && descriptor.writable !== true) continue;
        Object.defineProperty(clipboard, name, { ...descriptor, value: wrapped });
      } else {
        Object.defineProperty(clipboard, name, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: wrapped,
        });
      }
      installed = clipboard[name] === wrapped;
    } catch {
      try {
        (clipboard as Record<string, unknown>)[name] = wrapped;
        installed = clipboard[name] === wrapped;
      } catch {}
    }
    if (!installed) continue;
    restores.push(() => {
      try {
        if (descriptor) Object.defineProperty(clipboard, name, descriptor);
        else delete (clipboard as Record<string, unknown>)[name];
      } catch {
        try { (clipboard as Record<string, unknown>)[name] = original; } catch {}
      }
    });
  }

  return () => state.restore();
}

const COMMAND_SIGNALS: Record<ContentFreeCommand, ContentFreeSignal> = {
  FAST: "fast-state",
  APPR: "approval-resolution",
  REJ: "approval-resolution",
  CODEX: "thread-activity",
  MAGIC: "pin-state",
  DWN: "markdown-copy",
};

const NATIVE_UI_SIGNALS: Record<NativeUiKeycap, NativeUiSignal> = {
  TERM: "terminal-surface",
  DIFF: "review-surface",
  FOLD: "folder-picker",
  SETUP: "settings-route",
  LAB: "codex-micro-settings-route",
  APPS: "skills-route",
  NAV: "browser-surface",
  PARTY: "side-chat",
};

const WORKING_STATUSES = new Set(["working", "thinking", "running", "active"]);
const COMPLETED_STATUSES = new Set(["complete", "completed", "done"]);

/**
 * Project the current renderer snapshot to the metadata needed by command
 * observers. Missing native fields remain `null`; a refresh alone is never a
 * result signal.
 */
export function contentFreeSurface(snapshot: MicroSnapshot | undefined): ContentFreeSurface {
  if (!snapshot) return emptySurface();

  const activeThreadKey = snapshot.activeThreadKey ?? null;
  const activeComposerKey = snapshot.activeComposerKey ?? null;
  const slot = activeThreadKey
    ? snapshot.slots.find((candidate) => candidate.threadKey === activeThreadKey)
    : undefined;
  const sessionId = sessionIdFromThreadKey(activeThreadKey);
  const hostSession = sessionId
    ? snapshot.hostSessions?.find((candidate) => candidate.threadId === sessionId)
    : undefined;

  const approvalPending = readBoolean(snapshot.approvalPending ?? slot?.approvalPending);
  const threadPinned = readBoolean(snapshot.threadPinned ?? slot?.threadPinned);

  return {
    activeThreadKey,
    activeComposerKey,
    fastEnabled: readBoolean(snapshot.composerReadback?.fastEnabled),
    // These values are copied from the native parameterized selectors by the
    // renderer bridge. Missing selectors remain unavailable; generic status is
    // deliberately not used as an approximation.
    approvalPending,
    threadStatus: typeof slot?.status === "string"
      ? slot.status
      : hostSession?.status ?? null,
    threadActivityAt: finiteOrNull(hostSession?.activityAt),
    threadCompletionRevision: finiteOrNull(hostSession?.completionRevision),
    threadPinned,
    markdownCopyRevision: finiteOrNull(snapshot.markdownCopyRevision),
  };
}

/**
 * Compare two metadata-only surfaces after a native command dispatch.
 * Unavailable and unchanged results must remain unverified so callers cannot
 * turn an accepted handler call into a false command success.
 */
export function observeContentFreeResult(
  command: ContentFreeCommand,
  before: ContentFreeSurface,
  after: ContentFreeSurface,
): ContentFreeObservation {
  const signal = COMMAND_SIGNALS[command];
  const semantic = command === "APPR" || command === "REJ" ? "unverified" : "verified";

  if (!hasActiveScope(before) || !hasActiveScope(after)) {
    return { status: "unavailable", signal, semantic: "unverified" };
  }
  if (before.activeThreadKey !== after.activeThreadKey
    || before.activeComposerKey !== after.activeComposerKey) {
    return { status: "scope-changed", signal, semantic: "unverified" };
  }

  switch (command) {
    case "FAST":
      return observeBooleanToggle(signal, before.fastEnabled, after.fastEnabled, semantic);
    case "APPR":
    case "REJ":
      if (typeof before.approvalPending !== "boolean" || typeof after.approvalPending !== "boolean") {
        return { status: "unavailable", signal, semantic: "unverified" };
      }
      return before.approvalPending === true && after.approvalPending === false
        ? { status: "observed", signal, semantic: "unverified" }
        : { status: "unchanged", signal, semantic: "unverified" };
    case "CODEX":
      return observeThreadActivity(signal, before, after);
    case "MAGIC":
      return observeBooleanToggle(signal, before.threadPinned, after.threadPinned, semantic);
    case "DWN":
      return observeRevision(signal, before.markdownCopyRevision, after.markdownCopyRevision, semantic);
  }
}

/**
 * Compare native UI-only readback after a pinned command dispatch. A command
 * acknowledgement is never enough: every verified result below requires the
 * expected structural change. FOLD and PARTY deliberately remain unverified
 * here because the OS folder picker and side-chat transition are outside this
 * generic renderer surface observer.
 */
export function observeNativeUiResult(
  keycap: NativeUiKeycap,
  before: NativeUiSurface,
  after: NativeUiSurface,
): NativeUiObservation {
  const signal = NATIVE_UI_SIGNALS[keycap];
  switch (keycap) {
    case "TERM":
      return observeBooleanChange(signal, before.terminalVisible, after.terminalVisible);
    case "DIFF":
      return observeBooleanChange(signal, before.reviewVisible, after.reviewVisible);
    case "SETUP":
      return observeRoute(signal, before.route, after.route, "settings");
    case "LAB":
      return observeRoute(signal, before.route, after.route, "codex-micro-settings");
    case "APPS":
      return observeRoute(signal, before.route, after.route, "skills");
    case "NAV":
      return observeBrowserSurface(signal, before.browserTabCount, after.browserTabCount);
    case "FOLD":
      return { status: "unavailable", signal, semantic: "unverified" };
    case "PARTY":
      return { status: "unavailable", signal, semantic: "unverified" };
  }
}

function observeBooleanChange(
  signal: NativeUiSignal,
  before: boolean,
  after: boolean,
): NativeUiObservation {
  return before === after
    ? { status: "unchanged", signal, semantic: "unverified" }
    : { status: "observed", signal, semantic: "verified" };
}

function observeRoute(
  signal: NativeUiSignal,
  before: NativeUiRoute,
  after: NativeUiRoute,
  expected: Exclude<NativeUiRoute, null | "other">,
): NativeUiObservation {
  return after === expected && before !== expected
    ? { status: "observed", signal, semantic: "verified" }
    : after == null
      ? { status: "unavailable", signal, semantic: "unverified" }
      : { status: "unchanged", signal, semantic: "unverified" };
}

function observeBrowserSurface(
  signal: NativeUiSignal,
  before: number,
  after: number,
): NativeUiObservation {
  if (!Number.isSafeInteger(before) || before < 0 || !Number.isSafeInteger(after) || after < 0) {
    return { status: "unavailable", signal, semantic: "unverified" };
  }
  return after > before
    ? { status: "observed", signal, semantic: "verified" }
    : { status: "unchanged", signal, semantic: "unverified" };
}

function observeBooleanToggle(
  signal: ContentFreeSignal,
  before: boolean | null,
  after: boolean | null,
  semantic: "verified" | "unverified",
): ContentFreeObservation {
  if (typeof before !== "boolean" || typeof after !== "boolean") {
    return { status: "unavailable", signal, semantic: "unverified" };
  }
  return before === after
    ? { status: "unchanged", signal, semantic: "unverified" }
    : { status: "observed", signal, semantic };
}

function observeRevision(
  signal: ContentFreeSignal,
  before: number | null,
  after: number | null,
  semantic: "verified" | "unverified",
): ContentFreeObservation {
  if (!isFiniteNumber(before) || !isFiniteNumber(after)) {
    return { status: "unavailable", signal, semantic: "unverified" };
  }
  return after > before
    ? { status: "observed", signal, semantic }
    : { status: "unchanged", signal, semantic: "unverified" };
}

function observeThreadActivity(
  signal: ContentFreeSignal,
  before: ContentFreeSurface,
  after: ContentFreeSurface,
): ContentFreeObservation {
  const hasStatus = before.threadStatus != null || after.threadStatus != null;
  const hasActivity = isFiniteNumber(before.threadActivityAt) && isFiniteNumber(after.threadActivityAt);
  const hasCompletion = isFiniteNumber(before.threadCompletionRevision)
    && isFiniteNumber(after.threadCompletionRevision);
  if (!hasStatus && !hasActivity && !hasCompletion) {
    return { status: "unavailable", signal, semantic: "unverified" };
  }

  const enteredWorking = !isWorkingStatus(before.threadStatus) && isWorkingStatus(after.threadStatus);
  const reachedCompletion = before.threadStatus !== after.threadStatus
    && isCompletedStatus(after.threadStatus);
  const activityAdvanced = hasActivity
    && after.threadActivityAt! > before.threadActivityAt!
    && (isWorkingStatus(after.threadStatus) || isCompletedStatus(after.threadStatus));
  const completionAdvanced = hasCompletion
    && after.threadCompletionRevision! > before.threadCompletionRevision!;
  return enteredWorking || reachedCompletion || activityAdvanced || completionAdvanced
    ? { status: "observed", signal, semantic: "verified" }
    : { status: "unchanged", signal, semantic: "unverified" };
}

function hasActiveScope(surface: ContentFreeSurface): boolean {
  return Boolean(surface.activeThreadKey || surface.activeComposerKey);
}

function isWorkingStatus(value: string | null): boolean {
  return value != null && WORKING_STATUSES.has(value);
}

function isCompletedStatus(value: string | null): boolean {
  return value != null && COMPLETED_STATUSES.has(value);
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function finiteOrNull(value: number | undefined): number | null {
  return isFiniteNumber(value) ? value : null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function emptySurface(): ContentFreeSurface {
  return {
    activeThreadKey: null,
    activeComposerKey: null,
    fastEnabled: null,
    approvalPending: null,
    threadStatus: null,
    threadActivityAt: null,
    threadCompletionRevision: null,
    threadPinned: null,
    markdownCopyRevision: null,
  };
}
