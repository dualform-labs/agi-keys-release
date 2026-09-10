import assert from "node:assert/strict";
import test from "node:test";
import type { DialDownEvent, DialUpEvent, KeyDownEvent, KeyUpEvent, TouchTapEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { Dictation, Reasoning } from "../src/actions.js";
import {
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_NATIVE_BRIDGE_SHA256,
  OperationIntegrityGuard,
  assertFreshActiveThread,
  assertFreshOperationTarget,
  readNativeUiSurface,
  resolveAgentDispatch,
  selectVerifiedOpenedSideChat,
  selectNativeCommandRunner
} from "../src/codex-micro-renderer-bridge.js";
import { DeckController, reasoningDialValue } from "../src/controller.js";
import { PlusConversationDial, PlusReasoningDial } from "../src/plus-actions.js";
import type { MicroSnapshot, MutationConfirmation, OperationRequest, ReasoningAdjustment } from "../src/types.js";

type DispatchCall = {
  eventName: string;
  payload: unknown;
  expectedEventName: string;
  operation?: OperationRequest;
};

type BridgeHarness = {
  socket: WebSocket;
  refreshUsage(): Promise<MicroSnapshot>;
  sendEncoder(act: 0 | 1): Promise<void>;
  sendAction(slot: "ACT10" | "ACT11", act: 0 | 1): Promise<void>;
  releaseAction(slot: "ACT10" | "ACT11", options?: { onlyIfHeld?: boolean }): Promise<void>;
  adjustReasoning(direction: ReasoningAdjustment): Promise<void>;
  dispatch(eventName: string, payload: unknown, expectedEventName: string, operation?: OperationRequest): Promise<void>;
  refresh(): Promise<MicroSnapshot>;
  observeOperation(operation: OperationRequest): Promise<void>;
  advancePageEpoch(): void;
  connectionEpoch: number;
  pageEpoch: number;
  lastSnapshot: MicroSnapshot;
};

test("usage refresh awaits the one native query before reading the resulting snapshot", async () => {
  const sequence: string[] = [];
  const snapshot = microSnapshot(["thread-a", null, null, null, null, null]);
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness & {
    ensureConnected(): Promise<void>;
    evaluate<T>(expression: string): Promise<T>;
  };
  bridge.ensureConnected = async () => { sequence.push("connected"); };
  bridge.evaluate = async <T>(expression: string) => {
    assert.match(expression, /await matches\[0\]\.fetch\(\)/);
    assert.match(expression, /matches\.length !== 1/);
    sequence.push("native-query-awaited");
    return true as T;
  };
  bridge.refresh = async () => {
    sequence.push("snapshot-read");
    return snapshot;
  };

  assert.equal(await bridge.refreshUsage(), snapshot);
  assert.deepEqual(sequence, ["connected", "native-query-awaited", "snapshot-read"]);
});

type ControllerHarness = {
  plusDials: Map<string, { kind: "reasoning" | "navigation" }>;
  health: { state: "ready" };
  sendEncoder(act: 0 | 1): Promise<void>;
  pressEncoder(actionId: string): Promise<void>;
  releaseInput(actionId: string): Promise<void>;
  plusDialDown(actionId: string): Promise<void>;
  plusDialUp(actionId: string): Promise<void>;
};

type AgentBridgeHarness = {
  refresh(): Promise<MicroSnapshot>;
  sendAgent(slot: number, act: 0 | 1, expectedThreadKey?: string): Promise<void>;
  dispatch(eventName: string, payload: unknown, expectedEventName: string): Promise<void>;
  observeThreadActivated(threadKey: string): Promise<void>;
  sessionOwnership: { markOpened(threadKey: string): void };
  observeOperation(operation: OperationRequest): Promise<void>;
  socket: WebSocket;
  targetIdentity: string;
  connectionEpoch: number;
  pageEpoch: number;
  lastSnapshot: MicroSnapshot;
};

test("reasoning keypad and non-agent dial presses reach the native encoder handler", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);

  const harness = {} as ControllerHarness;
  const controller = harness as unknown as DeckController;
  harness.plusDials = new Map([
    ["reasoning-dial", { kind: "reasoning" }],
    ["navigation-dial", { kind: "navigation" }],
  ]);
  harness.health = { state: "ready" };
  harness.sendEncoder = (act) => bridge.sendEncoder(act);
  harness.pressEncoder = async () => { await bridge.sendEncoder(1); };
  harness.releaseInput = async () => { await bridge.sendEncoder(0); };
  harness.plusDialDown = (actionId) => DeckController.prototype.plusDialDown.call(controller, actionId);
  harness.plusDialUp = (actionId) => DeckController.prototype.plusDialUp.call(controller, actionId);

  const keyAction = { showAlert: async () => undefined };
  // The SDK action store reuses one action object throughout an appearance.
  const dialActions = new Map<string, { id: string; showAlert(): Promise<void> }>();
  const dialAction = (id: string) => {
    if (!dialActions.has(id)) dialActions.set(id, { id, showAlert: async () => undefined });
    return dialActions.get(id)!;
  };

  const keypad = new Reasoning(controller);
  await keypad.onKeyDown({ action: keyAction } as unknown as KeyDownEvent);
  await keypad.onKeyUp({ action: keyAction } as unknown as KeyUpEvent);

  const reasoningDial = new PlusReasoningDial(controller);
  await reasoningDial.onDialDown({ action: dialAction("reasoning-dial") } as unknown as DialDownEvent);
  await reasoningDial.onDialUp({ action: dialAction("reasoning-dial") } as unknown as DialUpEvent);

  const navigationDial = new PlusConversationDial(controller);
  await navigationDial.onDialDown({ action: dialAction("navigation-dial") } as unknown as DialDownEvent);
  await navigationDial.onDialUp({ action: dialAction("navigation-dial") } as unknown as DialUpEvent);

  assert.deepEqual(calls.map(({ eventName, expectedEventName }) => [eventName, expectedEventName]), [
    ["codex-micro-hid-event", "codex-micro-hid-event"],
    ["codex-micro-hid-event", "codex-micro-hid-event"],
    ["codex-micro-hid-event", "codex-micro-hid-event"],
    ["codex-micro-hid-event", "codex-micro-hid-event"],
    ["codex-micro-hid-event", "codex-micro-hid-event"],
    ["codex-micro-hid-event", "codex-micro-hid-event"],
  ]);
  assert.deepEqual(calls.map(({ payload }) => (payload as { event: unknown }).event), [
    { key: "ENC_CLK", act: 1, slot: null, threadKey: null },
    { key: "ENC_CLK", act: 0, slot: null, threadKey: null },
    { key: "ENC_CLK", act: 1, slot: null, threadKey: null },
    { key: "ENC_CLK", act: 0, slot: null, threadKey: null },
    { key: "ENC_CLK", act: 1, slot: null, threadKey: null },
    { key: "ENC_CLK", act: 0, slot: null, threadKey: null },
  ]);
});

test("dial touch and touch-hold use the configured paired press without changing dial down/up", async () => {
  const calls: string[] = [];
  const controller = {
    setActionPreferences: () => undefined,
    plusDialDown: async (actionId: string) => { calls.push(`down:${actionId}`); },
    plusDialUp: async (actionId: string) => { calls.push(`up:${actionId}`); },
  } as unknown as DeckController;
  const dial = new PlusReasoningDial(controller);
  const action = { id: "reasoning-dial", showAlert: async () => assert.fail("unexpected alert") };
  const event = (hold: boolean, settings: Record<string, unknown> = {}) => ({
    action,
    payload: { hold, tapPos: [100, 50], settings },
  }) as unknown as TouchTapEvent;

  await dial.onTouchTap(event(false, { dialTouchBehavior: "press" }));
  await dial.onTouchTap(event(true, { dialLongPressBehavior: "press" }));
  assert.deepEqual(calls, ["down:reasoning-dial", "up:reasoning-dial", "down:reasoning-dial", "up:reasoning-dial"]);
});

