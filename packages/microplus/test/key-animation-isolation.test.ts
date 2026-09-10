import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";

type FakeKey = {
  id: string;
  writes: string[];
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type Timer = { callback: () => Promise<void>; delay: number };

type ControllerInternals = {
  usageOverviewActions: Map<string, KeyAction>;
  operationFeedback: Map<string, { phase: "pending"; target: string }>;
  animationOrigin: number;
  scheduleAnimation(): void;
};

type Deferred = {
  promise: Promise<void>;
  resolve(): void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

function fakeKey(id: string, firstGate?: Deferred, firstStarted?: Deferred): FakeKey {
  let calls = 0;
  const key: FakeKey = {
    id,
    writes: [],
    setImage: async (image) => {
      calls += 1;
      if (image) key.writes.push(decode(image));
      if (calls === 1 && firstGate && firstStarted) {
        firstStarted.resolve();
        await firstGate.promise;
      }
    },
    setTitle: async () => {},
  };
  return key;
}

function registerPendingKey(
  internals: ControllerInternals,
  key: FakeKey,
  target: string,
): void {
  internals.usageOverviewActions.set(key.id, key as unknown as KeyAction);
  internals.operationFeedback.set(key.id, { phase: "pending", target });
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("a stalled key does not block the next animation frame for another key", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  const firstGate = deferred();
  const firstStarted = deferred();
  const keyA = fakeKey("animation-key-a", firstGate, firstStarted);
  const keyB = fakeKey("animation-key-b");
  registerPendingKey(internals, keyA, "A");
  registerPendingKey(internals, keyB, "B");

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  const timers: Timer[] = [];
  let now = internals.animationOrigin + 200;
  Date.now = () => now;
  globalThis.setTimeout = ((callback: () => Promise<void>, delay: number) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    internals.scheduleAnimation();
    assert.ok(timers[0], "the animation scheduler should install a timer");

    const firstTick = timers[0]!.callback();
    await firstStarted.promise;
    await flush();
    assert.equal(keyA.writes.length, 1, "key A should remain in its first in-flight send");
    assert.equal(keyB.writes.length, 1, "key B should render while key A is stalled");

    now += 50;
    assert.ok(timers[1], "the next scheduler callback should be installed before the first render settles");
    const secondTick = timers[1]!.callback();
    await flush();

    assert.equal(keyA.writes.length, 1, "key A must not accumulate sends while its first image is unresolved");
    assert.equal(keyB.writes.length, 2, "key B should receive the newer frame at the next scheduler callback");
    assert.notEqual(keyB.writes[0], keyB.writes[1], "key B's operation frame should advance");

    internals.operationFeedback.delete(keyA.id);
    firstGate.resolve();
    await Promise.all([firstTick, secondTick]);
    assert.equal(keyA.writes.length, 2, "key A should drain only one latest follow-up after its in-flight frame");
  } finally {
    firstGate.resolve();
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.match(keyB.writes.at(-1)!, /data-operation-phase="pending"/);
  assert.doesNotMatch(keyA.writes.at(-1)!, /data-operation-phase=/, "a queued animation must read the cleared state instead of resurrecting pending");
});
