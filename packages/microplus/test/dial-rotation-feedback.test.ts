import assert from "node:assert/strict";
import test from "node:test";
import type { DialAction } from "@elgato/streamdeck";
import { DIAL_INTERACTION_DURATION_MS } from "../src/render.js";
import { DeckController } from "../src/controller.js";
import type { HostHealth, MicroSnapshot } from "../src/types.js";

type Feedback = Record<string, unknown>;

type FakeDial = {
  id: string;
  layouts: string[];
  feedback: Feedback[];
  setFeedbackLayout(path: string): Promise<void>;
  setFeedback(value: Feedback): Promise<void>;
  showAlert(): Promise<void>;
};

type ControllerInternals = {
  snapshot: MicroSnapshot;
  health: HostHealth;
  lastPhysicalDialRotations: Map<string, number>;
  lastPhysicalDialDirections: Map<string, number>;
  dialSelections: Map<string, number>;
  plusDials: Map<string, unknown>;
  renderAllPlusDials(): Promise<void>;
  renderAnimated(): Promise<void>;
  scheduleAnimation(): void;
  renderPlusDial(registration: unknown): Promise<void>;
  microBridge: {
    advancePageEpoch(): void;
    refresh(): Promise<MicroSnapshot>;
  };
};

test("a real non-agent rotation gets immediate directional feedback and clears its static cue", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
  };

  const dial = fakeDial("rotation-cue");
  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await flush();
  const initial = latest(dial);
  assert.doesNotMatch(decode(String(initial["backdrop-13"])), /data-dial-input|data-dial-wait/u);

  await controller.plusDialRotate(dial.id, -1);
  const rotated = latest(dial);
  assert.equal((rotated.value as {font: {weight: number}}).font.weight, 750);
  assert.ok((rotated.value as {font: {size: number}}).font.size > 16);
  assert.equal(internals.lastPhysicalDialDirections.get(dial.id), -1);
  assert.match(decode(String(rotated.icon)), /data-dial-direction="-1"/u);
  assert.match(decode(String(rotated["backdrop-13"])), /data-dial-input="true"/u);

  // Animation off keeps the acknowledgement static while the cue is live.
  controller.setActionPreferences(dial.id, { animation: false });
  await flush();
  await controller.plusDialRotate(dial.id, 1);
  const staticCue = latest(dial);
  assert.match(decode(String(staticCue["backdrop-13"])), /data-dial-input="true"/u);
  assert.equal(internals.lastPhysicalDialDirections.get(dial.id), 1);

  const timestamp = internals.lastPhysicalDialRotations.get(dial.id);
  assert.ok(timestamp != null);
  internals.lastPhysicalDialRotations.set(dial.id, Date.now() - DIAL_INTERACTION_DURATION_MS - 1);
  await internals.renderAnimated();
  const cleared = latest(dial);
  assert.equal((cleared.value as {font: {weight: number}}).font.weight, 600);
  assert.equal((cleared.value as {font: {size: number}}).font.size, 16);
  assert.doesNotMatch(decode(String(cleared["backdrop-13"])), /data-dial-input|data-dial-wait/u);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  assert.equal(internals.lastPhysicalDialDirections.has(dial.id), false);

  controller.unregisterPlusDial(dial);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  assert.equal(internals.lastPhysicalDialDirections.has(dial.id), false);
});

test("agent dials and non-meaningful ticks do not create rotation acknowledgement state", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
  };

  const agent = fakeDial("agent-no-cue");
  controller.registerPlusDial("agents", agent as unknown as DialAction);
  await flush();
  await controller.plusDialRotate(agent.id, 1);
  assert.equal(internals.lastPhysicalDialRotations.has(agent.id), false);
  assert.doesNotMatch(decode(String(latest(agent)["backdrop-13"])), /data-dial-input|data-dial-wait/u);

  const dial = fakeDial("invalid-cue");
  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await flush();
  await controller.plusDialRotate(dial.id, 0.5);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  const selectionAfterFractionalTick = internals.dialSelections.get(dial.id) ?? 0;
  await controller.plusDialRotate(dial.id, Number.NaN);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  assert.equal(internals.dialSelections.get(dial.id) ?? 0, selectionAfterFractionalTick);
});

