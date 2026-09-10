import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexMicroRendererBridge,
  assertOperationTargetIdentity,
} from "../src/codex-micro-renderer-bridge.js";
import {
  buildRuntimeOverrideExpression,
  buildRuntimeVerificationExpression,
  runtimeTargetSetSignature,
  selectRuntimeTarget,
} from "../launcher/runtime-override.js";
import type { OperationRequest } from "../src/types.js";

const operation: OperationRequest = {
  version: 1,
  requestId: "request-1",
  operationId: "operation-1",
  connectionEpoch: 7,
  pageEpoch: 2,
  physicalId: "ACT10",
  phase: "down",
  mappingFingerprint: "mapping",
  targetIdentity: "window-a",
};

test("launcher target selection and target-set signatures remain deterministic across window ordering", () => {
  const first = { id: "first", type: "page", url: "app://codex/index.html?window=1", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/first" };
  const second = { id: "second", type: "page", url: "app://codex/index.html?window=2", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/second" };
  const auxiliary = { id: "overlay", type: "page", url: "app://codex/avatar-overlay", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/overlay" };

  assert.equal(selectRuntimeTarget([first]), first);
  assert.equal(selectRuntimeTarget([first, second]), undefined);
  assert.equal(runtimeTargetSetSignature([first, auxiliary, second]), runtimeTargetSetSignature([second, first]));
});

test("launcher mutation and verification expressions reject a background renderer before reading runtime state", () => {
  for (const expression of [buildRuntimeOverrideExpression(), buildRuntimeVerificationExpression()]) {
    assert.match(expression, /document\.hasFocus\(\)/);
    assert.match(expression, /document\.visibilityState !== 'visible'/);
    assert.ok(expression.indexOf("document.hasFocus()") < expression.indexOf("globalThis.__STATSIG__"));
  }
});

test("operation target identity binds every dispatch to the connection that created it", () => {
  assert.doesNotThrow(() => assertOperationTargetIdentity(operation, "window-a", 7));
  assert.throws(() => assertOperationTargetIdentity(operation, "window-b", 7), /E_TARGET_STALE/);
  assert.throws(() => assertOperationTargetIdentity(operation, "window-a", 8), /E_TARGET_STALE/);
});

test("a held PTT release survives a renderer rebind and dispatches exactly once on its leased socket", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  let leasedCloseCalls = 0;
  const leasedSocket = {
    readyState: 1,
    close() {
      leasedCloseCalls += 1;
      this.readyState = 3;
    },
  };
  let foregroundCloseCalls = 0;
  const foregroundSocket = {
    readyState: 1,
    close() {
      foregroundCloseCalls += 1;
      this.readyState = 3;
    },
  };

  bridge.socket = leasedSocket;
  bridge.heldPttOperations.set("ACT10", { operation, socket: leasedSocket });
  bridge.disconnect();
  bridge.socket = foregroundSocket;
  bridge.connectionEpoch = 8;
  bridge.targetIdentity = "window-b";

  const evaluatedSockets: unknown[] = [];
  const expressions: string[] = [];
  bridge.evaluateOnSocket = async (socket: unknown, expression: string) => {
    evaluatedSockets.push(socket);
    expressions.push(expression);
    return /"operationId":"([^"]+)"/u.exec(expression)?.[1] ?? null;
  };

  await bridge.releaseAction("ACT10");

  assert.deepEqual(evaluatedSockets, [leasedSocket]);
  assert.match(expressions[0] ?? "", /"act":0/u);
  assert.match(expressions[0] ?? "", /"connectionEpoch":7/u);
  assert.match(expressions[0] ?? "", /"targetIdentity":"window-a"/u);
  assert.equal(bridge.heldPttOperations.has("ACT10"), false);
  assert.equal(leasedCloseCalls, 1);
  assert.equal(foregroundCloseCalls, 0);

  await assert.rejects(() => bridge.releaseAction("ACT10"), /E_RELEASE_ALREADY_ATTEMPTED/);
  assert.deepEqual(evaluatedSockets, [leasedSocket]);
});
