import assert from "node:assert/strict";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent } from "@elgato/streamdeck";
import { KeycapMic, KeycapMicSingle } from "../src/actions.js";
import type { DeckController } from "../src/controller.js";
import { InputCoordinator } from "../src/input-coordination.js";

test("both semantic microphone keys use the active mapping and retain the pressed slot", async () => {
  let slot: "ACT10" | "ACT11" = "ACT10";
  const calls: string[] = [];
  const alerts: string[] = [];
  const inputs = new InputCoordinator();
  const controller = {
    resolveMicrophoneSlot: () => slot,
    pressMicroAction: async (ownerId: string, value: string) => inputs.press(ownerId, "microphone",
      async () => { calls.push(`down:${value}`); }, async () => { calls.push(`up:${value}`); }),
    releaseInput: async (ownerId: string) => inputs.release(ownerId)
  } as unknown as DeckController;
  const large = new KeycapMic(controller);
  const small = new KeycapMicSingle(controller);
  const event = (id: string) => ({ action: { id, showAlert: async () => { alerts.push(id); } } });
  await small.onKeyDown(event("small") as unknown as KeyDownEvent);
  slot = "ACT11";
  await large.onKeyDown(event("large") as unknown as KeyDownEvent);
  await large.onKeyUp(event("large") as unknown as KeyUpEvent);
  assert.deepEqual(calls, ["down:ACT10"]);
  assert.deepEqual(alerts, ["large"]);
  await small.onKeyUp(event("small") as unknown as KeyUpEvent);
  await large.onKeyDown(event("large") as unknown as KeyDownEvent);
  await large.onKeyUp(event("large") as unknown as KeyUpEvent);
  assert.deepEqual(calls, ["down:ACT10", "up:ACT10", "down:ACT11", "up:ACT11"]);
});

test("PTT release waits for the press dispatch and ignores duplicate key-up", async () => {
  const calls: string[] = [];
  const inputs = new InputCoordinator();
  let finishDown!: () => void;
  const down = new Promise<void>((resolve) => { finishDown = resolve; });
  const controller = {
    resolveMicrophoneSlot: () => "ACT10",
    pressMicroAction: async (ownerId: string) => inputs.press(ownerId, "ACT10",
      async () => { calls.push("down"); await down; }, async () => { calls.push("up"); }),
    releaseInput: async (ownerId: string) => inputs.release(ownerId)
  } as unknown as DeckController;
  const key = new KeycapMicSingle(controller);
  const event = { action: { id: "small", showAlert: async () => assert.fail("unexpected alert") } };
  const pressed = key.onKeyDown(event as unknown as KeyDownEvent);
  const released = key.onKeyUp(event as unknown as KeyUpEvent);
  const duplicateRelease = key.onKeyUp(event as unknown as KeyUpEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["down"]);
  finishDown();
  await Promise.all([pressed, released, duplicateRelease]);
  assert.deepEqual(calls, ["down", "up"]);
});
