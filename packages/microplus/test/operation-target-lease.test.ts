import assert from "node:assert/strict";
import test from "node:test";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";

test("a result operation cannot execute without its acquired target lease", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  let mutations = 0;
  await assert.rejects(
    bridge.withOperationTargetLease({ operationId: "missing" }, async () => { mutations += 1; }),
    /E_TARGET_STALE/,
  );
  assert.equal(mutations, 0);
});

test("an acquired target lease is released after either completion or rejection", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = { readyState: 1 };
  bridge.targetIdentity = "window-a";
  bridge.connectionEpoch = 7;
  for (const fails of [false, true]) {
    const operation = { operationId: `operation-${fails}`, targetIdentity: "window-a", connectionEpoch: 7 };
    bridge.leaseOperationTarget(operation);
    const result = bridge.withOperationTargetLease(operation, async () => {
      assert.equal(bridge.hasActiveTargetLease(), true);
      if (fails) throw new Error("test-operation-rejected");
      return 42;
    });
    if (fails) await assert.rejects(result, /test-operation-rejected/);
    else assert.equal(await result, 42);
    assert.equal(bridge.hasActiveTargetLease(), false);
  }
});
