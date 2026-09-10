import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { ContextCompactionAction } from "../src/context-compaction-action.js";
import { DeckController } from "../src/controller.js";
import { renderContextCompactionKey } from "../src/render.js";
import type { MicroSnapshot, MutationConfirmation } from "../src/types.js";

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
type FeedbackToken = { actionId: string; incarnation: number; sequence: number };
type Feedback = { state: "pending" | "confirmed" | "error"; incarnation: number; sequence: number };
type Timer = { callback: () => void; delay: number };
type ControllerInternals = {
  health: { state: "ready"; changedAt: number };
  snapshot: MicroSnapshot;
  snapshotObservationSequence: number;
  microBridge: { compactActiveThread(): Promise<MutationConfirmation>; advancePageEpoch(): void };
  contextCompactionFeedback: Map<string, Feedback>;
  contextCompactionFeedbackTimers: Map<string, { handle: unknown; token: FeedbackToken }>;
  beginContextCompactionFeedback(actionId: string): FeedbackToken;
  setContextCompactionFeedback(actionId: string, state: Feedback["state"], detail: string | undefined, token: FeedbackToken): Promise<void>;
  renderContextCompactionForId(actionId: string): Promise<void>;
  applySnapshot(snapshot: MicroSnapshot, observationSequence: number): boolean;
};

const confirmed: MutationConfirmation = {
  dispatch: "accepted",
  metadata: "matched",
  semanticOutcome: "confirmed",
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function decode(image: string): string {
  const comma = image.indexOf(",");
  return comma < 0 ? image : decodeURIComponent(image.slice(comma + 1));
}

function key(id: string) {
  return {
    id,
    isKey: () => true,
    isDial: () => false,
    setImage: async () => undefined,
    setTitle: async () => undefined,
    showAlert: async () => undefined,
  };
}

function event(action: ReturnType<typeof key>, settings: Record<string, unknown> = {}) {
  return { action, payload: { settings } } as never;
}

function snapshot(
  targetIdentity = "target-a",
  activeThreadKey = "local:11111111-1111-4111-8111-111111111111",
  activeComposerKey = "composer-1",
  activeContextUsedPercent = 80,
): MicroSnapshot {
  return {
    slots: [],
    activeThreadKey,
    activeComposerKey,
    activeContextUsedPercent,
    activeContextRevision: 100,
    layout: { version: 1, slots: {}, analogStick: {} as MicroSnapshot["layout"]["analogStick"] },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity,
  };
}

test("context compaction stays visibly unknown until an observed value exists", () => {
  const unknown = decode(renderContextCompactionKey({ health: "ready", language: "en", theme: "dark" }));
  assert.match(unknown, /data-context-compaction-state="unknown"/u);
  assert.match(unknown, /data-context-compaction-value="—"[^>]*>—<\/text>/u);
  assert.doesNotMatch(unknown, /data-context-used=/u);

  const zero = decode(renderContextCompactionKey({ contextUsedPercent: 0, health: "ready", language: "en" }));
  assert.match(zero, /data-context-used="0"/u);
  assert.match(zero, /data-context-compaction-value="0%"[^>]*>0%<\/text>/u);
});

test("context compaction pending motion is animated and terminal feedback is explicit", () => {
  const pending0 = decode(renderContextCompactionKey({ contextUsedPercent: 64, state: "pending", animationFrame: 0, language: "en" }));
  const pending1 = decode(renderContextCompactionKey({ contextUsedPercent: 64, state: "pending", animationFrame: 1, language: "en" }));
  assert.match(pending0, /data-context-compaction-motion="pending"/u);
  assert.match(pending0, /data-motion-frame="0"/u);
  assert.notEqual(pending0, pending1, "pending frames must produce visible movement");

  const confirmed = decode(renderContextCompactionKey({ contextUsedPercent: 64, state: "confirmed", language: "en" }));
  assert.match(confirmed, /data-context-compaction-motion="confirmed"/u);
  assert.match(confirmed, /COMPACTED/u);
  const error = decode(renderContextCompactionKey({ contextUsedPercent: 64, state: "error", detail: "E_RESULT_UNVERIFIED", language: "en" }));
  assert.match(error, /data-context-compaction-motion="error"/u);
  assert.match(error, /UNVERIFIED/u);
});

test("context compaction releases a display override on key-up without a second physical release on disappear", async () => {
  const calls: string[] = [];
  let overrideHeld = false;
  let physicalReleases = 0;
  const controller = {
    setActionPreferences: (id: string) => calls.push(`settings:${id}`),
    registerContextCompaction: (action: { id: string }) => calls.push(`register:${action.id}`),
    unregisterContextCompaction: (action: { id: string }) => calls.push(`unregister:${action.id}`),
    pressContextCompaction: async (id: string) => {
      calls.push(`press:${id}`);
      overrideHeld = true;
    },
    releaseConfiguredDisplayAction: (id: string) => {
      calls.push(`release-request:${id}`);
      if (!overrideHeld) return undefined;
      overrideHeld = false;
      physicalReleases += 1;
      return Promise.resolve();
    },
    isCurrentAction: () => true,
  };
  const action = key("context-compaction-test");
  const runtime = new ContextCompactionAction(controller as never);
  await runtime.onWillAppear(event(action, { language: "en", pressBehavior: "ptt" }));
  await runtime.onKeyDown(event(action));
  await runtime.onKeyUp(event(action));
  await runtime.onWillDisappear(event(action));

  assert.equal(physicalReleases, 1);
  assert.deepEqual(calls, [
    "settings:context-compaction-test",
    "register:context-compaction-test",
    "press:context-compaction-test",
    "release-request:context-compaction-test",
    "release-request:context-compaction-test",
    "unregister:context-compaction-test",
  ]);
});

test("context compaction unregisters even when release and alert delivery both fail", async () => {
  const calls: string[] = [];
  const controller = {
    setActionPreferences: () => undefined,
    registerContextCompaction: () => undefined,
    unregisterContextCompaction: () => calls.push("unregister"),
    releaseConfiguredDisplayAction: async () => { throw new Error("release failed"); },
    isCurrentAction: () => true,
  };
  const action = {
    ...key("context-compaction-alert-failure"),
    showAlert: async () => { throw new Error("alert unavailable"); },
  };
  const runtime = new ContextCompactionAction(controller as never);

  await runtime.onWillDisappear(event(action));

  assert.deepEqual(calls, ["unregister"]);
});

test("a same-id replacement waits for an old compaction then issues its own request", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  internals.snapshot = snapshot();
  const oldResult = deferred<MutationConfirmation>();
  const replacementResult = deferred<MutationConfirmation>();
  const results = [oldResult, replacementResult];
  let bridgeCalls = 0;
  internals.microBridge.compactActiveThread = async () => {
    bridgeCalls += 1;
    return results.shift()!.promise;
  };
  const oldAction = key("reused-context-action");
  const replacementImages: string[] = [];
  const replacement = {
    ...key(oldAction.id),
    setImage: async (image?: string) => { if (image) replacementImages.push(decode(image)); },
  };

  controller.registerContextCompaction(oldAction as unknown as KeyAction);
  const oldOperation = controller.compactActiveThread(oldAction.id);
  await flush();
  controller.unregisterContextCompaction(oldAction);
  controller.registerContextCompaction(replacement as unknown as KeyAction);
  const replacementOperation = controller.compactActiveThread(replacement.id);
  await flush();

  assert.equal(bridgeCalls, 1, "native compactions must remain serialized");
  oldResult.resolve(confirmed);
  await oldOperation;
  await flush();
  assert.equal(bridgeCalls, 2, "the replacement must issue an independent request after the old generation settles");
  replacementResult.resolve(confirmed);
  await replacementOperation;
  await flush();

  assert.ok(replacementImages.length > 0);
  assert.match(replacementImages.at(-1) ?? "", /COMPACTED|data-context-compaction-motion="confirmed"/u);
});

