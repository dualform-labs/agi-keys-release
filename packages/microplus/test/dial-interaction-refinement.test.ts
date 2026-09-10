import assert from "node:assert/strict";
import test from "node:test";
import { renderAgentSvg, renderPlusDialFeedback, renderDialInteractionRibbon, renderDialSurface, dialInteractionValueColor, dialInteractionStrength, DIAL_INTERACTION_DURATION_MS } from "../src/render.js";

const decodeIcon = (image: string): string => decodeURIComponent(image.slice(image.indexOf(",") + 1));

test("blocked goal keeps observed running visible, including a simultaneous question", () => {
  for (const language of ["ja", "en"] as const) {
    const attention = { goalStatus: "blocked" as const, pendingQuestion: true };
    const running = renderAgentSvg(0, "Task", "thinking", false, 0, "dark", undefined, "ready", undefined, true, language, attention);
    assert.match(running, /data-goal-status="blocked"/);
    assert.match(running, /data-agent-running="true"/);
    assert.ok(running.includes(language === "ja" ? "実行中" : "RUNNING"));
    assert.match(running, /data-agent-attention="pending-question"/);
    const idle = renderAgentSvg(0, "Task", "idle", false, 0, "dark", undefined, "ready", undefined, true, language, attention);
    assert.doesNotMatch(idle, /data-agent-running="true"/);
    const offline = renderAgentSvg(0, "Task", "thinking", false, 0, "dark", undefined, "offline", undefined, true, language, attention);
    assert.doesNotMatch(offline, /data-agent-running="true"/);
  }
});

test("dial glyphs animate pending operations while their current value remains stable", () => {
  for (const kind of ["model", "reasoning", "usage", "commands", "navigation"] as const) {
    const common = { kind, observedValue: "Current", activeThreadTitle: "Task", health: "ready" as const };
    const a = renderPlusDialFeedback({ ...common, state: "pending", animationFrame: 0 });
    const b = renderPlusDialFeedback({ ...common, state: "pending", animationFrame: 3 });
    assert.notEqual(a.icon, b.icon);
    assert.equal(a.value, b.value);
    assert.equal(renderPlusDialFeedback({ ...common, state: "ready", animationFrame: 0 }).icon,
      renderPlusDialFeedback({ ...common, state: "ready", animationFrame: 3 }).icon);
  }
});


