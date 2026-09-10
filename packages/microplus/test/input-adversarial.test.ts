import WebSocket from "ws";
import assert from "node:assert/strict";
import test from "node:test";
import type {
  DialRotateEvent,
  KeyDownEvent,
  KeyUpEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { Agent1, Dictation, Fast, KeycapMic, Plan, Reasoning } from "../src/actions.js";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import { DeckController } from "../src/controller.js";
import { PlusConversationDial } from "../src/plus-actions.js";
import type { MicroSnapshot, OperationRequest } from "../src/types.js";

type Dispatch = { phase: string; physicalId: string; act: number };
type BridgeHarness = {
  socket: WebSocket;
  targetIdentity: string;
  connectionEpoch: number;
  pageEpoch: number;
  lastSnapshot: MicroSnapshot | undefined;
  refresh(): Promise<MicroSnapshot>;
  observeOperation(operation: OperationRequest): Promise<void>;
  observeThreadActivated(threadKey: string): Promise<void>;
  close(): void;
  dispatch(
    eventName: string,
    payload: { event: { act: number } },
    expectedEventName: string,
    operation?: OperationRequest,
  ): Promise<void>;
  sessionOwnership: { markOpened(threadKey: string): void };
};

type ControllerHarness = {
  microBridge: BridgeHarness;
  snapshot: MicroSnapshot;
  health: { state: "ready"; changedAt: number };
};

function snapshot(pageEpoch = 7): MicroSnapshot {
  return {
    slots: [
      { id: 0, threadKey: "thread-a", title: "A", status: "idle", selected: true },
      ...Array.from({ length: 5 }, (_, offset) => ({
        id: offset + 1,
        threadKey: null,
        title: null,
        status: "off" as const,
        selected: false,
      })),
    ],
    activeThreadKey: "thread-a",
    layout: {
      version: 1,
      slots: {
        ACT06: { keycapId: "FAST" },
        ACT10: { keycapId: "MIC" },
        ACT11: { keycapId: "MIC1" },
      },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

function configuredController(dispatches: Dispatch[]): { controller: DeckController; bridge: BridgeHarness } {
  const initial = snapshot();
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as BridgeHarness;
  bridge.connectionEpoch = initial.connectionEpoch;
  bridge.pageEpoch = initial.pageEpoch;
  bridge.targetIdentity = initial.targetIdentity;
  bridge.lastSnapshot = initial;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.refresh = async () => {
    const current = snapshot(bridge.pageEpoch);
    bridge.lastSnapshot = current;
    return current;
  };
  bridge.observeOperation = async () => undefined;
  bridge.observeThreadActivated = async () => undefined;
  bridge.sessionOwnership = { markOpened: () => undefined };
  bridge.dispatch = async (_eventName, payload, _expectedEventName, operation) => {
    assert.ok(operation);
    dispatches.push({
      phase: operation.phase,
      physicalId: operation.physicalId,
      act: payload.event.act,
    });
  };

  const controller = new DeckController();
  Object.assign(controller as unknown as ControllerHarness, {
    microBridge: bridge,
    snapshot: initial,
    health: { state: "ready", changedAt: 0 },
  });
  return { controller, bridge };
}

function keyEvent(id: string, onAlert: () => void = () => assert.fail(`unexpected alert from ${id}`)) {
  return {
    action: {
      id,
      isKey: () => true,
      isDial: () => false,
      setImage: async () => undefined,
      setTitle: async () => undefined,
      showAlert: async () => onAlert(),
    },
    payload: { settings: {} },
  } as AsEvent;
}

type AsEvent = {
  action: {
    id: string;
    isKey(): boolean;
    isDial(): boolean;
    setImage(image?: string): Promise<void>;
    setTitle(title?: string): Promise<void>;
    showAlert(): Promise<void>;
  };
  payload: { settings: Record<string, never> };
};

test("fast key preserves a quick physical down/up through the actual action, controller, and bridge", async () => {
  const dispatches: Dispatch[] = [];
  const { controller, bridge } = configuredController(dispatches);
  let releaseRefresh!: () => void;
  let noteRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { noteRefresh = resolve; });
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let refreshCount = 0;
  bridge.refresh = async () => {
    refreshCount += 1;
    if (refreshCount === 1) {
      noteRefresh();
      await refreshGate;
    }
    const current = snapshot(bridge.pageEpoch);
    bridge.lastSnapshot = current;
    return current;
  };
  const fast = new Fast(controller);
  const event = keyEvent("fast-placement");

  const down = fast.onKeyDown(event as unknown as KeyDownEvent);
  await refreshStarted;
  const up = fast.onKeyUp(event as unknown as KeyUpEvent);
  releaseRefresh();
  await Promise.all([down, up]);

  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
  ]);
});

test("slow press feedback cannot let a quick key-up overtake its key-down", async () => {
  const dispatches: Dispatch[] = [];
  const { controller } = configuredController(dispatches);
  let releasePressFeedback!: () => void;
  let notePressFeedback!: () => void;
  const pressFeedbackStarted = new Promise<void>((resolve) => { notePressFeedback = resolve; });
  const pressFeedbackGate = new Promise<void>((resolve) => { releasePressFeedback = resolve; });
  let delayNextImage = false;
  const event = keyEvent("slow-feedback");
  event.action.setImage = async () => {
    if (!delayNextImage) return;
    delayNextImage = false;
    notePressFeedback();
    await pressFeedbackGate;
  };
  const fast = new Fast(controller);
  fast.onWillAppear(event as unknown as WillAppearEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));

  delayNextImage = true;
  const down = fast.onKeyDown(event as unknown as KeyDownEvent);
  await pressFeedbackStarted;
  const up = fast.onKeyUp(event as unknown as KeyUpEvent);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
  ]);
  releasePressFeedback();
  await Promise.all([down, up]);

  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
  ]);
});

