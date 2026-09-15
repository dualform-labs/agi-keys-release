import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { codexDebugTargetKey } from "../src/codex-debug-discovery.js";
import {
  assertFocusedVisibleRendererForMutation,
  CodexMicroRendererBridge,
  selectBridgeObservationTarget,
  selectUniqueComposerMutationTarget,
} from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot } from "../src/types.js";

function snapshot(): MicroSnapshot {
  return {
    slots: [],
    layout: { version: 1, slots: {}, analogStick: { up: null, right: null, down: null, left: null } },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 0,
    pageEpoch: 0,
    mappingFingerprint: "old",
    targetIdentity: "old",
  };
}

test("cold-start routing does not mistake duplicate stale initialRoute values for window identity", () => {
  const route = "%2Flocal%2F11111111-1111-4111-8111-111111111111";
  const first = { id: "window-a", type: "page", url: `app://-/index.html?initialRoute=${route}`, webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/window-a" };
  const second = { id: "window-b", type: "page", url: `app://-/index.html?initialRoute=${route}`, webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/window-b" };

  assert.equal(selectBridgeObservationTarget([first, second], undefined), undefined);
  assert.equal(selectBridgeObservationTarget([first, second], second), second);
});

test("mutation routing selects only one visible Composer window", () => {
  const target = (id: string) => ({
    id,
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:41001/devtools/page/${id}`,
  });
  const composer = target("composer");
  const auxiliary = target("auxiliary");
  assert.equal(selectUniqueComposerMutationTarget([
    { target: auxiliary, composerPresent: false, visibilityState: "visible" },
    { target: composer, composerPresent: true, visibilityState: "visible" },
  ]), composer);
  assert.equal(selectUniqueComposerMutationTarget([
    { target: composer, composerPresent: true, visibilityState: "visible" },
    { target: target("second"), composerPresent: true, visibilityState: "visible" },
  ]), undefined);
  assert.equal(selectUniqueComposerMutationTarget([
    { target: composer, composerPresent: true, visibilityState: "hidden" },
  ]), undefined);
});

test("background app focus keeps an open observation socket sticky", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: WebSocket.OPEN };
  bridge.socket = socket;
  let reconnects = 0;
  bridge.targetIdentity = "sticky-target";
  bridge.evaluate = async () => snapshot();
  bridge.sessionOwnership = {
    annotate: async (value: MicroSnapshot) => value,
    getActiveThreadContextUsage: () => undefined,
  };
  bridge.connect = async () => { reconnects += 1; };

  const observed = await bridge.refresh();

  assert.equal(bridge.socket, socket);
  assert.equal(observed.targetIdentity, "sticky-target");
  assert.equal(reconnects, 0);
});

test("refresh asks observation routing to follow an explicit Codex window switch", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = { readyState: WebSocket.OPEN };
  let observationChecks = 0;
  bridge.ensureObservationTarget = async () => { observationChecks += 1; };
  bridge.targetIdentity = "window-b";
  bridge.evaluate = async () => snapshot();
  bridge.sessionOwnership = {
    annotate: async (value: MicroSnapshot) => value,
    getActiveThreadContextUsage: () => undefined,
  };

  const observed = await bridge.refresh();

  assert.equal(observationChecks, 1);
  assert.equal(observed.targetIdentity, "window-b");
});

test("an in-flight mutation keeps periodic refresh on its leased renderer until observation completes", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: WebSocket.OPEN };
  bridge.socket = socket;
  bridge.connectedTargetKey = "window-a";
  bridge.targetIdentity = "window-a";
  bridge.connectionEpoch = 7;
  bridge.operationTargetLeases.set("operation-lease", {
    socket,
    targetIdentity: "window-a",
    connectionEpoch: 7,
  });
  const expressions: string[] = [];
  bridge.evaluate = async (expression: string) => {
    expressions.push(expression);
    return snapshot();
  };
  bridge.sessionOwnership = {
    annotate: async (value: MicroSnapshot) => value,
    getActiveThreadContextUsage: () => undefined,
  };

  const observed = await bridge.refresh();

  assert.equal(expressions.length, 1, "refresh must not run a focus probe that can rebind the leased target");
  assert.equal(observed.connectionEpoch, 7);
  assert.equal(observed.targetIdentity, "window-a");
  assert.equal(bridge.socket, socket);
});

test("a refresh that races a renderer rebind cannot publish mixed target metadata or close the replacement", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const oldSocket = { readyState: WebSocket.OPEN };
  const replacementSocket = { readyState: WebSocket.OPEN };
  bridge.socket = oldSocket;
  bridge.connectedTargetKey = "window-a";
  bridge.targetIdentity = "window-a";
  bridge.connectionEpoch = 7;
  bridge.ensureObservationTarget = async () => undefined;
  let resolveSnapshot!: (value: MicroSnapshot) => void;
  bridge.evaluate = () => new Promise<MicroSnapshot>((resolve) => { resolveSnapshot = resolve; });
  bridge.sessionOwnership = {
    annotate: async (value: MicroSnapshot) => value,
    getActiveThreadContextUsage: () => undefined,
  };

  const pendingRefresh = bridge.refresh();
  await Promise.resolve();
  bridge.socket = replacementSocket;
  bridge.connectedTargetKey = "window-b";
  bridge.targetIdentity = "window-b";
  bridge.connectionEpoch = 8;
  resolveSnapshot(snapshot());

  await assert.rejects(pendingRefresh, /E_CONNECTION_STALE/u);
  assert.equal(bridge.socket, replacementSocket);
  assert.equal(bridge.targetIdentity, "window-b");
  assert.equal(bridge.connectionEpoch, 8);
  assert.equal(bridge.lastSnapshot, undefined);
});

test("concurrent target connections serialize and never publish metadata from a different socket", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => {
    for (const client of server.clients) client.terminate();
    server.close(() => resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  let releaseFirstProbe!: () => void;
  const firstProbeGate = new Promise<void>((resolve) => { releaseFirstProbe = resolve; });
  let firstProbeStarted!: () => void;
  const firstProbe = new Promise<void>((resolve) => { firstProbeStarted = resolve; });
  let secondConnected!: () => void;
  const secondConnection = new Promise<void>((resolve) => { secondConnected = resolve; });
  const socketPaths: string[] = [];
  server.on("connection", (socket, request) => {
    const path = request.url ?? "";
    socketPaths.push(path);
    if (path === "/devtools/page/window-b") secondConnected();
    socket.on("message", async (raw) => {
      const message = JSON.parse(String(raw)) as { id: number };
      if (path === "/devtools/page/window-a") {
        firstProbeStarted();
        await firstProbeGate;
      }
      socket.send(JSON.stringify({
        id: message.id,
        result: { result: { value: { hasFocus: true, visibilityState: "visible", socketPath: path } } },
      }));
    });
  });

  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const target = (id: string) => ({
    id,
    type: "page",
    url: `app://-/index.html?initialRoute=%2Flocal%2F${id}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/page/${id}`,
  });
  const first = bridge.connect({ port: address.port, target: target("window-a"), requireFocused: true });
  await firstProbe;
  const second = bridge.connect({ port: address.port, target: target("window-b"), requireFocused: true });

  const secondConnectedEarly = await Promise.race([
    secondConnection.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 40)),
  ]);
  releaseFirstProbe();
  await Promise.all([first, second]);

  assert.equal(secondConnectedEarly, false, "the second socket connected before the first candidate was validated");
  assert.deepEqual(socketPaths, ["/devtools/page/window-a", "/devtools/page/window-b"]);
  assert.equal(bridge.connectedTargetKey, codexDebugTargetKey(target("window-b")));
  assert.equal((await bridge.evaluate("'socket identity'"))?.socketPath, "/devtools/page/window-b");
  assert.match(bridge.targetIdentity, /^[0-9a-f]{64}$/u);
  assert.equal(bridge.connectionEpoch, 2);
  bridge.close();
});

