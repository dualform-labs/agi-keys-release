import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot } from "../src/types.js";

function snapshot(activeThreadKey: string): MicroSnapshot {
  return { slots: [], activeThreadKey, layout: { version: 1, slots: {}, analogStick: { up: null, right: null, down: null, left: null } },
    agentSource: "recent", lightingAutoOff: "never", theme: "dark", connectionEpoch: 0, pageEpoch: 0,
    mappingFingerprint: "", targetIdentity: "window" };
}

test("slower older bridge refresh cannot replace a newer slot baseline", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = { readyState: 1 };
  bridge.targetIdentity = "window";
  bridge.ensureObservationTarget = async () => undefined;
  bridge.sessionOwnership = { annotate: async (value: MicroSnapshot) => value, getActiveThreadContextUsage: () => undefined };
  const pending: Array<(value: MicroSnapshot) => void> = [];
  bridge.evaluate = () => new Promise<MicroSnapshot>(resolve => pending.push(resolve));
  const older = bridge.refresh();
  await setImmediate();
  const newer = bridge.refresh();
  await setImmediate();
  assert.equal(pending.length, 2, "refreshes should remain concurrent");
  pending[1]!(snapshot("local:newer"));
  await newer;
  pending[0]!(snapshot("local:older"));
  await older;
  assert.equal(bridge.lastSnapshot.activeThreadKey, "local:newer");
  const next = bridge.refresh();
  await setImmediate();
  pending[2]!(snapshot("local:next"));
  await next;
  assert.equal(bridge.lastSnapshot.activeThreadKey, "local:next");
});
