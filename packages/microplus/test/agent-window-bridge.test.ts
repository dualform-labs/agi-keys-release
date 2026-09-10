import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import {
  type AgentWindowRoutingTransport,
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  sendDebugTargetCommand,
} from "../src/codex-micro-renderer-bridge.js";
import {
  AGENT_WINDOW_PROBE_EXPRESSION,
} from "../src/agent-window-probe.js";
import {
  codexDebugTargetKey,
  FOREGROUND_RENDERER_PROBE_EXPRESSION,
  type DebugTarget,
} from "../src/codex-debug-discovery.js";
import type { MicroSnapshot } from "../src/types.js";
import type { OperationRequest } from "../src/types.js";

function snapshot(threadKey: string, activeThreadKey = "local:source"): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({
      id,
      threadKey: id === 0 ? threadKey : null,
      title: id === 0 ? "Task A" : null,
      status: id === 0 ? "idle" : "off",
      selected: id === 0,
    })),
    activeThreadKey,
    layout: {
      version: 1,
      slots: {},
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-a",
    targetIdentity: "source-window",
  };
}

test("public agent selection ignores legacy new-window behavior and keeps native down/up on one lease", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const current = snapshot("local:task-a", "local:source");
  const sourceSocket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.socket = sourceSocket;
  bridge.targetIdentity = current.targetIdentity;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.lastSnapshot = current;
  bridge.connectedTargetKey = "source";
  bridge.ensureForegroundMutationTarget = async () => false;
  bridge.refresh = async () => current;
  bridge.routeAgentToWindow = async () => { throw new Error("public sendAgent must not scan or route windows"); };
  bridge.openAgentInNewWindow = async () => { throw new Error("public sendAgent must not open a window"); };
  bridge.observeOperation = async () => undefined;
  const activations: unknown[][] = [];
  bridge.observeThreadActivated = async (...args: unknown[]) => { activations.push(args); };
  const calls: Array<{ event: unknown; phase: string; socket: WebSocket | undefined }> = [];
  bridge.dispatch = async (
    _type: string,
    payload: { event: unknown },
    _handler: string,
    operation: OperationRequest,
    socket: WebSocket | undefined,
    submitted?: () => void,
  ) => {
    submitted?.();
    calls.push({ event: payload.event, phase: operation.phase, socket });
  };
  const opened: string[] = [];
  bridge.sessionOwnership = { markOpened: (key: string) => opened.push(key) };

  await bridge.sendAgent(0, 1, "local:task-a", "new-window");
  await bridge.sendAgent(0, 0, "different-current-mapping", "new-window");

  assert.deepEqual(calls.map(({ event, phase }) => [phase, event]), [
    ["down", { key: "AG00", act: 1, slot: 0, threadKey: "local:task-a" }],
    ["up", { key: "AG00", act: 0, slot: 0, threadKey: "local:task-a" }],
  ]);
  assert.ok(calls.every(({ socket }) => socket === sourceSocket));
  assert.deepEqual(activations, [["local:task-a", false]]);
  assert.deepEqual(opened, ["local:task-a"]);
  assert.equal(bridge.heldNativeInputOperations.size, 0);
});

test("legacy new-window behavior does not reject host-scoped native slot identities", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const current = snapshot("local:host-a:task-a", "local:source");
  const sourceSocket = { readyState: WebSocket.OPEN } as WebSocket;
  Object.assign(bridge, {
    socket: sourceSocket,
    targetIdentity: current.targetIdentity,
    connectionEpoch: current.connectionEpoch,
    pageEpoch: current.pageEpoch,
    lastSnapshot: current,
    connectedTargetKey: "source",
    ensureForegroundMutationTarget: async () => false,
    refresh: async () => current,
    observeOperation: async () => undefined,
    observeThreadActivated: async () => undefined,
    sessionOwnership: { markOpened: () => undefined },
    routeAgentToWindow: async () => { throw new Error("window route must stay unused"); },
  });
  const events: unknown[] = [];
  bridge.dispatch = async (
    _type: string,
    payload: { event: unknown },
    _handler: string,
    _operation: OperationRequest,
    _socket: WebSocket,
    submitted?: () => void,
  ) => { submitted?.(); events.push(payload.event); };

  await bridge.sendAgent(0, 1, "local:host-a:task-a", "new-window");
  await bridge.sendAgent(0, 0, "local:host-a:task-a", "new-window");

  assert.deepEqual(events, [
    { key: "AG00", act: 1, slot: 0, threadKey: "local:host-a:task-a" },
    { key: "AG00", act: 0, slot: 0, threadKey: "local:host-a:task-a" },
  ]);
});