test("parallel context compaction presses share one native request", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  internals.snapshot = snapshot();
  const result = deferred<MutationConfirmation>();
  let bridgeCalls = 0;
  internals.microBridge.compactActiveThread = async () => {
    bridgeCalls += 1;
    return result.promise;
  };
  const action = key("parallel-context-compaction");
  controller.registerContextCompaction(action as unknown as KeyAction);

  const first = controller.pressContextCompaction(action.id);
  const second = controller.pressContextCompaction(action.id);
  await flush();
  assert.equal(bridgeCalls, 1);

  result.resolve(confirmed);
  await Promise.all([first, second]);
  await controller.compactActiveThread(action.id);
  assert.equal(bridgeCalls, 2, "a settled request must release the controller-wide in-flight guard");
  controller.unregisterContextCompaction(action);
});

test("configured context display override bypasses native compaction", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  internals.snapshot = snapshot();
  let bridgeCalls = 0;
  internals.microBridge.compactActiveThread = async () => {
    bridgeCalls += 1;
    return confirmed;
  };
  const action = key("context-display-override");
  controller.setActionPreferences(action.id, { pressBehavior: "disabled" });
  controller.registerContextCompaction(action as unknown as KeyAction);

  await controller.pressContextCompaction(action.id);

  assert.equal(bridgeCalls, 0);
  controller.unregisterContextCompaction(action);
});

