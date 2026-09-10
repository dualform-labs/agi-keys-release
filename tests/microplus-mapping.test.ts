import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";
import {
  Act11,
  Approve,
  Back,
  Decline,
  Dictation,
  Fast,
  Fork,
  Forward,
  Plan,
  Send,
  Sidebar,
} from "../packages/microplus/src/actions.js";
import { assertFreshOperationTarget, resolveAgentDispatch } from "../packages/microplus/src/codex-micro-renderer-bridge.js";
import type { DeckController } from "../packages/microplus/src/controller.js";
import type { MicroSnapshot } from "../packages/microplus/src/types.js";

test("physical ACT and direction actions map to the production physical IDs", async () => {
  const source = await readFile(new URL("../packages/microplus/src/actions.ts", import.meta.url), "utf8");
  for (const [actionClass, physicalId] of [
    ["Fast", "ACT06"], ["Approve", "ACT07"], ["Decline", "ACT08"], ["Fork", "ACT09"],
    ["Dictation", "ACT10"], ["Act11", "ACT11"], ["Send", "ACT12"],
  ]) {
    assert.match(source, new RegExp(`class ${actionClass}[^\\n]+super\\(c, "${physicalId}"\\)`));
  }
  for (const [actionClass, direction] of [["Plan", "up"], ["Forward", "right"], ["Sidebar", "down"], ["Back", "left"]]) {
    assert.match(source, new RegExp(`class ${actionClass}[^\\n]+super\\(c, "${direction}"`));
  }
});

test("production action wrappers dispatch exact physical down and up calls", async () => {
  const calls: string[] = [];
  const controller = {
    pressMicroAction: async (ownerId: string, physicalId: string) => {
      calls.push(`micro:down:${ownerId}:${physicalId}`);
    },
    pressJoystick: async (ownerId: string, direction: string) => {
      calls.push(`joystick:down:${ownerId}:${direction}`);
    },
    releaseInput: async (ownerId: string) => {
      calls.push(`release:up:${ownerId}`);
    },
  } as unknown as DeckController;

  const microActions = [
    [Fast, "ACT06"],
    [Approve, "ACT07"],
    [Decline, "ACT08"],
    [Fork, "ACT09"],
    [Dictation, "ACT10"],
    [Act11, "ACT11"],
    [Send, "ACT12"],
  ] as const;
  const joystickActions = [
    [Plan, "up"],
    [Forward, "right"],
    [Sidebar, "down"],
    [Back, "left"],
  ] as const;
  const expected: string[] = [];

  for (const [Action, physicalId] of microActions) {
    const ownerId = `micro-${physicalId}`;
    const event = keyEvent(ownerId);
    const action = new Action(controller);
    await action.onKeyDown(event as unknown as KeyDownEvent);
    await action.onKeyUp(event as unknown as KeyUpEvent);
    expected.push(`micro:down:${ownerId}:${physicalId}`, `release:up:${ownerId}`);
  }
  for (const [Action, direction] of joystickActions) {
    const ownerId = `joystick-${direction}`;
    const event = keyEvent(ownerId);
    const action = new Action(controller);
    await action.onKeyDown(event as unknown as KeyDownEvent);
    await action.onKeyUp(event as unknown as KeyUpEvent);
    expected.push(`joystick:down:${ownerId}:${direction}`, `release:up:${ownerId}`);
  }

  assert.deepEqual(calls, expected);
});

test("changed readback identity is rejected before adapter dispatch", () => {
  let dispatches = 0;
  const snapshot = makeSnapshot(["replacement", "expected", null, null, null, null]);
  assert.throws(() => {
    const plan = resolveAgentDispatch(snapshot, 0, "expected");
    dispatches += 1;
    return plan;
  }, /changed before dispatch/u);
  assert.equal(dispatches, 0);
});

test("changed native mapping fingerprint is rejected before mutation", () => {
  const expected = makeSnapshot(["expected", null, null, null, null, null]);
  const changed = { ...expected, mappingFingerprint: "mapping-changed" };
  assert.throws(() => assertFreshOperationTarget(expected, changed), /E_MAPPING_STALE/u);
});

function makeSnapshot(threadKeys: Array<string | null>): MicroSnapshot {
  return {
    slots: threadKeys.map((threadKey, id) => ({ id, threadKey, title: threadKey, status: "idle", selected: id === 0 })),
    layout: {
      version: 1,
      slots: Object.fromEntries(["ACT06", "ACT07", "ACT08", "ACT09", "ACT10", "ACT11", "ACT12"].map((id) => [id, { keycapId: id }])) as MicroSnapshot["layout"]["slots"],
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-current",
    targetIdentity: "target-current",
  };
}

function keyEvent(id: string): { action: {
  id: string;
  isKey: () => boolean;
  isDial: () => boolean;
  showAlert: () => Promise<void>;
  showOk: () => Promise<void>;
  setImage: (image?: string) => Promise<void>;
  setTitle: (title?: string) => Promise<void>;
} } {
  return {
    action: {
      id,
      isKey: () => true,
      isDial: () => false,
      showAlert: async () => undefined,
      showOk: async () => undefined,
      setImage: async () => undefined,
      setTitle: async () => undefined,
    },
  };
}