test("LCD ribbon distinguishes a finite input acknowledgement from waiting and failure", () => {
  const svg = (state: Parameters<typeof renderDialInteractionRibbon>[0], age?: number, frame = 0) => decodeURIComponent(renderDialInteractionRibbon(state, "dark", frame, age).split(",").slice(1).join(","));
  assert.match(svg("ready", 0), /data-dial-input/);
  assert.notEqual(svg("ready", 0), svg("ready", 300));
  assert.doesNotMatch(svg("ready", DIAL_INTERACTION_DURATION_MS), /data-dial-input|data-dial-wait/);
  assert.doesNotMatch(svg("ready", Number.NaN), /data-dial-input|data-dial-wait/);
  assert.doesNotMatch(svg("ready", -1), /data-dial-input|data-dial-wait/);
  assert.match(svg("pending"), /data-dial-wait/);
  assert.notEqual(svg("pending", undefined, 0), svg("pending", undefined, 3));
  for (const state of ["error", "offline", "stale", "unavailable", "connecting"] as const) {
    assert.doesNotMatch(svg(state, 10), /data-dial-input|data-dial-wait/);
  }
  assert.match(decodeURIComponent(renderDialInteractionRibbon("ready", "light", 0)), /#EEF2F4/);
});


test("actual rotation direction reacts without changing the observed value and settles to rest", () => {
  const base = { kind: "model" as const, observedValue: "GPT-5.6 Sol", state: "ready" as const };
  const right = renderPlusDialFeedback({ ...base, interactionAgeMs: 0, interactionDirection: 1 });
  const left = renderPlusDialFeedback({ ...base, interactionAgeMs: 0, interactionDirection: -1 });
  assert.notEqual(right.icon, left.icon);
  assert.equal(right.value, base.observedValue);
  assert.equal(left.value, base.observedValue);
  assert.equal(renderPlusDialFeedback({ ...base, interactionAgeMs: DIAL_INTERACTION_DURATION_MS }).icon, renderPlusDialFeedback(base).icon);
  assert.equal(dialInteractionValueColor("dark", 0), dialInteractionValueColor("dark", 20));
  assert.notEqual(dialInteractionValueColor("dark", 0), dialInteractionValueColor("dark", 300));
  assert.equal(DIAL_INTERACTION_DURATION_MS, 360);
  assert.equal(dialInteractionStrength(70), 1);
  assert.ok(dialInteractionStrength(71) < 1, "the dial cue begins fading after its 70ms peak");
  assert.equal(dialInteractionStrength(DIAL_INTERACTION_DURATION_MS), 0);
  assert.equal(dialInteractionValueColor("dark", DIAL_INTERACTION_DURATION_MS), "#F1F5F7");
  assert.equal(dialInteractionValueColor("light", DIAL_INTERACTION_DURATION_MS), "#172027");
});

test("dial glass is limited to a live healthy cue and disappears at expiry or offline", () => {
  const base = { kind: "model" as const, observedValue: "GPT-5.6 Sol", state: "ready" as const, theme: "light" as const };
  const fresh = decodeIcon(renderPlusDialFeedback({ ...base, interactionAgeMs: 0, interactionDirection: 1 }).icon!);
  const rest = decodeIcon(renderPlusDialFeedback(base).icon!);
  const expired = decodeIcon(renderPlusDialFeedback({ ...base, interactionAgeMs: DIAL_INTERACTION_DURATION_MS, interactionDirection: 1 }).icon!);
  const offline = decodeIcon(renderPlusDialFeedback({ ...base, state: "offline", health: "offline", interactionAgeMs: 0, interactionDirection: 1 }).icon!);

  assert.match(fresh, /data-dial-glass="true"/);
  assert.match(fresh, /data-dial-glass="true" opacity="1\.000"/);
  assert.match(fresh, /<linearGradient id="dial-glass"[\s\S]*<stop stop-color="#7040B8"/);
  assert.match(fresh, /data-dial-specular="true"/);
  assert.match(fresh, /data-dial-trails="true"/);
  assert.match(fresh, /stroke-width="2\.7"/);
  assert.match(fresh, /stop-opacity="\.58"/);
  assert.match(fresh, /data-dial-direction="1"/);
  assert.equal(renderPlusDialFeedback({ ...base, interactionAgeMs: 0, interactionDirection: 1 }).value, base.observedValue);
  for (const [name, svg] of [["rest", rest], ["expired", expired], ["offline", offline]] as const) {
    assert.doesNotMatch(svg, /data-dial-glass|data-dial-direction/, `${name} must not retain the transient dial cue`);
  }
});

test("the full LCD surface moves by direction in bounded keyframes and rests without motion", () => {
  const start = decodeIcon(renderDialSurface("model", "ready", "dark", 0, 1));
  const sameKeyframe = decodeIcon(renderDialSurface("model", "ready", "dark", 33, 1));
  const nextKeyframe = decodeIcon(renderDialSurface("model", "ready", "dark", 61, 1));
  const left = decodeIcon(renderDialSurface("model", "ready", "dark", 0, -1));
  const rest = decodeIcon(renderDialSurface("model", "ready", "dark"));
  assert.equal(start, sameKeyframe, "large surface should not force a host raster on every 33ms glyph frame");
  assert.notEqual(start, nextKeyframe);
  assert.match(start, /data-dial-surface-motion="1"/);
  assert.match(left, /data-dial-surface-motion="-1"/);
  assert.doesNotMatch(rest, /data-dial-surface-motion/);
  assert.doesNotMatch(start, /ellipse|radialGradient|surface-bloom/);
  assert.match(start, /linearGradient id="surface-rest"/);
  assert.match(start, /data-dial-surface-motion="1" clip-path="url\(#dial-surface-clip\)"/);
  assert.match(start, /<clipPath id="dial-surface-clip"><rect width="200" height="100" rx="18"\/><\/clipPath>/);
  assert.match(start, /stroke-width="2\.2" opacity="\.76"/);
});
