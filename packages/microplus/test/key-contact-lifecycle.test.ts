import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import { KEY_CONTACT_DURATION_MS } from "../src/render.js";
import type { HostHealth } from "../src/types.js";

type Feedback = { phase: "pending" | "held" | "error" | "sent-unverified"; detail?: string };

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
  setOperationFeedback(actionId: string, feedback: Feedback | undefined): Promise<void>;
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

function readyController(): { controller: DeckController; internals: ControllerInternals } {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  return { controller, internals };
}

test("press contact renders immediately, retains its origin through held, and expires with one base frame", async () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("press-contact");
    controller.registerFixedAction("press", key as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();
    key.images.length = 0;

    await internals.setOperationFeedback(key.id, { phase: "pending" });
    assert.match(latest(key), /data-key-contact="press"/u);
    assert.equal(internals.keyContacts.get(key.id)?.startedAt, 10_000);

    now += 70;
    await internals.setOperationFeedback(key.id, { phase: "held" });
    assert.match(latest(key), /data-key-contact="press"/u);
    assert.equal(internals.keyContacts.get(key.id)?.startedAt, 10_000, "pending to held must retain the press origin");

    now = 10_000 + KEY_CONTACT_DURATION_MS;
    const beforeExpiry = key.images.length;
    await internals.renderAnimated();
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
    assert.match(latest(key), /data-operation-phase="held"/u);
    assert.equal(internals.keyContacts.has(key.id), false);
    assert.equal(key.images.length, beforeExpiry + 1, "expiry must send the operation-only base frame once");

    await internals.renderAnimated();
    assert.equal(key.images.length, beforeExpiry + 1, "cleared contact must not emit another base frame");
  } finally {
    Date.now = originalNow;
  }
});

test("held to pending starts release contact and later clearing feedback does not extend it", async () => {
  const originalNow = Date.now;
  let now = 20_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("release-contact");
    controller.registerFixedAction("release", key as unknown as KeyAction, { kind: "local", keycapId: "DIFF" });
    await flush();

    await internals.setOperationFeedback(key.id, { phase: "pending" });
    await internals.setOperationFeedback(key.id, { phase: "held" });
    now += 40;
    await internals.setOperationFeedback(key.id, { phase: "pending" });
    assert.match(latest(key), /data-key-contact="release"/u);
    const releasedAt = internals.keyContacts.get(key.id)?.startedAt;
    assert.equal(releasedAt, now);

    now += 25;
    await internals.setOperationFeedback(key.id, undefined);
    assert.match(latest(key), /data-key-contact="release"/u);
    assert.equal(internals.keyContacts.get(key.id)?.startedAt, releasedAt, "pending to clear must preserve an active release");

    now = (releasedAt ?? 0) + KEY_CONTACT_DURATION_MS;
    await internals.renderAnimated();
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
    assert.doesNotMatch(latest(key), /data-operation-phase=/u);
    assert.equal(internals.keyContacts.has(key.id), false);
  } finally {
    Date.now = originalNow;
  }
});

test("clearing an active pending operation starts a bounded release contact", async () => {
  const originalNow = Date.now;
  let now = 25_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("pending-clear-release");
    controller.registerFixedAction("clear", key as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();

    await internals.setOperationFeedback(key.id, { phase: "pending" });
    now += 20;
    await internals.setOperationFeedback(key.id, undefined);
    assert.equal(internals.keyContacts.get(key.id)?.phase, "release");
    assert.equal(internals.keyContacts.get(key.id)?.startedAt, now);
    assert.match(latest(key), /data-key-contact="release"/u);
    assert.doesNotMatch(latest(key), /data-operation-phase=/u);
  } finally {
    Date.now = originalNow;
  }
});

