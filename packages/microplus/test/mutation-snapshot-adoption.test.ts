import assert from "node:assert/strict";
import test from "node:test";
import { DeckController } from "../src/controller.js";
import type { MicroSnapshot, MutationConfirmation } from "../src/types.js";

type ControllerInternals = {
  snapshot: MicroSnapshot;
  health: { state: "ready" | "degraded"; changedAt: number };
  refresh(): Promise<void>;
  microBridge: {
    rotateModelPicker(): Promise<MutationConfirmation>;
    refresh(): Promise<MicroSnapshot>;
  };
};

test("a model mutation adopts its observer snapshot without a third renderer refresh", async () => {
  const before = snapshot("model-before");
  const after = snapshot("model-after");
  let refreshes = 0;
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = before;
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    rotateModelPicker: async () => ({
      dispatch: "accepted",
      metadata: "matched",
      semanticOutcome: "unverified",
      observedSnapshot: after,
    }),
    refresh: async () => { refreshes += 1; return after; },
  };

  controller.setActionPreferences("model-display", { pressBehavior: "model-next" });
  await controller.pressDisplayAction("model-display");

  assert.equal(refreshes, 0, "post-dispatch observation must not be fetched a third time");
  assert.equal(internals.snapshot.composerReadback?.modelLabel, "model-after");
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`an older deferred refresh ${outcome} cannot overwrite a newer mutation observation`, async () => {
    const before = snapshot("model-before");
    const stale = snapshot("model-stale");
    const after = snapshot("model-after");
    const gate = deferred<MicroSnapshot>();
    const controller = new DeckController();
    const internals = controller as unknown as ControllerInternals;
    internals.snapshot = before;
    internals.health = { state: "ready", changedAt: 0 };
    internals.microBridge = {
      rotateModelPicker: async () => ({
        dispatch: "accepted",
        metadata: "matched",
        semanticOutcome: "unverified",
        observedSnapshot: after,
      }),
      refresh: () => gate.promise,
    };
    controller.setActionPreferences("model-display", { pressBehavior: "model-next" });

    const olderRefresh = internals.refresh();
    await controller.pressDisplayAction("model-display");
    if (outcome === "resolve") gate.resolve(stale);
    else gate.reject(new Error("E_SYNTHETIC_OLDER_REFRESH"));
    await olderRefresh;

    assert.equal(internals.snapshot.composerReadback?.modelLabel, "model-after");
    assert.equal(internals.health.state, "ready");
  });
}

test("same-epoch mutation observations commit in request order when responses finish out of order", async () => {
  const first = deferred<MutationConfirmation>();
  const second = deferred<MutationConfirmation>();
  const responses = [first, second];
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot("model-before");
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    rotateModelPicker: () => responses.shift()!.promise,
    refresh: async () => snapshot("fallback"),
  };
  controller.setActionPreferences("model-display", { pressBehavior: "model-next" });

  const older = controller.pressDisplayAction("model-display");
  const newer = controller.pressDisplayAction("model-display");
  second.resolve(confirmation(snapshot("model-newer")));
  await newer;
  first.resolve(confirmation(snapshot("model-older")));
  await older;

  assert.equal(internals.snapshot.composerReadback?.modelLabel, "model-newer");
});

test("a confirmed legacy mutation without an observer snapshot keeps the refresh fallback", async () => {
  const before = snapshot("model-before");
  const after = snapshot("model-after");
  let refreshes = 0;
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = before;
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    rotateModelPicker: async () => ({
      dispatch: "accepted",
      metadata: "matched",
      semanticOutcome: "reasoning-changed",
    }),
    refresh: async () => { refreshes += 1; return after; },
  };
  controller.setActionPreferences("model-display", { pressBehavior: "model-next" });

  await controller.pressDisplayAction("model-display");

  assert.equal(refreshes, 1);
  assert.equal(internals.snapshot.composerReadback?.modelLabel, "model-after");
});

function snapshot(modelLabel: string): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-1",
    composerReadback: {
      modelLabel,
      reasoningEffort: "medium",
      fastEnabled: null,
      dictationPhase: "unavailable",
      observedAt: Date.now(),
    },
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function confirmation(observedSnapshot: MicroSnapshot): MutationConfirmation {
  return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified", observedSnapshot };
}
