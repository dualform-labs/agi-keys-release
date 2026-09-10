import assert from "node:assert/strict";
import test from "node:test";
import type { KeyAction } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import { renderActionFeedback, renderCatalogKeycap } from "../src/render.js";

type FakeKey = {
  id: string;
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type ControllerInternals = {
  usageOverviewActions: Map<string, KeyAction>;
  setImage(action: KeyAction, image: string): Promise<void>;
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

function interactionImages(): { pending: string; held: string; clear: string } {
  const clear = renderCatalogKeycap("TERM", "dark", "ja");
  assert.ok(clear);
  return {
    pending: renderActionFeedback(clear, { phase: "pending", target: "TERM" }, "dark", "ja", 0),
    held: renderActionFeedback(clear, { phase: "held", target: "TERM" }, "dark", "ja", 1),
    clear,
  };
}

function registerKey(controller: DeckController, id: string, key: FakeKey): ControllerInternals {
  const internals = controller as unknown as ControllerInternals;
  // currentKeyAction() resolves usageOverviewActions directly, which keeps
  // this test focused on the per-key delivery queue rather than registration.
  internals.usageOverviewActions.set(id, key as unknown as KeyAction);
  return internals;
}

test("coalesces delayed key frames to the first send and latest cleared state", async () => {
  const controller = new DeckController();
  const images = interactionImages();
  const firstGate = deferred();
  const firstStarted = deferred();
  const writes: string[] = [];
  let calls = 0;
  const key: FakeKey = {
    id: "key-frame-coalescing",
    setImage: async (image) => {
      calls += 1;
      if (image) writes.push(decode(image));
      if (calls === 1) {
        firstStarted.resolve();
        await firstGate.promise;
      }
    },
    setTitle: async () => {},
  };
  const internals = registerKey(controller, key.id, key);

  const first = internals.setImage(key as unknown as KeyAction, images.pending);
  await firstStarted.promise;
  const middle = internals.setImage(key as unknown as KeyAction, images.held);
  const cleared = internals.setImage(key as unknown as KeyAction, images.clear);

  firstGate.resolve();
  await Promise.all([first, middle, cleared]);

  assert.equal(writes.length, 2, "one in-flight send plus one latest follow-up is expected");
  assert.match(writes[0]!, /data-operation-phase="pending"/);
  assert.doesNotMatch(writes[1]!, /data-operation-phase=/, "the final cleared image must win over queued held frames");
  assert.match(writes[1]!, /data-keycap-id="TERM"/);
});

test("a failed key send still drains the newest cleared frame", async () => {
  const controller = new DeckController();
  const images = interactionImages();
  const firstGate = deferred();
  const firstStarted = deferred();
  const writes: string[] = [];
  let calls = 0;
  const key: FakeKey = {
    id: "key-frame-rejection-coalescing",
    setImage: async (image) => {
      calls += 1;
      if (image) writes.push(decode(image));
      if (calls === 1) {
        firstStarted.resolve();
        await firstGate.promise;
        throw new Error("simulated delayed key send failure");
      }
    },
    setTitle: async () => {},
  };
  const internals = registerKey(controller, key.id, key);

  const first = internals.setImage(key as unknown as KeyAction, images.pending);
  await firstStarted.promise;
  const middle = internals.setImage(key as unknown as KeyAction, images.held);
  const cleared = internals.setImage(key as unknown as KeyAction, images.clear);

  firstGate.resolve();
  const outcomes = await Promise.allSettled([first, middle, cleared]);

  assert.deepEqual(
    outcomes.map(({ status }) => status),
    ["fulfilled", "fulfilled", "fulfilled"],
    "a successful latest frame should drain the queue after the first send fails",
  );
  assert.equal(writes.length, 2, "the failed first send plus one latest retry is expected");
  assert.doesNotMatch(writes[1]!, /data-operation-phase=/, "the retry must be the cleared state");
  assert.match(writes[1]!, /data-keycap-id="TERM"/);
});