test("renderer rebind slot rejection retires the unsent guard down before the next valid press", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const original = snapshot("local:task-a", "local:source");
  const rebound: MicroSnapshot = {
    ...snapshot("local:task-b", "local:source"),
    connectionEpoch: 2,
    mappingFingerprint: "mapping-b",
    targetIdentity: "window-b",
  };
  const socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  Object.assign(bridge, {
    socket,
    targetIdentity: original.targetIdentity,
    connectionEpoch: original.connectionEpoch,
    pageEpoch: original.pageEpoch,
    lastSnapshot: original,
    connectedTargetKey: "window-a",
  });
  let didRebind = false;
  bridge.refresh = async () => {
    const current = didRebind ? rebound : original;
    bridge.lastSnapshot = current;
    return current;
  };
  bridge.ensureForegroundMutationTarget = async () => {
    if (didRebind) return false;
    didRebind = true;
    bridge.operationGuard.reset();
    bridge.targetIdentity = rebound.targetIdentity;
    bridge.connectionEpoch = rebound.connectionEpoch;
    bridge.pageEpoch = rebound.pageEpoch;
    bridge.lastSnapshot = undefined;
    bridge.connectedTargetKey = "window-b";
    return true;
  };
  bridge.observeOperation = async () => undefined;
  bridge.observeThreadActivated = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };
  const phases: string[] = [];
  bridge.dispatch = async (
    _type: string,
    _payload: unknown,
    _handler: string,
    operation: OperationRequest,
    _socket: WebSocket,
    submitted?: () => void,
  ) => {
    submitted?.();
    phases.push(operation.phase);
  };

  await assert.rejects(bridge.sendAgent(0, 1, "local:task-a"), /changed before dispatch/);
  await bridge.sendAgent(0, 1, "local:task-b");
  await bridge.sendAgent(0, 0, "local:task-b");

  assert.deepEqual(phases, ["down", "up"]);
  assert.equal(bridge.heldNativeInputOperations.size, 0);
});

test("legacy new-window behavior still rejects a remapped native slot before dispatch", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const current = snapshot("thread-a", "local:source");
  const remapped = snapshot("thread-b", "local:source");
  bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.targetIdentity = current.targetIdentity;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.lastSnapshot = current;
  bridge.connectedTargetKey = "source";
  bridge.refresh = async () => current;
  bridge.ensureForegroundMutationTarget = async () => {
    bridge.lastSnapshot = remapped;
    return false;
  };
  bridge.dispatch = async () => { throw new Error("stale mapping must not dispatch"); };

  await assert.rejects(
    bridge.sendAgent(0, 1, "thread-a", "new-window"),
    /changed before dispatch/,
  );
  assert.equal(bridge.heldNativeInputOperations.size, 0);
});

