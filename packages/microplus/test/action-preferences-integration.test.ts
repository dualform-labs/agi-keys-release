import assert from "node:assert/strict";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";
import { Fast } from "../src/actions.js";
import { DeckController } from "../src/controller.js";
import type { MicroActionSlot } from "../src/types.js";

type BridgeHarness = {
  sendAction(slot: MicroActionSlot, act: 0 | 1): Promise<void>;
  releaseAction(slot: "ACT10" | "ACT11"): Promise<void>;
};

type ControllerHarness = {
  microBridge: BridgeHarness;
  focusApplication(): Promise<void>;
};

function configuredController(events: string[]): { controller: DeckController; harness: ControllerHarness } {
  const controller = new DeckController();
  const harness = controller as unknown as ControllerHarness;
  harness.microBridge = {
    sendAction: async (slot, act) => { events.push(`${slot}:${act === 1 ? "down" : "up"}`); },
    releaseAction: async (slot) => { events.push(`${slot}:up`); },
  };
  harness.focusApplication = async () => { events.push("focus"); };
  return { controller, harness };
}

function keyEvent(id: string, onAlert: () => void = () => assert.fail(`unexpected alert from ${id}`)) {
  return {
    action: {
      id,
      showAlert: async () => onAlert(),
    },
  };
}

test("focus-before-action preserves a fast down/up while focus is delayed", async () => {
  const events: string[] = [];
  const { controller, harness } = configuredController(events);
  controller.setActionPreferences("fast-focused", { focusBeforeAction: true });
  let finishFocus!: () => void;
  let noteFocus!: () => void;
  const focusStarted = new Promise<void>((resolve) => { noteFocus = resolve; });
  const focusGate = new Promise<void>((resolve) => { finishFocus = resolve; });
  harness.focusApplication = async () => {
    events.push("focus:start");
    noteFocus();
    await focusGate;
    events.push("focus:end");
  };
  const action = new Fast(controller);
  const event = keyEvent("fast-focused");

  const down = action.onKeyDown(event as unknown as KeyDownEvent);
  await focusStarted;
  const up = action.onKeyUp(event as unknown as KeyUpEvent);
  assert.deepEqual(events, ["focus:start"]);

  finishFocus();
  await Promise.all([down, up]);
  assert.deepEqual(events, ["focus:start", "focus:end", "ACT06:down", "ACT06:up"]);
});

test("focus-before-action disabled never invokes the application focus boundary", async () => {
  const events: string[] = [];
  const { controller, harness } = configuredController(events);
  let focusCalls = 0;
  harness.focusApplication = async () => { focusCalls += 1; };
  controller.setActionPreferences("fast-unfocused", { focusBeforeAction: false });
  const action = new Fast(controller);
  const event = keyEvent("fast-unfocused");

  await action.onKeyDown(event as unknown as KeyDownEvent);
  await action.onKeyUp(event as unknown as KeyUpEvent);

  assert.equal(focusCalls, 0);
  assert.deepEqual(events, ["ACT06:down", "ACT06:up"]);
});

test("focus failure releases ownership and does not leave the physical input stuck", async () => {
  const events: string[] = [];
  const { controller, harness } = configuredController(events);
  let failedAlerts = 0;
  harness.focusApplication = async () => {
    events.push("focus:failed");
    throw new Error("E_FOCUS_FAILED");
  };
  controller.setActionPreferences("fast-failing", { focusBeforeAction: true });
  const failingAction = new Fast(controller);
  const failingEvent = keyEvent("fast-failing", () => { failedAlerts += 1; });

  await failingAction.onKeyDown(failingEvent as unknown as KeyDownEvent);
  await failingAction.onKeyUp(failingEvent as unknown as KeyUpEvent);
  assert.equal(failedAlerts, 1);

  controller.setActionPreferences("fast-probe", { focusBeforeAction: false });
  const probeAction = new Fast(controller);
  const probeEvent = keyEvent("fast-probe");
  await probeAction.onKeyDown(probeEvent as unknown as KeyDownEvent);
  await probeAction.onKeyUp(probeEvent as unknown as KeyUpEvent);

  assert.deepEqual(events, [
    "focus:failed",
    "ACT06:up",
    "ACT06:down",
    "ACT06:up",
  ]);
});
