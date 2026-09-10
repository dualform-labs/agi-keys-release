import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { safeActionFailureCode } from "../src/action-feedback.js";
import { bridgeFailureCode } from "../src/bridge-error.js";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import { safeDialFailureCode } from "../src/controller.js";

type BridgeInternals = {
  socket?: WebSocket;
  pending: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    socket: WebSocket;
  }>;
  evaluate<T>(expression: string): Promise<T>;
  evaluateOnSocket<T>(socket: WebSocket, expression: string, timeoutMs?: number): Promise<T>;
  disconnect(expected?: WebSocket): void;
};

function assertClassifiers(error: unknown, expected: string): boolean {
  assert.equal(bridgeFailureCode(error), expected, "bridge log classifier");
  assert.equal(safeActionFailureCode(error), expected, "action feedback classifier");
  assert.equal(safeDialFailureCode(error), expected, "dial feedback classifier");
  return true;
}

test("transport boundary codes survive the bridge, action, and dial classifiers", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeInternals;

  await assert.rejects(
    bridge.evaluate("void 0"),
    (error: unknown) => assertClassifiers(error, "E_BRIDGE_DISCONNECTED"),
  );

  const openSocket = {
    readyState: WebSocket.OPEN,
    send: () => undefined,
    close: () => undefined,
  } as unknown as WebSocket;
  await assert.rejects(
    bridge.evaluateOnSocket(openSocket, "void 0", 5),
    (error: unknown) => assertClassifiers(error, "E_RENDERER_EVALUATION_TIMEOUT"),
  );

  const closedSocket = {
    readyState: WebSocket.CLOSED,
    close: () => undefined,
  } as unknown as WebSocket;
  let rejectPending!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
  const timer = setTimeout(() => undefined, 1_000);
  bridge.socket = closedSocket;
  bridge.pending = new Map([[1, {
    resolve: () => undefined,
    reject: rejectPending,
    timer,
    socket: closedSocket,
  }]]);
  bridge.disconnect();
  await assert.rejects(
    pending,
    (error: unknown) => assertClassifiers(error, "E_BRIDGE_DISCONNECTED"),
  );
});

test("transport classifier keeps old generic exception text redacted", () => {
  for (const message of [
    "Zeitüberschreitung beim Verbinden mit Codex.",
    "Codex-Runtime-Antwort hat zu lange gedauert.",
    "Codex-Micro-Brücke wurde getrennt.",
  ]) {
    const error = new Error(message);
    assert.equal(bridgeFailureCode(error), "unavailable");
    assert.equal(safeActionFailureCode(error), "E_ACTION_UNKNOWN");
    assert.equal(safeDialFailureCode(error), "E_DIAL_UNKNOWN");
  }
});