test("duplicate touch-hold events do not fire a second dial press while the first is active", async () => {
  const calls: string[] = [];
  let finishDown!: () => void;
  const downGate = new Promise<void>((resolve) => { finishDown = resolve; });
  const controller = {
    setActionPreferences: () => undefined,
    plusDialDown: async (actionId: string) => { calls.push(`down:${actionId}`); await downGate; },
    plusDialUp: async (actionId: string) => { calls.push(`up:${actionId}`); },
  } as unknown as DeckController;
  const dial = new PlusReasoningDial(controller);
  const action = { id: "reasoning-dial", showAlert: async () => assert.fail("unexpected alert") };
  const event = {
    action,
    payload: { hold: true, tapPos: [100, 50], settings: { dialLongPressBehavior: "press" } },
  } as unknown as TouchTapEvent;

  const first = dial.onTouchTap(event);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = dial.onTouchTap(event);
  finishDown();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["down:reasoning-dial", "up:reasoning-dial"]);
});

test("physical dial ownership ignores overlapping touch without an early release", async () => {
  const calls: string[] = [];
  let finishDown!: () => void;
  const downGate = new Promise<void>((resolve) => { finishDown = resolve; });
  const controller = {
    setActionPreferences: () => undefined,
    plusDialDown: async (actionId: string) => { calls.push(`down:${actionId}`); await downGate; },
    plusDialUp: async (actionId: string) => { calls.push(`up:${actionId}`); },
  } as unknown as DeckController;
  const dial = new PlusReasoningDial(controller);
  const action = { id: "reasoning-dial", showAlert: async () => assert.fail("unexpected alert") };
  const touch = {
    action,
    payload: { hold: true, tapPos: [100, 50], settings: { dialLongPressBehavior: "press" } },
  } as unknown as TouchTapEvent;

  const physicalDown = dial.onDialDown({ action } as unknown as DialDownEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const overlappingTouch = dial.onTouchTap(touch);
  const physicalUp = dial.onDialUp({ action } as unknown as DialUpEvent);
  assert.deepEqual(calls, ["down:reasoning-dial"]);

  finishDown();
  await Promise.all([physicalDown, overlappingTouch, physicalUp]);
  assert.deepEqual(calls, ["down:reasoning-dial", "up:reasoning-dial"]);
});

test("touch ownership ignores overlapping physical down/up and releases once", async () => {
  const calls: string[] = [];
  let finishDown!: () => void;
  const downGate = new Promise<void>((resolve) => { finishDown = resolve; });
  const controller = {
    setActionPreferences: () => undefined,
    plusDialDown: async (actionId: string) => { calls.push(`down:${actionId}`); await downGate; },
    plusDialUp: async (actionId: string) => { calls.push(`up:${actionId}`); },
  } as unknown as DeckController;
  const dial = new PlusReasoningDial(controller);
  const action = { id: "reasoning-dial", showAlert: async () => assert.fail("unexpected alert") };
  const touch = {
    action,
    payload: { hold: false, tapPos: [100, 50], settings: { dialTouchBehavior: "press" } },
  } as unknown as TouchTapEvent;

  const touchPress = dial.onTouchTap(touch);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const physicalDown = dial.onDialDown({ action } as unknown as DialDownEvent);
  const physicalUp = dial.onDialUp({ action } as unknown as DialUpEvent);
  assert.deepEqual(calls, ["down:reasoning-dial"]);

  finishDown();
  await Promise.all([touchPress, physicalDown, physicalUp]);
  assert.deepEqual(calls, ["down:reasoning-dial", "up:reasoning-dial"]);
});

test("disappearance shares the active touch release instead of sending a second release", async () => {
  const calls: string[] = [];
  let finishDown!: () => void;
  const downGate = new Promise<void>((resolve) => { finishDown = resolve; });
  const controller = {
    setActionPreferences: () => undefined,
    plusDialDown: async (actionId: string) => { calls.push(`down:${actionId}`); await downGate; },
    plusDialUp: async (actionId: string) => { calls.push(`up:${actionId}`); },
    unregisterPlusDial: () => undefined,
  } as unknown as DeckController;
  const dial = new PlusReasoningDial(controller);
  const action = { id: "reasoning-dial", showAlert: async () => assert.fail("unexpected alert") };
  const touch = {
    action,
    payload: { hold: true, tapPos: [100, 50], settings: { dialLongPressBehavior: "press" } },
  } as unknown as TouchTapEvent;

  const touchPress = dial.onTouchTap(touch);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const disappearance = dial.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["down:reasoning-dial"]);

  finishDown();
  await Promise.all([touchPress, disappearance]);
  assert.deepEqual(calls, ["down:reasoning-dial", "up:reasoning-dial"]);
});

test("ACT10 and ACT11 dispatch as distinct physical events", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);

  await bridge.sendAction("ACT10", 1);
  await bridge.sendAction("ACT10", 0);
  await bridge.sendAction("ACT11", 1);
  await bridge.sendAction("ACT11", 0);

  assert.deepEqual(calls.map(({ payload }) => (payload as { event: unknown }).event), [
    { key: "ACT10", act: 1, slot: null, threadKey: null },
    { key: "ACT10", act: 0, slot: null, threadKey: null },
    { key: "ACT11", act: 1, slot: null, threadKey: null },
    { key: "ACT11", act: 0, slot: null, threadKey: null },
  ]);
  assert.deepEqual(calls.map(({ operation }) => operation?.physicalId), ["ACT10", "ACT10", "ACT11", "ACT11"]);
  assert.ok(calls.every(({ operation }) => operation?.requestId && operation.operationId));
});

test("ACT12 preserves confirmed versus unverified submission without repeating down", async () => {
  const before = microSnapshot(["local:send-thread", null, null, null, null, null]);
  before.layout.slots.ACT12 = { keycapId: "CODEX" };
  before.activeThreadKey = "local:send-thread";
  before.activeComposerKey = "composer-1";
  const after = {
    ...before,
    slots: before.slots.map((slot, index) => index === 0 ? { ...slot, status: "working" } : slot),
  };
  const operation = operationRequest({
    physicalId: "ACT12",
    phase: "down",
    activeThreadKey: before.activeThreadKey,
    activeComposerKey: before.activeComposerKey,
  });
  const confirmation: MutationConfirmation = {
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
    observedSnapshot: after,
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    sendAction(slot: "ACT12", act: 0 | 1): Promise<MutationConfirmation | void>;
    beginOperation(): Promise<OperationRequest>;
    dispatch(type: string, payload: { event: { act: number } }): Promise<void>;
    observeOperation(): Promise<MutationConfirmation>;
    observeContentFreeCommand(): Promise<MutationConfirmation>;
    lastSnapshot: MicroSnapshot;
    socket: WebSocket;
    targetIdentity: string;
    connectionEpoch: number;
    operationTargetLeases: Map<string, { socket: WebSocket; targetIdentity: string; connectionEpoch: number }>;
  };
  const socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.socket = socket;
  bridge.targetIdentity = operation.targetIdentity;
  bridge.connectionEpoch = operation.connectionEpoch;
  bridge.operationTargetLeases.set(operation.operationId, {
    socket,
    targetIdentity: operation.targetIdentity,
    connectionEpoch: operation.connectionEpoch,
  });
  bridge.lastSnapshot = before;
  bridge.beginOperation = async () => {
    bridge.operationTargetLeases.set(operation.operationId, {
      socket,
      targetIdentity: operation.targetIdentity,
      connectionEpoch: operation.connectionEpoch,
    });
    return operation;
  };
  const dispatched: number[] = [];
  bridge.dispatch = async (_type, payload) => { dispatched.push(payload.event.act); };
  bridge.observeOperation = async () => confirmation;

  const observed = await bridge.sendAction("ACT12", 1);
  assert.equal(observed?.semanticOutcome, "confirmed");
  await bridge.sendAction("ACT12", 0);

  bridge.observeContentFreeCommand = async () => confirmation;
  const unverified = await bridge.sendAction("ACT12", 1);
  assert.equal(unverified?.semanticOutcome, "unverified");
  assert.deepEqual(dispatched, [1, 0, 1], "unknown result neither rolls back nor repeats down");
  await assert.rejects(() => bridge.sendAction("ACT12", 1), /E_DUPLICATE_DOWN/);
  assert.deepEqual(dispatched, [1, 0, 1], "duplicate down cannot submit a second message");
  await bridge.sendAction("ACT12", 0);
  assert.deepEqual(dispatched, [1, 0, 1, 0], "normal key-up retires the retained native hold");

  bridge.observeContentFreeCommand = async () => { throw new Error("E_TARGET_STALE"); };
  await assert.rejects(() => bridge.sendAction("ACT12", 1), /E_TARGET_STALE/);
  await bridge.sendAction("ACT12", 0);
  assert.deepEqual(dispatched, [1, 0, 1, 0, 1, 0]);
});

