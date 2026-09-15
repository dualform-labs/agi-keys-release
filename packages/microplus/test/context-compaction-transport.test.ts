import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot } from "../src/types.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_THREAD_KEY = `local:${SESSION_ID}`;
const SWITCHED_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SWITCHED_THREAD_KEY = `local:${SWITCHED_SESSION_ID}`;

type RuntimeEvaluateRequest = {
  id: number;
  method: string;
  params?: {
    expression?: string;
    awaitPromise?: boolean;
    returnByValue?: boolean;
  };
};

type ContextState = {
  usedPercent: number;
  revision: number;
};

type BridgeInternals = {
  socket: WebSocket | undefined;
  connectionEpoch: number;
  pageEpoch: number;
  targetIdentity: string;
  sessionOwnership: {
    annotate(snapshot: MicroSnapshot): Promise<MicroSnapshot>;
    getActiveThreadContextUsage(snapshot: Pick<MicroSnapshot, "activeThreadKey">): {
      threadKey: string;
      sessionId: string;
      contextUsedPercent: number;
      contextRevision: number;
    } | null;
    refreshActiveThreadContextUsage(snapshot: Pick<MicroSnapshot, "activeThreadKey">): Promise<{
      threadKey: string;
      sessionId: string;
      contextUsedPercent: number;
      contextRevision: number;
    } | null>;
  };
  handleMessage(raw: string): void;
};

function nativeSnapshot(activeThreadKey = ACTIVE_THREAD_KEY, activeComposerKey = "composer-1"): MicroSnapshot {
  return {
    slots: [],
    activeThreadKey,
    activeComposerKey,
    layout: { version: 1, slots: {}, analogStick: {} as MicroSnapshot["layout"]["analogStick"] },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 0,
    pageEpoch: 0,
    mappingFingerprint: "",
    targetIdentity: "",
  };
}

function operationIdFrom(expression: string): string {
  const encoded = [...expression.matchAll(/return ("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");/giu)].at(-1)?.[1];
  assert.ok(encoded, "the native manager result must return the bridge operation id");
  return JSON.parse(encoded) as string;
}

async function openHarness(changesContext: boolean, switchesActiveTask = false) {
  const state: ContextState = { usedPercent: 82, revision: 100 };
  const activeTarget = { threadKey: ACTIVE_THREAD_KEY, composerKey: "composer-1" };
  const evaluations: RuntimeEvaluateRequest[] = [];
  const mutations: Array<{ call: number; before: ContextState; after: ContextState }> = [];
  let managerCalls = 0;

  const manager = {
    async compactThread(rawConversationId: string): Promise<void> {
      assert.equal(rawConversationId, SESSION_ID);
      managerCalls += 1;
      const before = { ...state };
      if (changesContext) {
        state.usedPercent = 31;
        state.revision = 200;
      }
      if (switchesActiveTask) {
        activeTarget.threadKey = SWITCHED_THREAD_KEY;
        activeTarget.composerKey = "composer-2";
      }
      mutations.push({ call: managerCalls, before, after: { ...state } });
    },
  };

  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;

  server.on("connection", (peer) => {
    peer.on("message", async (raw) => {
      const request = JSON.parse(String(raw)) as RuntimeEvaluateRequest;
      evaluations.push(request);
      assert.equal(request.method, "Runtime.evaluate");
      assert.equal(request.params?.awaitPromise, true);
      assert.equal(request.params?.returnByValue, true);
      const expression = request.params?.expression ?? "";

      let value: unknown;
      if (expression.includes("({hasFocus:document.hasFocus(),visibilityState:document.visibilityState})")) {
        value = { hasFocus: true, visibilityState: "visible" };
      } else if (expression.includes("Codex Micro slot resolver was not found.")) {
        value = nativeSnapshot(activeTarget.threadKey, activeTarget.composerKey);
      } else if (expression.includes("manager.compactThread(rawConversationId)")) {
        assert.ok(expression.includes(`const expectedThreadKey = ${JSON.stringify(ACTIVE_THREAD_KEY)};`));
        assert.match(expression, /const expectedComposerKey = "composer-1"/u);
        assert.match(expression, /expectedThreadKey !== 'local:' \+ rawConversationId/u);
        await manager.compactThread(SESSION_ID);
        value = operationIdFrom(expression);
      } else {
        assert.fail(`unexpected Runtime.evaluate expression: ${expression.slice(0, 160)}`);
      }

      peer.send(JSON.stringify({ id: request.id, result: { result: { value } } }));
    });
  });

  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const bridge = new CodexMicroRendererBridge(() => undefined);
  const internals = bridge as unknown as BridgeInternals;
  internals.socket = socket;
  internals.connectionEpoch = 4;
  internals.pageEpoch = 2;
  internals.targetIdentity = "transport-target";
  internals.sessionOwnership = {
    async annotate(snapshot) {
      return {
        ...snapshot,
        hostSessions: [{
          threadId: activeTarget.threadKey.slice("local:".length),
          activityAt: 1,
          status: "idle",
          contextUsedPercent: state.usedPercent,
        }],
      };
    },
    getActiveThreadContextUsage(snapshot) {
      return snapshot.activeThreadKey === activeTarget.threadKey
        ? {
            threadKey: activeTarget.threadKey,
            sessionId: activeTarget.threadKey.slice("local:".length),
            contextUsedPercent: state.usedPercent,
            contextRevision: state.revision,
          }
        : null;
    },
    async refreshActiveThreadContextUsage(snapshot) {
      return this.getActiveThreadContextUsage(snapshot);
    },
  };
  socket.on("message", (raw) => internals.handleMessage(String(raw)));

  const close = async () => {
    bridge.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    bridge,
    close,
    evaluations,
    managerCalls: () => managerCalls,
    mutations,
    state,
  };
}

