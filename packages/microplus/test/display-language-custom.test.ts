import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";
import {
  customizeKeyImage,
  renderActionFeedback,
  renderActionKey,
  renderAgentSvg,
  renderFallbackKeycap,
  renderPlusDialFeedback,
  type OperationFeedback,
} from "../src/render.js";

function decode(image: string): string {
  const comma = image.indexOf(",");
  return comma < 0 ? image : decodeURIComponent(image.slice(comma + 1));
}

function run(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd }, (error) => error ? reject(error) : resolve());
  });
}

function operation(phase: OperationFeedback["phase"]): OperationFeedback {
  return phase === "error" ? { phase, detail: "E_FOCUS_FAILED" } : { phase };
}

test("ja/en operation feedback has concrete motion frames and no SMIL animation", () => {
  const base = renderActionKey({ identity: "ACT10", current: "MIC", state: "ready", language: "en" });
  const jaHeld0 = decode(renderActionFeedback(base, operation("held"), "dark", "ja", 0));
  const jaHeld1 = decode(renderActionFeedback(base, operation("held"), "dark", "ja", 1));
  const enPending = decode(renderActionFeedback(base, { phase: "pending" }, "dark", "en", 3));

  assert.match(jaHeld0, />押下中</u);
  assert.match(jaHeld0, /data-operation-motion="held"/u);
  assert.notEqual(jaHeld0, jaHeld1, "held feedback must change with controller-owned frame");
  assert.match(enPending, />PENDING</u);
  assert.match(enPending, /data-operation-motion="pending"/u);
  assert.doesNotMatch(enPending, /<animate(?:Transform)?\b/u);
  assert.doesNotMatch(jaHeld0, /録音中|RECORDING|CONFIRMED/u);
});

test("goal and question attention are explicit, readable, and question-first", () => {
  const ja = renderAgentSvg(0, "タイトル", "idle", false, 0, "light", undefined, "ready", undefined, true, "ja", {
    goalStatus: "blocked",
    pendingQuestion: true,
  });
  const en = renderAgentSvg(0, "Task", "idle", false, 0, "dark", undefined, "ready", undefined, true, "en", {
    goalStatus: "blocked",
    pendingQuestion: true,
  });

  assert.match(ja, /data-agent-attention-priority="question-first"/u);
  assert.match(ja, /質問待ち/u);
  assert.match(ja, /停滞中/u);
  assert.doesNotMatch(ja, />準備完了</u, "goal/question attention must own the ready footer");
  assert.match(en, /QUESTION/u);
  assert.match(en, /STALLED/u);
  assert.doesNotMatch(en, />READY</u, "goal/question attention must own the ready footer");
  assert.match(en, /data-goal-status="blocked"/u);
  assert.doesNotMatch(ja, /data-agent-motion=/u, "attention owns the compact middle row");
  for (const match of en.matchAll(/data-agent-attention="[^"]*"[\s\S]*?font-size="([0-9.]+)"/gu)) {
    assert.ok(Number(match[1]) >= 9, "attention text must remain readable on a small key");
  }
});