test("clockwise reasoning ticks increase and counter-clockwise ticks decrease", async () => {
  const requested: ReasoningAdjustment[] = [];
  const harness = {
    plusDials: new Map([["reasoning-dial", { kind: "reasoning" as const }]]),
    actionPreferences: new Map(),
    health: { state: "ready" as const },
    adjustReasoning: async (direction: ReasoningAdjustment) => {
      requested.push(direction);
      return { dispatch: "accepted" as const, metadata: "matched" as const, semanticOutcome: "reasoning-changed" as const };
    },
    refresh: async () => undefined,
    setOperationFeedback: async () => undefined,
    rotationQueue: Promise.resolve(),
  };
  const controller = harness as unknown as DeckController;

  const rotateNow = DeckController.prototype as unknown as {
    plusDialRotateNow(this: DeckController, actionId: string, ticks: number): Promise<void>;
  };
  await rotateNow.plusDialRotateNow.call(controller, "reasoning-dial", 2);
  await rotateNow.plusDialRotateNow.call(controller, "reasoning-dial", -1);

  assert.deepEqual(requested, ["increase", "increase", "decrease"]);
});

test("reasoning adjustments invoke the fixed native reasoning keycaps independent of encoder mode", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  const keycaps: string[] = [];
  (bridge as unknown as { runKeycap(keycapId: string): Promise<void> }).runKeycap = async (keycapId) => { keycaps.push(keycapId); };

  await bridge.adjustReasoning("increase");
  await bridge.adjustReasoning("decrease");

  assert.deepEqual(keycaps, ["MIND+", "MIND-"]);
  assert.deepEqual(calls, []);
});

test("standalone keycaps select only the current native two-argument command runner export", () => {
  const runner = (_command: string, _source: string) => true;
  assert.equal(selectNativeCommandRunner({ I5: runner }, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), runner);
  assert.equal(selectNativeCommandRunner({ i: runner }, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeCommandRunner({ I5: "not-a-function" }, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeCommandRunner({ I5: runner }, "different-build", CURRENT_APP_INITIAL_SHA256, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeCommandRunner({ I5: runner }, CURRENT_NATIVE_BRIDGE_SHA256, "different-module", CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
  const generated = Function(`return (${selectNativeCommandRunner.toString()})`)() as typeof selectNativeCommandRunner;
  assert.equal(generated({ I5: runner }, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256, CURRENT_NATIVE_BRIDGE_SHA256, CURRENT_APP_INITIAL_SHA256), runner);
});

test("native UI readback exposes only structural markers and classifies approved routes", () => {
  const marker = (ariaHidden?: string, secret = "private-path") => ({
    getAttribute(name: string) {
      if (name === "aria-hidden") return ariaHidden ?? null;
      if (name === "data-review-path") return secret;
      return null;
    },
  });
  const doc = {
    defaultView: { location: { pathname: "/settings/codex-micro" } },
    querySelectorAll(selector: string) {
      if (selector === "[data-codex-terminal], [data-codex-xterm]") return [marker("true"), marker()];
      if (selector === "[data-diffs-header], [data-file-tree-id], [data-review-path]") return [marker("true")];
      if (selector === "[data-browser-sidebar-browser-tab-id]") return [marker(), marker("true"), marker()];
      return [];
    },
  } as unknown as Document;
  const generated = Function(`return (${readNativeUiSurface.toString()})`)() as typeof readNativeUiSurface;
  const observed = generated(doc);
  assert.deepEqual(observed, {
    route: "codex-micro-settings",
    terminalVisible: true,
    reviewVisible: false,
    browserTabCount: 2,
  });
  assert.doesNotMatch(JSON.stringify(observed), /private-path/);
});

test("access-gated keycaps build the pinned native scope and capability checks", async () => {
  const snapshot = microSnapshot(["thread-a", null, null, null, null, null]);
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "TERM" | "TIME" | "LAB"): Promise<unknown>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  primeBridgeTarget(bridge, snapshot);
  (bridge as unknown as { targetIdentity: string }).targetIdentity = snapshot.targetIdentity;
  bridge.lastSnapshot = snapshot;
  bridge.refresh = async () => snapshot;
  bridge.observeOperation = async () => ({ dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" });
  const expressions: string[] = [];
  bridge.evaluate = async <T>(expression: string) => {
    expressions.push(expression);
    const operationId = expression.match(/return "([0-9a-f-]{36})";/)?.[1];
    assert.ok(operationId);
    return operationId as T;
  };
  await bridge.runKeycap("TERM");
  await bridge.runKeycap("TIME");
  await bridge.runKeycap("LAB");
  assert.ok(expressions.every((expression) => expression.includes("appInitial.QHt")));
  assert.ok(expressions.some((expression) => expression.includes("automations.local") && expression.includes("automations.cloud")));
  assert.ok(expressions.every((expression) => expression.includes(CURRENT_APP_INITIAL_SHA256)));
  const labExpression = expressions.at(-1)!;
  assert.match(labExpression, /codexMicroSettings/);
  assert.match(labExpression, /expectedNativeUiCommand/);
  assert.match(labExpression, /native-ui-changed/);
});

test("CODEX confirms only after same-composer task activity is read back", async () => {
  const idle = {
    ...microSnapshot(["thread-a", null, null, null, null, null]),
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
  };
  const working = {
    ...idle,
    slots: idle.slots.map((slot) => slot.threadKey === "thread-a"
      ? { ...slot, status: "thinking" }
      : slot),
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "CODEX"): Promise<{ semanticOutcome: string }>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = idle.connectionEpoch;
  bridge.pageEpoch = idle.pageEpoch;
  primeBridgeTarget(bridge, idle);
  bridge.lastSnapshot = idle;
  let refreshes = 0;
  bridge.refresh = async () => ++refreshes >= 2 ? working : idle;
  bridge.observeOperation = async () => ({
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
    observedSnapshot: idle,
  });
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/return "([0-9a-f-]{36})";/)?.[1];
    assert.ok(operationId);
    return operationId as T;
  };

  assert.equal((await bridge.runKeycap("CODEX")).semanticOutcome, "confirmed");
  assert.equal(refreshes, 2);
});

test("content-free keycaps never promote a generic command acknowledgement", async () => {
  const snapshot = {
    ...microSnapshot(["thread-a", null, null, null, null, null]),
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "FAST" | "CODEX"): Promise<{ semanticOutcome: string }>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  primeBridgeTarget(bridge, snapshot);
  bridge.lastSnapshot = snapshot;
  bridge.refresh = async () => snapshot;
  bridge.observeOperation = async () => ({
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
    observedSnapshot: snapshot,
  });
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/return "([0-9a-f-]{36})";/)?.[1];
    assert.ok(operationId);
    return operationId as T;
  };

  assert.equal((await bridge.runKeycap("FAST")).semanticOutcome, "unverified");
  assert.equal((await bridge.runKeycap("CODEX")).semanticOutcome, "unverified");
});

test("CODEX result observation rejects a newer page even when task activity advances", async () => {
  const idle = {
    ...microSnapshot(["thread-a", null, null, null, null, null]),
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
  };
  const differentPage = {
    ...idle,
    pageEpoch: idle.pageEpoch + 1,
    slots: idle.slots.map((slot) => slot.threadKey === "thread-a"
      ? { ...slot, status: "thinking" }
      : slot),
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "CODEX"): Promise<{ semanticOutcome: string }>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = idle.connectionEpoch;
  bridge.pageEpoch = idle.pageEpoch;
  primeBridgeTarget(bridge, idle);
  bridge.lastSnapshot = idle;
  let refreshes = 0;
  bridge.refresh = async () => ++refreshes >= 2 ? differentPage : idle;
  bridge.observeOperation = async () => ({
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
    observedSnapshot: idle,
  });
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/return "([0-9a-f-]{36})";/)?.[1];
    assert.ok(operationId);
    return operationId as T;
  };

  await assert.rejects(bridge.runKeycap("CODEX"), /E_PAGE_STALE/);
});

