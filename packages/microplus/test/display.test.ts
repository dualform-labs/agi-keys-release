import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  displayWidth,
  renderActionFeedback,
  renderActionKey,
  renderAgentSvg,
  renderFallbackKeycap,
  renderPlusDialFeedback,
  renderPlusDialSvg,
  renderUsageLimitKey,
  renderUsageOverviewKey,
  splitDisplayLines
} from "../src/render.js";
import { visualStatusFromMicro } from "../src/status.js";

function decode(image: string): string {
  const comma = image.indexOf(",");
  return comma < 0 ? image : decodeURIComponent(image.slice(comma + 1));
}

test("unknown native status is explicit and never falls back to ready", () => {
  assert.equal(visualStatusFromMicro("idle"), "idle");
  assert.equal(visualStatusFromMicro("future-native-state"), "unknown");
  const svg = renderAgentSvg(0, "作業タイトル", "unknown", false, 0, "light");
  assert.match(svg, /data-agent-status-label="unknown"/u);
  assert.match(svg, />UNKNOWN</u);
  assert.doesNotMatch(svg, />READY</u);
});

test("title wrapping measures CJK at full width and ellipsizes the second line", () => {
  assert.equal(displayWidth("日本語"), 6);
  const lines = splitDisplayLines("これはとても長い日本語のタスクタイトルです", 13, 2);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "これはとても");
  assert.match(lines[1] ?? "", /…$/u);
  const svg = renderAgentSvg(1, "これはとても長い日本語のタスクタイトルです", "thinking", false, 0, "dark");
  assert.match(svg, /これはとても/u);
  assert.match(svg, /長い日本語の…/u);
  assert.doesNotMatch(svg, />長い日本語のタスクタイトル/u);
});

test("ACT11 fallback keeps the physical slot and status on balanced lines", () => {
  const svg = decode(renderFallbackKeycap("ACT11 無効", "dark"));
  assert.match(svg, />ACT11</u);
  assert.match(svg, />無効</u);
  assert.doesNotMatch(svg, />効</u);
});

test("light idle status uses a readable dark marker", () => {
  const svg = renderAgentSvg(0, "Ready", "idle", false, 0, "light");
  assert.match(svg, /data-agent-status-label="idle"[^>]*fill="#3E4B56"/u);
  assert.doesNotMatch(svg, /data-agent-status-label="idle"[^>]*fill="#FFFFFF"/u);
});

test("context ring is rendered only for an observed context value", () => {
  const absent = renderAgentSvg(0, "Task", "idle", false, 0, "dark", undefined, "ready", undefined, true);
  const observed = renderAgentSvg(0, "Task", "idle", false, 0, "dark", undefined, "ready", 42, true);
  assert.doesNotMatch(absent, /data-context-used=/u);
  assert.match(observed, /data-context-used="42"/u);
});

test("action and agent keys share one continuous rounded status frame", () => {
  const action = decode(renderActionKey({ identity: "ACT10", state: "ready", theme: "dark" }));
  const agent = renderAgentSvg(0, "Task", "idle", false, 0, "dark");

  assert.match(action, /data-accent="[^"]+"[^>]*x="7" y="7" width="130" height="130" rx="16"/u);
  assert.match(agent, /data-agent-status-frame="idle"[^>]*x="7" y="7" width="130" height="130" rx="16"/u);
  assert.doesNotMatch(action, /data-key-rest-specular|data-key-inner-rim/u);
  assert.doesNotMatch(agent, /data-agent-status-band|data-key-rest-specular|data-key-inner-rim/u);
});

test("operation feedback exposes pending/held/error without claiming success", () => {
  const base = renderActionKey({ identity: "ACT10", current: "マイク", target: "割当確認済み", state: "ready", theme: "dark" });
  const held = decode(renderActionFeedback(base, { phase: "held", detail: "PTT" }));
  const pending = decode(renderActionFeedback(base, { phase: "pending", operationId: "op-1" }));
  const sent = decode(renderActionFeedback(base, { phase: "sent-unverified" }));
  const error = decode(renderActionFeedback(base, { phase: "error", detail: "E_DOWNSTREAM_TIMEOUT" }));
  assert.match(held, /data-operation-phase="held"/u);
  assert.match(held, />押下中</u);
  assert.doesNotMatch(held, /録音中|CONFIRMED|成功/u);
  assert.match(pending, /data-operation-phase="pending"[^>]*data-operation-id="op-1"/u);
  assert.match(sent, />未確認</u);
  assert.match(error, /data-operation-detail="結果未確認"/u);
  assert.doesNotMatch(error, /E_DOWNSTREAM_TIMEOUT/u);
  const stateWidth = displayWidth("失敗") * 9;
  const detailWidth = displayWidth("結果未確認") * 7;
  assert.ok(18 + stateWidth < 126 - detailWidth, "operation state and detail must keep separate measured regions");
});

