import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { CodexMicroRendererBridge, CURRENT_APP_INITIAL_SHA256 } from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot } from "../src/types.js";

function snapshot(overrides: Partial<MicroSnapshot> = {}): MicroSnapshot {
  return {
    slots: [],
    activeThreadKey: "local:11111111-1111-4111-8111-111111111111",
    activeComposerKey: "composer-1",
    activeContextUsedPercent: 82,
    activeContextRevision: 100,
    hostSessions: [{
      threadId: "11111111-1111-4111-8111-111111111111",
      activityAt: 1,
      status: "idle",
      contextUsedPercent: 82,
    }],
    layout: { version: 1, slots: {}, analogStick: {} as MicroSnapshot["layout"]["analogStick"] },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 4,
    pageEpoch: 2,
    mappingFingerprint: "map",
    targetIdentity: "target",
    ...overrides,
  };
}

test("context compaction uses the pinned native manager and confirms a newer lower context reading", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.lastSnapshot = snapshot();
  bridge.socket = { readyState: WebSocket.OPEN };
  bridge.targetIdentity = "target";
  bridge.connectionEpoch = 4;
  bridge.pageEpoch = 2;
  let expression = "";
  bridge.evaluateOnSocket = async (_socket: unknown, source: string, timeoutMs: number) => {
    expression = source;
    assert.equal(timeoutMs, 30_000);
    const operationId = /return ("[0-9a-f-]+");\s*\}\)\(\)$/u.exec(source)?.[1];
    assert.ok(operationId);
    return JSON.parse(operationId);
  };
  bridge.refresh = async (forceActiveContext: boolean) => {
    return forceActiveContext
      ? snapshot({ activeContextUsedPercent: 31, activeContextRevision: 200 })
      : snapshot();
  };
  bridge.log = () => undefined;

  const result = await bridge.compactActiveThread();

  assert.equal(result.semanticOutcome, "confirmed");
  assert.equal(result.observedSnapshot?.activeContextUsedPercent, 31);
  assert.match(expression, /assertMutationForeground\(document\)/);
  assert.match(expression, /composerController\.getPersistedText\(\)\.length !== 0/);
  assert.match(expression, /appInitial\.Q3t\(scope, managerBinding\)/);
  assert.match(expression, /manager\.compactThread\(rawConversationId\)/);
  assert.ok(expression.includes(CURRENT_APP_INITIAL_SHA256));
  const begin = expression.indexOf("      const scope = selectScope(");
  const end = expression.indexOf("      assertMutationForeground(document);", begin);
  assert.ok(begin >= 0 && end > begin);
  const calls: unknown[] = [];
  const manager = { compactThread() {} };
  const binding = Symbol("current-host-selector");
  const scope = { get(selector: unknown, id: unknown) { calls.push([selector, id]); return "local"; } };
  const initial = { e6t: Symbol("scope"), mqt: Symbol("access"), hU: Symbol("capability"), gOt: binding,
    Q3t(selected: unknown, host: unknown) { assert.equal(selected, scope); assert.equal(host, "local"); return manager; } };
  const resolve = Function("selectScope", "document", "active", "appInitial", "rawConversationId", expression.slice(begin, end) + "return manager;");
  assert.equal(resolve((_doc: unknown, _root: unknown, atom: unknown, access: unknown, capability: unknown) => {
    assert.equal(atom, initial.e6t); assert.equal(access, initial.mqt); assert.equal(capability, initial.hU); return scope;
  }, {}, { root: {} }, initial, "test-task"), manager);
  assert.deepEqual(calls, [[binding, "test-task"]]);

  assert.match(expression, /expectedThreadKey !== 'local:' \+ rawConversationId/);
  assert.match(expression, /afterRawConversationId !== rawConversationId/);
});

