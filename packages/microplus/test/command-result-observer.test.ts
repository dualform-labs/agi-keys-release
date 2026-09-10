import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_FREE_COMMANDS,
  NATIVE_UI_KEYCAPS,
  contentFreeSurface,
  installMarkdownCopyObserver,
  observeContentFreeResult,
  observeNativeUiResult,
  type ContentFreeSurface,
  type NativeUiSurface,
} from "../src/command-result-observer.js";
import type { MicroSnapshot } from "../src/types.js";

test("the content-free observer catalog covers the six command keycaps", () => {
  assert.deepEqual(CONTENT_FREE_COMMANDS, ["FAST", "APPR", "REJ", "CODEX", "MAGIC", "DWN"]);
});

test("the native UI observer catalog uses the persisted ids for BRWS and SIDE", () => {
  assert.deepEqual(NATIVE_UI_KEYCAPS, ["TERM", "DIFF", "FOLD", "SETUP", "LAB", "APPS", "NAV", "PARTY"]);
});

test("TERM and DIFF require a structural surface toggle", () => {
  assert.deepEqual(observeNativeUiResult(
    "TERM",
    nativeSurface({ terminalVisible: false }),
    nativeSurface({ terminalVisible: true }),
  ), { status: "observed", signal: "terminal-surface", semantic: "verified" });
  assert.deepEqual(observeNativeUiResult(
    "DIFF",
    nativeSurface({ reviewVisible: true }),
    nativeSurface({ reviewVisible: true }),
  ), { status: "unchanged", signal: "review-surface", semantic: "unverified" });
});

test("settings, Codex Micro settings, and skills require their expected route", () => {
  assert.deepEqual(observeNativeUiResult(
    "SETUP",
    nativeSurface({ route: "other" }),
    nativeSurface({ route: "settings" }),
  ), { status: "observed", signal: "settings-route", semantic: "verified" });
  assert.deepEqual(observeNativeUiResult(
    "LAB",
    nativeSurface({ route: "settings" }),
    nativeSurface({ route: "codex-micro-settings" }),
  ), { status: "observed", signal: "codex-micro-settings-route", semantic: "verified" });
  assert.deepEqual(observeNativeUiResult(
    "APPS",
    nativeSurface({ route: "other" }),
    nativeSurface({ route: "skills" }),
  ), { status: "observed", signal: "skills-route", semantic: "verified" });
});

test("BRWS/NAV requires a newly observed browser tab and FOLD/SIDE stay unverified", () => {
  assert.deepEqual(observeNativeUiResult(
    "NAV",
    nativeSurface({ browserTabCount: 0 }),
    nativeSurface({ browserTabCount: 1 }),
  ), { status: "observed", signal: "browser-surface", semantic: "verified" });
  assert.deepEqual(observeNativeUiResult(
    "NAV",
    nativeSurface({ browserTabCount: 1 }),
    nativeSurface({ browserTabCount: 1 }),
  ), { status: "unchanged", signal: "browser-surface", semantic: "unverified" });
  assert.deepEqual(observeNativeUiResult(
    "FOLD",
    nativeSurface(),
    nativeSurface(),
  ), { status: "unavailable", signal: "folder-picker", semantic: "unverified" });
  assert.deepEqual(observeNativeUiResult(
    "PARTY",
    nativeSurface(),
    nativeSurface(),
  ), { status: "unavailable", signal: "side-chat", semantic: "unverified" });
});

test("FAST is observed only when the native boolean actually toggles", () => {
  const before = surface({ fastEnabled: false });
  const after = surface({ fastEnabled: true });
  assert.deepEqual(observeContentFreeResult("FAST", before, after), {
    status: "observed",
    signal: "fast-state",
    semantic: "verified",
  });

  assert.deepEqual(observeContentFreeResult("FAST", before, surface({ fastEnabled: false })), {
    status: "unchanged",
    signal: "fast-state",
    semantic: "unverified",
  });
});

for (const command of ["APPR", "REJ"] as const) {
  test(`${command} observes request resolution without claiming the decision`, () => {
    assert.deepEqual(observeContentFreeResult(
      command,
      surface({ approvalPending: true }),
      surface({ approvalPending: false }),
    ), {
      status: "observed",
      signal: "approval-resolution",
      semantic: "unverified",
    });
    assert.deepEqual(observeContentFreeResult(
      command,
      surface({ approvalPending: true }),
      surface({ approvalPending: true }),
    ), {
      status: "unchanged",
      signal: "approval-resolution",
      semantic: "unverified",
    });
  });
}

test("CODEX observes only same-scope task lifecycle progress", () => {
  const before = surface({ threadStatus: "idle", threadActivityAt: 100, threadCompletionRevision: 4 });
  const after = surface({ threadStatus: "working", threadActivityAt: 101, threadCompletionRevision: 4 });
  assert.deepEqual(observeContentFreeResult("CODEX", before, after), {
    status: "observed",
    signal: "thread-activity",
    semantic: "verified",
  });

  assert.deepEqual(observeContentFreeResult("CODEX", before, surface({
    threadStatus: "idle",
    threadActivityAt: 100,
    threadCompletionRevision: 4,
  })), {
    status: "unchanged",
    signal: "thread-activity",
    semantic: "unverified",
  });

  assert.deepEqual(observeContentFreeResult("CODEX", before, surface({
    activeThreadKey: "local:other-thread",
    activeComposerKey: "composer-2",
    threadStatus: "working",
    threadActivityAt: 999,
    threadCompletionRevision: 5,
  })), {
    status: "scope-changed",
    signal: "thread-activity",
    semantic: "unverified",
  });
});

