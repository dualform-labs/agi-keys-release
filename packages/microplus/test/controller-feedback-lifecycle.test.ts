import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import { renderCatalogKeycap } from "../src/render.js";
import type { MutationConfirmation } from "../src/types.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

type FakeKey = {
  id: string;
  images: string[];
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type ControllerInternals = {
  health: { state: "ready"; changedAt: number };
  fixedActions: Map<string, unknown>;
  setImage(action: KeyAction, image: string): Promise<void>;
  trackMutation(actionId: string, operation: () => Promise<MutationConfirmation>, target: string): Promise<MutationConfirmation>;
};

const unverified: MutationConfirmation = {
  dispatch: "accepted",
  metadata: "matched",
  semanticOutcome: "unverified",
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

function immediateKey(id: string): FakeKey {
  const key: FakeKey = {
    id,
    images: [],
    setImage: async (image) => { if (image) key.images.push(decode(image)); },
    setTitle: async () => {},
  };
  return key;
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("an operation from a disappeared key cannot replace feedback on its reappeared incarnation", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  const oldKey = immediateKey("reused-context");
  const newKey = immediateKey("reused-context");
  const oldResult = deferred<MutationConfirmation>();
  const newResult = deferred<MutationConfirmation>();

  controller.registerFixedAction("old", oldKey as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
  const oldOperation = internals.trackMutation(oldKey.id, () => oldResult.promise, "OLD");
  await flush();
  controller.unregisterFixedAction(oldKey);
  controller.registerFixedAction("new", newKey as unknown as KeyAction, { kind: "local", keycapId: "DIFF" });
  const newOperation = internals.trackMutation(newKey.id, () => newResult.promise, "NEW");
  await flush();

  oldResult.resolve(unverified);
  await oldOperation;
  await flush();

  assert.match(newKey.images.at(-1) ?? "", /data-operation-phase="pending"/);
  assert.match(newKey.images.at(-1) ?? "", /data-operation-target="NEW"/);
  assert.doesNotMatch(newKey.images.at(-1) ?? "", /data-operation-target="OLD"/);

  newResult.resolve(unverified);
  await newOperation;
});

test("a delayed image send from a disappeared key cannot suppress the reappeared key image", async () => {
  const controller = new DeckController();
  (controller as unknown as ControllerInternals).health = { state: "ready", changedAt: 0 };
  const oldSend = deferred<void>();
  let oldSendStarted = false;
  let hardwareImage = "";
  const oldKey: FakeKey = {
    id: "delayed-image-context",
    images: [],
    setImage: async (image) => {
      oldSendStarted = true;
      await oldSend.promise;
      if (image) hardwareImage = decode(image);
    },
    setTitle: async () => {},
  };

  controller.registerFixedAction("old", oldKey as unknown as KeyAction, { kind: "local", keycapId: "TERM" });
  await flush();
  assert.equal(oldSendStarted, true);
  controller.unregisterFixedAction(oldKey);

  const newKey: FakeKey = {
    id: oldKey.id,
    images: [],
    setImage: async (image) => {
      if (image) {
        newKey.images.push(decode(image));
        hardwareImage = decode(image);
      }
    },
    setTitle: async () => {},
  };
  controller.registerFixedAction("new", newKey as unknown as KeyAction, { kind: "local", keycapId: "DIFF" });
  await flush();
  assert.match(hardwareImage, /data-keycap-id="DIFF"/);

  oldSend.resolve();
  await flush();

  assert.match(hardwareImage, /data-keycap-id="DIFF"/, "a late old SDK send must be followed by restoration of the current key");
  assert.ok(newKey.images.length >= 2, "the current key must be resent after a stale SDK send lands");
});

test("same-incarnation image sends are serialized and settle on the latest view", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as ControllerInternals;
  internals.health = { state: "ready", changedAt: 0 };
  const first = deferred<void>();
  const second = deferred<void>();
  const writes: string[] = [];
  let call = 0;
  const key: FakeKey = {
    id: "reverse-image-context",
    images: [],
    setImage: async (image) => {
      call += 1;
      if (call === 1) await first.promise;
      else if (call === 2) await second.promise;
      if (image) writes.push(decode(image));
    },
    setTitle: async () => {},
  };
  internals.fixedActions.set(key.id, { action: key, id: "current", source: { kind: "local", keycapId: "DIFF" } });
  const oldImage = renderCatalogKeycap("TERM", "dark", "ja");
  const currentImage = renderCatalogKeycap("DIFF", "dark", "ja");
  assert.ok(oldImage && currentImage);

  const oldRender = internals.setImage(key as unknown as KeyAction, oldImage);
  await flush();
  const currentRender = internals.setImage(key as unknown as KeyAction, currentImage);
  await flush();
  assert.equal(call, 1, "a same-incarnation replacement must wait for the active SDK send");
  first.resolve();
  await flush();
  assert.equal(call, 2);
  second.resolve();
  await oldRender;
  await currentRender;

  assert.equal(call, 2, "serialized sends must not create recursive restoration writes");
  assert.match(writes.at(-1) ?? "", /data-keycap-id="DIFF"/);
});
