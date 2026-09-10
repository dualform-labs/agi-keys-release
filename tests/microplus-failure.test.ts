import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";
import WebSocket from "ws";
import type { KeyDownEvent, KeyUpEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { Dictation } from "../packages/microplus/src/actions.js";
import { CodexMicroRendererBridge } from "../packages/microplus/src/codex-micro-renderer-bridge.js";
import type { DeckController } from "../packages/microplus/src/controller.js";
import { InputCoordinator } from "../packages/microplus/src/input-coordination.js";
import type { MicroSnapshot } from "../packages/microplus/src/types.js";

type Pending = Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
type BridgeHarness = {
  socket: { readyState: number; send(value: string): void; close(): void } | undefined;
  pending: Pending;
  evaluate(expression: string): Promise<unknown>;
  disconnect(): void;
};

test("observer timeout never reports success or replays the pending mutation", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let sends = 0;
    const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
    bridge.socket = { readyState: WebSocket.OPEN, send: () => { sends += 1; }, close: () => undefined };
    const pending = bridge.evaluate("true");
    assert.equal(sends, 1);
    mock.timers.tick(5_001);
    await assert.rejects(pending, /E_RENDERER_EVALUATION_TIMEOUT/u);
    assert.equal(sends, 1);
    assert.equal(bridge.pending.size, 0);
  } finally {
    mock.timers.reset();
  }
});

test("disconnect rejects every pending operation once and clears replay state", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  const errors: Error[] = [];
  const timers = [setTimeout(() => undefined, 60_000), setTimeout(() => undefined, 60_000)];
  timers.forEach((timer, index) => bridge.pending.set(index + 1, {
    resolve: () => assert.fail("disconnect must not resolve a pending operation"),
    reject: (error) => errors.push(error),
    timer,
  }));
  bridge.disconnect();
  bridge.disconnect();
  assert.equal(errors.length, 2);
  assert.equal(errors.every((error) => /E_BRIDGE_DISCONNECTED/u.test(error.message)), true);
  assert.equal(bridge.pending.size, 0);
});

test("page disappearance invalidates the stale snapshot baseline", () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    lastSnapshot: MicroSnapshot | undefined;
    pageEpoch: number;
    advancePageEpoch(): void;
  };
  bridge.lastSnapshot = {} as MicroSnapshot;
  bridge.pageEpoch = 4;
  bridge.advancePageEpoch();
  assert.equal(bridge.pageEpoch, 5);
  assert.equal(bridge.lastSnapshot, undefined);
});

test("PTT disappearance attempts one release and never replays it", async () => {
  const events: Array<0 | 1> = [];
  const inputs = new InputCoordinator();
  const controller = {
    pressMicroAction: async (ownerId: string) => inputs.press(ownerId, "microphone",
      async () => { events.push(1); }, async () => { events.push(0); }),
    releaseInput: async (ownerId: string) => inputs.release(ownerId),
    unregisterMicroAction: () => undefined,
  } as unknown as DeckController;
  const action = { id: "ptt", isKey: () => true, showAlert: async () => undefined };
  const dictation = new Dictation(controller);
  await dictation.onKeyDown({ action } as unknown as KeyDownEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await dictation.onKeyUp({ action } as unknown as KeyUpEvent);
  assert.deepEqual(events, [1, 0]);
});

test("PTT observer failure still retains exactly one release obligation", async () => {
  const events: Array<0 | 1> = [];
  const inputs = new InputCoordinator();
  const controller = {
    pressMicroAction: async (ownerId: string) => inputs.press(ownerId, "microphone", async () => {
      events.push(1);
      throw new Error("observer failed after dispatch");
    }, async () => { events.push(0); }),
    releaseInput: async (ownerId: string) => inputs.release(ownerId),
    unregisterMicroAction: () => undefined,
  } as unknown as DeckController;
  const action = { id: "ptt-uncertain", isKey: () => true, showAlert: async () => undefined };
  const dictation = new Dictation(controller);
  await dictation.onKeyDown({ action } as unknown as KeyDownEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await dictation.onKeyUp({ action } as unknown as KeyUpEvent);
  assert.deepEqual(events, [1, 0]);
});
