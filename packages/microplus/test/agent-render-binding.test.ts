import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import type { MicroSnapshot } from "../src/types.js";

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void };
type AgentDispatch = { slot: number; act: 0 | 1; threadKey?: string };

type FakeBridge = {
  calls: AgentDispatch[];
  advancePageEpoch(): void;
  refresh(): Promise<MicroSnapshot>;
  sendAgent(slot: number, act: 0 | 1, expectedThreadKey?: string): Promise<void>;
};

type AgentBinding = {
  action: KeyAction;
  incarnation: number;
  snapshotRevision: number;
  slot: number;
  threadKey: string;
};

type ControllerInternals = {
  snapshot: MicroSnapshot;
  snapshotRevision: number;
  health: { state: "ready"; changedAt: number };
  microBridge: FakeBridge;
  renderAgent(registration: { action: KeyAction; slot: number }): Promise<void>;
  renderedAgentBindings: Map<string, AgentBinding>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function snapshot(threadKey: string, title: string): MicroSnapshot {
  return {
    slots: [{ id: 0, threadKey, title, status: "idle", selected: true }],
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
    mappingFingerprint: "agent-render-binding",
    targetIdentity: "agent-render-binding-target",
  };
}

function titleFromImage(image: string): string {
  const raw = decodeURIComponent(image.slice(image.indexOf(",") + 1));
  return raw.match(/data-agent-title="([^"]+)"/)?.[1] ?? "<missing-title>";
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function harness(initial: MicroSnapshot): {
  controller: DeckController;
  key: KeyAction;
  internals: ControllerInternals;
  images: { attempts: string[]; displayed: string[] };
  blockNextImage(): { started: Promise<void>; release(): void };
  setTitleFailure(value: boolean): void;
} {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const images = { attempts: [] as string[], displayed: [] as string[] };
  let titleFailure = false;
  let block: { started: Deferred<void>; gate: Deferred<void> } | undefined;
  const key: KeyAction = {
    id: "agent-render-binding",
    isKey: () => true,
    setImage: async (image: string | undefined) => {
      if (!image) return;
      const title = titleFromImage(image);
      images.attempts.push(title);
      const currentBlock = block;
      if (currentBlock) {
        block = undefined;
        currentBlock.started.resolve();
        await currentBlock.gate.promise;
      }
      images.displayed.push(title);
    },
    setTitle: async () => {
      if (titleFailure) throw new Error("title write failed");
    },
  } as unknown as KeyAction;
  const bridge: FakeBridge = {
    calls: [],
    advancePageEpoch: () => undefined,
    refresh: async () => internals.snapshot,
    sendAgent: async (slot, act, expectedThreadKey) => {
      bridge.calls.push({ slot, act, ...(expectedThreadKey ? { threadKey: expectedThreadKey } : {}) });
    },
  };
  internals.snapshot = initial;
  internals.snapshotRevision = 1;
  internals.health = { state: "ready", changedAt: 0 };
  internals.microBridge = bridge;

  return {
    controller,
    key,
    internals,
    images,
    blockNextImage: () => {
      const current = { started: deferred<void>(), gate: deferred<void>() };
      block = current;
      return { started: current.started.promise, release: () => current.gate.resolve() };
    },
    setTitleFailure: (value) => { titleFailure = value; },
  };
}

function setSnapshot(internals: ControllerInternals, next: MicroSnapshot): void {
  internals.snapshot = next;
  internals.snapshotRevision += 1;
}

async function registerAndFlush(controller: DeckController, key: KeyAction): Promise<void> {
  controller.registerAgent(0, key);
  await flush();
}

test("agent down fails closed while a reordered task image is still delayed", async () => {
  const { controller, key, internals, images, blockNextImage } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-a");

  setSnapshot(internals, snapshot("thread-b", "Task B"));
  const delayed = blockNextImage();
  const render = internals.renderAgent({ action: key, slot: 0 });
  await delayed.started;
  assert.equal(images.displayed.at(-1), "Task A");

  const press = controller.pressAgent(key.id, 0);
  await flush();
  assert.deepEqual(internals.microBridge.calls, [], "stale display must not dispatch the newly read slot task");

  delayed.release();
  await assert.rejects(press, /No Codex task is assigned/u);
  await render;
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-b");

  await controller.pressAgent(key.id, 0);
  await controller.releaseInput(key.id);
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-b" },
    { slot: 0, act: 0, threadKey: "thread-b" },
  ]);

  controller.unregisterAgent(key);
});