test("agent dispatch requires the expected thread to remain in the requested physical slot", () => {
  const snapshot = microSnapshot(["thread-a", "thread-b", null, null, null, null]);
  assert.deepEqual(resolveAgentDispatch(snapshot, 0, "thread-a"), {
    kind: "native",
    slot: 0,
    threadKey: "thread-a",
  });

  const relocated = microSnapshot(["thread-new", "thread-a", null, null, null, null]);
  assert.throws(
    () => resolveAgentDispatch(relocated, 0, "thread-a"),
    /changed before dispatch; reselect the task/
  );
  const outsideSlots = microSnapshot(["thread-new", "thread-b", null, null, null, null]);
  assert.throws(
    () => resolveAgentDispatch(outsideSlots, 0, "thread-a"),
    /changed before dispatch; reselect the task/
  );
});

test("stale agent identity emits no native event and never activates the relocated thread", async () => {
  const dispatches: DispatchCall[] = [];
  const activations: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as AgentBridgeHarness;
  bridge.refresh = async () => microSnapshot(["thread-new", "thread-a", null, null, null, null]);
  bridge.dispatch = async (eventName, payload, expectedEventName) => {
    dispatches.push({ eventName, payload, expectedEventName });
  };
  bridge.observeThreadActivated = async (threadKey) => { activations.push(threadKey); };
  bridge.sessionOwnership = { markOpened: () => undefined };

  await assert.rejects(
    bridge.sendAgent(0, 1, "thread-a"),
    /changed before dispatch; reselect the task/
  );
  assert.deepEqual(dispatches, []);
  assert.deepEqual(activations, []);
});

test("fresh exact-slot agent identity emits the requested physical slot once", async () => {
  const dispatches: DispatchCall[] = [];
  const activations: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as AgentBridgeHarness;
  const snapshot = microSnapshot(["thread-a", "thread-b", null, null, null, null]);
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  bridge.lastSnapshot = snapshot;
  bridge.socket = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  bridge.targetIdentity = snapshot.targetIdentity;
  bridge.refresh = async () => snapshot;
  bridge.dispatch = async (eventName, payload, expectedEventName) => {
    dispatches.push({ eventName, payload, expectedEventName });
  };
  bridge.observeThreadActivated = async (threadKey) => { activations.push(threadKey); };
  bridge.observeOperation = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };

  await bridge.sendAgent(0, 1, "thread-a");
  assert.deepEqual(dispatches.map(({ payload }) => (payload as { event: unknown }).event), [
    { key: "AG00", act: 1, slot: 0, threadKey: "thread-a" },
  ]);
  assert.deepEqual(activations, ["thread-a"]);
});

test("an already selected exact agent remains a verified idempotent activation", async () => {
  const dispatches: DispatchCall[] = [];
  const observed: Array<{ threadKey: string; alreadyActive: boolean }> = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as AgentBridgeHarness & {
    observeThreadActivated(threadKey: string, alreadyActive?: boolean): Promise<void>;
  };
  const snapshot = {
    ...microSnapshot(["thread-a", "thread-b", null, null, null, null]),
    activeThreadKey: "thread-a",
  };
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  bridge.lastSnapshot = snapshot;
  bridge.socket = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  bridge.targetIdentity = snapshot.targetIdentity;
  bridge.refresh = async () => snapshot;
  bridge.dispatch = async (eventName, payload, expectedEventName) => {
    dispatches.push({ eventName, payload, expectedEventName });
  };
  bridge.observeThreadActivated = async (threadKey: string, alreadyActive: boolean = false) => {
    observed.push({ threadKey, alreadyActive });
  };
  bridge.observeOperation = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };

  await bridge.sendAgent(0, 1, "thread-a");

  assert.equal(dispatches.length, 1);
  assert.deepEqual(observed, [{ threadKey: "thread-a", alreadyActive: true }]);
});