test("rapid same-owner down/up/down/up replays both pairs and leaves the resource unheld", async () => {
  const dispatches: Dispatch[] = [];
  const { controller, bridge } = configuredController(dispatches);
  let releaseRefresh!: () => void;
  let noteRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { noteRefresh = resolve; });
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let refreshCount = 0;
  bridge.refresh = async () => {
    refreshCount += 1;
    if (refreshCount === 1) {
      noteRefresh();
      await refreshGate;
    }
    const current = snapshot(bridge.pageEpoch);
    bridge.lastSnapshot = current;
    return current;
  };
  const fast = new Fast(controller);
  const event = keyEvent("fast-replay");

  const firstDown = fast.onKeyDown(event as unknown as KeyDownEvent);
  await refreshStarted;
  const firstUp = fast.onKeyUp(event as unknown as KeyUpEvent);
  const secondDown = fast.onKeyDown(event as unknown as KeyDownEvent);
  const secondUp = fast.onKeyUp(event as unknown as KeyUpEvent);
  releaseRefresh();
  await Promise.all([firstDown, firstUp, secondDown, secondUp]);

  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
  ]);

  const probe = new Fast(controller);
  const probeEvent = keyEvent("fast-probe");
  await probe.onKeyDown(probeEvent as unknown as KeyDownEvent);
  await probe.onKeyUp(probeEvent as unknown as KeyUpEvent);
  assert.deepEqual(dispatches.slice(-2), [
    { phase: "down", physicalId: "ACT06", act: 1 },
    { phase: "up", physicalId: "ACT06", act: 0 },
  ]);
});

test("controller stop waits for a pending PTT down, releases it, then closes the bridge", async () => {
  const dispatches: Dispatch[] = [];
  const { controller, bridge } = configuredController(dispatches);
  let releaseRefresh!: () => void;
  let noteRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { noteRefresh = resolve; });
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const closedAfterDispatchCounts: number[] = [];
  const originalRefresh = bridge.refresh;
  bridge.refresh = async () => {
    noteRefresh();
    await refreshGate;
    return originalRefresh();
  };
  bridge.close = () => { closedAfterDispatchCounts.push(dispatches.length); };
  const dictation = new Dictation(controller);
  const event = keyEvent("shutdown-ptt");

  const down = dictation.onKeyDown(event as unknown as KeyDownEvent);
  await refreshStarted;
  const stopped = controller.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatches, []);
  assert.deepEqual(closedAfterDispatchCounts, []);

  releaseRefresh();
  await Promise.all([down, stopped]);
  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT10", act: 1 },
    { phase: "up", physicalId: "ACT10", act: 0 },
  ]);
  assert.deepEqual(closedAfterDispatchCounts, [2]);
});

