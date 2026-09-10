import assert from "node:assert/strict";
import test from "node:test";
import * as bridgeRuntime from "../src/codex-micro-renderer-bridge.js";
import {
  operationFeedbackDetail,
  renderAgentSvg,
  renderRateLimitResetKey,
} from "../src/render.js";

function decode(image: string): string {
  const comma = image.indexOf(",");
  return comma < 0 ? image : decodeURIComponent(image.slice(comma + 1));
}

test("usage timestamps remain unknown unless the native query supplied a positive finite update time", () => {
  const candidate = Reflect.get(bridgeRuntime, "verifiedUsageObservedAt");
  assert.equal(typeof candidate, "function");
  const verifiedUsageObservedAt = candidate as (value: unknown) => number | undefined;
  assert.equal(verifiedUsageObservedAt(undefined), undefined);
  assert.equal(verifiedUsageObservedAt(null), undefined);
  assert.equal(verifiedUsageObservedAt(0), undefined);
  assert.equal(verifiedUsageObservedAt(Number.NaN), undefined);
  for (const invalid of [true, false, "1725000000000", Infinity, -Infinity, {}, [1725000000000]]) {
    assert.equal(verifiedUsageObservedAt(invalid), undefined);
  }
  assert.equal(verifiedUsageObservedAt(1_725_000_000_000), 1_725_000_000_000);
});

test("reset credit count is hidden when its snapshot freshness is unknown or stale", () => {
  for (const state of ["unknown", "stale"] as const) {
    const svg = decode(renderRateLimitResetKey(4, 0, "dark", "ready", { state }, "en"));
    assert.match(svg, /data-reset-credits="unknown"/u);
    assert.doesNotMatch(svg, />4<\/text>/u);
    assert.match(svg, />—<\/text>/u);
    assert.doesNotMatch(svg, /AVAILABLE CREDITS/u);
  }
});

test("connecting agent surfaces show connection state instead of claiming the slot is unassigned", () => {
  const en = renderAgentSvg(0, "Not assigned", "empty", false, 0, "dark", undefined, "connecting", undefined, true, "en");
  const ja = renderAgentSvg(0, "Not assigned", "empty", false, 0, "dark", undefined, "connecting", undefined, true, "ja");
  assert.match(en, />CONNECTING</u);
  assert.doesNotMatch(en, /UNASSIGNED|Not assigned/u);
  assert.match(ja, />接続中</u);
  assert.doesNotMatch(ja, /未割当|Not assigned/u);
});

test("attachment transfer rejection explains the unsupported content in both display languages", () => {
  const feedback = { phase: "error" as const, detail: "E_DRAFT_TRANSFER_ATTACHMENTS_UNSUPPORTED" };
  assert.equal(operationFeedbackDetail(feedback, "ja"), "添付は非対応");
  assert.equal(operationFeedbackDetail(feedback, "en"), "ATTACH UNSUP");
});