test("a late compaction result for task A cannot overwrite the current task B snapshot", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const taskA = snapshot();
  const taskAAfterCompaction = { ...taskA, activeContextUsedPercent: 24, activeContextRevision: 200 };
  const taskB = snapshot(
    "target-a",
    "local:22222222-2222-4222-8222-222222222222",
    "composer-2",
    57,
  );
  internals.snapshot = taskA;
  internals.health = { state: "ready", changedAt: 0 };
  const result = deferred<MutationConfirmation>();
  internals.microBridge.compactActiveThread = () => result.promise;
  const images: string[] = [];
  const action = {
    ...key("context-task-switch"),
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
  };
  controller.registerContextCompaction(action as unknown as KeyAction);

  const operation = controller.compactActiveThread(action.id);
  await flush();
  assert.equal(internals.snapshotObservationSequence, 1, "the compaction must reserve its observation order before waiting");
  // Model the current-view observer independently of the compaction result.
  // Keeping the renderer target equal makes thread/composer matching essential.
  internals.snapshot = taskB;
  result.resolve({ ...confirmed, observedSnapshot: taskAAfterCompaction });

  await assert.rejects(operation, /E_RESULT_UNVERIFIED/u);
  await flush();
  assert.equal(internals.snapshot.targetIdentity, "target-a");
  assert.equal(internals.snapshot.activeThreadKey, taskB.activeThreadKey);
  assert.equal(internals.snapshot.activeComposerKey, "composer-2");
  assert.equal(internals.snapshot.activeContextUsedPercent, 57);
  assert.doesNotMatch(images.at(-1) ?? "", /data-context-used="24"|>24%<|COMPACTED/u);
  assert.match(images.at(-1) ?? "", /data-context-used="57"/u);
  assert.match(images.at(-1) ?? "", /data-context-compaction-state="error"/u);
  assert.match(images.at(-1) ?? "", /data-context-compaction-detail="(?:結果未確認|UNVERIFIED)"/u);
  controller.unregisterContextCompaction(action);
});

test("an older same-task compaction observation cannot roll back a newer observation", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const before = snapshot("target-a", undefined, undefined, 80);
  const newer = { ...before, activeContextUsedPercent: 63, activeContextRevision: 300 };
  const late = { ...before, activeContextUsedPercent: 24, activeContextRevision: 200 };
  internals.snapshot = before;
  internals.health = { state: "ready", changedAt: 0 };
  const result = deferred<MutationConfirmation>();
  internals.microBridge.compactActiveThread = () => result.promise;
  const action = key("context-observation-order");
  controller.registerContextCompaction(action as unknown as KeyAction);

  const operation = controller.compactActiveThread(action.id);
  await flush();
  assert.equal(internals.snapshotObservationSequence, 1);
  assert.equal(internals.applySnapshot(newer, ++internals.snapshotObservationSequence), true);
  result.resolve({ ...confirmed, observedSnapshot: late });

  await operation;
  assert.equal(internals.snapshot.activeContextUsedPercent, 63);
  assert.equal(internals.snapshot.activeContextRevision, 300);
  controller.unregisterContextCompaction(action);
});

test("stale context render completion and timer cannot displace the newest reset timer", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const slowRender = deferred<void>();
  let renderCall = 0;
  internals.renderContextCompactionForId = async () => {
    renderCall += 1;
    if (renderCall === 2) await slowRender.promise;
  };
  const timers: Timer[] = [];
  const cleared: unknown[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((timer: unknown) => { cleared.push(timer); }) as typeof clearTimeout;

  try {
    const firstToken = internals.beginContextCompactionFeedback("timer-race");
    const firstTerminal = internals.setContextCompactionFeedback("timer-race", "confirmed", undefined, firstToken);
    await flush();
    const secondToken = internals.beginContextCompactionFeedback("timer-race");
    await internals.setContextCompactionFeedback("timer-race", "error", "E_RESULT_UNVERIFIED", secondToken);
    assert.equal(timers.length, 1);
    const currentTimer = internals.contextCompactionFeedbackTimers.get("timer-race");
    assert.equal(currentTimer?.handle, timers[0]);
    assert.equal(currentTimer?.token.sequence, secondToken.sequence);

    slowRender.resolve();
    await firstTerminal;
    assert.equal(internals.contextCompactionFeedbackTimers.get("timer-race"), currentTimer, "a stale render completion must preserve the newer timer");

    const thirdToken = internals.beginContextCompactionFeedback("timer-race");
    await internals.setContextCompactionFeedback("timer-race", "confirmed", undefined, thirdToken);
    assert.equal(timers.length, 2);
    const newestTimer = internals.contextCompactionFeedbackTimers.get("timer-race");
    timers[0]!.callback();
    assert.equal(internals.contextCompactionFeedbackTimers.get("timer-race"), newestTimer, "a cleared timer callback must not delete its replacement");
    assert.equal(internals.contextCompactionFeedback.get("timer-race")?.sequence, thirdToken.sequence);
    assert.ok(cleared.includes(timers[0]));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("context compaction inspector keeps language, focus, and truthful display overrides", () => {
  const inspector = readFileSync(new URL("../static/property-inspector/context-compaction.html", import.meta.url), "utf8");
  assert.match(inspector, /id="language"/u);
  assert.match(inspector, /id="focusBeforeAction"/u);
  assert.match(inspector, /value="ptt"/u);
  assert.match(inspector, /value="command:CODEX"/u);
  assert.match(inspector, /window\.CodexPropertyInspector\.contextCompaction\(\)/u);
});
