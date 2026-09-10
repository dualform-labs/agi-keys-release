import assert from "node:assert/strict";
import test from "node:test";
import { renderActionFeedback, renderBuiltinKeycap, renderFallbackKeycap, renderUsageOverviewKey } from "../src/render.js";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";
const decode = (image: string) => decodeURIComponent(image.slice(image.indexOf(",") + 1));

test("every catalog key retains its identity while pending frames change", () => {
  for (const id of OFFICIAL_KEYCAP_IDS) {
    const base = renderFallbackKeycap(id, "dark", "ja");
    const first = decode(renderActionFeedback(base, { phase: "pending", target: id }, "dark", "ja", 0));
    const next = decode(renderActionFeedback(base, { phase: "pending", target: id }, "dark", "ja", 1));
    assert.notEqual(first, next, id);
    assert.match(first, /data-key-interaction="pending"/);
    assert.match(first, /data-keycap-id=/);
    assert.doesNotMatch(first, /<animate|録音中|RECORDING/);
  }
});

test("held glyph contracts without moving the label; unverified state never keeps spinning", () => {
  const base = renderBuiltinKeycap("home", "dark");
  const held = decode(renderActionFeedback(base, { phase: "held" }, "dark", "en", 2));
  assert.match(held, /scale\(\.90\)/);
  assert.match(held, /data-operation-motion="held"/);
  const a = renderActionFeedback(base, { phase: "sent-unverified" }, "dark", "en", 0);
  const b = renderActionFeedback(base, { phase: "sent-unverified" }, "dark", "en", 7);
  assert.equal(a, b);
});

test("sub-frame motion is continuous across every catalog key without animating unverified results", () => {
  for (const id of OFFICIAL_KEYCAP_IDS) {
    const base = renderFallbackKeycap(id, "dark", "ja");
    const frames = [0, .2, .4, .6, .8].map((frame) => renderActionFeedback(base, { phase: "pending" }, "dark", "ja", frame));
    assert.equal(new Set(frames).size, frames.length, id);
    assert.match(decode(frames[0]!), /data-key-energy="true"/);
    assert.match(decode(frames[0]!), /data-key-light-core="true"/);
    assert.equal(renderActionFeedback(base, { phase: "sent-unverified" }, "dark", "ja", .2),
      renderActionFeedback(base, { phase: "sent-unverified" }, "dark", "ja", .8));
  }
});

test("usage data remains present beneath interaction feedback", () => {
  const base = renderUsageOverviewKey([], "dark", "ready");
  const image = decode(renderActionFeedback(base, { phase: "pending" }, "dark", "ja", 3));
  assert.match(image, /data-operation-phase="pending"/);
  assert.match(image, /data-key-interaction="pending"/);
});

test("usage key command feedback reaches setImage and advances through the animation scheduler", async () => {
  const { DeckController } = await import("../src/controller.js");
  const images: string[] = [];
  const controller = new DeckController();
  const internal = controller as unknown as {
    usageOverviewActions: Map<string, unknown>;
    setOperationFeedback(id: string, state: { phase: "pending" } | undefined): Promise<void>;
    renderAnimated(): Promise<void>;
    animationFrame: number;
  };
  internal.usageOverviewActions.set("usage-motion", {
    id: "usage-motion", setImage: async (value: string) => { images.push(decode(value)); }, setTitle: async () => {},
  });
  await internal.setOperationFeedback("usage-motion", { phase: "pending" });
  assert.match(images.at(-1)!, /data-operation-phase="pending"/);
  const initial = images.at(-1);
  internal.animationFrame = .75;
  await internal.renderAnimated();
  assert.notEqual(images.at(-1), initial);
  await internal.setOperationFeedback("usage-motion", undefined);
  assert.doesNotMatch(images.at(-1)!, /data-operation-phase=/);
});

test("reset rejection is rendered and microphone mapping errors are exposed", async () => {
  const { DeckController } = await import("../src/controller.js");
  const controller = new DeckController();
  try {
    const images: string[] = [];
    const internal = controller as unknown as {
      rateLimitResetActions: Map<string, unknown>;
      resetHolds: Map<string, number>;
      operationFeedback: Map<string, { phase: string }>;
      microBridge: { consumeRateLimitReset(idempotencyKey: string): Promise<never>; close(): void };
    };
    internal.microBridge = {
      consumeRateLimitReset: async () => { throw new Error("E_RESET_REJECTED"); },
      close: () => {},
    };
    internal.rateLimitResetActions.set("reset", {
      id: "reset", setImage: async (value: string) => { images.push(decode(value)); }, setTitle: async () => {},
    });
    internal.resetHolds.set("reset", Date.now() - 2000);
    await assert.rejects(controller.finishRateLimitReset({ id: "reset" }));
    assert.match(images.at(-1)!, /data-operation-phase="error"/);
    assert.throws(() => controller.resolveMicrophoneSlot("mic"));
    assert.equal(internal.operationFeedback.get("mic")?.phase, "error");
  } finally {
    await controller.stop();
  }
});