test("MAGIC and DWN require their own monotonic passive signal", () => {
  assert.deepEqual(observeContentFreeResult(
    "MAGIC",
    surface({ threadPinned: false }),
    surface({ threadPinned: true }),
  ), {
    status: "observed",
    signal: "pin-state",
    semantic: "verified",
  });
  assert.deepEqual(observeContentFreeResult(
    "DWN",
    surface({ markdownCopyRevision: 7 }),
    surface({ markdownCopyRevision: 8 }),
  ), {
    status: "observed",
    signal: "markdown-copy",
    semantic: "verified",
  });
});

test("Markdown copy readback advances only after the native clipboard promise resolves", async () => {
  let resolveWrite!: () => void;
  const writes: unknown[] = [];
  const clipboard = {
    writeText(value: unknown) {
      writes.push(value);
      return new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
    },
  };
  let successes = 0;
  const restore = installMarkdownCopyObserver(clipboard, () => { successes += 1; });
  const secret = { private: "content" };
  const pending = clipboard.writeText(secret);
  assert.equal(successes, 0);
  assert.deepEqual(writes, [secret]);
  resolveWrite();
  await pending;
  await Promise.resolve();
  assert.equal(successes, 1);
  // The observer is one-shot and cannot attribute a later unrelated write.
  clipboard.writeText("later");
  assert.equal(successes, 1);

  // A rejected native write never advances the content-free revision.
  const failedClipboard = { writeText: () => Promise.reject(new Error("clipboard denied")) };
  let failedSuccesses = 0;
  installMarkdownCopyObserver(failedClipboard, () => { failedSuccesses += 1; });
  await assert.rejects(failedClipboard.writeText());
  await Promise.resolve();
  assert.equal(failedSuccesses, 0);
  restore();
});

test("Markdown copy observer source is executable when injected into the renderer", async () => {
  const generated = Function(`return (${installMarkdownCopyObserver.toString()})`)() as typeof installMarkdownCopyObserver;
  let successes = 0;
  const clipboard = { writeText: () => Promise.resolve() };
  const restore = generated(clipboard, () => { successes += 1; });
  await clipboard.writeText();
  await Promise.resolve();
  assert.equal(successes, 1);
  restore();
});

test("content-free surface projects native approval, pin, and copy metadata", () => {
  const projected = contentFreeSurface({
    ...snapshot(),
    slots: [{
      id: 0,
      threadKey: "local:thread-1",
      title: "private slot title",
      status: "awaiting-approval",
      selected: true,
      approvalPending: true,
      threadPinned: false,
    }],
    markdownCopyRevision: 12,
  });
  assert.equal(projected.approvalPending, true);
  assert.equal(projected.threadPinned, false);
  assert.equal(projected.markdownCopyRevision, 12);

  const activeProjection = contentFreeSurface({
    ...snapshot(),
    // Active-thread readback covers a task outside the six physical slots.
    approvalPending: false,
    threadPinned: true,
  });
  assert.equal(activeProjection.approvalPending, false);
  assert.equal(activeProjection.threadPinned, true);
});

test("missing passive fields stay unverified instead of accepting a generic refresh", () => {
  const current = snapshot();
  const before = contentFreeSurface(current);
  const after = contentFreeSurface({ ...current, activeThreadTitle: "private title" });
  for (const command of CONTENT_FREE_COMMANDS) {
    const result = observeContentFreeResult(command, before, after);
    assert.notEqual(result.status, "observed", command);
    assert.equal(result.semantic, "unverified", command);
  }
  assert.doesNotMatch(JSON.stringify(after), /private title/);
});

test("snapshot projection reads only metadata fields and never copies title or body content", () => {
  const source = snapshot();
  const projected = contentFreeSurface(new Proxy(source, {
    get(target, property, receiver) {
      assert.notEqual(property, "activeThreadTitle");
      assert.notEqual(property, "body");
      return Reflect.get(target, property, receiver);
    },
  }));
  assert.deepEqual(projected, surface({ threadStatus: "idle" }));
});

function surface(overrides: Partial<ContentFreeSurface> = {}): ContentFreeSurface {
  return {
    activeThreadKey: "local:thread-1",
    activeComposerKey: "composer-1",
    fastEnabled: null,
    approvalPending: null,
    threadStatus: null,
    threadActivityAt: null,
    threadCompletionRevision: null,
    threadPinned: null,
    markdownCopyRevision: null,
    ...overrides,
  };
}

function nativeSurface(overrides: Partial<NativeUiSurface> = {}): NativeUiSurface {
  return {
    route: "other",
    terminalVisible: false,
    reviewVisible: false,
    browserTabCount: 0,
    ...overrides,
  };
}

function snapshot(): MicroSnapshot {
  return {
    slots: [{ id: 0, threadKey: "local:thread-1", title: "private slot title", status: "idle", selected: true }],
    activeThreadKey: "local:thread-1",
    activeThreadTitle: "private title",
    activeComposerKey: "composer-1",
    composerReadback: {
      fastEnabled: null,
      reasoningEffort: null,
      dictationPhase: "unavailable",
      observedAt: 1,
    },
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping",
    targetIdentity: "target",
  };
}