test("private unused new-window helper retains its pinned host-message contract", async () => {
  const sourceTarget: DebugTarget = {
    id: "source",
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/source",
  };
  let expression = "";
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => 9222,
    listTargets: async () => [sourceTarget],
    command: async <T>(_target: DebugTarget, _port: number, method: string, params?: object) => {
      assert.equal(method, "Runtime.evaluate");
      expression = (params as { expression: string }).expression;
      return true as T;
    },
  };
  const bridge = new CodexMicroRendererBridge(() => undefined, undefined, transport) as any;

  await bridge.openAgentInNewWindow(sourceTarget, 9222, "/local/task-a");

  assert.match(expression, new RegExp(CURRENT_APP_INITIAL_SHA256));
  assert.match(expression, /appInitial\.Kun/);
  assert.match(expression, /dispatchMessage\('open-in-new-window'/);
  assert.match(expression, /path: "\/local\/task-a"/);
  assert.match(expression, /assertMutationForeground\(document\)/);
});

test("private unused routing helper fails closed when its lightweight scan is incomplete", async () => {
  const sourceTarget: DebugTarget = {
    id: "source",
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/source",
  };
  const logs: string[] = [];
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => 9222,
    listTargets: async () => [sourceTarget],
    command: async () => { throw new Error("renderer not ready"); },
  };
  const bridge = new CodexMicroRendererBridge((message) => logs.push(message), undefined, transport) as any;
  bridge.connectedTargetKey = codexDebugTargetKey(sourceTarget);

  await assert.rejects(
    bridge.routeAgentToWindow("local:task-a", snapshot("local:source"), "current-window", "/local/task-a"),
    /E_AGENT_WINDOW_UNVERIFIED/,
  );
  assert.deepEqual(logs, ["Agent window routing failed phase=scan."]);
});

test("private unused routing helper rejects a destination that changes during connection", async () => {
  const target = (id: string): DebugTarget => ({
    id,
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/${id}`,
  });
  const sourceTarget = target("source");
  const destinationTarget = target("destination");
  let connected = false;
  const logs: string[] = [];
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => 9222,
    listTargets: async () => [sourceTarget, destinationTarget],
    command: async <T>(selected: DebugTarget) => ({
      activeThreadKey: selected.id === "source" ? "local:source" : connected ? "local:other" : "local:task-a",
      activeComposerKey: selected.id === "source" ? "composer-source" : "composer-destination",
      composerPresent: true,
      focusedVisible: selected.id === "destination",
      identityAvailable: true,
    }) as T,
  };
  const bridge = new CodexMicroRendererBridge((message) => logs.push(message), undefined, transport) as any;
  bridge.connectedTargetKey = codexDebugTargetKey(sourceTarget);
  bridge.connect = async () => { connected = true; };

  await assert.rejects(
    bridge.routeAgentToWindow("local:task-a", snapshot("local:source"), "current-window", "/local/task-a"),
    /E_AGENT_WINDOW_UNVERIFIED/,
  );
  assert.deepEqual(logs, [
    "Agent window scan total=2 readable=2 matches=1 selection=existing.",
    "Agent window routing failed phase=connect.",
  ]);
});

test("private unused routing helper preserves a proven empty source composer", async () => {
  const target = (id: string): DebugTarget => ({
    id,
    type: "page",
    url: "app://-/index.html",
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/${id}`,
  });
  const sourceTarget = target("source");
  const destinationTarget = target("destination");
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => 9222,
    listTargets: async () => [sourceTarget, destinationTarget],
    command: async <T>(selected: DebugTarget) => ({
      activeThreadKey: selected.id === "source" ? null : "local:task-a",
      activeComposerKey: selected.id === "source" ? "composer-empty" : "composer-destination",
      composerPresent: true,
      focusedVisible: selected.id === "destination",
      identityAvailable: true,
    }) as T,
  };
  const bridge = new CodexMicroRendererBridge(() => undefined, undefined, transport) as any;
  bridge.connectedTargetKey = codexDebugTargetKey(sourceTarget);
  let connectCount = 0;
  bridge.connect = async () => { connectCount += 1; };
  const { activeThreadKey: _activeThreadKey, ...sourceWithoutThread } = snapshot("local:source");
  const emptySource = { ...sourceWithoutThread, activeComposerKey: "composer-empty" };

  await bridge.routeAgentToWindow("local:task-a", emptySource, "current-window", "/local/task-a");
  assert.equal(connectCount, 1);
});