test("agent activation holds the same target through dispatch and foreground proof, then releases it", async () => {
  const sourceSocket = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  const source = microSnapshot(["thread-a", "thread-b", null, null, null, null]);
  source.targetIdentity = "source-window";
  const operation: OperationRequest = {
    ...operationRequest({ physicalId: "AG00", targetIdentity: source.targetIdentity }),
    phase: "down",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = sourceSocket;
  bridge.targetIdentity = source.targetIdentity;
  bridge.connectionEpoch = source.connectionEpoch;
  bridge.pageEpoch = source.pageEpoch;
  bridge.lastSnapshot = source;
  bridge.refresh = async () => source;
  bridge.beginOperation = async () => operation;
  const phases: Array<{ name: string; leaseCount: number; target: string; sourceSocket: boolean }> = [];
  bridge.dispatch = async (_eventName: string, payload: { event: unknown }, _expected: string, dispatched: OperationRequest) => {
    phases.push({ name: `dispatch:${(payload.event as { act: number }).act}`, leaseCount: bridge.operationTargetLeases.size, target: dispatched.targetIdentity, sourceSocket: bridge.socket === sourceSocket });
  };
  bridge.observeOperation = async () => {
    phases.push({ name: "source-readback", leaseCount: bridge.operationTargetLeases.size, target: bridge.targetIdentity, sourceSocket: bridge.socket === sourceSocket });
  };
  bridge.observeThreadActivated = async () => {
    phases.push({ name: "foreground-proof", leaseCount: bridge.operationTargetLeases.size, target: bridge.targetIdentity, sourceSocket: bridge.socket === sourceSocket });
  };
  bridge.sessionOwnership = { markOpened: () => undefined };

  await bridge.sendAgent(0, 1, "thread-a");

  assert.deepEqual(phases, [
    { name: "dispatch:1", leaseCount: 1, target: "source-window", sourceSocket: true },
    { name: "source-readback", leaseCount: 1, target: "source-window", sourceSocket: true },
    { name: "foreground-proof", leaseCount: 1, target: "source-window", sourceSocket: true },
  ]);
  assert.equal(bridge.operationTargetLeases.size, 0);
});

test("agent dispatch rejects a background source before any native event", async () => {
  const source = microSnapshot(["thread-a", "thread-b", null, null, null, null]);
  const sourceSocket = { readyState: WebSocket.OPEN } as unknown as WebSocket;
  source.targetIdentity = "source-window";
  const operation: OperationRequest = {
    ...operationRequest({ physicalId: "AG00", targetIdentity: source.targetIdentity }),
    phase: "down",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.socket = sourceSocket;
  bridge.targetIdentity = source.targetIdentity;
  bridge.connectionEpoch = source.connectionEpoch;
  bridge.pageEpoch = source.pageEpoch;
  bridge.lastSnapshot = source;
  bridge.refresh = async () => source;
  bridge.beginOperation = async () => operation;
  bridge.ensureConnected = async () => undefined;
  let evaluated = 0;
  bridge.evaluateOnSocket = async (_socket: WebSocket, expression: string) => {
    evaluated += 1;
    const evaluate = Function("document", "return (" + expression + ")") as (document: unknown) => Promise<unknown>;
    return await evaluate({ hasFocus: () => false, visibilityState: "visible" });
  };
  let sourceReadback = 0;
  bridge.observeOperation = async () => { sourceReadback += 1; };
  bridge.observeThreadActivated = async () => { throw new Error("observer must not run"); };
  bridge.sessionOwnership = { markOpened: () => undefined };

  await assert.rejects(bridge.sendAgent(0, 1, "thread-a"), /E_FOREGROUND_TARGET_STALE/);

  assert.equal(evaluated, 1);
  assert.equal(sourceReadback, 0);
  assert.equal(bridge.operationTargetLeases.size, 0);
});

test("side-chat success requires the preserved main scope and one active side scope", () => {
  const main = { isConnected: true } as unknown as Element;
  const side = { isConnected: true } as unknown as Element;
  const roots = [main, side];
  const scopes = new Map<Element, { value: { kind: string; placement: string } }>([
    [main, { value: { kind: "local", placement: "main" } }],
    [side, { value: { kind: "local", placement: "side" } }],
  ]);
  const doc = { querySelectorAll: () => roots } as unknown as Document;
  const selectScope = ((_doc: Document, root: Element | null) => scopes.get(root!)) as never;
  const resolveActive = () => ({ root: side, activeThreadKey: "local:side-thread" });

  assert.deepEqual(
    selectVerifiedOpenedSideChat(doc, main, selectScope, {}, {}, {}, resolveActive),
    { root: side, activeThreadKey: "local:side-thread" },
  );

  const unrelated = { isConnected: true } as unknown as Element;
  roots.push(unrelated);
  scopes.set(unrelated, { value: { kind: "local", placement: "side" } });
  assert.equal(
    selectVerifiedOpenedSideChat(doc, main, selectScope, {}, {}, {}, resolveActive),
    null,
    "an unrelated second side composer must not satisfy the postcondition",
  );
});

test("side-chat success accepts current AppScope wrappers whose value is null", () => {
  const main = { isConnected: true } as unknown as Element;
  const side = { isConnected: true } as unknown as Element;
  const roots = [main, side];
  const scopes = new Map<Element, { node: object; chain: object; value: null }>([
    [main, { node: {}, chain: {}, value: null }],
    [side, { node: {}, chain: {}, value: null }],
  ]);
  const doc = { querySelectorAll: () => roots } as unknown as Document;
  const selectScope = ((_doc: Document, root: Element | null) => scopes.get(root!)) as never;
  const resolveActive = () => ({ root: side, activeThreadKey: "local:side-thread" });

  assert.deepEqual(
    selectVerifiedOpenedSideChat(doc, main, selectScope, {}, {}, {}, resolveActive),
    { root: side, activeThreadKey: "local:side-thread" },
  );
});

test("side-chat success tolerates unrelated composers that existed before the command", () => {
  const main = { isConnected: true } as unknown as Element;
  const unrelated = { isConnected: true } as unknown as Element;
  const side = { isConnected: true } as unknown as Element;
  const roots = [main, unrelated, side];
  const scopes = new Map<Element, { node: object; chain: object; value: null }>([
    [main, { node: {}, chain: {}, value: null }],
    [side, { node: {}, chain: {}, value: null }],
  ]);
  const doc = { querySelectorAll: () => roots } as unknown as Document;
  const selectScope = ((_doc: Document, root: Element | null) => scopes.get(root!)) as never;
  const resolveActive = () => ({ root: main, activeThreadKey: "local:main-thread" });

  assert.deepEqual(
    selectVerifiedOpenedSideChat(doc, main, selectScope, {}, {}, {}, resolveActive, [main, unrelated]),
    { root: side },
  );
  assert.equal(
    selectVerifiedOpenedSideChat(doc, main, selectScope, {}, {}, {}, resolveActive, [main, unrelated, side]),
    null,
    "an already-mounted composer activation is not proof that this command opened it",
  );
});

test("PARTY forwards only its exact verified side-chat identity to the post-dispatch observer", async () => {
  const snapshot = {
    ...microSnapshot(["local:main-thread", null, null, null, null, null]),
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "PARTY"): Promise<unknown>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(
      operation: OperationRequest,
      direction: undefined,
      postcondition: { kind: string; activeThreadKey: string; activeComposerKey: string; sideComposerKey: string },
    ): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  primeBridgeTarget(bridge, snapshot);
  bridge.lastSnapshot = snapshot;
  bridge.refresh = async () => snapshot;
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    return {
      operationId,
      postcondition: {
        kind: "side-chat-opened",
        activeThreadKey: "local:main-thread",
        activeComposerKey: "composer-1",
        sideComposerKey: "composer-2",
      },
    } as T;
  };
  let observedPostcondition: unknown;
  bridge.observeOperation = async (_operation, _direction, postcondition) => {
    observedPostcondition = postcondition;
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };

  await bridge.runKeycap("PARTY");
  assert.deepEqual(observedPostcondition, {
    kind: "side-chat-opened",
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
    sideComposerKey: "composer-2",
  });
});

test("side-chat observer preserves the main identity after verifying the added side composer", async () => {
  const before = {
    ...microSnapshot(["local:main-thread", null, null, null, null, null]),
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
  };
  const operation: OperationRequest = {
    version: 1,
    requestId: "request-postcondition",
    operationId: "operation-postcondition",
    connectionEpoch: before.connectionEpoch,
    pageEpoch: before.pageEpoch,
    physicalId: "KEYCAP_PARTY",
    phase: "invoke",
    mappingFingerprint: before.mappingFingerprint,
    targetIdentity: before.targetIdentity,
    activeThreadKey: before.activeThreadKey,
    activeComposerKey: before.activeComposerKey,
  };
  const expectedPostcondition = {
    kind: "side-chat-opened" as const,
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
    sideComposerKey: "composer-2",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    observeOperation(
      operation: OperationRequest,
      direction: undefined,
      verifiedPostcondition: {
        kind: "side-chat-opened";
        activeThreadKey: string;
        activeComposerKey: string;
        sideComposerKey: string;
      },
    ): Promise<{ observedSnapshot?: MicroSnapshot }>;
    refresh(): Promise<MicroSnapshot>;
    lastSnapshot: MicroSnapshot;
  };
  bridge.lastSnapshot = before;
  const verified = { ...before };
  bridge.refresh = async () => verified;
  assert.equal((await bridge.observeOperation(operation, undefined, expectedPostcondition)).observedSnapshot, verified);

  bridge.refresh = async () => ({ ...verified, activeThreadKey: "local:unrelated-thread" });
  await assert.rejects(
    bridge.observeOperation(operation, undefined, expectedPostcondition),
    /E_ACTIVE_THREAD_STALE/,
  );
});

test("SPLIT forwards the exact forked thread transition to the post-dispatch observer", async () => {
  const before = {
    ...microSnapshot(["local:main-thread", null, null, null, null, null]),
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "SPLIT"): Promise<unknown>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest, direction: undefined, postcondition: unknown): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = before.connectionEpoch;
  bridge.pageEpoch = before.pageEpoch;
  primeBridgeTarget(bridge, before);
  bridge.lastSnapshot = before;
  bridge.refresh = async () => before;
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1]
      ?? expression.match(/return "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    return {
      operationId,
      postcondition: {
        kind: "active-view-transition",
        transition: "forked",
        fromActiveThreadKey: "local:main-thread",
        fromActiveComposerKey: "composer-1",
        activeThreadKey: "local:forked-thread",
        activeComposerKey: "composer-2",
      },
    } as T;
  };
  let observedPostcondition: unknown;
  bridge.observeOperation = async (_operation, _direction, postcondition) => {
    observedPostcondition = postcondition;
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };

  await bridge.runKeycap("SPLIT");
  assert.deepEqual(observedPostcondition, {
    kind: "active-view-transition",
    transition: "forked",
    fromActiveThreadKey: "local:main-thread",
    fromActiveComposerKey: "composer-1",
    activeThreadKey: "local:forked-thread",
    activeComposerKey: "composer-2",
  });
});