test("rotation before layout readiness never stores a cue", async () => {
  let releaseLayout!: () => void;
  const layoutGate = new Promise<void>((resolve) => { releaseLayout = resolve; });
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
  };

  const dial = fakeDial("pending-layout-cue");
  dial.setFeedbackLayout = async () => { await layoutGate; };
  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await Promise.resolve();

  await controller.plusDialRotate(dial.id, 1);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  assert.equal(internals.lastPhysicalDialDirections.has(dial.id), false);
  assert.equal(dial.feedback.length, 0);

  releaseLayout();
  await flush();
  assert.equal(dial.feedback.length, 1);
  assert.doesNotMatch(decode(String(latest(dial)["backdrop-13"])), /data-dial-input|data-dial-wait/u);
});

test("an expired cue is cleared on an early render while layout is pending", async () => {
  let releaseLayout!: () => void;
  const layoutGate = new Promise<void>((resolve) => { releaseLayout = resolve; });
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
  };

  const dial = fakeDial("expired-pending-layout-cue");
  dial.setFeedbackLayout = async () => { await layoutGate; };
  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await Promise.resolve();
  const registration = internals.plusDials.get(dial.id);
  assert.ok(registration);
  internals.lastPhysicalDialRotations.set(dial.id, Date.now() - DIAL_INTERACTION_DURATION_MS - 1);
  internals.lastPhysicalDialDirections.set(dial.id, 1);

  await internals.renderPlusDial(registration);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);
  assert.equal(internals.lastPhysicalDialDirections.has(dial.id), false);
  assert.equal(dial.feedback.length, 0);

  // The expiry cleanup must remove the renderAnimated work item too.
  await internals.renderAnimated();
  assert.equal(dial.feedback.length, 0);
  assert.equal(internals.lastPhysicalDialRotations.has(dial.id), false);

  releaseLayout();
  await flush();
  assert.equal(dial.feedback.length, 1);
  assert.doesNotMatch(decode(String(latest(dial)["backdrop-13"])), /data-dial-input|data-dial-wait/u);
});

test("a different-action stale restore queues the expired cue's final blank frame", async () => {
  let releaseOldFeedback!: () => void;
  let oldFeedbackStarted!: () => void;
  const oldFeedbackGate = new Promise<void>((resolve) => { releaseOldFeedback = resolve; });
  const oldFeedbackStart = new Promise<void>((resolve) => { oldFeedbackStarted = resolve; });
  let releaseNewFeedback!: () => void;
  let newFeedbackStarted!: () => void;
  const newFeedbackGate = new Promise<void>((resolve) => { releaseNewFeedback = resolve; });
  const newFeedbackStart = new Promise<void>((resolve) => { newFeedbackStarted = resolve; });

  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
  };

  const oldAction = fakeDial("stale-restore-cue");
  oldAction.setFeedback = async (value) => {
    oldFeedbackStarted();
    await oldFeedbackGate;
    recordFeedback(oldAction.feedback, value);
  };
  const newAction = fakeDial("stale-restore-cue");
  const newAttempts: Feedback[] = [];
  newAction.setFeedback = async (value) => {
    newAttempts.push(value);
    newFeedbackStarted();
    await newFeedbackGate;
    recordFeedback(newAction.feedback, value);
  };

  controller.registerPlusDial("commands", oldAction as unknown as DialAction);
  await oldFeedbackStart;
  controller.unregisterPlusDial(oldAction as unknown as DialAction);
  controller.registerPlusDial("commands", newAction as unknown as DialAction);
  // Seed the replacement's live cue before its first render starts.
  internals.lastPhysicalDialRotations.set(newAction.id, Date.now());
  internals.lastPhysicalDialDirections.set(newAction.id, 1);
  await newFeedbackStart;
  assert.match(decode(String(newAttempts[0]?.["backdrop-13"])), /data-dial-input="true"/u);

  // The stale old write completes after the replacement cue has expired. The
  // different-action restore must queue behind the replacement send and land
  // as the final blank frame.
  internals.lastPhysicalDialRotations.set(newAction.id, Date.now() - DIAL_INTERACTION_DURATION_MS - 1);
  releaseOldFeedback();
  releaseNewFeedback();
  await flush();
  await flush();
  await flush();

  assert.equal(newAction.feedback.length, 2);
  assert.match(decode(String(newAction.feedback[0]?.["backdrop-13"])), /data-dial-input="true"/u);
  assert.doesNotMatch(decode(String(newAction.feedback[1]?.["backdrop-13"])), /data-dial-input|data-dial-wait/u);
  assert.equal(internals.lastPhysicalDialRotations.has(newAction.id), false);
  assert.equal(internals.lastPhysicalDialDirections.has(newAction.id), false);
});