test("context compaction never confirms context changes observed after the active task switches", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.lastSnapshot = snapshot();
  const pinnedSocket = { readyState: WebSocket.OPEN };
  bridge.socket = pinnedSocket;
  bridge.targetIdentity = "target";
  bridge.connectionEpoch = 4;
  bridge.pageEpoch = 2;
  let dispatches = 0;
  bridge.evaluateOnSocket = async (_socket: unknown, source: string) => {
    dispatches += 1;
    const encodedOperationId = /return ("[0-9a-f-]+");\s*\}\)\(\)$/u.exec(source)?.[1];
    assert.ok(encodedOperationId);
    return JSON.parse(encodedOperationId);
  };
  let refreshes = 0;
  bridge.refresh = async () => {
    refreshes += 1;
    return refreshes === 1
      ? snapshot()
      : snapshot({
          activeThreadKey: "local:22222222-2222-4222-8222-222222222222",
          activeComposerKey: "composer-2",
          activeContextUsedPercent: 24,
          activeContextRevision: 200,
        });
  };
  bridge.log = () => undefined;

  await assert.rejects(() => bridge.compactActiveThread(), /E_ACTIVE_THREAD_STALE/);
  assert.equal(dispatches, 1, "a target switch must not retry native compaction");
  assert.equal(bridge.socket, pinnedSocket);
});

test("context compaction rejects a working active task before native dispatch", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.lastSnapshot = snapshot({
    hostSessions: [{
      threadId: "11111111-1111-4111-8111-111111111111",
      activityAt: 1,
      status: "working",
      contextUsedPercent: 82,
    }],
  });
  bridge.socket = { readyState: WebSocket.OPEN };
  bridge.targetIdentity = "target";
  bridge.connectionEpoch = 4;
  bridge.pageEpoch = 2;
  bridge.refresh = async () => bridge.lastSnapshot;
  let dispatched = false;
  bridge.evaluateOnSocket = async () => {
    dispatched = true;
    return "operation";
  };

  await assert.rejects(() => bridge.compactActiveThread(), /E_CONTEXT_COMPACTION_BUSY/);
  assert.equal(dispatched, false);
});

function snapshotWithout(field: "activeContextUsedPercent" | "activeContextRevision"): MicroSnapshot {
  const value = snapshot();
  delete value[field];
  return value;
}

const unavailablePreconditions: Array<[string, () => MicroSnapshot]> = [
  ["missing active host session", () => snapshot({ hostSessions: [] })],
  ["unknown active host session status", () => snapshot({
    hostSessions: [{
      threadId: "11111111-1111-4111-8111-111111111111",
      activityAt: 1,
      status: "complete",
      contextUsedPercent: 82,
    }],
  })],
  ["ambiguous duplicate active host sessions", () => snapshot({
    hostSessions: [
      {
        threadId: "11111111-1111-4111-8111-111111111111",
        activityAt: 1,
        status: "idle",
        contextUsedPercent: 82,
      },
      {
        threadId: "11111111-1111-4111-8111-111111111111",
        activityAt: 2,
        status: "idle",
        contextUsedPercent: 82,
      },
    ],
  })],
  ["missing active context percent", () => snapshotWithout("activeContextUsedPercent")],
  ["missing active context revision", () => snapshotWithout("activeContextRevision")],
];

for (const [name, createSnapshot] of unavailablePreconditions) {
  test(`context compaction rejects ${name} before native dispatch`, async () => {
    const bridge = new CodexMicroRendererBridge(() => undefined) as any;
    bridge.lastSnapshot = createSnapshot();
    bridge.socket = { readyState: WebSocket.OPEN };
    bridge.targetIdentity = "target";
    bridge.connectionEpoch = 4;
    bridge.pageEpoch = 2;
    bridge.refresh = async () => bridge.lastSnapshot;
    let dispatched = false;
    bridge.evaluateOnSocket = async () => {
      dispatched = true;
      return "operation";
    };

    await assert.rejects(() => bridge.compactActiveThread(), /E_CONTEXT_COMPACTION_UNAVAILABLE/);
    assert.equal(dispatched, false);
  });
}