test("operation target leases are released after injected failures", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: WebSocket.OPEN };
  bridge.socket = socket;
  bridge.connectionEpoch = 7;
  bridge.pageEpoch = 2;
  bridge.targetIdentity = "window-a";
  const fresh = { ...snapshot(), connectionEpoch: 7, pageEpoch: 2, targetIdentity: "window-a" };

  const operation = await bridge.beginOperation("ACT06", "down", fresh);
  assert.equal(bridge.operationTargetLeases.size, 1);

  await assert.rejects(
    bridge.withOperationTargetLease(operation, async () => { throw new Error("E_SYNTHETIC_MUTATION_FAILURE"); }),
    /E_SYNTHETIC_MUTATION_FAILURE/u,
  );
  assert.equal(bridge.operationTargetLeases.size, 0);
});

test("a second mutation cannot rebind while another operation owns the renderer target", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: WebSocket.OPEN };
  bridge.socket = socket;
  bridge.connectedTargetKey = "window-a";
  bridge.operationTargetLeases.set("operation-lease", {
    socket,
    targetIdentity: "window-a",
    connectionEpoch: 7,
  });
  bridge.evaluate = async () => ({ hasFocus: false, visibilityState: "visible" });
  let reconnects = 0;
  bridge.connect = async () => { reconnects += 1; };

  await assert.rejects(bridge.ensureForegroundMutationTarget(), /E_FOREGROUND_TARGET_STALE/u);

  assert.equal(reconnects, 0);
  assert.equal(bridge.socket, socket);
});

