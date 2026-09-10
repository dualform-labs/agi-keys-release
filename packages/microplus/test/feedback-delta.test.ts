import assert from "node:assert/strict";
import test from "node:test";
import { feedbackDelta, type FeedbackPayload } from "../src/feedback-delta.js";

test("the first payload is returned in full without mutating it", () => {
  const next = payload();
  const before = structuredClone(next);

  const delta = feedbackDelta(undefined, next);

  assert.deepEqual(delta, next);
  assert.notEqual(delta, next);
  assert.deepEqual(next, before);
});

test("deep equality suppresses unchanged nested fields and keeps changed top-level fields", () => {
  const previous = payload();
  const next: FeedbackPayload = {
    ...payload(),
    value: { value: "gpt-6-sol", color: "#7EC5FF", font: { weight: 750, size: 19 } },
    "backdrop-13": "data:image/svg+xml,next-ribbon",
  };
  const previousBefore = structuredClone(previous);
  const nextBefore = structuredClone(next);

  const delta = feedbackDelta(previous, next);

  assert.deepEqual(delta, {
    value: next.value,
    "backdrop-13": next["backdrop-13"],
  });
  assert.deepEqual(previous, previousBefore);
  assert.deepEqual(next, nextBefore);
});

test("explicit empty, zero, color, and font resets are retained", () => {
  const previous: FeedbackPayload = {
    detail: "結果確認中",
    progress: 65,
    value: { value: "TERM", color: "#2DBAFF", font: { weight: 750, size: 19 } },
    icon: "data:image/svg+xml,old-icon",
  };
  const next: FeedbackPayload = {
    detail: "",
    progress: 0,
    value: { value: "TERM", color: "#F1F5F7", font: { weight: 600, size: 16 } },
    icon: "",
  };

  assert.deepEqual(feedbackDelta(previous, next), next);
});

test("a changed partial payload is materially smaller than the full LCD payload", () => {
  const previous = payload();
  const next: FeedbackPayload = {
    ...previous,
    value: { value: "gpt-6-astra", color: "#2DBAFF", font: { weight: 750, size: 19 } },
    "backdrop-13": `data:image/svg+xml,${"next-ribbon".repeat(80)}`,
  };
  const delta = feedbackDelta(previous, next);
  const fullBytes = Buffer.byteLength(JSON.stringify(next));
  const deltaBytes = Buffer.byteLength(JSON.stringify(delta));

  assert.deepEqual(Object.keys(delta).sort(), ["backdrop-13", "value"]);
  assert.ok(deltaBytes < fullBytes / 2, `expected delta ${deltaBytes}B to be below half of full ${fullBytes}B`);
});

function payload(): FeedbackPayload {
  return {
    heading: "モデル",
    value: { value: "gpt-6-astra", color: "#F1F5F7", font: { weight: 600, size: 16 } },
    detail: "回転ですぐ変更",
    status: "",
    progress: 0,
    icon: `data:image/svg+xml,${"dial-icon".repeat(160)}`,
    "backdrop-13": `data:image/svg+xml,${"dial-ribbon".repeat(80)}`,
  };
}