test("reasoning dial keeps a command in detail and leaves current value unobserved", () => {
  const pending = renderPlusDialFeedback({ kind: "reasoning", operation: "increase", health: "ready" });
  assert.equal(pending.status, "pending");
  assert.equal(pending.value, "—");
  assert.match(pending.detail, /increase/u);
  assert.doesNotMatch(pending.value, /increase/u);

  const observed = renderPlusDialFeedback({ kind: "reasoning", observedValue: "高", health: "ready" });
  assert.equal(observed.status, "ready");
  assert.equal(observed.value, "高");
});

test("native dial SVG mirrors typed feedback without placing a command in value", () => {
  const svg = renderPlusDialSvg({ kind: "reasoning", operation: "increase", health: "ready" });
  assert.match(svg, /width="200" height="100"/u);
  assert.match(svg, /data-dial-value="—"/u);
  assert.match(svg, /data-dial-detail="操作: increase"/u);
  assert.match(svg, /data-dial-status-label="pending"/u);
  assert.doesNotMatch(svg, /data-dial-value="[^"]*increase/u);
});

test("usage distinguishes zero from missing and does not call an un-timestamped value fresh", () => {
  const missing = decode(renderUsageLimitKey(undefined, "five-hour", "dark", "ready"));
  const zero = decode(renderUsageLimitKey({ id: "5h", kind: "five-hour", usedPercent: 100, remainingPercent: 0, windowDurationMins: 300, resetsAt: null }, "five-hour", "dark", "ready"));
  const fresh = decode(renderUsageLimitKey({ id: "5h", kind: "five-hour", usedPercent: 42, remainingPercent: 58, windowDurationMins: 300, resetsAt: null }, "five-hour", "dark", "ready", { observedAt: 1000, now: 1000 }));
  assert.match(missing, /data-usage-state="unknown"/u);
  assert.match(missing, /未取得/u);
  assert.match(zero, /data-usage-value="0"/u);
  assert.match(zero, /data-usage-state="unknown"/u);
  assert.match(fresh, /data-usage-state="ready"/u);
});

test("usage overview never marks non-finite remaining capacity ready", () => {
  for (const remainingPercent of [NaN, Infinity, -Infinity]) {
    const svg = decode(renderUsageOverviewKey([
      { id: "5h", kind: "five-hour", usedPercent: 0, remainingPercent, windowDurationMins: 300, resetsAt: null }
    ], "dark", "ready", { observedAt: 1000, now: 1000 }, "en"));
    assert.match(svg, /data-usage-state="unknown"/u);
    assert.match(svg, /data-usage-window-state="unknown"/u);
  }
});

test("an empty task dial title cannot imply a ready target", () => {
  for (const taskTitle of [undefined, "", "   "]) {
    const feedback = renderPlusDialFeedback({ kind: "agents", taskTitle, health: "ready", language: "en" });
    assert.equal(feedback.status, "unknown");
    assert.equal(feedback.value, "—");
  }
  const populated = renderPlusDialFeedback({ kind: "agents", taskTitle: "My task", health: "ready", language: "en" });
  assert.equal(populated.status, "ready");
  assert.equal(populated.value, "My task");
});

test("navigation artwork is neutral and does not present a conversation glyph", async () => {
  const svg = await readFile(new URL("../static/imgs/action-dial-conversation.svg", import.meta.url), "utf8");
  const svg2x = await readFile(new URL("../static/imgs/action-dial-conversation@2x.svg", import.meta.url), "utf8");
  assert.match(svg, /native navigation dial/u);
  assert.match(svg2x, /native navigation dial/u);
  assert.doesNotMatch(svg, />C</u);
  assert.doesNotMatch(svg2x, />C</u);
});

test("unknown operation progress never emits invalid SVG geometry or a full bar", () => {
  const base = renderActionKey({ identity: "ACT10", current: "Voice", target: "", state: "ready", theme: "dark" });
  for (const progress of [NaN, Infinity, -Infinity]) {
    const svg = decode(renderActionFeedback(base, { phase: "pending", progress }));
    assert.doesNotMatch(svg, /NaN|Infinity|data-operation-progress/u);
    assert.match(svg, /data-operation-phase="pending"/u);
  }
  assert.match(decode(renderActionFeedback(base, { phase: "pending", progress: 0.5 })), /data-operation-progress="0.500"/u);
});