test("observation routing keeps the sticky socket when no Codex window is focused", () => {
  const source = readFileSync(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  const methodStart = source.indexOf("private async ensureObservationTarget");
  const methodEnd = source.indexOf("private async ensureForegroundMutationTarget", methodStart);
  const method = source.slice(methodStart, methodEnd);
  assert.match(method, /MUTATION_RENDERER_PROBE_EXPRESSION/u);
  assert.match(method, /current\.composerPresent === true/u);
  assert.match(method, /selectUniqueComposerMutationTarget\(composerObservations\)/u);
  assert.match(method, /if \(!observationTarget\?\.webSocketDebuggerUrl\) return;/u);
  assert.doesNotMatch(method, /throw integrityError\("E_FOREGROUND_TARGET_UNAVAILABLE"\)/u);
});

test("mutation preparation accepts only the focused visible sticky renderer", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = { readyState: WebSocket.OPEN };
  let focusProbes = 0;
  bridge.evaluate = async () => {
    focusProbes += 1;
    return { hasFocus: true, visibilityState: "visible" };
  };

  assert.equal(await bridge.ensureForegroundMutationTarget(), false);
  assert.equal(focusProbes, 1);
});

test("renderer dispatch retains a focus gate immediately before mutation", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: WebSocket.OPEN };
  bridge.socket = socket;
  bridge.ensureConnected = async () => undefined;
  bridge.targetIdentity = "target";
  bridge.connectionEpoch = 7;
  let expression = "";
  bridge.evaluateOnSocket = async (_socket: unknown, source: string) => {
    expression = source;
    return "operation";
  };
  const operation = {
    version: 1,
    requestId: "request",
    operationId: "operation",
    connectionEpoch: 7,
    pageEpoch: 0,
    physicalId: "ACT06",
    phase: "down",
    mappingFingerprint: "mapping",
    targetIdentity: "target",
  };

  await bridge.dispatch("codex-micro-hid-event", { event: {} }, "codex-micro-hid-event", operation);

  const focusGate = expression.lastIndexOf("assertMutationForeground(document)");
  const nativeDispatch = expression.lastIndexOf("dispatch.call(bus");
  assert.ok(focusGate >= 0);
  assert.ok(nativeDispatch > focusGate, "focus must be checked in the renderer immediately before native dispatch");
  assert.ok(nativeDispatch - focusGate < 240, "no asynchronous work may separate the final focus check from dispatch");
});