test("same-task snapshot updates keep the rendered identity usable", async () => {
  const { controller, key, internals } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);

  setSnapshot(internals, snapshot("thread-a", "Task A (updated)"));
  await internals.renderAgent({ action: key, slot: 0 });
  await controller.pressAgent(key.id, 0);
  await controller.releaseInput(key.id);

  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
    { slot: 0, act: 0, threadKey: "thread-a" },
  ]);
  controller.unregisterAgent(key);
});

test("same-looking different tasks bind only after their own image write", async () => {
  const { controller, key, internals, images, blockNextImage } = harness(snapshot("thread-a", "Same title"));
  await registerAndFlush(controller, key);
  const attemptsBefore = images.attempts.length;
  setSnapshot(internals, snapshot("thread-b", "Same title"));
  const delayed = blockNextImage();
  const render = internals.renderAgent({ action: key, slot: 0 });
  await delayed.started;
  assert.equal(images.attempts.length, attemptsBefore + 1);
  assert.equal(internals.renderedAgentBindings.has(key.id), false);
  assert.deepEqual(internals.microBridge.calls, []);
  delayed.release();
  await render;
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-b");
  await controller.pressAgent(key.id, 0);
  await controller.releaseInput(key.id);
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-b" },
    { slot: 0, act: 0, threadKey: "thread-b" },
  ]);
  controller.unregisterAgent(key);
});

test("same-task redraw keeps the binding usable while its image write is blocked", async () => {
  const { controller, key, internals, blockNextImage } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);

  setSnapshot(internals, snapshot("thread-a", "Task A (animated)"));
  const delayed = blockNextImage();
  const render = internals.renderAgent({ action: key, slot: 0 });
  await delayed.started;
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-a");

  const press = controller.pressAgent(key.id, 0);
  await flush();
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
  ]);
  const release = controller.releaseInput(key.id);
  await flush();
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
    { slot: 0, act: 0, threadKey: "thread-a" },
  ]);

  delayed.release();
  await render;
  await press;
  await release;
  controller.unregisterAgent(key);
});

test("rendering a non-agent action does not change an agent's committed binding", async () => {
  const { controller, key, internals } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);
  const otherKey = { ...key, id: "unrelated-micro-action" } as KeyAction;

  controller.registerMicroAction("ACT12", otherKey);
  await flush();
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-a");

  await controller.pressAgent(key.id, 0);
  await controller.releaseInput(key.id);
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
    { slot: 0, act: 0, threadKey: "thread-a" },
  ]);
  controller.unregisterMicroAction(otherKey);
  controller.unregisterAgent(key);
});

test("re-registering an agent clears its previous rendered task binding", async () => {
  const { controller, key: oldKey, internals, blockNextImage } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, oldKey);
  controller.unregisterAgent(oldKey);
  assert.equal(internals.renderedAgentBindings.has(oldKey.id), false);
  await assert.rejects(controller.pressAgent(oldKey.id, 0), /No Codex task is assigned/u);
  assert.deepEqual(internals.microBridge.calls, []);

  const newKey = { ...oldKey, id: oldKey.id } as KeyAction;
  const delayed = blockNextImage();
  controller.registerAgent(0, newKey);
  await delayed.started;

  const press = controller.pressAgent(newKey.id, 0);
  await flush();
  assert.deepEqual(internals.microBridge.calls, []);
  delayed.release();
  await assert.rejects(press, /No Codex task is assigned/u);
  await flush();

  await controller.pressAgent(newKey.id, 0);
  await controller.releaseInput(newKey.id);
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
    { slot: 0, act: 0, threadKey: "thread-a" },
  ]);
  controller.unregisterAgent(newKey);
});

