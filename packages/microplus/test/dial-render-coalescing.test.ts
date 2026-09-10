import assert from "node:assert/strict";
import test from "node:test";
import type { DialAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import type { HostHealth, MicroSnapshot, MutationConfirmation } from "../src/types.js";
import type { OperationFeedback } from "../src/render.js";

type Feedback = Record<string, unknown>;

type ControllerInternals = {
  snapshot: MicroSnapshot;
  health: HostHealth;
  animationFrame: number;
  dialSelections: Map<string, number>;
  operationFeedback: Map<string, OperationFeedback>;
  plusDials: Map<string, unknown>;
  renderPlusDial(registration: unknown): Promise<void>;
  refresh(): Promise<void>;
  microBridge: {
    adjustReasoning(): Promise<MutationConfirmation>;
    rotateModelPicker(direction: "increase" | "decrease"): Promise<MutationConfirmation>;
    sendJoystick(direction: "left" | "right", act: 0 | 1): Promise<void>;
  };
};

test("coalesces a burst of delayed LCD renders into one latest follow-up", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStart = new Promise<void>((resolve) => { firstStarted = resolve; });
  const sent: Feedback[] = [];
  const dial = fakeDial("render-coalescing");
  dial.setFeedback = async (value) => {
    recordFeedback(sent, value);
    if (sent.length === 1) {
      firstStarted();
      await firstGate;
    } else {
      // Every FIFO replay would otherwise be identical. Advancing the real
      // animation frame makes each replay observable in the pending glyph.
      internals.animationFrame += 1;
    }
  };

  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await firstStart;
  const registration = internals.plusDials.get(dial.id);
  assert.ok(registration);
  internals.operationFeedback.set(dial.id, { phase: "pending", progress: 0.25, detail: "E_RESULT_UNVERIFIED" });
  const queued = Array.from({ length: 6 }, () => internals.renderPlusDial(registration));

  releaseFirst();
  await Promise.all(queued);

  assert.equal(sent.length, 2, "one in-flight send plus one latest follow-up is expected");
  assert.equal(sent[1]?.status, "確認中");
  assert.equal(sent[1]?.progress, 25);
});

test("dial mutation starts while its immediate LCD send is unresolved", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStart = new Promise<void>((resolve) => { firstStarted = resolve; });
  let released = false;
  const dial = fakeDial("rotation-ordering");
  dial.setFeedback = async (value) => {
    if (dial.feedback.length === 0) {
      firstStarted();
      await firstGate;
      released = true;
    }
    recordFeedback(dial.feedback, value);
  };

  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await firstStart;
  const rotation = controller.plusDialRotate(dial.id, 1);
  await flush();

  assert.equal(internals.dialSelections.get(dial.id), 1, "the local dial selection must not wait for LCD I/O");
  assert.equal(released, false, "the first LCD send is still blocked");

  releaseFirst();
  await rotation;
  assert.equal(released, true);
});

test("a stalled LCD send cannot hold the global rotation queue after the native operation finishes", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  let releaseReasoningRender!: () => void;
  let reasoningRenderStarted!: () => void;
  const reasoningRenderGate = new Promise<void>((resolve) => { releaseReasoningRender = resolve; });
  const reasoningRenderStart = new Promise<void>((resolve) => { reasoningRenderStarted = resolve; });
  const operations: string[] = [];
  const reasoningDial = fakeDial("slow-reasoning-render");
  const navigationDial = fakeDial("following-navigation-operation");
  reasoningDial.setFeedback = async (value) => {
    recordFeedback(reasoningDial.feedback, value);
    if (reasoningDial.feedback.length === 1) {
      reasoningRenderStarted();
      await reasoningRenderGate;
    }
  };
  internals.microBridge.adjustReasoning = async () => {
    operations.push("reasoning");
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };
  internals.microBridge.sendJoystick = async (direction, act) => {
    operations.push(`${direction}:${act}`);
  };
  internals.refresh = async () => undefined;

  controller.registerPlusDial("reasoning", reasoningDial as unknown as DialAction);
  await reasoningRenderStart;
  controller.registerPlusDial("navigation", navigationDial as unknown as DialAction);
  await flush();

  const reasoningRotation = controller.plusDialRotate(reasoningDial.id, 1);
  await flush();
  const navigationRotation = controller.plusDialRotate(navigationDial.id, 1);
  await flush();

  assert.deepEqual(
    operations,
    ["reasoning", "right:1", "right:0"],
    "the next serialized native operation must start without waiting for prior LCD I/O",
  );

  releaseReasoningRender();
  await Promise.all([reasoningRotation, navigationRotation]);
});