test("DEL accepts an exact transition to no active thread and rejects an unrelated thread", async () => {
  const before = {
    ...microSnapshot(["local:archived-thread", null, null, null, null, null]),
    activeThreadKey: "local:archived-thread",
    activeComposerKey: "composer-1",
  };
  const operation: OperationRequest = {
    version: 1,
    requestId: "request-archive-transition",
    operationId: "operation-archive-transition",
    connectionEpoch: before.connectionEpoch,
    pageEpoch: before.pageEpoch,
    physicalId: "KEYCAP_DEL",
    phase: "invoke",
    mappingFingerprint: before.mappingFingerprint,
    targetIdentity: before.targetIdentity,
    activeThreadKey: before.activeThreadKey,
    activeComposerKey: before.activeComposerKey,
  };
  const expectedPostcondition = {
    kind: "active-view-transition" as const,
    transition: "archived" as const,
    fromActiveThreadKey: "local:archived-thread",
    fromActiveComposerKey: "composer-1",
    activeThreadKey: null,
    activeComposerKey: "composer-2",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    observeOperation(
      operation: OperationRequest,
      direction: undefined,
      postcondition: typeof expectedPostcondition,
    ): Promise<{ semanticOutcome: string }>;
    refresh(): Promise<MicroSnapshot>;
    lastSnapshot: MicroSnapshot;
  };
  bridge.lastSnapshot = before;
  bridge.refresh = async () => {
    const { activeThreadKey: _activeThreadKey, ...withoutActiveThread } = before;
    return { ...withoutActiveThread, activeComposerKey: "composer-2" };
  };
  assert.equal(
    (await bridge.observeOperation(operation, undefined, expectedPostcondition)).semanticOutcome,
    "confirmed",
  );

  bridge.refresh = async () => ({ ...before, activeThreadKey: "local:unrelated-thread", activeComposerKey: "composer-3" });
  await assert.rejects(
    bridge.observeOperation(operation, undefined, expectedPostcondition),
    /E_ACTIVE_THREAD_STALE/,
  );
});

test("NEW forwards a content-free new-composer transition instead of accepting any refresh", async () => {
  const before = {
    ...microSnapshot(["local:main-thread", null, null, null, null, null]),
    activeThreadKey: "local:main-thread",
    activeComposerKey: "composer-1",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "NEW"): Promise<unknown>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest, direction: undefined, postcondition: unknown): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = before.connectionEpoch;
  bridge.pageEpoch = before.pageEpoch;
  primeBridgeTarget(bridge, before);
  bridge.lastSnapshot = before;
  bridge.refresh = async () => before;
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1]
      ?? expression.match(/return "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    return {
      operationId,
      postcondition: {
        kind: "active-view-transition",
        transition: "new-task",
        fromActiveThreadKey: "local:main-thread",
        fromActiveComposerKey: "composer-1",
        activeThreadKey: null,
        activeComposerKey: "composer-2",
      },
    } as T;
  };
  let observedPostcondition: unknown;
  bridge.observeOperation = async (_operation, _direction, postcondition) => {
    observedPostcondition = postcondition;
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };

  await bridge.runKeycap("NEW");
  assert.deepEqual(observedPostcondition, {
    kind: "active-view-transition",
    transition: "new-task",
    fromActiveThreadKey: "local:main-thread",
    fromActiveComposerKey: "composer-1",
    activeThreadKey: null,
    activeComposerKey: "composer-2",
  });
});

test("NEW can transition from the global task surface with no active composer", async () => {
  const base = microSnapshot([null, null, null, null, null, null]);
  const {
    activeThreadKey: _activeThreadKey,
    activeComposerKey: _activeComposerKey,
    composerReadback: _composerReadback,
    ...globalSurface
  } = base;
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    runKeycap(keycapId: "NEW"): Promise<unknown>;
    refresh(): Promise<MicroSnapshot>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(operation: OperationRequest, direction: undefined, postcondition: unknown): Promise<unknown>;
    connectionEpoch: number;
    pageEpoch: number;
    lastSnapshot: MicroSnapshot;
  };
  bridge.connectionEpoch = globalSurface.connectionEpoch;
  bridge.pageEpoch = globalSurface.pageEpoch;
  primeBridgeTarget(bridge, globalSurface);
  bridge.lastSnapshot = globalSurface;
  bridge.refresh = async () => globalSurface;
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1]
      ?? expression.match(/return "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    return {
      operationId,
      postcondition: {
        kind: "active-view-transition",
        transition: "new-task",
        fromActiveThreadKey: null,
        fromActiveComposerKey: null,
        activeThreadKey: null,
        activeComposerKey: "composer-1",
      },
    } as T;
  };
  let observedPostcondition: unknown;
  bridge.observeOperation = async (_operation, _direction, postcondition) => {
    observedPostcondition = postcondition;
    return { dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" };
  };

  await bridge.runKeycap("NEW");
  assert.deepEqual(observedPostcondition, {
    kind: "active-view-transition",
    transition: "new-task",
    fromActiveThreadKey: null,
    fromActiveComposerKey: null,
    activeThreadKey: null,
    activeComposerKey: "composer-1",
  });
});

test("agent dispatch rejects a mapping change observed immediately before mutation", async () => {
  const dispatches: DispatchCall[] = [];
  const expected = microSnapshot(["thread-a", null, null, null, null, null]);
  const current = { ...expected, mappingFingerprint: "mapping-b" };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as AgentBridgeHarness;
  bridge.connectionEpoch = expected.connectionEpoch;
  bridge.pageEpoch = expected.pageEpoch;
  bridge.lastSnapshot = expected;
  bridge.refresh = async () => {
    bridge.lastSnapshot = current;
    return current;
  };
  bridge.dispatch = async (eventName, payload, expectedEventName) => {
    dispatches.push({ eventName, payload, expectedEventName });
  };
  bridge.observeThreadActivated = async () => undefined;
  bridge.observeOperation = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };

  await assert.rejects(bridge.sendAgent(0, 1, "thread-a"), /E_MAPPING_STALE/);
  assert.deepEqual(dispatches, []);
});

test("reasoning dial labels an unobserved current effort honestly", () => {
  assert.equal(reasoningDialValue("準備完了"), "準備完了 · 現在値 未取得 · 操作待ち");
  assert.equal(reasoningDialValue("準備完了", "increase"), "準備完了 · 現在値 未取得 · 上げる操作を送信");
});