test("a disconnected bridge cannot rebind while a PTT release remains leased", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.heldPttOperations.set("ACT10", { operation: {}, socket: { readyState: WebSocket.OPEN } });
  let refreshes = 0;
  bridge.refresh = async () => { refreshes += 1; return snapshot(); };

  await assert.rejects(bridge.beginOperation("ACT06", "down"), /E_FOREGROUND_TARGET_STALE/u);
  assert.equal(refreshes, 0);
});

test("an open leased PTT socket survives a failed foreground probe without rebinding", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  let closes = 0;
  let reconnects = 0;
  const socket = { readyState: WebSocket.OPEN, close: () => { closes += 1; } };
  bridge.socket = socket;
  bridge.connectedTargetKey = "window-a";
  bridge.heldPttOperations.set("ACT10", { operation: {}, socket });
  bridge.evaluate = async () => { throw new Error("focus probe failed"); };
  bridge.connect = async () => { reconnects += 1; };

  await assert.rejects(bridge.ensureForegroundMutationTarget(), /E_FOREGROUND_TARGET_STALE/u);

  assert.equal(bridge.socket, socket);
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.equal(closes, 0);
  assert.equal(reconnects, 0);
});

test("the final renderer guard blocks a direct mutation after focus changes during preparation", async () => {
  let focused = true;
  let mutations = 0;
  const documentLike = { hasFocus: () => focused, visibilityState: "visible" };

  await Promise.resolve().then(() => { focused = false; });
  assert.throws(() => {
    assertFocusedVisibleRendererForMutation(documentLike);
    mutations += 1;
  }, /E_FOREGROUND_TARGET_STALE/u);
  assert.equal(mutations, 0);
});

test("context compaction rechecks focus immediately before its native mutation", () => {
  const source = readFileSync(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  const mutation = source.indexOf("await manager.compactThread(rawConversationId)");
  const focusGate = source.lastIndexOf("assertMutationForeground(document)", mutation);
  assert.ok(mutation > focusGate && mutation - focusGate < 240);
});

test("every direct renderer action uses the common final foreground guard", () => {
  const source = readFileSync(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  const guardedMutations = [
    "const outcome = moveDraft(",
    "await manager.compactThread(rawConversationId)",
    "owner.onBeforeSelectModel(expected.modelId)",
    "owner.onSelectModel(expected.modelId",
    "const completionResult = completion()",
    "boundTrigger.focus(",
    "boundTrigger.dispatchEvent(",
    "toggle.focus(",
    "toggle.dispatchEvent(",
    "submenuTrigger.focus(",
    "submenuTrigger.dispatchEvent(",
    "target.focus(",
    "target.dispatchEvent(",
    "expected.focus(",
    "const handled = commandRunner(",
    "if (openExternalUrl(",
    "bus.dispatchHostMessage({ type: 'codex-micro-insert-composer-text'",
    "const result = await client.safePost(",
    "queryClient.setQueryData(",
    "void queryClient.invalidateQueries(",
  ];
  for (const mutation of guardedMutations) {
    const mutationIndex = source.indexOf(mutation);
    assert.ok(mutationIndex >= 0, `missing production mutation oracle: ${mutation}`);
    const guardIndex = source.lastIndexOf("assertMutationForeground(document)", mutationIndex);
    const between = source.slice(guardIndex, mutationIndex);
    assert.ok(guardIndex >= 0 && mutationIndex - guardIndex < 220, `missing final guard: ${mutation}`);
    assert.doesNotMatch(between, /\bawait\b/u, `async gap after final guard: ${mutation}`);
  }
});