test("private unused routing helper verifies an existing task with fake local CDP transport", async (t) => {
  const server = createServer();
  const websocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client, request));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    websocketServer.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  let destinationFocused = false;
  let bringToFrontCount = 0;
  let nativeWindowExpression = "";
  const evaluatedExpressions: string[] = [];
  websocketServer.on("connection", (socket, request) => {
    const destination = request.url === "/devtools/destination";
    const cold = request.url === "/devtools/cold";
    socket.on("message", (raw) => {
      const command = JSON.parse(String(raw)) as { id: number; method: string; params?: { expression?: string } };
      if (command.method === "Page.bringToFront") {
        destinationFocused = true;
        bringToFrontCount += 1;
        socket.send(JSON.stringify({ id: command.id, result: {} }));
        return;
      }
      const expression = command.params?.expression ?? "";
      evaluatedExpressions.push(expression);
      if (cold) {
        socket.send(JSON.stringify({ id: command.id, error: { message: "renderer not ready" } }));
        return;
      }
      if (expression.includes("open-in-new-window")) nativeWindowExpression = expression;
      const value = expression === AGENT_WINDOW_PROBE_EXPRESSION
        ? {
            activeThreadKey: destination ? "local:task-a" : "local:source",
            activeComposerKey: destination ? "composer-destination" : "composer-source",
            composerPresent: true,
            focusedVisible: destination ? destinationFocused : !destinationFocused,
            identityAvailable: true,
          }
        : expression === FOREGROUND_RENDERER_PROBE_EXPRESSION
        ? { hasFocus: destination ? destinationFocused : !destinationFocused, visibilityState: "visible" }
        : expression.includes("open-in-new-window")
          ? true
          : destination
            ? snapshot("local:task-a", "local:task-a")
            : snapshot("local:source");
      socket.send(JSON.stringify({ id: command.id, result: { result: { value } } }));
    });
  });
  const target = (id: string): DebugTarget => ({
    id,
    type: "page",
    url: `app://-/index.html?initialRoute=%2Flocal%2F${id}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/${id}`,
  });
  const sourceTarget = target("source");
  const destinationTarget = target("destination");
  const coldTarget = target("cold");
  const transport: AgentWindowRoutingTransport = {
    discoverPort: async () => port,
    listTargets: async () => [sourceTarget, destinationTarget, coldTarget],
    command: sendDebugTargetCommand,
  };
  const bridge = new CodexMicroRendererBridge(() => undefined, undefined, transport) as any;
  bridge.connectedTargetKey = codexDebugTargetKey(sourceTarget);
  bridge.connect = async ({ target: selected }: { target: DebugTarget }) => {
    assert.equal(codexDebugTargetKey(selected), codexDebugTargetKey(destinationTarget));
  };

  await bridge.routeAgentToWindow("local:task-a", snapshot("local:source"), "new-window", "/local/task-a");

  assert.equal(bringToFrontCount, 1);
  assert.equal(destinationFocused, true);
  assert.ok(evaluatedExpressions.includes(AGENT_WINDOW_PROBE_EXPRESSION));
  assert.equal(evaluatedExpressions.some((expression) => expression.includes("Codex Micro slot store was not found")), false);

  const nativeBridge = new CodexMicroRendererBridge(() => undefined, undefined, transport) as any;
  await nativeBridge.openAgentInNewWindow(sourceTarget, port, "/local/task-a");
  assert.match(nativeWindowExpression, /dispatchMessage\('open-in-new-window', \{ path: "\/local\/task-a" \}\)/);
});