test("operation integrity rejects duplicate IDs and out-of-order releases before dispatch", () => {
  const guard = new OperationIntegrityGuard();
  const down = operationRequest({ operationId: "op-down", requestId: "req-down", phase: "down" });
  guard.accept(down, 3, 7);
  assert.throws(() => guard.accept(down, 3, 7), /E_DUPLICATE_OPERATION/);
  assert.throws(
    () => guard.accept(operationRequest({ operationId: "op-replayed", requestId: "req-down", physicalId: "ACT11" }), 3, 7),
    /E_DUPLICATE_REQUEST/
  );
  assert.throws(
    () => guard.accept(operationRequest({ operationId: "op-up-other", requestId: "req-up-other", physicalId: "ACT11", phase: "up" }), 3, 7),
    /E_OUT_OF_ORDER_UP/
  );
  guard.accept(operationRequest({ operationId: "op-up", requestId: "req-up", phase: "up" }), 3, 7);
});

test("operation integrity rejects stale connection and page epochs without changing key state", () => {
  const guard = new OperationIntegrityGuard();
  assert.throws(() => guard.accept(operationRequest(), 4, 7), /E_CONNECTION_STALE/);
  assert.throws(() => guard.accept(operationRequest({ connectionEpoch: 4, pageEpoch: 6 }), 4, 7), /E_PAGE_STALE/);
  guard.accept(operationRequest({ connectionEpoch: 4 }), 4, 7);
});

test("mapping and target attestation must still match immediately before mutation", () => {
  const expected = microSnapshot(["thread-a", null, null, null, null, null]);
  const changedMapping = { ...expected, mappingFingerprint: "mapping-b" };
  const changedTarget = { ...expected, targetIdentity: "target-b" };
  assert.throws(() => assertFreshOperationTarget(expected, changedMapping), /E_MAPPING_STALE/);
  assert.throws(() => assertFreshOperationTarget(expected, changedTarget), /E_TARGET_STALE/);
  assert.doesNotThrow(() => assertFreshOperationTarget(expected, { ...expected }));
});

test("view-scoped freshness binds the exact active task", () => {
  const expected = { ...microSnapshot(["thread-a", null, null, null, null, null]), activeThreadKey: "thread-a" };
  assert.doesNotThrow(() => assertFreshActiveThread(expected, { ...expected }));
  assert.throws(() => assertFreshActiveThread(expected, { ...expected, activeThreadKey: "thread-b" }), /E_ACTIVE_THREAD_STALE/);
  const { activeThreadKey: _omitted, ...withoutActiveThread } = expected;
  assert.throws(() => assertFreshActiveThread(expected, withoutActiveThread), /E_ACTIVE_(?:THREAD|COMPOSER)_STALE/);
});

test("view-scoped freshness preserves an unsubmitted draft by composer identity", () => {
  const draft = microSnapshot([null, null, null, null, null, null]);
  assert.equal(draft.activeThreadKey, undefined);
  assert.equal(draft.activeComposerKey, "composer-1");
  assert.doesNotThrow(() => assertFreshActiveThread(draft, { ...draft }));
  assert.throws(() => assertFreshActiveThread(draft, { ...draft, activeComposerKey: "composer-2" }), /E_ACTIVE_COMPOSER_STALE/);
});

test("confirmed reset outcome is retained by request ID while refresh status stays separate", async () => {
  let stored: import("../src/reset-outcome-store.js").PersistedResetAttempt | undefined;
  const bridge = new CodexMicroRendererBridge(() => undefined, {
    read: async () => stored,
    write: async (value) => { stored = value; },
  }) as unknown as {
    consumeRateLimitReset(requestId: string): Promise<{ code: string; refresh: string; redeemRequestId: string }>;
    ensureConnected(): Promise<void>;
    prepareRateLimitReset(requestId: string): Promise<string>;
    evaluate<T>(expression: string): Promise<T>;
  };
  let evaluations = 0;
  bridge.ensureConnected = async () => undefined;
  bridge.prepareRateLimitReset = async () => "credit-1";
  bridge.evaluate = async <T>(expression: string) => {
    evaluations += 1;
    assert.match(expression, /stable-reset-request/);
    return { code: "reset", refresh: "failed", redeemRequestId: "stable-reset-request" } as T;
  };
  const first = await bridge.consumeRateLimitReset("stable-reset-request");
  const retry = await bridge.consumeRateLimitReset("stable-reset-request");
  assert.deepEqual(first, { code: "reset", refresh: "failed", redeemRequestId: "stable-reset-request" });
  assert.deepEqual(retry, first);
  assert.equal(evaluations, 1);
});

test("uncertain reset send can retry with the same idempotency key", async () => {
  let stored: import("../src/reset-outcome-store.js").PersistedResetAttempt | undefined;
  const bridge = new CodexMicroRendererBridge(() => undefined, {
    read: async () => stored,
    write: async (value) => { stored = value; },
  }) as unknown as {
    consumeRateLimitReset(requestId: string): Promise<{ code: string; refresh: string; redeemRequestId: string }>;
    ensureConnected(): Promise<void>;
    prepareRateLimitReset(requestId: string): Promise<string>;
    evaluate<T>(expression: string): Promise<T>;
    disconnect(): void;
  };
  const expressions: string[] = [];
  bridge.ensureConnected = async () => undefined;
  bridge.prepareRateLimitReset = async () => "credit-1";
  bridge.disconnect = () => undefined;
  bridge.evaluate = async <T>(expression: string) => {
    expressions.push(expression);
    if (expressions.length === 1) throw new Error("timeout");
    return { code: "already_redeemed", refresh: "updated", redeemRequestId: "uncertain-reset-request" } as T;
  };
  await assert.rejects(bridge.consumeRateLimitReset("uncertain-reset-request"), /timeout/);
  const retry = await bridge.consumeRateLimitReset("uncertain-reset-request");
  assert.equal(retry.code, "already_redeemed");
  assert.equal(expressions.length, 2);
  assert.ok(expressions.every((expression) => expression.includes("uncertain-reset-request")));
});

test("concurrent distinct reset IDs share one bridge-wide consume attempt", async () => {
  let stored: import("../src/reset-outcome-store.js").PersistedResetAttempt | undefined;
  const bridge = new CodexMicroRendererBridge(() => undefined, {
    read: async () => stored,
    write: async (value) => { stored = value; },
  }) as unknown as {
    consumeRateLimitReset(requestId: string): Promise<{ code: string; refresh: string; redeemRequestId: string }>;
    ensureConnected(): Promise<void>;
    prepareRateLimitReset(requestId: string): Promise<string>;
    evaluate<T>(expression: string): Promise<T>;
  };
  let evaluations = 0;
  bridge.ensureConnected = async () => undefined;
  bridge.prepareRateLimitReset = async () => "credit-1";
  bridge.evaluate = async <T>() => {
    evaluations += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { code: "reset", refresh: "updated", redeemRequestId: "concurrent-request-a" } as T;
  };
  const first = bridge.consumeRateLimitReset("concurrent-request-a");
  const second = bridge.consumeRateLimitReset("concurrent-request-b");
  assert.equal(first, second);
  assert.equal((await second).redeemRequestId, "concurrent-request-a");
  assert.equal(evaluations, 1);
});

