import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import type { HostHealth } from "../src/types.js";

type FakeKey = {
  id: string;
  images: string[];
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type Contact = { owner: KeyAction; phase: "press" | "release"; startedAt: number };
type ControllerInternals = {
  health: HostHealth;
  keyContacts: Map<string, Contact>;
  operationFeedback: Map<string, { phase: string }>;
  setOperationFeedback(actionId: string, feedback: { phase: "pending" } | undefined): Promise<void>;
  renderAnimated(): Promise<void>;
};

function fakeKey(id: string): FakeKey {
  const key: FakeKey = {
    id,
    images: [],
    setImage: async (image) => { if (image) key.images.push(decode(image)); },
    setTitle: async () => undefined,
  };
  return key;
}

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

function latest(key: FakeKey): string {
  const image = key.images.at(-1);
  assert.ok(image, `${key.id} did not receive an image`);
  return image;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("rate-limit reset key emits physical contact without replacing hold progress", async () => {
  const originalNow = Date.now;
  let now = 10_000;
  let controller: DeckController | undefined;
  Date.now = () => now;
  try {
    controller = new DeckController();
    const internals = controller as unknown as ControllerInternals;
    internals.health = { state: "ready", changedAt: 0 };
    const key = fakeKey("reset-contact");
    controller.registerRateLimitReset(key as unknown as KeyAction);
    await flush();

    controller.beginRateLimitReset(key);
    await flush();
    assert.equal(internals.keyContacts.get(key.id)?.phase, "press");
    assert.match(latest(key), /data-key-contact="press"/u);
    assert.match(latest(key), /data-reset-detail="長押し中"/u, "the existing reset hold frame must remain active");
    assert.doesNotMatch(latest(key), /data-operation-phase=/u, "contact must not replace hold progress with generic pending feedback");

    now += 100;
    await internals.renderAnimated();
    assert.match(latest(key), /data-reset-hold="8"/u, "the reset hold ring must continue advancing under contact");
    assert.equal(await controller.finishRateLimitReset(key), false);
    assert.equal(internals.keyContacts.get(key.id)?.phase, "release");
    assert.match(latest(key), /data-key-contact="release"/u);
    assert.doesNotMatch(latest(key), /data-reset-detail="長押し中"/u);
  } finally {
    await controller?.stop();
    Date.now = originalNow;
  }
});

test("reset errors clear contact and animation-off suppresses it", async () => {
  const originalNow = Date.now;
  let now = 20_000;
  let controller: DeckController | undefined;
  Date.now = () => now;
  try {
    controller = new DeckController();
    const internals = controller as unknown as ControllerInternals;
    internals.health = { state: "ready", changedAt: 0 };
    const key = fakeKey("reset-error-contact");
    controller.registerRateLimitReset(key as unknown as KeyAction);
    await flush();

    controller.beginRateLimitReset(key);
    now += 1_300;
    await assert.rejects(controller.finishRateLimitReset(key));
    assert.equal(internals.keyContacts.has(key.id), false);
    assert.equal(internals.operationFeedback.get(key.id)?.phase, "error");
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
    assert.match(latest(key), /data-operation-phase="error"/u);

    controller.setActionPreferences(key.id, { animation: false });
    await flush();
    controller.beginRateLimitReset(key);
    await flush();
    assert.equal(internals.keyContacts.has(key.id), false);
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
  } finally {
    await controller?.stop();
    Date.now = originalNow;
  }
});

test("reset contact special case does not suppress ordinary quick repeats or invent unmatched release", async () => {
  const originalNow = Date.now;
  let now = 30_000;
  let controller: DeckController | undefined;
  Date.now = () => now;
  try {
    controller = new DeckController();
    const internals = controller as unknown as ControllerInternals;
    internals.health = { state: "ready", changedAt: 0 };
    const ordinary = fakeKey("ordinary-repeat");
    controller.registerFixedAction("ordinary", ordinary as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();

    await internals.setOperationFeedback(ordinary.id, { phase: "pending" });
    now += 10;
    await internals.setOperationFeedback(ordinary.id, undefined);
    assert.equal(internals.keyContacts.get(ordinary.id)?.phase, "release");
    now += 10;
    await internals.setOperationFeedback(ordinary.id, { phase: "pending" });
    assert.equal(internals.keyContacts.get(ordinary.id)?.phase, "press");
    assert.equal(internals.keyContacts.get(ordinary.id)?.startedAt, now, "ordinary rapid presses must restart their contact cue");

    const reset = fakeKey("unmatched-reset-up");
    controller.registerRateLimitReset(reset as unknown as KeyAction);
    await flush();
    assert.equal(await controller.finishRateLimitReset(reset), false);
    assert.equal(internals.keyContacts.has(reset.id), false, "an unmatched key-up must not invent release contact");
  } finally {
    await controller?.stop();
    Date.now = originalNow;
  }
});
