import assert from "node:assert/strict";
import test from "node:test";
import type { DialAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import { renderPlusDialFeedback } from "../src/render.js";
import type { MicroSnapshot } from "../src/types.js";

type Feedback = Record<string, unknown>;

test("usage LCD keeps an actual cached value visibly stale and hides it offline", () => {
  const stale = renderPlusDialFeedback({
    kind: "usage",
    health: "ready",
    state: "stale",
    observedValue: "60%",
    detail: "週間・前回値",
  });
  assert.deepEqual({ value: stale.value, status: stale.status, detail: stale.detail }, {
    value: "60%",
    status: "stale",
    detail: "週間・前回値",
  });
  assert.equal(renderPlusDialFeedback({
    kind: "usage",
    health: "offline",
    observedValue: "60%",
  }).value, "—");
});

test("usage dial treats multi-tick turns as stable directional endpoints and refreshes the value", async () => {
  let refreshes = 0;
  const controller = readyController(() => { refreshes += 1; });
  const dial = fakeDial("usage-direction");
  controller.registerPlusDial("usage", dial as unknown as DialAction);
  await flush();

  await controller.plusDialRotate(dial.id, 2);
  assert.equal(latestValue(dial), "60%", "two clockwise ticks must stay on the weekly endpoint");
  assert.equal(latest(dial).detail, "週間・残り");

  await controller.plusDialRotate(dial.id, -3);
  assert.equal(latestValue(dial), "80%", "three counter-clockwise ticks must stay on the five-hour endpoint");
  assert.equal(latest(dial).detail, "5時間・残り");
  assert.equal(refreshes, 0, "fresh observer-backed usage does not trigger a redundant refresh");
});

test("usage rotation refreshes an expired observer snapshot before completing", async () => {
  let refreshes = 0;
  const controller = readyController(() => { refreshes += 1; }, Date.now() - 300_001);
  const dial = fakeDial("usage-stale-refresh");
  controller.registerPlusDial("usage", dial as unknown as DialAction);
  await flush();

  await controller.plusDialRotate(dial.id, 1);
  assert.equal(refreshes, 1);
  assert.equal(latestValue(dial), "60%", "the last observed value stays visible while marked stale");
  assert.equal(latest(dial).status, "期限切れ");
  assert.equal(latest(dial).detail, "週間・前回値");
});

test("usage dial reverse preference swaps endpoints without allowing dialStep to cancel the change", async () => {
  const controller = readyController();
  const dial = fakeDial("usage-reversed");
  controller.setActionPreferences(dial.id, { reverseDial: true, dialStep: 2 });
  controller.registerPlusDial("usage", dial as unknown as DialAction);
  await flush();

  await controller.plusDialRotate(dial.id, 1);
  assert.equal(latestValue(dial), "80%");
  assert.equal(latest(dial).detail, "5時間・残り");

  await controller.plusDialRotate(dial.id, -1);
  assert.equal(latestValue(dial), "60%");
  assert.equal(latest(dial).detail, "週間・残り");
});

test("usage selection commits before a configured focus wait resolves", async () => {
  const controller = readyController();
  const dial = fakeDial("usage-focus");
  let releaseFocus!: () => void;
  const focusWait = new Promise<void>((resolve) => { releaseFocus = resolve; });
  const internals = controller as unknown as {
    dialSelections: Map<string, number>;
    focusApplication: () => Promise<void>;
  };
  internals.focusApplication = () => focusWait;
  controller.setActionPreferences(dial.id, { focusBeforeAction: true });
  controller.registerPlusDial("usage", dial as unknown as DialAction);
  await flush();

  const rotation = controller.plusDialRotate(dial.id, 1);
  await flush();
  assert.equal(internals.dialSelections.get(dial.id), 1, "selection must not wait for application focus");
  assert.equal(latestValue(dial), "60%", "the target LCD receives the selected window before focus finishes");
  releaseFocus();
  await rotation;
});

test("an unresolved stale usage query is coalesced and does not block another dial", async () => {
  const controller = readyController(undefined, Date.now() - 300_001);
  const usage = fakeDial("usage-background");
  const commands = fakeDial("commands-during-usage-refresh");
  let resolveUsage!: (snapshot: MicroSnapshot) => void;
  let refreshes = 0;
  const usageRefresh = new Promise<MicroSnapshot>((resolve) => { resolveUsage = resolve; });
  const internals = controller as unknown as {
    microBridge: { refreshUsage(): Promise<MicroSnapshot> };
  };
  internals.microBridge.refreshUsage = () => { refreshes += 1; return usageRefresh; };
  controller.registerPlusDial("usage", usage as unknown as DialAction);
  controller.registerPlusDial("commands", commands as unknown as DialAction);
  await flush();

  await controller.plusDialRotate(usage.id, 1);
  await controller.plusDialRotate(usage.id, -1);
  await controller.plusDialRotate(commands.id, 1);

  assert.equal(refreshes, 1, "stale usage turns share one in-flight account query");
  assert.equal(latestValue(commands), "DIFF", "the global rotation queue is free while usage refresh is pending");
  resolveUsage(usageSnapshot());
  await flush();
});

test("a completed background usage refresh redraws dials and both usage key families", async () => {
  const controller = readyController(undefined, Date.now() - 300_001);
  const internals = controller as unknown as {
    plusDials: Map<string, { action: DialAction; kind: "usage"; selection: number; layoutState: "ready" }>;
    usageLimitActions: Map<string, { action: { id: string }; mode: "weekly" }>;
    usageOverviewActions: Map<string, { id: string }>;
    microBridge: { refreshUsage(): Promise<MicroSnapshot> };
    refreshUsageInBackground(): void;
    renderPlusDial(registration: unknown): Promise<void>;
    renderUsageLimit(registration: unknown): Promise<void>;
    renderUsageOverview(action: unknown): Promise<void>;
  };
  const redraws: string[] = [];
  internals.plusDials.set("usage-dial-refresh", {
    action: fakeDial("usage-dial-refresh") as unknown as DialAction,
    kind: "usage",
    selection: 0,
    layoutState: "ready",
  });
  internals.usageLimitActions.set("usage-limit-refresh", {
    action: { id: "usage-limit-refresh" },
    mode: "weekly",
  });
  internals.usageOverviewActions.set("usage-overview-refresh", { id: "usage-overview-refresh" });
  internals.microBridge.refreshUsage = async () => usageSnapshot();
  internals.renderPlusDial = async () => { redraws.push("dial"); };
  internals.renderUsageLimit = async () => { redraws.push("limit"); };
  internals.renderUsageOverview = async () => { redraws.push("overview"); };

  internals.refreshUsageInBackground();
  await flush();

  assert.deepEqual(redraws.sort(), ["dial", "limit", "overview"]);
});

function readyController(onRefresh: () => void = () => undefined, observedAt = Date.now()): DeckController {
  const controller = new DeckController();
  const snapshot = usageSnapshot(observedAt);
  const internals = controller as unknown as {
    snapshot: MicroSnapshot;
    health: { state: "ready"; changedAt: number };
    microBridge: { advancePageEpoch(): void; refresh(): Promise<MicroSnapshot>; refreshUsage(): Promise<MicroSnapshot> };
  };
  internals.snapshot = snapshot;
  internals.health = { state: "ready", changedAt: Date.now() };
  internals.microBridge = {
    advancePageEpoch: () => undefined,
    refresh: async () => { onRefresh(); return snapshot; },
    refreshUsage: async () => { onRefresh(); return snapshot; },
  };
  return controller;
}

function fakeDial(id: string): { id: string; feedback: Feedback[]; setFeedbackLayout(path: string): Promise<void>; setFeedback(value: Feedback): Promise<void>; showAlert(): Promise<void> } {
  const dial = {
    id,
    feedback: [] as Feedback[],
    setFeedbackLayout: async (_path: string) => undefined,
    setFeedback: async (value: Feedback) => { dial.feedback.push({ ...(dial.feedback.at(-1) ?? {}), ...value }); },
    showAlert: async () => undefined,
  };
  return dial;
}

function latest(dial: { feedback: Feedback[] }): Feedback {
  const feedback = dial.feedback.at(-1);
  assert.ok(feedback);
  return feedback;
}

function latestValue(dial: { feedback: Feedback[] }): string {
  const value = latest(dial).value;
  assert.ok(value && typeof value === "object" && "value" in value);
  return String((value as { value: unknown }).value);
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function usageSnapshot(observedAt = Date.now()): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-1",
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    usage: {
      observedAt,
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