test("custom key image edits only owned primary/detail nodes", () => {
  const base = renderActionKey({ identity: "ACT10", current: "MIC", target: "mapped", state: "ready", detail: "detail", theme: "dark" });
  const customized = decode(customizeKeyImage(base, {
    label: "MIC",
    textSize: "large",
    showDetails: false,
    language: "en",
  }));
  const resizedWithoutLabel = decode(customizeKeyImage(base, { textSize: "large", showDetails: true, language: "en" }));
  const imported = decode(customizeKeyImage(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"144\" height=\"144\"><text x=\"2\" y=\"20\">ORIGINAL</text></svg>",
    { label: "MIC", textSize: "large", language: "en" },
  ));

  assert.match(customized, /data-action-identity="MIC"[^>]*data-custom-label="true"/u);
  assert.match(customized, /data-action-identity="MIC"[^>]*font-size="(?:1[89]|2[0-9])\./u);
  assert.doesNotMatch(customized, /data-action-detail=/u);
  assert.doesNotMatch(customized, />detail</u);
  assert.match(resizedWithoutLabel, /data-action-identity="ACT10"[^>]*font-size="(?:1[89]|2[0-9])\./u);
  assert.match(imported, />ORIGINAL</u, "arbitrary imported text is preserved");
  assert.match(imported, /data-custom-label-layer="true"/u);
  assert.match(imported, />MIC</u);
});

test("every official keycap has a compact English label", () => {
  for (const id of OFFICIAL_KEYCAP_IDS) {
    const svg = decode(renderFallbackKeycapForTest(id));
    assert.doesNotMatch(svg, /[\u3040-\u30ff\u3400-\u9fff]/u, `${id} leaked Japanese fallback copy`);
  }
});

test("prototype-property fallback IDs render in both languages", () => {
  for (const language of ["ja", "en"] as const) {
    for (const id of ["__proto__", "constructor"] as const) {
      const svg = decode(renderFallbackKeycap(id, "dark", language));
      assert.match(svg, /data-icon-source="fallback-label"/u, `${id}/${language} should use fallback rendering`);
      assert.ok(svg.includes(`data-keycap-id="${id}"`), `${id}/${language} should preserve the fallback ID marker`);
    }
  }
});

function renderFallbackKeycapForTest(id: string): string {
  // Keep this helper local to the contract test so the loop checks the public
  // renderer output while the import remains independent of implementation
  // internals.
  return renderFallbackKeycap(id, "dark", "en");
}

test("command, usage, and model dial values remain observed value fields", () => {
  const command = renderPlusDialFeedback({ kind: "commands", observedValue: "TERM", detail: "Press to run", health: "ready", language: "en" });
  const usage = renderPlusDialFeedback({ kind: "usage", observedValue: null, detail: "5H remaining", health: "ready", language: "en" });
  const model = renderPlusDialFeedback({ kind: "model", observedValue: "gpt-6", detail: "Rotate to select, press to confirm", health: "ready", language: "en" });

  assert.deepEqual({ title: command.title, value: command.value, detail: command.detail }, { title: "COMMAND", value: "TERM", detail: "Press to run" });
  assert.deepEqual({ title: usage.title, value: usage.value, status: usage.status }, { title: "USAGE", value: "—", status: "unknown" });
  assert.deepEqual({ title: model.title, value: model.value }, { title: "MODEL", value: "gpt-6" });
});

test("agent dial icon animates only observed working states", () => {
  const thinking0 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "thinking", animationFrame: 0, health: "ready", language: "en" }).icon ?? "");
  const thinking1 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "thinking", animationFrame: 1, health: "ready", language: "en" }).icon ?? "");
  const input0 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "input", animationFrame: 0, health: "ready", language: "en" }).icon ?? "");
  const input1 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "input", animationFrame: 1, health: "ready", language: "en" }).icon ?? "");
  const idle0 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "idle", animationFrame: 0, health: "ready", language: "en" }).icon ?? "");
  const idle1 = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "idle", animationFrame: 1, health: "ready", language: "en" }).icon ?? "");
  const jaThinking = decode(renderPlusDialFeedback({ kind: "agents", slot: 0, agentStatus: "thinking", animationFrame: 0, health: "ready", language: "ja" }).icon ?? "");

  assert.notEqual(thinking0, thinking1, "thinking icon must change with the controller frame");
  assert.notEqual(input0, input1, "input/question icon must change with the controller frame");
  assert.equal(idle0, idle1, "idle icon must remain stable across animation frames");
  assert.match(thinking0, /data-agent-dial-motion="thinking"/u);
  assert.match(input0, /data-agent-dial-motion="input"/u);
  assert.match(input0, />\?</u, "input state should use a question shape");
  assert.match(jaThinking, /思考中/u, "agent dial status label should honor ja language");
  assert.doesNotMatch(thinking0, /<animate(?:Transform)?\b/u);
  assert.doesNotMatch(input0, /録音中|RECORDING/u, "input observation is not recording evidence");
});

test("language and attention fixtures rasterize in a temporary directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "microplus-display-language-"));
  try {
    try {
      await run("sips", ["--version"], directory);
    } catch {
      t.skip("macOS sips is unavailable");
      return;
    }
    const fixtures = {
      "ja-question-blocked.svg": renderAgentSvg(0, "タイトル", "idle", false, 0, "light", undefined, "ready", undefined, true, "ja", { goalStatus: "blocked", pendingQuestion: true }),
      "en-held.svg": decode(renderActionFeedback(renderActionKey({ identity: "ACT10", state: "ready" }), { phase: "held" }, "dark", "en", 5)),
    };
    for (const [name, svg] of Object.entries(fixtures)) {
      const input = join(directory, name);
      const output = join(directory, name.replace(/\.svg$/u, ".png"));
      await writeFile(input, svg, "utf8");
      await run("sips", ["-s", "format", "png", input, "--out", output], directory);
      const png = await readFile(output);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} must be a PNG`);
      assert.ok(png.length > 500, `${name} raster must contain visible output`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("question indicator pulses while blocked-only text remains stable", () => {
  const draw = (phase: number, pendingQuestion: boolean) => renderAgentSvg(0, "Task", "idle", false, phase, "dark", undefined, "ready", undefined, true, "en", { goalStatus: "blocked", pendingQuestion });
  assert.notEqual(draw(0, true), draw(6, true));
  assert.equal(draw(0, false), draw(6, false));
  assert.match(draw(0, true), /data-question-signal="true"/u);
  assert.match(draw(0, true), />QUESTION</u);
  assert.match(draw(6, true), />STALLED</u);
});