test("a partial image/title write invalidates the old binding", async () => {
  const { controller, key, internals, images, setTitleFailure } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);
  assert.equal(internals.renderedAgentBindings.has(key.id), true);

  setSnapshot(internals, snapshot("thread-b", "Task B"));
  setTitleFailure(true);
  await assert.rejects(
    internals.renderAgent({ action: key, slot: 0 }),
    /title write failed/u,
  );
  assert.equal(images.displayed.at(-1), "Task B", "the image write succeeded before the title write failed");
  assert.equal(internals.renderedAgentBindings.has(key.id), false);

  setTitleFailure(false);
  setSnapshot(internals, snapshot("thread-a", "Task A"));
  await assert.rejects(controller.pressAgent(key.id, 0), /No Codex task is assigned/u);
  assert.deepEqual(internals.microBridge.calls, []);

  // A revert to A must really rewrite the image after the partial B write;
  // the old image cache cannot be used as proof that A is still displayed.
  await internals.renderAgent({ action: key, slot: 0 });
  assert.equal(images.displayed.at(-1), "Task A");
  await controller.pressAgent(key.id, 0);
  await controller.releaseInput(key.id);
  assert.deepEqual(internals.microBridge.calls, [
    { slot: 0, act: 1, threadKey: "thread-a" },
    { slot: 0, act: 0, threadKey: "thread-a" },
  ]);
  controller.unregisterAgent(key);
});

test("a partial write waits for its delayed image before a queued image starts", async () => {
  const { controller, key, internals, images, blockNextImage, setTitleFailure } = harness(snapshot("thread-a", "Task A"));
  await registerAndFlush(controller, key);

  setSnapshot(internals, snapshot("thread-b", "Task B"));
  setTitleFailure(true);
  const delayed = blockNextImage();
  const firstRender = internals.renderAgent({ action: key, slot: 0 });
  await delayed.started;

  // The title has already rejected, but the image write is still pending.
  // Queue C before releasing B so fail-fast handling would let C overtake B.
  setTitleFailure(false);
  setSnapshot(internals, snapshot("thread-c", "Task C"));
  const queuedRender = internals.renderAgent({ action: key, slot: 0 });
  delayed.release();
  await firstRender;
  await queuedRender;

  assert.deepEqual(images.displayed, ["Task A", "Task B", "Task C"]);
  assert.equal(internals.renderedAgentBindings.get(key.id)?.threadKey, "thread-c");
  controller.unregisterAgent(key);
});

test("terminal route and marked predispatch failures end pending feedback, uncertain results do not", async () => {
  for (const [code, predispatch, expectedPhase] of [
    ["E_AGENT_WINDOW_UNVERIFIED", false, "error"],
    ["E_ACTIVE_THREAD_STALE", true, "error"],
    ["E_ACTIVE_THREAD_STALE", false, "sent-unverified"],
    ["E_AGENT_ACTIVATION_UNCHANGED", false, "sent-unverified"],
  ] as const) {
    const { controller, key, internals } = harness(snapshot("thread-a", "Task A"));
    await registerAndFlush(controller, key);
    const failure = new Error(code);
    if (predispatch) Object.defineProperty(failure, "codexDeckPredispatch", { value: true });
    internals.microBridge.sendAgent = async (_slot, act) => { if (act === 1) throw failure; };
    await assert.rejects(controller.pressAgent(key.id, 0), (error) => error === failure);
    const feedback = (internals as unknown as { operationFeedback: Map<string, { phase: string; detail: string }> })
      .operationFeedback.get(key.id);
    assert.equal(feedback?.phase, expectedPhase);
    assert.equal(feedback?.detail, expectedPhase === "error" ? code : "E_RESULT_UNVERIFIED");
    controller.unregisterAgent(key);
  }
});
