import assert from "node:assert/strict";
import test from "node:test";
import { CodexMicroRendererBridge, OperationIntegrityGuard } from "../packages/microplus/src/codex-micro-renderer-bridge.js";
import type { OperationRequest } from "../packages/microplus/src/types.js";

type Pending = Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
type BridgeHarness = { pending: Pending; handleMessage(raw: string): void };

test("100 malformed plus 100 unknown CDP frames cannot consume a pending operation or retain body text", () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  let resolutions = 0;
  const timer = setTimeout(() => undefined, 60_000);
  bridge.pending.set(7, { resolve: () => { resolutions += 1; }, reject: () => undefined, timer });
  for (let index = 0; index < 100; index += 1) {
    bridge.handleMessage(`{malformed-${index}`);
    bridge.handleMessage(JSON.stringify({ id: 10_000 + index, payload: `secret-body-${index}` }));
  }
  assert.equal(resolutions, 0);
  assert.equal(bridge.pending.has(7), true);
  clearTimeout(timer);
});

test("a response ID is consumed once and duplicate frames are ignored", () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  let resolutions = 0;
  const timer = setTimeout(() => undefined, 60_000);
  bridge.pending.set(11, { resolve: () => { resolutions += 1; }, reject: () => undefined, timer });
  const frame = JSON.stringify({ id: 11, result: { result: { value: true } } });
  bridge.handleMessage(frame);
  bridge.handleMessage(frame);
  assert.equal(resolutions, 1);
  assert.equal(bridge.pending.size, 0);
});

test("100 unknown physical inputs are rejected before dispatch", () => {
  const guard = new OperationIntegrityGuard();
  let dispatches = 0;
  for (let index = 0; index < 100; index += 1) {
    const request: OperationRequest = {
      version: 1,
      requestId: `request-${index}`,
      operationId: `operation-${index}`,
      connectionEpoch: 1,
      pageEpoch: 1,
      physicalId: `UNKNOWN_${index}`,
      phase: "invoke",
      mappingFingerprint: "mapping-current",
      targetIdentity: "target-current",
    };
    assert.throws(() => {
      guard.accept(request, 1, 1);
      dispatches += 1;
    }, /E_UNKNOWN_PHYSICAL/u);
  }
  assert.equal(dispatches, 0);
});

test("100 duplicate operations and 100 out-of-order releases are rejected before dispatch", () => {
  const guard = new OperationIntegrityGuard();
  let dispatches = 0;
  const first: OperationRequest = {
    version: 1,
    requestId: "request-first",
    operationId: "operation-first",
    connectionEpoch: 1,
    pageEpoch: 1,
    physicalId: "ACT10",
    phase: "down",
    mappingFingerprint: "mapping-current",
    targetIdentity: "target-current",
  };
  guard.accept(first, 1, 1);
  for (let index = 0; index < 100; index += 1) {
    assert.throws(() => {
      guard.accept({ ...first, requestId: `duplicate-request-${index}` }, 1, 1);
      dispatches += 1;
    }, /E_DUPLICATE_OPERATION/u);
    assert.throws(() => {
      guard.accept({
        ...first,
        requestId: "request-first",
        operationId: `duplicate-request-operation-${index}`,
        physicalId: `ACT${String(6 + (index % 7)).padStart(2, "0")}`,
        phase: "invoke",
      }, 1, 1);
      dispatches += 1;
    }, /E_DUPLICATE_REQUEST/u);
    assert.throws(() => {
      guard.accept({
        ...first,
        requestId: `orphan-request-${index}`,
        operationId: `orphan-operation-${index}`,
        physicalId: "ACT11",
        phase: "up",
      }, 1, 1);
      dispatches += 1;
    }, /E_OUT_OF_ORDER_UP/u);
  }
  assert.equal(dispatches, 0);
});

test("invalid envelope fields and non-PTT safety releases fail closed", () => {
  const guard = new OperationIntegrityGuard();
  const valid: OperationRequest = {
    version: 1,
    requestId: "request-valid",
    operationId: "operation-valid",
    connectionEpoch: 1,
    pageEpoch: 1,
    physicalId: "ACT10",
    phase: "invoke",
    mappingFingerprint: "mapping-current",
    targetIdentity: "target-current",
  };
  assert.throws(() => guard.accept({ ...valid, version: 99 as 1 }, 1, 1), /E_UNSUPPORTED_ENVELOPE/u);
  assert.throws(() => guard.accept({ ...valid, requestId: "" }, 1, 1), /E_INVALID_REQUEST_ID/u);
  assert.throws(() => guard.accept({ ...valid, operationId: "" }, 1, 1), /E_INVALID_OPERATION_ID/u);
  assert.throws(() => guard.accept({ ...valid, phase: "bogus" as OperationRequest["phase"] }, 1, 1), /E_INVALID_PHASE/u);
  assert.throws(() => guard.accept({ ...valid, mappingFingerprint: "" }, 1, 1), /E_MAPPING_STALE/u);
  assert.throws(() => guard.accept({ ...valid, targetIdentity: "" }, 1, 1), /E_TARGET_STALE/u);
  assert.throws(() => guard.accept({ ...valid, physicalId: "ACT06", phase: "safety-up" }, 1, 1), /E_INVALID_SAFETY_RELEASE/u);
  assert.doesNotThrow(() => guard.accept({ ...valid, requestId: "release-request", operationId: "release-operation", phase: "safety-up" }, 1, 1));
});