test("current-window HID fallback releases its exact socket and can be pressed twice", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const current = snapshot("thread-a", "thread-a");
  const sourceSocket = {
    readyState: WebSocket.OPEN,
    close: () => undefined,
  } as unknown as WebSocket;
  bridge.socket = sourceSocket;
  bridge.targetIdentity = current.targetIdentity;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.lastSnapshot = current;
  bridge.connectedTargetKey = "source";
  bridge.ensureForegroundMutationTarget = async () => false;
  bridge.refresh = async () => current;
  bridge.observeOperation = async () => undefined;
  bridge.observeThreadActivated = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };
  const calls: Array<{ phase: string; act: number; socket: WebSocket | undefined }> = [];
  bridge.dispatch = async (
    _type: string,
    payload: { event: { act: number } },
    _handler: string,
    operation: OperationRequest,
    socket: WebSocket | undefined,
    submitted?: () => void,
  ) => {
    submitted?.();
    calls.push({ phase: operation.phase, act: payload.event.act, socket });
  };

  await bridge.sendAgent(0, 1, "thread-a", "current-window");
  await bridge.sendAgent(0, 0, "thread-a", "current-window");
  await bridge.sendAgent(0, 1, "thread-a", "current-window");
  await bridge.sendAgent(0, 0, "thread-a", "current-window");

  assert.deepEqual(calls.map(({ phase, act }) => [phase, act]), [
    ["down", 1], ["up", 0], ["down", 1], ["up", 0],
  ]);
  assert.ok(calls.every(({ socket }) => socket === sourceSocket));
  assert.equal(bridge.heldNativeInputOperations.size, 0);
});

test("current-window release keeps the accepted down payload and old socket after observation rebind", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const current = snapshot("thread-a", "thread-a");
  let sourceClosed = 0;
  const sourceSocket = {
    readyState: WebSocket.OPEN,
    close: () => { sourceClosed += 1; },
  } as unknown as WebSocket;
  const nextSocket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.socket = sourceSocket;
  bridge.targetIdentity = current.targetIdentity;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.lastSnapshot = current;
  bridge.connectedTargetKey = "source";
  bridge.ensureForegroundMutationTarget = async () => false;
  bridge.refresh = async () => current;
  bridge.observeOperation = async () => undefined;
  bridge.observeThreadActivated = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };
  const calls: Array<{ payload: any; socket: WebSocket | undefined }> = [];
  bridge.dispatch = async (
    _type: string,
    payload: unknown,
    _handler: string,
    _operation: OperationRequest,
    socket: WebSocket | undefined,
    submitted?: () => void,
  ) => { submitted?.(); calls.push({ payload, socket }); };

  await bridge.sendAgent(0, 1, "thread-a", "current-window");
  bridge.socket = nextSocket;
  bridge.targetIdentity = "next-window";
  bridge.connectionEpoch += 1;
  bridge.operationGuard.reset();
  await bridge.sendAgent(0, 0, "different-current-mapping", "current-window");

  assert.equal(calls[1]!.socket, sourceSocket);
  assert.deepEqual(calls[1]!.payload.event, {
    key: "AG00",
    act: 0,
    slot: 0,
    threadKey: "thread-a",
  });
  assert.equal(bridge.heldNativeInputOperations.size, 0);
  assert.equal(sourceClosed, 1);
});

test("a shared old renderer socket closes only after its final leased state-clear", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  let closeCount = 0;
  const sourceSocket = {
    readyState: WebSocket.OPEN,
    close: () => { closeCount += 1; },
  } as unknown as WebSocket;
  bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.targetIdentity = "next-window";
  bridge.connectionEpoch = 2;
  bridge.pageEpoch = 1;
  const held = (physicalId: "AG00" | "AG01", operationId: string): OperationRequest => ({
    version: 1,
    requestId: `${operationId}-request`,
    operationId,
    connectionEpoch: 1,
    pageEpoch: 1,
    physicalId,
    phase: "down",
    mappingFingerprint: "mapping-a",
    targetIdentity: "source-window",
  });
  for (const [physicalId, operationId, slot] of [["AG00", "held-a", 0], ["AG01", "held-b", 1]] as const) {
    bridge.heldNativeInputOperations.set(physicalId, {
      operation: held(physicalId, operationId),
      socket: sourceSocket,
      releaseAttempted: false,
      releaseEvent: { key: physicalId, act: 0, slot, threadKey: `thread-${slot}` },
    });
  }
  bridge.dispatch = async () => undefined;

  await bridge.releaseLeasedNativeInput("AG00");
  assert.equal(closeCount, 0);
  assert.equal(bridge.heldNativeInputOperations.size, 1);
  await bridge.releaseLeasedNativeInput("AG01");
  assert.equal(closeCount, 1);
  assert.equal(bridge.heldNativeInputOperations.size, 0);
});

