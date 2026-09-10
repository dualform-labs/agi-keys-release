import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot, OperationRequest } from "../src/types.js";

type PttSlot = "ACT10" | "ACT11";

type DispatchCall = {
  act: 0 | 1;
  operation?: OperationRequest;
  socket?: WebSocket;
};

type PttBridgeHarness = {
  endedRendererSessions: WeakSet<WebSocket>;
  operationGuard: { reset(): void };
  socket: WebSocket;
  connectionEpoch: number;
  pageEpoch: number;
  targetIdentity: string;
  lastSnapshot: MicroSnapshot;
  heldPttOperations: Map<PttSlot, { operation: OperationRequest; socket: WebSocket }>;
  attemptedPttReleases: Set<PttSlot>;
  refresh(): Promise<MicroSnapshot>;
  observeOperation(operation: OperationRequest): Promise<void>;
  dispatch(
    eventName: string,
    payload: { event: { act: 0 | 1 } },
    expectedEventName: string,
    operation?: OperationRequest,
    socket?: WebSocket,
    onBeforeCdpSubmit?: () => void,
  ): Promise<void>;
  beginOperation(): Promise<OperationRequest>;
  evaluateOnSocket<T>(socket: WebSocket, expression: string): Promise<T>;
  sendAction(slot: PttSlot, act: 0 | 1): Promise<void>;
  releaseAction(slot: PttSlot, options?: { onlyIfHeld?: boolean }): Promise<void>;
};

function snapshot(): MicroSnapshot {
  return {
    slots: [{ id: 0, threadKey: "thread-a", title: "A", status: "idle", selected: true }],
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
    layout: {
      version: 1,
      slots: { ACT10: { keycapId: "MIC" }, ACT11: { keycapId: "MIC1" } },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch: 7,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

function configuredBridge(calls: DispatchCall[]): PttBridgeHarness {
  const current = snapshot();
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as PttBridgeHarness;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.targetIdentity = current.targetIdentity;
  bridge.lastSnapshot = current;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.refresh = async () => current;
  bridge.observeOperation = async () => undefined;
  bridge.dispatch = async (_eventName, payload, _expectedEventName, operation, socket, onBeforeCdpSubmit) => {
    onBeforeCdpSubmit?.();
    calls.push({ act: payload.event.act, ...(operation ? { operation } : {}), ...(socket ? { socket } : {}) });
  };
  return bridge;
}

test("uncertain PTT down keeps its exact lease so rollback emits one up and never replays down", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  const originalSocket = bridge.socket;
  bridge.dispatch = async (_eventName, payload, _expectedEventName, operation, socket, onBeforeCdpSubmit) => {
    onBeforeCdpSubmit?.();
    calls.push({ act: payload.event.act, ...(operation ? { operation } : {}), ...(socket ? { socket } : {}) });
    if (payload.event.act === 1) throw new Error("E_CDP_RESPONSE_LOST_AFTER_RENDERER_DISPATCH");
  };

  await assert.rejects(bridge.sendAction("ACT10", 1), /E_CDP_RESPONSE_LOST_AFTER_RENDERER_DISPATCH/);
  const lease = bridge.heldPttOperations.get("ACT10");
  assert.ok(lease, "ambiguous down must keep release responsibility");
  assert.equal(lease.socket, originalSocket);
  assert.equal(lease.operation, calls[0]?.operation);

  await assert.rejects(bridge.sendAction("ACT10", 1), /E_DUPLICATE_DOWN/);
  await bridge.releaseAction("ACT10", { onlyIfHeld: true });

  assert.deepEqual(calls.map(({ act }) => act), [1, 0]);
  assert.equal(calls[1]?.socket, originalSocket);
  assert.equal(calls[1]?.operation?.targetIdentity, lease.operation.targetIdentity);
  assert.equal(calls[1]?.operation?.activeComposerKey, lease.operation.activeComposerKey);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
});

test("definite pre-dispatch PTT down failure leaves no lease and rollback emits no up", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  bridge.socket = { readyState: WebSocket.CLOSED, close: () => undefined } as unknown as WebSocket;

  await assert.rejects(bridge.sendAction("ACT10", 1), /E_RELEASE_TARGET_GONE/);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
  await bridge.releaseAction("ACT10", { onlyIfHeld: true });

  assert.deepEqual(calls, []);

  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  await bridge.sendAction("ACT10", 1);
  await bridge.releaseAction("ACT10");
  assert.deepEqual(calls.map(({ act }) => act), [1, 0], "known-unsent down must not poison the next physical cycle");
});

test("real dispatch rejects stale PTT down before CDP submission and leaves no rollback lease", async () => {
  const current = snapshot();
  let socketSendCount = 0;
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as PttBridgeHarness;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.targetIdentity = "target-b";
  bridge.lastSnapshot = current;
  bridge.socket = {
    readyState: WebSocket.OPEN,
    close: () => undefined,
    send: () => { socketSendCount += 1; },
  } as unknown as WebSocket;
  bridge.beginOperation = async () => ({
    version: 1,
    requestId: "request-stale-down",
    operationId: "operation-stale-down",
    connectionEpoch: current.connectionEpoch,
    pageEpoch: current.pageEpoch,
    physicalId: "ACT10",
    phase: "down",
    mappingFingerprint: current.mappingFingerprint,
    targetIdentity: current.targetIdentity,
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
  });

  await assert.rejects(bridge.sendAction("ACT10", 1), /E_TARGET_STALE/);
  assert.equal(socketSendCount, 0, "local identity rejection must happen before Runtime.evaluate is sent");
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
  await bridge.releaseAction("ACT10", { onlyIfHeld: true });
  assert.equal(socketSendCount, 0);
});

test("real renderer foreground preflight rejects PTT down without retaining a false hold", async () => {
  const current = snapshot();
  let evaluations = 0;
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as PttBridgeHarness;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.targetIdentity = current.targetIdentity;
  bridge.lastSnapshot = current;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.refresh = async () => current;
  bridge.observeOperation = async () => undefined;
  bridge.evaluateOnSocket = async <T>(_socket: WebSocket, expression: string) => {
    evaluations += 1;
    return await (0, eval)(expression) as T;
  };
  const environment = globalThis as unknown as { document?: unknown };
  const previousDocument = environment.document;
  environment.document = { hasFocus: () => false, visibilityState: "hidden" };
  try {
    await assert.rejects(bridge.sendAction("ACT10", 1), /E_FOREGROUND_TARGET_STALE/);
  } finally {
    if (previousDocument === undefined) delete environment.document;
    else environment.document = previousDocument;
  }

  assert.equal(evaluations, 1);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
  await bridge.releaseAction("ACT10", { onlyIfHeld: true });
  assert.equal(evaluations, 1, "rollback must not submit an up after a proven renderer preflight rejection");

  const subsequentCalls: DispatchCall[] = [];
  bridge.dispatch = async (_eventName, payload, _expectedEventName, operation, socket, onBeforeCdpSubmit) => {
    onBeforeCdpSubmit?.();
    subsequentCalls.push({ act: payload.event.act, ...(operation ? { operation } : {}), ...(socket ? { socket } : {}) });
  };
  await bridge.sendAction("ACT10", 1);
  await bridge.releaseAction("ACT10");
  assert.deepEqual(subsequentCalls.map(({ act }) => act), [1, 0]);
});

test("uncertain failed PTT up retains lease and attempt while duplicate cleanup only reports uncertainty", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  bridge.dispatch = async (_eventName, payload, _expectedEventName, operation, socket, onBeforeCdpSubmit) => {
    onBeforeCdpSubmit?.();
    calls.push({ act: payload.event.act, ...(operation ? { operation } : {}), ...(socket ? { socket } : {}) });
    if (payload.event.act === 0) throw new Error("E_CDP_RESPONSE_LOST_AFTER_RENDERER_RELEASE");
  };

  await bridge.sendAction("ACT11", 1);
  const lease = bridge.heldPttOperations.get("ACT11");
  assert.ok(lease);
  await assert.rejects(bridge.releaseAction("ACT11"), /E_CDP_RESPONSE_LOST_AFTER_RENDERER_RELEASE/);

  assert.equal(bridge.heldPttOperations.get("ACT11"), lease);
  assert.equal(bridge.attemptedPttReleases.has("ACT11"), true);
  await assert.rejects(
    bridge.releaseAction("ACT11", { onlyIfHeld: true }),
    /E_RELEASE_ALREADY_ATTEMPTED/,
  );
  await assert.rejects(bridge.releaseAction("ACT11"), /E_RELEASE_ALREADY_ATTEMPTED/);
  assert.deepEqual(calls.map(({ act }) => act), [1, 0]);
});