test("physical and semantic PTT placements cannot cross-own or cross-release one microphone", async () => {
  const dispatches: Dispatch[] = [];
  const { controller } = configuredController(dispatches);
  let semanticAlerts = 0;
  const physicalEvent = keyEvent("physical-ptt");
  const semanticEvent = keyEvent("semantic-ptt", () => { semanticAlerts += 1; });
  const physical = new Dictation(controller);
  const semantic = new KeycapMic(controller);

  await physical.onKeyDown(physicalEvent as unknown as KeyDownEvent);
  await semantic.onKeyDown(semanticEvent as unknown as KeyDownEvent);
  await semantic.onKeyUp(semanticEvent as unknown as KeyUpEvent);

  assert.equal(semanticAlerts, 1);
  assert.deepEqual(dispatches, [{ phase: "down", physicalId: "ACT10", act: 1 }]);

  await physical.onKeyUp(physicalEvent as unknown as KeyUpEvent);
  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT10", act: 1 },
    { phase: "up", physicalId: "ACT10", act: 0 },
  ]);
});

test("disappearance releases every native held input exactly once", async () => {
  const dispatches: Dispatch[] = [];
  const { controller } = configuredController(dispatches);
  const cases = [
    { action: new Agent1(controller), event: keyEvent("agent-placement") },
    { action: new Plan(controller), event: keyEvent("joystick-placement") },
    { action: new Reasoning(controller), event: keyEvent("encoder-placement") },
  ];

  for (const { action, event } of cases) {
    await action.onKeyDown(event as unknown as KeyDownEvent);
    await action.onWillDisappear(event as unknown as WillDisappearEvent);
    await action.onWillDisappear(event as unknown as WillDisappearEvent);
  }

  assert.deepEqual(dispatches.map(({ phase, physicalId }) => [phase, physicalId]), [
    ["down", "AG00"],
    ["up", "AG00"],
    ["down", "JOY_UP"],
    ["up", "JOY_UP"],
    ["down", "ENC_CLK"],
    ["up", "ENC_CLK"],
  ]);
});

test("an unrelated action appearance does not invalidate a held input guard", async () => {
  const dispatches: Dispatch[] = [];
  const { controller, bridge } = configuredController(dispatches);
  const held = new Plan(controller);
  const unrelated = new Reasoning(controller);
  const heldEvent = keyEvent("held-joystick");
  const unrelatedEvent = keyEvent("unrelated-encoder");

  held.onWillAppear(heldEvent as unknown as WillAppearEvent);
  await held.onKeyDown(heldEvent as unknown as KeyDownEvent);
  const heldPageEpoch = bridge.pageEpoch;
  unrelated.onWillAppear(unrelatedEvent as unknown as WillAppearEvent);
  assert.equal(bridge.pageEpoch, heldPageEpoch);
  await held.onKeyUp(heldEvent as unknown as KeyUpEvent);

  assert.deepEqual(dispatches.map(({ phase, physicalId }) => [phase, physicalId]), [
    ["down", "JOY_UP"],
    ["up", "JOY_UP"],
  ]);
});

test("concurrent navigation dial callbacks preserve every physical tick", async () => {
  const dispatches: Dispatch[] = [];
  const { controller } = configuredController(dispatches);
  const dial = new PlusConversationDial(controller);
  let alerts = 0;
  const event = {
    action: {
      id: "navigation-dial",
      isDial: () => true,
      setFeedbackLayout: async () => undefined,
      setFeedback: async () => undefined,
      showAlert: async () => { alerts += 1; },
    },
    payload: { ticks: 1, settings: {} },
  };
  dial.onWillAppear(event as unknown as WillAppearEvent);

  await Promise.all([
    dial.onDialRotate(event as unknown as DialRotateEvent),
    dial.onDialRotate(event as unknown as DialRotateEvent),
  ]);

  assert.equal(alerts, 0);
  assert.deepEqual(dispatches.map(({ phase, physicalId }) => [phase, physicalId]), [
    ["down", "JOY_RIGHT"],
    ["up", "JOY_RIGHT"],
    ["down", "JOY_RIGHT"],
    ["up", "JOY_RIGHT"],
  ]);
});