test("uncertain current-window down retains one release while definite predispatch failure does not", async () => {
  const configured = () => {
    const bridge = new CodexMicroRendererBridge(() => undefined) as any;
    const current = snapshot("thread-a", "thread-a");
    bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
    bridge.targetIdentity = current.targetIdentity;
    bridge.connectionEpoch = current.connectionEpoch;
    bridge.pageEpoch = current.pageEpoch;
    bridge.lastSnapshot = current;
    bridge.connectedTargetKey = "source";
    bridge.ensureForegroundMutationTarget = async () => false;
    bridge.refresh = async () => current;
    bridge.observeOperation = async () => undefined;
    bridge.observeThreadActivated = async () => undefined;
    bridge.sessionOwnership = { markOpened: () => undefined };
    return bridge;
  };
  const uncertain = configured();
  uncertain.dispatch = async (
    _type: string,
    _payload: unknown,
    _handler: string,
    _operation: OperationRequest,
    _socket: WebSocket,
    submitted?: () => void,
  ) => { submitted?.(); throw new Error("lost acknowledgement"); };
  await assert.rejects(uncertain.sendAgent(0, 1, "thread-a"), /lost acknowledgement/);
  assert.equal(uncertain.heldNativeInputOperations.size, 1);
  uncertain.dispatch = async () => undefined;
  await uncertain.sendAgent(0, 0, "thread-a");
  assert.equal(uncertain.heldNativeInputOperations.size, 0);

  const definite = configured();
  definite.dispatch = async () => {
    const error = new Error("renderer rejected before dispatch") as Error & { codexDeckPredispatch?: boolean };
    error.codexDeckPredispatch = true;
    throw error;
  };
  await assert.rejects(definite.sendAgent(0, 1, "thread-a"), /renderer rejected/);
  assert.equal(definite.heldNativeInputOperations.size, 0);
  await definite.sendAgent(0, 0, "thread-a");
});

test("an observed renderer-session close retires an unreachable AG release without reporting success", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const first = snapshot("thread-a", "thread-a");
  const firstSocket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  Object.assign(bridge, {
    socket: firstSocket,
    targetIdentity: first.targetIdentity,
    connectionEpoch: first.connectionEpoch,
    pageEpoch: first.pageEpoch,
    lastSnapshot: first,
    connectedTargetKey: "source",
    ensureForegroundMutationTarget: async () => false,
    refresh: async () => first,
    observeOperation: async () => undefined,
    observeThreadActivated: async () => undefined,
    sessionOwnership: { markOpened: () => undefined },
  });
  bridge.dispatch = async (
    _type: string,
    _payload: unknown,
    _handler: string,
    _operation: OperationRequest,
    _socket: WebSocket,
    submitted?: () => void,
  ) => { submitted?.(); };
  await bridge.sendAgent(0, 1, "thread-a");

  bridge.endedRendererSessions.add(firstSocket);
  bridge.operationGuard.reset(); // disconnect() owns this reset after the close event.
  const next: MicroSnapshot = {
    ...first,
    connectionEpoch: 2,
    mappingFingerprint: "mapping-b",
    targetIdentity: "next-window",
  };
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.targetIdentity = next.targetIdentity;
  bridge.connectionEpoch = next.connectionEpoch;
  bridge.lastSnapshot = next;
  bridge.refresh = async () => next;

  await assert.rejects(bridge.sendAgent(0, 0, "thread-a"), /E_RELEASE_TARGET_GONE/);
  assert.equal(bridge.heldNativeInputOperations.size, 0);
  await bridge.sendAgent(0, 1, "thread-a");
  await bridge.sendAgent(0, 0, "thread-a");
});