function fakeDial(id: string): FakeDial {
  const dial: FakeDial = {
    id,
    layouts: [],
    feedback: [],
    setFeedbackLayout: async (path) => { dial.layouts.push(path); },
    setFeedback: async (value) => { recordFeedback(dial.feedback, value); },
    showAlert: async () => undefined,
  };
  return dial;
}

function recordFeedback(history: Feedback[], value: Feedback): void {
  history.push({ ...(history.at(-1) ?? {}), ...value });
}

function latest(dial: FakeDial): Feedback {
  const value = dial.feedback.at(-1);
  assert.ok(value, `${dial.id} did not receive LCD feedback`);
  return value;
}

function decode(value: string): string {
  const comma = value.indexOf(",");
  assert.ok(comma >= 0, "expected an encoded SVG data URL");
  return decodeURIComponent(value.slice(comma + 1));
}

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


test("dial frames continue while unrelated animation is stalled, with one scheduled timer", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot();
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = { advancePageEpoch: () => undefined, refresh: async () => internals.snapshot };
  const dial = fakeDial("timer-cadence");
  controller.registerPlusDial("commands", dial as unknown as DialAction);
  await flush();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const timers: Array<{ callback: () => Promise<void>; delay: number }> = [];
  const cleared: unknown[] = [];
  globalThis.setTimeout = ((callback: () => Promise<void>, delay: number) => {
    const timer = { callback, delay }; timers.push(timer); return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((timer: unknown) => { cleared.push(timer); }) as typeof clearTimeout;
  try {
    internals.scheduleAnimation();
    assert.equal(timers[0]?.delay, 200);
    await controller.plusDialRotate(dial.id, 1);
    assert.equal(cleared[0], timers[0]);
    assert.equal(timers[1]?.delay, 33);
    let finish!: () => void;
    const renderAnimated = internals.renderAnimated.bind(internals);
    let firstPass = true;
    internals.renderAnimated = async () => {
      const first = firstPass;
      firstPass = false;
      await renderAnimated();
      if (first) await new Promise<void>((resolve) => { finish = resolve; });
    };
    const inFlight = timers[1]!.callback();
    assert.equal(timers.length, 3, "next frame is scheduled before slow rendering completes");
    await controller.plusDialRotate(dial.id, 1);
    assert.equal(cleared.length, 1, "continuous rotation must not postpone the active timer");
    assert.equal(timers.length, 3);
    const before = dial.feedback.length;
    internals.lastPhysicalDialRotations.set(dial.id, Date.now() - Math.floor(DIAL_INTERACTION_DURATION_MS / 2));
    await timers[2]!.callback();
    assert.ok(dial.feedback.length > before, "dial frame is sent despite unrelated render still pending");
    assert.equal(timers.length, 4);
    finish();
    await inFlight;
    assert.equal(timers.length, 4, "completion does not create another timer");
    assert.equal(timers[3]?.delay, 33);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});
