import assert from "node:assert/strict";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { parseActionPreferences } from "../src/action-preferences.js";
import { Agent1, RateLimitReset, UsageLimit, UsageOverview } from "../src/actions.js";
import { ContextCompactionAction } from "../src/context-compaction-action.js";
import { DeckController } from "../src/controller.js";
import type { HostHealth, MicroSnapshot } from "../src/types.js";

type ControllerInternals = {
  health: HostHealth;
  snapshot?: MicroSnapshot;
  microBridge: {
    sendAction(slot: string, value: number): Promise<void>;
    releaseAction(slot: string): Promise<void>;
  };
  focusApplication(): Promise<void>;
};

function snapshot(): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-display-override",
    layout: {
      version: 1,
      slots: { ACT10: { keycapId: "MIC" } },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-display-override",
    targetIdentity: "target-display-override",
  };
}

type FakeKeyEvent = {
  action: { id: string; isKey(): boolean; showAlert(): Promise<void>; showOk(): Promise<void> };
  payload: { settings: Record<string, unknown> };
};

function keyEvent(id: string): FakeKeyEvent {
  return {
    action: {
      id,
      isKey: () => true,
      showAlert: async () => undefined,
      showOk: async () => undefined,
    },
    payload: { settings: {} },
  };
}

test("ptt display override releases on key-up after settings change and on disappearance", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const calls: string[] = [];
  internals.health = { state: "ready", changedAt: 0 };
  internals.snapshot = snapshot();
  internals.microBridge = {
    sendAction: async (slot, value) => { calls.push(`down:${slot}:${value}`); },
    releaseAction: async (slot) => { calls.push(`up:${slot}`); },
  };

  const limit = new UsageLimit(controller);
  const limitEvent = keyEvent("usage-ptt-up");
  controller.setActionPreferences(limitEvent.action.id, { pressBehavior: "ptt" });
  await limit.onKeyDown(limitEvent as unknown as KeyDownEvent);
  controller.setActionPreferences(limitEvent.action.id, { pressBehavior: "disabled" });
  await limit.onKeyUp(limitEvent as unknown as KeyUpEvent);

  const overview = new UsageOverview(controller);
  const overviewEvent = keyEvent("usage-ptt-disappear");
  controller.setActionPreferences(overviewEvent.action.id, { pressBehavior: "ptt" });
  await overview.onKeyDown(overviewEvent as unknown as KeyDownEvent);
  await overview.onWillDisappear(overviewEvent as unknown as WillDisappearEvent);

  assert.deepEqual(calls, ["down:ACT10:1", "up:ACT10", "down:ACT10:1", "up:ACT10"]);
});

test("all display action families release a configured PTT override on key-up", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const calls: string[] = [];
  internals.health = { state: "ready", changedAt: 0 };
  internals.snapshot = snapshot();
  internals.microBridge = {
    sendAction: async (slot, value) => { calls.push(`down:${slot}:${value}`); },
    releaseAction: async (slot) => { calls.push(`up:${slot}`); },
  };

  const actions = [
    ["agent", new Agent1(controller)],
    ["usage-limit", new UsageLimit(controller)],
    ["usage-overview", new UsageOverview(controller)],
    ["rate-limit-reset", new RateLimitReset(controller)],
    ["context-compaction", new ContextCompactionAction(controller)],
  ] as const;
  for (const [name, action] of actions) {
    const ev = keyEvent(`display-ptt-${name}`);
    controller.setActionPreferences(ev.action.id, { pressBehavior: "ptt" });
    await action.onKeyDown(ev as unknown as KeyDownEvent);
    await action.onKeyUp(ev as unknown as KeyUpEvent);
  }

  assert.deepEqual(calls, [
    "down:ACT10:1", "up:ACT10",
    "down:ACT10:1", "up:ACT10",
    "down:ACT10:1", "up:ACT10",
    "down:ACT10:1", "up:ACT10",
    "down:ACT10:1", "up:ACT10",
  ]);
});

test("focus and disabled display overrides need no bridge state and preserve native defaults", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  let focusCalls = 0;
  internals.focusApplication = async () => { focusCalls += 1; };
  internals.microBridge = new Proxy({} as ControllerInternals["microBridge"], {
    get: () => { throw new Error("bridge must not be read"); },
  });

  const usage = new UsageLimit(controller);
  const focusEvent = keyEvent("usage-focus-no-bridge");
  controller.setActionPreferences(focusEvent.action.id, { pressBehavior: "focus" });
  await usage.onKeyDown(focusEvent as unknown as KeyDownEvent);
  await usage.onKeyUp(focusEvent as unknown as KeyUpEvent);
  assert.equal(focusCalls, 1);

  const agent = new Agent1(controller);
  const agentEvent = keyEvent("agent-disabled");
  controller.setActionPreferences(agentEvent.action.id, { pressBehavior: "disabled" });
  await agent.onKeyDown(agentEvent as unknown as KeyDownEvent);
  await agent.onKeyUp(agentEvent as unknown as KeyUpEvent);

  const reset = new RateLimitReset(controller);
  const resetEvent = keyEvent("reset-disabled");
  controller.setActionPreferences(resetEvent.action.id, { pressBehavior: "disabled" });
  await reset.onKeyDown(resetEvent as unknown as KeyDownEvent);
  await reset.onKeyUp(resetEvent as unknown as KeyUpEvent);
});

test("preference parser distinguishes explicit ptt and disabled from legacy none", () => {
  assert.equal(parseActionPreferences({ pressBehavior: "ptt" }).pressBehavior, "ptt");
  assert.equal(parseActionPreferences({ pressBehavior: "disabled" }).pressBehavior, "disabled");
  assert.equal(parseActionPreferences({ pressBehavior: "none" }).pressBehavior, "none");
});
