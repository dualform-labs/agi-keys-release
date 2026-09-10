import assert from "node:assert/strict";
import test from "node:test";
import type { DialAction } from "@elgato/streamdeck";
import { DeckController, MICROPLUS_DIAL_LAYOUT } from "../src/controller.js";
import type { MicroSnapshot, MutationConfirmation } from "../src/types.js";

type DialFixture = {
  action: DialAction;
  layouts: string[];
  feedback: Array<Record<string, unknown>>;
};

test("commands dial previews its selection and invokes the selected keycap", async () => {
  const calls: string[] = [];
  const controller = controllerWithBridge(calls);
  const dial = await sdkDial("commands-dial");

  controller.registerPlusDial("commands", dial.action);
  await immediate();
  assert.deepEqual(dial.layouts, [MICROPLUS_DIAL_LAYOUT]);
  assert.equal(observedValue(dial), "TERM");

  await controller.plusDialRotate(dial.action.id, 1);
  assert.equal(observedValue(dial), "DIFF");
  await controller.plusDialDown(dial.action.id);
  assert.deepEqual(calls, ["DIFF"]);
});

test("commands dial applies reverse direction and dialStep before selection", async () => {
  const calls: string[] = [];
  const controller = controllerWithBridge(calls);
  const dial = await sdkDial("commands-reversed");
  controller.setActionPreferences(dial.action.id, { reverseDial: true, dialStep: 2 });
  controller.registerPlusDial("commands", dial.action);
  await immediate();

  await controller.plusDialRotate(dial.action.id, 1);
  assert.equal(observedValue(dial), "SETUP");
  await controller.plusDialDown(dial.action.id);
  assert.deepEqual(calls, ["SETUP"]);
});

test("model dial reverses native direction and honors the per-key reverse setting", async () => {
  const calls: string[] = [];
  const controller = controllerWithBridge([]);
  const bridge = (controller as unknown as { microBridge: Record<string, unknown> }).microBridge;
  bridge.rotateModelPicker = async (direction: string) => {
    calls.push(direction);
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };
  const dial = await sdkDial("model-direction");
  controller.registerPlusDial("model", dial.action);
  await immediate();
  await controller.plusDialRotate(dial.action.id, 1);
  await controller.plusDialRotate(dial.action.id, -1);
  assert.deepEqual(calls, ["decrease", "increase"]);
  controller.setActionPreferences(dial.action.id, { reverseDial: true });
  await controller.plusDialRotate(dial.action.id, 1);
  assert.deepEqual(calls, ["decrease", "increase", "increase"]);
});

test("model dial shows the focused picker candidate until it is committed", async () => {
  const snapshot = microSnapshot();
  snapshot.composerReadback = {
    currentModelId: "model-a",
    modelLabel: "Model A",
    modelSelectionMode: "model",
    modelPickerOpen: true,
    modelCandidateLabel: "Model B",
    activeThreadKey: "thread-a",
    reasoningEffort: "medium",
    fastEnabled: null,
    dictationPhase: "unavailable",
    observedAt: Date.now(),
  };
  const controller = controllerWithBridge([], snapshot);
  const dial = await sdkDial("model-candidate");

  controller.registerPlusDial("model", dial.action);
  await immediate();

  assert.equal(observedValue(dial), "Model B");
});

test("a queued rotation reports a stale mapping when the dial reappears", async () => {
  const controller = controllerWithBridge([]);
  const first = await sdkDial("reappearing-model");
  const replacement = await sdkDial("reappearing-model");
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const bridge = (controller as unknown as { microBridge: Record<string, unknown> }).microBridge;
  bridge.rotateModelPicker = async () => {
    firstStarted();
    await gate;
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };
  controller.registerPlusDial("model", first.action);
  await immediate();

  const active = controller.plusDialRotate(first.action.id, 1);
  await started;
  const queued = controller.plusDialRotate(first.action.id, 1);
  controller.unregisterPlusDial(first.action);
  controller.registerPlusDial("model", replacement.action);
  releaseFirst();

  await active;
  await assert.rejects(queued, /E_MAPPING_STALE/u);
});