test("context compaction crosses the real CDP transport and confirms only after native state changes", async (t) => {
  const harness = await openHarness(true);
  t.after(harness.close);

  const first = await harness.bridge.refresh(true);
  const second = await harness.bridge.refresh(true);
  assert.equal(harness.managerCalls(), 0);
  assert.deepEqual(
    [first.activeContextRevision, first.activeContextUsedPercent],
    [second.activeContextRevision, second.activeContextUsedPercent],
    "ordinary transport reads must not mutate active context state",
  );

  const result = await harness.bridge.compactActiveThread();

  assert.equal(result.semanticOutcome, "confirmed");
  assert.equal(harness.managerCalls(), 1);
  assert.deepEqual(harness.mutations, [{
    call: 1,
    before: { usedPercent: 82, revision: 100 },
    after: { usedPercent: 31, revision: 200 },
  }]);
  assert.deepEqual(
    [result.observedSnapshot?.activeContextRevision, result.observedSnapshot?.activeContextUsedPercent],
    [200, 31],
  );

  const compactionFrame = harness.evaluations.find((request) =>
    request.params?.expression?.includes("manager.compactThread(rawConversationId)"));
  assert.ok(compactionFrame, "the bridge must send native compaction through Runtime.evaluate");
  assert.equal(compactionFrame.params?.awaitPromise, true);
  assert.equal(compactionFrame.params?.returnByValue, true);
  assert.match(compactionFrame.params?.expression ?? "", /appInitial\.Q3t\(scope, managerBinding\)/u);
  assert.match(compactionFrame.params?.expression ?? "", /await manager\.compactThread\(rawConversationId\)/u);
});

test("an acknowledged native no-op stays unverified and is not retried", async (t) => {
  const harness = await openHarness(false);
  t.after(harness.close);
  await harness.bridge.refresh(true);

  const originalNow = Date.now;
  let reads = 0;
  Date.now = () => (reads++ < 2 ? 0 : 8_001);
  try {
    const result = await harness.bridge.compactActiveThread();
    assert.equal(result.semanticOutcome, "unverified");
    assert.deepEqual(
      [result.observedSnapshot?.activeContextRevision, result.observedSnapshot?.activeContextUsedPercent],
      [100, 82],
    );
  } finally {
    Date.now = originalNow;
  }

  assert.equal(harness.managerCalls(), 1, "observer polling must not retry the native mutation");
  assert.deepEqual(harness.mutations, [{
    call: 1,
    before: { usedPercent: 82, revision: 100 },
    after: { usedPercent: 82, revision: 100 },
  }]);
});

test("a CDP-observed A-to-B task switch cannot confirm A's compaction from B's lower context", async (t) => {
  const harness = await openHarness(true, true);
  t.after(harness.close);
  await harness.bridge.refresh(true);

  await assert.rejects(() => harness.bridge.compactActiveThread(), /E_ACTIVE_THREAD_STALE/);

  assert.equal(harness.managerCalls(), 1, "the rejected confirmation must never retry compaction");
  assert.deepEqual(harness.mutations, [{
    call: 1,
    before: { usedPercent: 82, revision: 100 },
    after: { usedPercent: 31, revision: 200 },
  }]);
});