test("a slow model rotation does not block an unrelated navigation dial", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  let releaseModel!: () => void;
  let modelStarted!: () => void;
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
  const modelStart = new Promise<void>((resolve) => { modelStarted = resolve; });
  const operations: string[] = [];
  const modelDial = fakeDial("slow-model-operation");
  const navigationDial = fakeDial("independent-navigation-operation");

  internals.microBridge.rotateModelPicker = async () => {
    operations.push("model:start");
    modelStarted();
    await modelGate;
    operations.push("model:end");
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };
  internals.microBridge.sendJoystick = async (direction, act) => {
    operations.push(`${direction}:${act}`);
  };
  internals.refresh = async () => undefined;

  controller.registerPlusDial("model", modelDial as unknown as DialAction);
  controller.registerPlusDial("navigation", navigationDial as unknown as DialAction);
  await flush();

  const modelRotation = controller.plusDialRotate(modelDial.id, 1);
  await modelStart;
  const navigationRotation = controller.plusDialRotate(navigationDial.id, 1);
  await flush();
  const operationsWhileModelPending = [...operations];

  releaseModel();
  await Promise.all([modelRotation, navigationRotation]);

  assert.deepEqual(
    operationsWhileModelPending,
    ["model:start", "right:1", "right:0"],
    "a slow model picker must not hold an unrelated physical dial queue",
  );
});

test("a rejected LCD send still drains the latest queued render", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  let releaseFailure!: () => void;
  let failingSendStarted!: () => void;
  const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const failingSendStart = new Promise<void>((resolve) => { failingSendStarted = resolve; });
  const attempts: Feedback[] = [];
  const dial = fakeDial("render-rejection-coalescing");
  dial.setFeedback = async (value) => {
    recordFeedback(attempts, value);
    if (attempts.length === 2) {
      failingSendStarted();
      await failureGate;
      throw new Error("simulated delayed LCD failure");
    }
  };

  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await flush();
  const registration = internals.plusDials.get(dial.id);
  assert.ok(registration);
  internals.operationFeedback.set(dial.id, { phase: "pending", progress: 0.25, detail: "E_RESULT_UNVERIFIED" });
  const failed = internals.renderPlusDial(registration);
  await failingSendStart;

  internals.operationFeedback.set(dial.id, { phase: "pending", progress: 0.9, detail: "E_RESULT_UNVERIFIED" });
  const latest = internals.renderPlusDial(registration);
  releaseFailure();

  const outcomes = await Promise.allSettled([failed, latest]);
  assert.deepEqual(outcomes.map(({ status }) => status), ["fulfilled", "fulfilled"]);
  assert.equal(attempts.length, 3, "the newer request must be attempted after the older send fails");
  assert.equal(attempts[2]?.progress, 90);
});

test("a nested microtask render request survives drain settlement", async () => {
  const controller = readyController();
  const internals = controller as unknown as ControllerInternals;
  const sent: Feedback[] = [];
  let registration: unknown;
  let nestedRequested = false;
  let nestedRender: Promise<void> | undefined;
  const dial = fakeDial("render-drain-microtask");
  dial.setFeedback = (value) => {
    recordFeedback(sent, value);
    if (!nestedRequested) {
      nestedRequested = true;
      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          resolve();
          queueMicrotask(() => {
            queueMicrotask(() => {
              internals.operationFeedback.set(dial.id, { phase: "pending", progress: 0.5, detail: "E_RESULT_UNVERIFIED" });
              nestedRender = internals.renderPlusDial(registration);
            });
          });
        });
      });
    }
    return Promise.resolve();
  };

  controller.registerPlusDial("commands", dial as unknown as DialAction);
  registration = internals.plusDials.get(dial.id);
  assert.ok(registration);
  await flush();
  assert.ok(nestedRender, "the nested request should be issued during drain completion");
  await nestedRender;

  assert.equal(sent.length, 2, "the nested request must receive its own follow-up send");
  assert.equal(sent[1]?.progress, 50);
});

function readyController(): DeckController {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.animationFrame = 0;
  return controller;
}

function fakeDial(id: string): FakeDial {
  const dial: FakeDial = {
    id,
    feedback: [],
    setFeedbackLayout: async () => undefined,
    setFeedback: async (value) => { recordFeedback(dial.feedback, value); },
    showAlert: async () => undefined,
  };
  return dial;
}

function recordFeedback(history: Feedback[], value: Feedback): void {
  history.push({ ...(history.at(-1) ?? {}), ...value });
}

type FakeDial = {
  id: string;
  feedback: Feedback[];
  setFeedbackLayout(path: string): Promise<void>;
  setFeedback(value: Feedback): Promise<void>;
  showAlert(): Promise<void>;
};

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function snapshot(): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-1",
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    usage: {
      observedAt: Date.now(),
      resetCreditsAvailable: 0,
      resetCreditsApplicable: 0,
      windows: [],
    },
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}
