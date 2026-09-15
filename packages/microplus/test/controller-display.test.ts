import assert from "node:assert/strict";
import test from "node:test";
import {
  healthToContextDisplayState,
  localizedDialFeedbackStatus,
  reasoningDialValue,
  truncateFeedback,
} from "../src/controller-display.js";
import type { HostHealth } from "../src/types.js";

test("controller display helpers keep LCD text bounded and content-free", () => {
  assert.equal(truncateFeedback("  hello\nworld\u0000  ", 20), "hello world");
  assert.equal(truncateFeedback("0123456789", 5), "0123…");
  assert.equal(reasoningDialValue("準備完了"), "準備完了 · 現在値 未取得 · 操作待ち");
  assert.equal(reasoningDialValue("準備完了", "increase", "high\ncontext"), "準備完了 · 現在値 high context · 上げる操作を送信");
});

test("controller display helpers map every observed lifecycle state", () => {
  const statuses = ["ready", "pressed", "pending", "recording", "confirmed", "error", "stale", "offline", "connecting", "unknown", "unavailable"] as const;
  const healthStates: HostHealth["state"][] = ["ready", "connecting", "offline", "degraded"];
  for (const status of statuses) assert.notEqual(localizedDialFeedbackStatus(status), "");
  assert.deepEqual(
    healthStates.map((health) => healthToContextDisplayState(health)),
    ["ready", "connecting", "offline", "unavailable"],
  );
});