test("usage dial switches fresh readout windows and refreshes on press", async () => {
  let refreshes = 0;
  const snapshot = microSnapshot();
  const controller = controllerWithBridge([], snapshot, () => { refreshes += 1; });
  const dial = await sdkDial("usage-dial");

  controller.registerPlusDial("usage", dial.action);
  await immediate();
  assert.equal(observedValue(dial), "80%");
  assert.equal(latest(dial).detail, "5時間・残り");

  await controller.plusDialRotate(dial.action.id, 1);
  assert.equal(observedValue(dial), "60%");
  assert.equal(latest(dial).detail, "週間・残り");
  await controller.plusDialDown(dial.action.id);
  assert.equal(refreshes, 1);
});

test("usage dial press propagates an account refresh failure", async () => {
  const controller = controllerWithBridge([]);
  const bridge = (controller as unknown as { microBridge: Record<string, unknown> }).microBridge;
  bridge.refreshUsage = async () => { throw new Error("E_OPERATION_UNOBSERVED"); };
  const dial = await sdkDial("usage-refresh-failure");
  controller.registerPlusDial("usage", dial.action);
  await immediate();

  await assert.rejects(controller.plusDialDown(dial.action.id), /E_OPERATION_UNOBSERVED/u);
});

async function sdkDial(id: string): Promise<DialFixture> {
  const sdkModuleUrl = new URL("../node_modules/@elgato/streamdeck/dist/plugin/actions/dial.js", import.meta.url).href;
  const sdkModule = await import(sdkModuleUrl) as { DialAction: { prototype: object } };
  const action = Object.create(sdkModule.DialAction.prototype) as DialAction;
  const layouts: string[] = [];
  const feedback: Array<Record<string, unknown>> = [];
  Object.defineProperties(action, {
    id: { value: id },
    setFeedbackLayout: { value: async (layout: string) => { layouts.push(layout); } },
    setFeedback: { value: async (value: Record<string, unknown>) => { recordFeedback(feedback, value); } },
    showAlert: { value: async () => undefined },
  });
  return { action, layouts, feedback };
}

function recordFeedback(history: Array<Record<string, unknown>>, value: Record<string, unknown>): void {
  history.push({ ...(history.at(-1) ?? {}), ...value });
}

function controllerWithBridge(
  keycaps: string[],
  snapshot = microSnapshot(),
  onRefresh: () => void = () => undefined,
): DeckController {
  const controller = new DeckController();
  const confirmation: MutationConfirmation = { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  const internals = controller as unknown as {
    snapshot: MicroSnapshot;
    health: { state: "ready"; changedAt: number };
    microBridge: {
      advancePageEpoch(): void;
      runKeycap(keycapId: string): Promise<MutationConfirmation>;
      refresh(): Promise<MicroSnapshot>;
      refreshUsage(): Promise<MicroSnapshot>;
    };
  };
  internals.snapshot = snapshot;
  internals.health = { state: "ready", changedAt: Date.now() };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    runKeycap: async (keycapId) => { keycaps.push(keycapId); return confirmation; },
    refresh: async () => { onRefresh(); return snapshot; },
    refreshUsage: async () => { onRefresh(); return snapshot; },
  };
  return controller;
}

function latest(dial: DialFixture): Record<string, unknown> {
  const value = dial.feedback.at(-1);
  assert.ok(value, `${dial.action.id} did not render feedback`);
  return value;
}

function observedValue(dial: DialFixture): string {
  const value = latest(dial).value;
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function microSnapshot(): MicroSnapshot {
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
      windows: [
        { id: "five-hour", kind: "five-hour", usedPercent: 20, remainingPercent: 80, windowDurationMins: 300, resetsAt: null },
        { id: "weekly", kind: "weekly", usedPercent: 40, remainingPercent: 60, windowDurationMins: 10_080, resetsAt: null },
      ],
    },
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}