test("a reconstructed bridge resumes the persisted pending reset ID and credit", async () => {
  let stored: import("../src/reset-outcome-store.js").PersistedResetAttempt | undefined;
  const store = {
    read: async () => stored,
    write: async (value: import("../src/reset-outcome-store.js").PersistedResetAttempt) => { stored = value; },
  };
  const makeBridge = () => new CodexMicroRendererBridge(() => undefined, store) as unknown as {
    consumeRateLimitReset(requestId: string): Promise<{ code: string; refresh: string; redeemRequestId: string }>;
    ensureConnected(): Promise<void>;
    prepareRateLimitReset(requestId: string): Promise<string>;
    evaluate<T>(expression: string): Promise<T>;
  };
  const first = makeBridge();
  first.ensureConnected = async () => undefined;
  first.prepareRateLimitReset = async () => "persisted-credit";
  first.evaluate = async () => { throw new Error("uncertain"); };
  await assert.rejects(first.consumeRateLimitReset("persisted-request"), /uncertain/);
  assert.deepEqual(stored, { version: 1, redeemRequestId: "persisted-request", creditId: "persisted-credit" });

  const reconstructed = makeBridge();
  reconstructed.ensureConnected = async () => undefined;
  reconstructed.prepareRateLimitReset = async () => { throw new Error("must reuse persisted credit"); };
  reconstructed.evaluate = async <T>(expression: string) => {
    assert.match(expression, /persisted-request/);
    assert.match(expression, /persisted-credit/);
    return { code: "already_redeemed", refresh: "updated", redeemRequestId: "persisted-request" } as T;
  };
  const resumed = await reconstructed.consumeRateLimitReset("different-new-request");
  assert.equal(resumed.redeemRequestId, "persisted-request");
});

test("page lifecycle invalidates the old snapshot baseline", () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    lastSnapshot: MicroSnapshot | undefined;
    pageEpoch: number;
    advancePageEpoch(): void;
  };
  bridge.lastSnapshot = microSnapshot(["thread-a", null, null, null, null, null]);
  bridge.pageEpoch = 7;
  bridge.advancePageEpoch();
  assert.equal(bridge.pageEpoch, 8);
  assert.equal(bridge.lastSnapshot, undefined);
});

test("public close permanently prevents late operations from reconnecting", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined);
  bridge.close();
  await assert.rejects(bridge.refresh(), /E_BRIDGE_CLOSED/);
  await assert.rejects(bridge.sendAction("ACT06", 1), /E_BRIDGE_CLOSED/);
});

test("PTT disappearance sends at most one release for a successful down", async () => {
  const events: Array<0 | 1> = [];
  const controller = {
    pressMicroAction: async () => { events.push(1); },
    releaseInput: async () => { if (events.at(-1) !== 0) events.push(0); },
    unregisterMicroAction: () => undefined,
  } as unknown as DeckController;
  const action = { id: "ptt", isKey: () => true, showAlert: async () => undefined };
  const dictation = new Dictation(controller);

  await dictation.onKeyDown({ action } as unknown as KeyDownEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);
  await dictation.onKeyUp({ action } as unknown as KeyUpEvent);

  assert.deepEqual(events, [1, 0]);
});

test("PTT keeps release responsibility when post-dispatch observation fails", async () => {
  const events: Array<0 | 1> = [];
  const controller = {
    pressMicroAction: async () => {
      events.push(1);
      throw new Error("post-dispatch snapshot unavailable");
    },
    releaseInput: async () => { events.push(0); },
    unregisterMicroAction: () => undefined,
  } as unknown as DeckController;
  const action = { id: "ptt-uncertain", isKey: () => true, showAlert: async () => undefined };
  const dictation = new Dictation(controller);

  await dictation.onKeyDown({ action } as unknown as KeyDownEvent);
  await dictation.onWillDisappear({ action } as unknown as WillDisappearEvent);

  assert.deepEqual(events, [1, 0]);
});

test("bridge rebases a pre-dispatch orphan PTT release into one safety-up", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  await bridge.releaseAction("ACT10");
  assert.equal(calls.length, 1);
  const [release] = calls;
  assert.ok(release);
  assert.deepEqual((release.payload as { event: unknown }).event, { key: "ACT10", act: 0, slot: null, threadKey: null });
  assert.equal(release.operation?.phase, "safety-up");
});

test("failed PTT down rollback does not synthesize an up when no down reached the renderer", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);

  await bridge.releaseAction("ACT10", { onlyIfHeld: true });

  assert.equal(calls.length, 0);
});

test("PTT release retains the exact task and composer captured by its down", async () => {
  const calls: DispatchCall[] = [];
  const initial = {
    ...microSnapshot(["thread-a", "thread-b", null, null, null, null]),
    activeThreadKey: "thread-a",
    activeComposerKey: "composer-1",
  };
  let current = initial;
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  bridge.connectionEpoch = initial.connectionEpoch;
  bridge.pageEpoch = initial.pageEpoch;
  bridge.lastSnapshot = initial;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.refresh = async () => current;
  bridge.dispatch = async (eventName, payload, expectedEventName, operation) => {
    calls.push({ eventName, payload, expectedEventName, ...(operation ? { operation } : {}) });
  };

  await bridge.sendAction("ACT10", 1);
  current = {
    ...initial,
    activeThreadKey: "thread-b",
    activeComposerKey: "composer-2",
  };
  await bridge.releaseAction("ACT10");

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ operation }) => ({
      phase: operation?.phase,
      activeThreadKey: operation?.activeThreadKey,
      activeComposerKey: operation?.activeComposerKey,
    })),
    [
      { phase: "down", activeThreadKey: "thread-a", activeComposerKey: "composer-1" },
      { phase: "up", activeThreadKey: "thread-a", activeComposerKey: "composer-1" },
    ],
  );
});

test("bridge never retries a PTT release after post-dispatch observation failure", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);
  bridge.observeOperation = async () => { throw new Error("observer disconnected"); };

  await assert.rejects(bridge.releaseAction("ACT10"), /observer disconnected/);
  bridge.advancePageEpoch();
  await assert.rejects(bridge.releaseAction("ACT10"), /E_RELEASE_ALREADY_ATTEMPTED/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.operation?.phase, "safety-up");
});

test("bridge reserves a PTT release before async preparation", async () => {
  const calls: DispatchCall[] = [];
  const bridge = configuredBridge(calls);

  const results = await Promise.allSettled([
    bridge.releaseAction("ACT10"),
    bridge.releaseAction("ACT10"),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.operation?.phase, "safety-up");
});

function microSnapshot(threadKeys: Array<string | null>): MicroSnapshot {
  return {
    slots: threadKeys.map((threadKey, id) => ({
      id,
      threadKey,
      title: threadKey,
      status: threadKey ? "idle" : "off",
      selected: id === 0,
    })),
    ...(threadKeys[0] ? { activeThreadKey: threadKeys[0] } : { activeComposerKey: "composer-1" }),
    layout: {
      version: 1,
      slots: {
        ACT06: { keycapId: "FAST" },
        ACT07: { keycapId: "APPR" },
        ACT08: { keycapId: "REJ" },
        ACT09: { keycapId: "SPLIT" },
        ACT10: { keycapId: "MIC" },
        ACT11: { keycapId: "MIC1" },
        ACT12: { keycapId: "SUBM" },
      },
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

function operationRequest(overrides: Partial<OperationRequest> = {}): OperationRequest {
  return {
    version: 1,
    requestId: "req-1",
    operationId: "op-1",
    connectionEpoch: 3,
    pageEpoch: 7,
    physicalId: "ACT10",
    phase: "down",
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
    ...overrides,
  };
}

function primeBridgeTarget(bridge: object, snapshot: MicroSnapshot): void {
  const target = bridge as { socket: WebSocket; targetIdentity: string };
  target.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  target.targetIdentity = snapshot.targetIdentity;
}

function configuredBridge(calls: DispatchCall[]): BridgeHarness {
  const snapshot = microSnapshot(["thread-a", "thread-b", null, null, null, null]);
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  bridge.connectionEpoch = snapshot.connectionEpoch;
  bridge.pageEpoch = snapshot.pageEpoch;
  primeBridgeTarget(bridge, snapshot);
  bridge.lastSnapshot = snapshot;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.refresh = async () => snapshot;
  bridge.observeOperation = async () => undefined;
  bridge.dispatch = async (eventName, payload, expectedEventName, operation) => {
    calls.push({ eventName, payload, expectedEventName, ...(operation ? { operation } : {}) });
  };
  return bridge;
}