test("an observed renderer-session close retires an unreachable PTT lease but still reports release failure", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  await bridge.sendAction("ACT10", 1);
  const endedSocket = bridge.heldPttOperations.get("ACT10")?.socket;
  assert.ok(endedSocket);

  bridge.endedRendererSessions.add(endedSocket);
  bridge.operationGuard.reset(); // disconnect() resets the current-session guard on close.
  const next = snapshot();
  next.connectionEpoch += 1;
  next.targetIdentity = "target-b";
  next.mappingFingerprint = "mapping-b";
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.connectionEpoch = next.connectionEpoch;
  bridge.targetIdentity = next.targetIdentity;
  bridge.lastSnapshot = next;
  bridge.refresh = async () => next;

  await assert.rejects(bridge.releaseAction("ACT10"), /E_RELEASE_TARGET_GONE/);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
  assert.equal(bridge.attemptedPttReleases.has("ACT10"), false);
  await bridge.sendAction("ACT10", 1);
  await bridge.releaseAction("ACT10");
  assert.deepEqual(calls.map(({ act }) => act), [1, 1, 0]);
});

test("successful leased release retires the original guard so consecutive PTT cycles remain usable", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);

  await bridge.sendAction("ACT10", 1);
  await bridge.releaseAction("ACT10");
  await bridge.sendAction("ACT10", 1);
  await bridge.releaseAction("ACT10");

  assert.deepEqual(calls.map(({ act }) => act), [1, 0, 1, 0]);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
});