test("generated leased state-clear reaches a background source once and rejects a mismatched payload", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const sourceSocket = { readyState: WebSocket.OPEN } as WebSocket;
  const foregroundSocket = { readyState: WebSocket.OPEN } as WebSocket;
  const held: OperationRequest = {
    version: 1,
    requestId: "held-request",
    operationId: "held-operation",
    connectionEpoch: 1,
    pageEpoch: 1,
    physicalId: "AG00",
    phase: "down",
    mappingFingerprint: "mapping-a",
    targetIdentity: "source-window",
    activeThreadKey: "local:source",
    activeComposerKey: "composer-1",
  };
  const release = bridge.continueLeasedNativeInputOperation(held) as OperationRequest;
  bridge.closed = false;
  bridge.socket = foregroundSocket;
  bridge.targetIdentity = "other-window";
  bridge.connectionEpoch = 2;
  bridge.heldNativeInputOperations.set("AG00", { operation: held, socket: sourceSocket, releaseAttempted: true });
  const dispatched: unknown[] = [];
  const bus = {
    handlers: new Map([["codex-micro-hid-event", new Set([true])]]),
    dispatchHostMessage(message: unknown) { dispatched.push(message); },
  };
  const environment = globalThis as any;
  const savedDocument = environment.document;
  const savedLocation = environment.location;
  const savedNamespace = environment.__nativeReleaseTestNamespace;
  environment.document = {
    hasFocus: () => false,
    visibilityState: "hidden",
    querySelectorAll: () => [{ href: "app://codex/assets/native-release.js", src: "" }],
  };
  environment.location = { href: "app://codex/index.html" };
  environment.__nativeReleaseTestNamespace = { bus };
  bridge.evaluateOnSocket = async <T>(socket: WebSocket, expression: string) => {
    assert.equal(socket, sourceSocket);
    const executable = expression.replaceAll("await import(url)", "globalThis.__nativeReleaseTestNamespace");
    return await (0, eval)(executable) as T;
  };
  try {
    await bridge.dispatch(
      "codex-micro-hid-event",
      { event: { key: "AG00", act: 0, slot: 0, threadKey: "local:source" } },
      "codex-micro-hid-event",
      release,
      sourceSocket,
    );
    assert.equal(dispatched.length, 1);
    await assert.rejects(
      bridge.dispatch(
        "codex-micro-hid-event",
        { event: { key: "AG00", act: 1, slot: 0, threadKey: "local:source" } },
        "codex-micro-hid-event",
        release,
        sourceSocket,
      ),
      /E_TARGET_STALE/,
    );
    assert.equal(dispatched.length, 1);
  } finally {
    if (savedDocument === undefined) delete environment.document; else environment.document = savedDocument;
    if (savedLocation === undefined) delete environment.location; else environment.location = savedLocation;
    if (savedNamespace === undefined) delete environment.__nativeReleaseTestNamespace;
    else environment.__nativeReleaseTestNamespace = savedNamespace;
  }
});

test("current-window local activation uses canonical snapshot readback when the sidebar is absent", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.refresh = async () => snapshot("local:task-a", "local:task-a");
  let legacyObserverCalls = 0;
  bridge.evaluate = async (expression: string) => {
    if (expression === FOREGROUND_RENDERER_PROBE_EXPRESSION) {
      return { hasFocus: true, visibilityState: "visible" };
    }
    legacyObserverCalls += 1;
    return false;
  };

  await bridge.observeThreadActivated("local:task-a");
  assert.equal(legacyObserverCalls, 0);
});
