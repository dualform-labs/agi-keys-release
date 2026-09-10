import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import type { HostHealth, MicroAgentSlot, MicroSnapshot } from "../src/types.js";

type Feedback = {
  phase: "pending" | "held" | "sent-unverified" | "error";
  detail?: string;
  target?: string;
};

type FakeKey = {
  id: string;
  images: string[];
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type ControllerInternals = {
  snapshot: MicroSnapshot;
  snapshotRevision: number;
  health: HostHealth;
  operationFeedback: Map<string, Feedback>;
  animationFrame: number;
  animationDelay: number;
  animation?: NodeJS.Timeout;
  renderedAgentBindings: Map<string, unknown>;
  renderAgent(registration: { action: KeyAction; slot: number }): Promise<void>;
  renderAnimated(): Promise<void>;
  scheduleAnimation(): void;
};

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

function latest(key: FakeKey): string {
  const image = key.images.at(-1);
  assert.ok(image, `${key.id} did not receive an image`);
  return image;
}

function fakeKey(id: string): FakeKey {
  const key: FakeKey = {
    id,
    images: [],
    setImage: async (image) => {
      if (image) key.images.push(decode(image));
    },
    setTitle: async () => undefined,
  };
  return key;
}

function snapshot(statuses: readonly string[], includeAttention = true): MicroSnapshot {
  const slots = statuses.map((status, id): MicroAgentSlot => {
    const slot: MicroAgentSlot = {
      id,
      threadKey: `thread-${id}`,
      title: `Task ${id + 1}`,
      status,
      selected: id === 0,
    };
    if (id === 0 && includeAttention) {
      slot.goalStatus = "active";
      slot.pendingQuestion = true;
    }
    return slot;
  });
  return {
    slots,
    layout: {
      version: 1,
      slots: {},
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "agent-terminal-animation",
    targetIdentity: "agent-terminal-animation-target",
  };
}

function harness(statuses: readonly string[], includeAttention = true): { controller: DeckController; internals: ControllerInternals } {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.snapshot = snapshot(statuses, includeAttention);
  internals.snapshotRevision = 1;
  internals.health = { state: "ready", changedAt: 0 };
  return { controller, internals };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function register(controller: DeckController, key: FakeKey, slot: number): Promise<void> {
  controller.registerAgent(slot, key as unknown as KeyAction);
  await flush();
  assert.ok(key.images.length > 0, `${key.id} initial render did not complete`);
}

function setFeedback(internals: ControllerInternals, key: FakeKey, feedback: Feedback): void {
  internals.operationFeedback.set(key.id, feedback);
}

async function renderFeedback(
  internals: ControllerInternals,
  key: FakeKey,
  slot: number,
  feedback: Feedback,
): Promise<void> {
  setFeedback(internals, key, feedback);
  await internals.renderAgent({ action: key as unknown as KeyAction, slot });
}

test("terminal errors freeze thinking and input bases while preserving their status identity", async () => {
  for (const [rawStatus, visualStatus, label] of [["thinking", "thinking", "思考中"], ["approval", "input", "入力"]] as const) {
    const { controller, internals } = harness([rawStatus], false);
    const key = fakeKey(`terminal-${visualStatus}`);
    await register(controller, key, 0);

    const base = latest(key);
    assert.match(base, new RegExp(`data-agent-status-label="${visualStatus}"`));

    await renderFeedback(internals, key, 0, {
      phase: "error",
      detail: "E_AGENT_WINDOW_UNVERIFIED",
      target: "AG01",
    });
    const terminal = latest(key);
    const writesAtTerminal = key.images.length;

    // The operation overlay must retain the observed agent state and the
    // selected/attention surfaces while the terminal frame stays stable.
    assert.match(terminal, new RegExp(`data-agent-status-frame="${visualStatus}"`));
    assert.match(terminal, new RegExp(`aria-label="Codex agent A01 ${label}"`));
    assert.match(terminal, /data-agent-selected="true"/u);
    assert.match(terminal, /data-operation-phase="error"/u);
    assert.match(terminal, new RegExp(`data-agent-motion="${visualStatus === "thinking" ? "working" : "input"}"`));

    internals.animationFrame = 7;
    await internals.renderAnimated();
    assert.equal(key.images.length, writesAtTerminal, `${visualStatus} terminal overlay must not animate`);
    assert.equal(latest(key), terminal, `${visualStatus} terminal frame must remain byte-stable`);

    controller.unregisterAgent(key);
  }
});

test("terminal agent feedback keeps the selected task attention surfaces", async () => {
  const { controller, internals } = harness(["thinking"]);
  const key = fakeKey("terminal-attention");
  await register(controller, key, 0);
  await renderFeedback(internals, key, 0, {
    phase: "error",
    detail: "E_AGENT_WINDOW_UNVERIFIED",
    target: "AG01",
  });

  const terminal = latest(key);
  assert.match(terminal, /data-agent-status-frame="thinking"/u);
  assert.match(terminal, /data-agent-selected="true"/u);
  assert.match(terminal, /data-agent-attention="pending-question"/u);
  assert.match(terminal, /data-agent-attention="goal" data-goal-status="active"/u);
  assert.match(terminal, /data-operation-phase="error"/u);

  controller.unregisterAgent(key);
});

test("terminal agent feedback is excluded from scheduler interaction until it becomes active again", async () => {
  const { controller, internals } = harness(["thinking"]);
  const key = fakeKey("terminal-scheduled");
  await register(controller, key, 0);
  await renderFeedback(internals, key, 0, { phase: "error", detail: "E_AGENT_WINDOW_UNVERIFIED", target: "AG01" });

  internals.scheduleAnimation();
  assert.equal(internals.animationDelay, 200, "a terminal agent must not keep the fast animation scheduler alive");
  if (internals.animation) clearTimeout(internals.animation);

  controller.unregisterAgent(key);
});

test("a healthy thinking slot continues while a different slot is terminal", async () => {
  const { controller, internals } = harness(["thinking", "thinking"]);
  const terminalKey = fakeKey("terminal-slot");
  const healthyKey = fakeKey("healthy-slot");
  await register(controller, terminalKey, 0);
  await register(controller, healthyKey, 1);

  await renderFeedback(internals, terminalKey, 0, {
    phase: "error",
    detail: "E_ACTIVE_THREAD_STALE",
    target: "AG01",
  });
  const terminalWrites = terminalKey.images.length;
  const healthyWrites = healthyKey.images.length;
  const healthyBefore = latest(healthyKey);

  internals.animationFrame = 3;
  await internals.renderAnimated();

  assert.equal(terminalKey.images.length, terminalWrites, "a terminal slot must stay frozen");
  assert.equal(healthyKey.images.length, healthyWrites + 1, "a healthy slot must keep receiving animation frames");
  assert.notEqual(latest(healthyKey), healthyBefore, "the healthy slot must advance its frame");
  assert.match(latest(healthyKey), /data-agent-status-frame="thinking"/u);

  controller.unregisterAgent(terminalKey);
  controller.unregisterAgent(healthyKey);
});

test("pending and cleared feedback resume agent motion, while sent-unverified remains active", async () => {
  const { controller, internals } = harness(["thinking"]);
  const key = fakeKey("feedback-resume");
  await register(controller, key, 0);

  await renderFeedback(internals, key, 0, { phase: "error", detail: "E_AGENT_WINDOW_UNVERIFIED", target: "AG01" });
  const terminalWrites = key.images.length;
  internals.animationFrame = 2;
  await internals.renderAnimated();
  assert.equal(key.images.length, terminalWrites);

  // A non-terminal pending result re-enables the task activity animation.
  await renderFeedback(internals, key, 0, { phase: "pending", detail: "結果確認中", target: "AG01" });
  const pendingWrites = key.images.length;
  internals.animationFrame = 4;
  await internals.renderAnimated();
  assert.equal(key.images.length, pendingWrites + 1);
  assert.match(latest(key), /data-operation-phase="pending"/u);
  assert.notEqual(latest(key), latestBefore(key, pendingWrites), "pending motion must advance after the terminal frame");

  // Clearing feedback also returns to the observed thinking base animation.
  internals.operationFeedback.delete(key.id);
  const clearedWrites = key.images.length;
  internals.animationFrame = 5;
  await internals.renderAnimated();
  assert.equal(key.images.length, clearedWrites + 1);
  assert.doesNotMatch(latest(key), /data-operation-phase=/u);

  // An observer-unverified result is still task activity and must retain motion.
  setFeedback(internals, key, { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED", target: "AG01" });
  await internals.renderAgent({ action: key as unknown as KeyAction, slot: 0 });
  const uncertainWrites = key.images.length;
  const uncertainBefore = latest(key);
  internals.animationFrame = 8;
  await internals.renderAnimated();
  assert.equal(key.images.length, uncertainWrites + 1);
  assert.notEqual(latest(key), uncertainBefore, "sent-unverified must preserve task activity motion");
  assert.match(latest(key), /data-operation-phase="sent-unverified"/u);
  assert.match(latest(key), /data-agent-status-frame="thinking"/u);

  controller.unregisterAgent(key);
});

test("a rejected agent down remains terminal after an immediate key-up", async () => {
  type Deferred = {
    promise: Promise<never>;
    reject(reason: Error): void;
  };
  let rejectDown!: (reason: Error) => void;
  const downGate: Deferred = {
    promise: new Promise<never>((_resolve, reject) => { rejectDown = reject; }),
    reject: (reason) => rejectDown(reason),
  };
  let downStarted!: () => void;
  const downStartedPromise = new Promise<void>((resolve) => { downStarted = resolve; });

  const { controller, internals } = harness(["thinking"], false);
  const key = fakeKey("terminal-immediate-up");
  await register(controller, key, 0);
  const calls: Array<{ act: 0 | 1; expectedThreadKey?: string; unopenedTaskBehavior?: string }> = [];
  const failure = new Error("E_AGENT_WINDOW_UNVERIFIED");
  const bridge = {
    advancePageEpoch: () => undefined,
    sendAgent: async (
      _slot: number,
      act: 0 | 1,
      expectedThreadKey?: string,
      unopenedTaskBehavior?: string,
    ): Promise<void> => {
      calls.push({ act, ...(expectedThreadKey ? { expectedThreadKey } : {}), ...(unopenedTaskBehavior ? { unopenedTaskBehavior } : {}) });
      if (act === 1) {
        downStarted();
        await downGate.promise;
        throw failure;
      }
    },
  };
  (internals as unknown as { microBridge: typeof bridge }).microBridge = bridge;

  const press = controller.pressAgent(key.id, 0);
  // Queue key-up before the down observer resolves. The up must not erase the
  // terminal result once the matching down has failed.
  const release = controller.releaseInput(key.id);
  await downStartedPromise;
  downGate.reject(failure);

  await assert.rejects(press, /E_AGENT_WINDOW_UNVERIFIED/u);
  await release;
  assert.deepEqual(calls.map(({ act }) => act), [1, 0]);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "error",
    detail: "E_AGENT_WINDOW_UNVERIFIED",
    target: "AG01",
  });

  const writesAtTerminal = key.images.length;
  const terminal = latest(key);
  internals.animationFrame = 8;
  await internals.renderAnimated();
  assert.equal(key.images.length, writesAtTerminal);
  assert.equal(latest(key), terminal);

  controller.unregisterAgent(key);
});

test("key-up preserves a fail-fast missing agent binding and does not restart motion", async () => {
  const { controller, internals } = harness(["thinking"], false);
  const key = fakeKey("terminal-missing-binding");
  await register(controller, key, 0);
  internals.renderedAgentBindings.delete(key.id);

  await assert.rejects(controller.pressAgent(key.id, 0), /No Codex task is assigned/u);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "error",
    detail: "E_TARGET_UNAVAILABLE",
  });

  await controller.releaseInput(key.id);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "error",
    detail: "E_TARGET_UNAVAILABLE",
  }, "matching key-up must preserve the fail-fast binding error");
  const terminal = latest(key);
  const writesAtTerminal = key.images.length;

  internals.animationFrame = 8;
  await internals.renderAnimated();
  assert.equal(key.images.length, writesAtTerminal, "a missing binding must not restart agent animation");
  assert.equal(latest(key), terminal);

  controller.unregisterAgent(key);
});

test("an unassigned Micro action keeps its mapping error after key-up", async () => {
  const { controller, internals } = harness(["idle"], false);
  internals.snapshot.layout.separateMicrophoneKeys = false;
  const key = fakeKey("terminal-unassigned-micro");
  controller.registerMicroAction("ACT11", key as unknown as KeyAction);
  await flush();

  await assert.rejects(controller.pressMicroAction(key.id, "ACT11"), /E_MAPPING_INACTIVE/u);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "error",
    detail: "E_MAPPING_INACTIVE",
    target: "ACT11",
  });
  await controller.releaseInput(key.id);
  assert.deepEqual(internals.operationFeedback.get(key.id), {
    phase: "error",
    detail: "E_MAPPING_INACTIVE",
    target: "ACT11",
  }, "matching key-up must preserve the inactive mapping error");
  assert.match(latest(key), /data-operation-phase="error"/u);

  controller.unregisterMicroAction(key);
});

function latestBefore(key: FakeKey, count: number): string {
  assert.ok(count > 0);
  const image = key.images[count - 1];
  assert.ok(image);
  return image;
}