test("error and sent-unverified feedback cancel contact without implying success", async () => {
  const { controller, internals } = readyController();
  const key = fakeKey("failed-contact");
  controller.registerFixedAction("failure", key as unknown as KeyAction, { kind: "local", keycapId: "SETUP" });
  await flush();

  await internals.setOperationFeedback(key.id, { phase: "pending" });
  assert.equal(internals.keyContacts.get(key.id)?.phase, "press");
  await internals.setOperationFeedback(key.id, { phase: "error", detail: "E_INPUT_OWNED" });
  assert.equal(internals.keyContacts.has(key.id), false);
  assert.doesNotMatch(latest(key), /data-key-contact=/u);
  assert.match(latest(key), /data-operation-phase="error"/u);

  await internals.setOperationFeedback(key.id, { phase: "pending" });
  await internals.setOperationFeedback(key.id, { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED" });
  assert.equal(internals.keyContacts.has(key.id), false);
  assert.doesNotMatch(latest(key), /data-key-contact=/u);
  assert.match(latest(key), /data-operation-phase="sent-unverified"/u);
});

test("animation off suppresses new contact and clears an existing contact", async () => {
  const { controller, internals } = readyController();
  const key = fakeKey("animation-off-contact");
  controller.registerFixedAction("animation", key as unknown as KeyAction, { kind: "local", keycapId: "FOLD" });
  await flush();

  await internals.setOperationFeedback(key.id, { phase: "pending" });
  assert.equal(internals.keyContacts.get(key.id)?.phase, "press");
  controller.setActionPreferences(key.id, { animation: false });
  await flush();
  assert.equal(internals.keyContacts.has(key.id), false);
  assert.doesNotMatch(latest(key), /data-key-contact=/u);

  await internals.setOperationFeedback(key.id, undefined);
  await internals.setOperationFeedback(key.id, { phase: "pending" });
  assert.equal(internals.keyContacts.has(key.id), false);
  assert.doesNotMatch(latest(key), /data-key-contact=/u);
});

test("unregistering a key clears contact before the same context is reused", async () => {
  const { controller, internals } = readyController();
  const oldKey = fakeKey("reused-contact-context");
  controller.registerFixedAction("old", oldKey as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
  await flush();
  await internals.setOperationFeedback(oldKey.id, { phase: "pending" });
  assert.equal(internals.keyContacts.get(oldKey.id)?.owner, oldKey);

  controller.unregisterFixedAction(oldKey);
  assert.equal(internals.keyContacts.has(oldKey.id), false);
  const newKey = fakeKey(oldKey.id);
  controller.registerFixedAction("new", newKey as unknown as KeyAction, { kind: "local", keycapId: "DIFF" });
  await flush();
  await internals.renderAnimated();

  assert.doesNotMatch(latest(newKey), /data-key-contact=/u);
  assert.match(latest(newKey), /data-keycap-id="DIFF"/u);
  assert.equal(internals.keyContacts.has(newKey.id), false);
});

test("an expired contact remains scheduled until its base frame is written successfully", async () => {
  const originalNow = Date.now;
  let now = 30_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("expiry-retry-contact");
    controller.registerFixedAction("retry", key as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();
    await internals.setOperationFeedback(key.id, { phase: "pending" });
    assert.match(latest(key), /data-key-contact="press"/u);

    now += KEY_CONTACT_DURATION_MS;
    let failBase = true;
    key.setImage = async (image) => {
      if (failBase) {
        failBase = false;
        throw new Error("simulated key write failure");
      }
      if (image) key.images.push(decode(image));
    };

    await internals.renderAnimated();
    assert.equal(internals.keyContacts.has(key.id), true, "a failed base write must keep expiry work scheduled");
    assert.match(latest(key), /data-key-contact="press"/u, "the last observed hardware frame is still contact");

    await internals.renderAnimated();
    assert.equal(internals.keyContacts.has(key.id), false);
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
    assert.match(latest(key), /data-operation-phase="pending"/u);
  } finally {
    Date.now = originalNow;
  }
});

test("a contact frame composed just before expiry cannot acknowledge the base frame", async () => {
  const originalNow = Date.now;
  let now = 40_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("expiry-boundary-contact");
    controller.registerFixedAction("boundary", key as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();

    let call = 0;
    Date.now = () => {
      call += 1;
      if (call === 1) return 40_000;
      if (call === 2) return 40_000 + KEY_CONTACT_DURATION_MS - 1;
      return 40_000 + KEY_CONTACT_DURATION_MS;
    };
    await internals.setOperationFeedback(key.id, { phase: "pending" });
    assert.match(latest(key), /data-key-contact="press"/u);
    assert.equal(internals.keyContacts.has(key.id), true, "a rendered contact frame cannot clear its own expiry work");

    Date.now = () => 40_000 + KEY_CONTACT_DURATION_MS;
    await internals.renderAnimated();
    assert.doesNotMatch(latest(key), /data-key-contact=/u);
    assert.equal(internals.keyContacts.has(key.id), false);
  } finally {
    Date.now = originalNow;
  }
});

test("queued terminal feedback cancels contact and leaves the current error frame", async () => {
  const { controller, internals } = readyController();
  const key = fakeKey("queued-error-contact");
  controller.registerFixedAction("queued", key as unknown as KeyAction, { kind: "local", keycapId: "DIFF" });
  await flush();

  let releasePending!: () => void;
  let pendingStarted!: () => void;
  const pendingGate = new Promise<void>((resolve) => { releasePending = resolve; });
  const pendingStart = new Promise<void>((resolve) => { pendingStarted = resolve; });
  let first = true;
  key.setImage = async (image) => {
    if (first) {
      first = false;
      pendingStarted();
      await pendingGate;
    }
    if (image) key.images.push(decode(image));
  };

  const pending = internals.setOperationFeedback(key.id, { phase: "pending" });
  await pendingStart;
  const terminal = internals.setOperationFeedback(key.id, { phase: "error", detail: "E_INPUT_OWNED" });
  assert.equal(internals.keyContacts.has(key.id), false, "terminal state clears contact before queued rendering drains");
  releasePending();
  await pending;
  await terminal;

  assert.doesNotMatch(latest(key), /data-key-contact=/u);
  assert.match(latest(key), /data-operation-phase="error"/u);
});

test("label text resembling the contact marker cannot block expiry cleanup", async () => {
  const originalNow = Date.now;
  let now = 50_000;
  Date.now = () => now;
  try {
    const { controller, internals } = readyController();
    const key = fakeKey("marker-label-contact");
    controller.setActionPreferences(key.id, { label: "data-key-contact" });
    controller.registerFixedAction("marker", key as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
    await flush();
    await internals.setOperationFeedback(key.id, { phase: "pending" });
    assert.match(latest(key), /data-key-contact="press"/u);

    now += KEY_CONTACT_DURATION_MS;
    await internals.renderAnimated();
    assert.equal(internals.keyContacts.has(key.id), false);
    assert.doesNotMatch(latest(key), /data-key-contact="(?:press|release)"/u);
  } finally {
    Date.now = originalNow;
  }
});
