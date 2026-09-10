import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DialAction, KeyAction } from "@elgato/streamdeck";
import { DeckController, MICROPLUS_DIAL_LAYOUT } from "../src/controller.js";
import type { HostHealth, MicroSnapshot } from "../src/types.js";

type FakeKey = {
  id: string;
  images: string[];
  titles: string[];
  setImage(image?: string): Promise<void>;
  setTitle(title?: string): Promise<void>;
};

type FakeDial = {
  id: string;
  layouts: string[];
  feedback: unknown[];
  setFeedbackLayout(path: string): Promise<void>;
  setFeedback(value: unknown): Promise<void>;
  showAlert(): Promise<void>;
};

type ControllerHarness = {
  snapshot: MicroSnapshot;
  health: HostHealth;
  animationFrame: number;
  operationFeedback: Map<string, { phase: "sent-unverified" | "pending"; detail: string; target: string }>;
  renderAll(): Promise<void>;
};

function snapshot(overrides: Partial<MicroSnapshot["slots"][number]>[] = []): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({
      id,
      threadKey: `thread-${id}`,
      title: id === 0 ? "Alpha" : id === 1 ? "Beta" : `Task ${id + 1}`,
      status: "idle",
      selected: id === 0,
      ...overrides[id],
    })),
    activeThreadKey: "thread-0",
    activeThreadTitle: "Alpha",
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch: 7,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

function controllerWithSnapshot(current = snapshot()): { controller: DeckController; harness: ControllerHarness } {
  const controller = new DeckController();
  const harness = controller as unknown as ControllerHarness;
  harness.snapshot = current;
  harness.health = { state: "ready", changedAt: 0 };
  return { controller, harness };
}

function fakeKey(id: string): FakeKey {
  const key: FakeKey = {
    id,
    images: [],
    titles: [],
    setImage: async (image) => { if (image != null) key.images.push(image); },
    setTitle: async (title) => { if (title != null) key.titles.push(title); },
  };
  return key;
}

function fakeDial(id: string): FakeDial {
  const dial: FakeDial = {
    id,
    layouts: [],
    feedback: [],
    setFeedbackLayout: async (path) => { dial.layouts.push(path); },
    setFeedback: async (value) => { recordFeedback(dial.feedback, value); },
    showAlert: async () => assert.fail("unexpected dial alert"),
  };
  return dial;
}

function recordFeedback(history: unknown[], value: unknown): void {
  const previous = history.at(-1);
  if (isFeedbackRecord(value)) {
    history.push({ ...(isFeedbackRecord(previous) ? previous : {}), ...value });
    return;
  }
  history.push(value);
}

function isFeedbackRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("model dial shows the focused candidate while the picker is open and the committed model at rest", async () => {
  const { controller, harness } = controllerWithSnapshot();
  const dial = fakeDial("committed-model");
  harness.snapshot.composerReadback = {
    modelLabel: "Model A", modelCandidateLabel: "Model B", modelPickerOpen: true,
    reasoningEffort: "high", fastEnabled: null, dictationPhase: "unavailable", observedAt: 1,
  };
  controller.registerPlusDial("model", dial as unknown as DialAction);
  await flushRender(harness);
  assert.equal(observedDialValue(dial), "Model B");
  harness.snapshot.composerReadback.modelPickerOpen = false;
  harness.snapshot.composerReadback.modelCandidateLabel = null;
  await flushRender(harness);
  assert.equal(observedDialValue(dial), "Model A");
  harness.operationFeedback.set(dial.id, { phase: "pending", detail: "結果確認中", target: "model" });
  await flushRender(harness);
  const pendingIcon = String((dial.feedback.at(-1) as Record<string, unknown>).icon);
  assert.match(decodeSvg(pendingIcon), /data-dial-glyph="model"/);
  assert.doesNotMatch(decodeSvg(pendingIcon), /data-operation-detail-text/);
  harness.animationFrame = .75;
  await flushRender(harness);
  assert.notEqual((dial.feedback.at(-1) as Record<string, unknown>).icon, pendingIcon);
  assert.equal(observedDialValue(dial), "Model A");
  harness.operationFeedback.set(dial.id, { phase: "sent-unverified", detail: "E_RESULT_UNVERIFIED", target: "model" });
  await flushRender(harness);
  assert.equal(observedDialValue(dial), "Model A");
  assert.equal((dial.feedback.at(-1) as Record<string, unknown>).status, "");
  assert.equal((dial.feedback.at(-1) as Record<string, unknown>).detail, "");
  harness.operationFeedback.set(dial.id, { phase: "sent-unverified", detail: "E_RELEASE_UNVERIFIED", target: "model" });
  await flushRender(harness);
  assert.match(String((dial.feedback.at(-1) as Record<string, unknown>).detail), /解除/);
  assert.notEqual((dial.feedback.at(-1) as Record<string, unknown>).status, "");
  harness.health = { state: "degraded", changedAt: 2 };
  await flushRender(harness);
  assert.equal(observedDialValue(dial), "—");
  harness.health = { state: "ready", changedAt: 3 };
  harness.snapshot = snapshot();
  harness.snapshot.activeThreadKey = "another-thread";
  await flushRender(harness);
  assert.notEqual((dial.feedback.at(-1) as Record<string, unknown>).value, "Model A");
});

test("idle reasoning dial does not keep the previous rotation marked pending", async () => {
  const { controller, harness } = controllerWithSnapshot();
  harness.snapshot.composerReadback = { modelLabel: "Model A", reasoningEffort: "high", fastEnabled: null, dictationPhase: "unavailable", observedAt: 1 };
  (harness as unknown as { lastReasoningAdjustment: string }).lastReasoningAdjustment = "increase";
  const dial = fakeDial("quiet-reasoning");
  controller.registerPlusDial("reasoning", dial as unknown as DialAction);
  await flushRender(harness);
  assert.equal(observedDialValue(dial), "high");
  assert.equal((dial.feedback.at(-1) as Record<string, unknown>).status, "");
  assert.equal((dial.feedback.at(-1) as Record<string, unknown>).detail, "");
});

function decodeSvg(image: string): string {
  const comma = image.indexOf(",");
  assert.ok(comma >= 0, "expected an encoded SVG image");
  return decodeURIComponent(image.slice(comma + 1));
}

function observedDialValue(dial: FakeDial): string {
  const payload = dial.feedback.at(-1) as Record<string, unknown> | undefined;
  const value = payload?.value;
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

function latestSvg(key: FakeKey): string {
  const image = key.images.at(-1);
  assert.ok(image, `${key.id} did not receive an image`);
  return decodeSvg(image);
}

async function flushRender(harness: ControllerHarness): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await harness.renderAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function agentTitleFont(svg: string): number {
  const group = /<g\b[^>]*data-agent-title="[^"]*"[^>]*>([\s\S]*?)<\/g>/u.exec(svg)?.[1] ?? "";
  const font = /font-size="([0-9.]+)"/u.exec(group)?.[1];
  assert.ok(font, "agent title font size is missing");
  return Number(font);
}

test("two key instances keep label, theme, and language preferences independent", async () => {
  const { controller, harness } = controllerWithSnapshot();
  const alpha = fakeKey("agent-alpha");
  const beta = fakeKey("agent-beta");
  controller.registerAgent(0, alpha as unknown as KeyAction);
  controller.registerAgent(1, beta as unknown as KeyAction);

  controller.setActionPreferences(alpha.id, { label: "日本語ラベル", theme: "light", language: "ja" });
  controller.setActionPreferences(beta.id, { label: "English Label", theme: "dark", language: "en" });
  await flushRender(harness);

  const alphaSvg = latestSvg(alpha);
  const betaSvg = latestSvg(beta);
  assert.match(alphaSvg, /data-theme="light"/u);
  assert.match(alphaSvg, /data-custom-label="true"[^>]*>日本語ラベル</u);
  assert.match(alphaSvg, />準備完了</u);
  assert.doesNotMatch(alphaSvg, /English Label|>READY</u);

  assert.match(betaSvg, /data-theme="dark"/u);
  assert.match(betaSvg, /data-custom-label="true"[^>]*>English Label</u);
  assert.match(betaSvg, />READY</u);
  assert.doesNotMatch(betaSvg, /日本語ラベル|準備完了/u);
});

test("large text changes the primary font even when the custom label is empty", async () => {
  const { controller, harness } = controllerWithSnapshot();
  const key = fakeKey("agent-text-size");
  controller.registerAgent(0, key as unknown as KeyAction);

  controller.setActionPreferences(key.id, { label: "", textSize: "normal" });
  await flushRender(harness);
  const normalFont = agentTitleFont(latestSvg(key));
  controller.setActionPreferences(key.id, { label: "", textSize: "large" });
  await flushRender(harness);
  const largeFont = agentTitleFont(latestSvg(key));

  assert.ok(largeFont > normalFont, `expected ${largeFont} to exceed ${normalFont}`);
});

test("hiding details preserves critical goal and question attention", async () => {
  const current = snapshot([{ goalStatus: "blocked", pendingQuestion: true }]);
  const { controller, harness } = controllerWithSnapshot(current);
  const key = fakeKey("agent-attention");
  controller.registerAgent(0, key as unknown as KeyAction);

  controller.setActionPreferences(key.id, { showDetails: false, language: "en" });
  await flushRender(harness);
  const svg = latestSvg(key);

  assert.match(svg, /data-agent-attention-priority="question-first"/u);
  assert.match(svg, /data-agent-attention="pending-question"/u);
  assert.match(svg, /data-goal-status="blocked"/u);
  assert.match(svg, /QUESTION/u);
  assert.match(svg, /STALLED/u);
});

test("animation disabled pins the rendered frame while controller animation advances", async () => {
  const current = snapshot([{ status: "thinking" }]);
  const { controller, harness } = controllerWithSnapshot(current);
  const key = fakeKey("agent-static");
  controller.registerAgent(0, key as unknown as KeyAction);
  controller.setActionPreferences(key.id, { animation: false });

  harness.animationFrame = 1;
  await flushRender(harness);
  const first = latestSvg(key);
  harness.animationFrame = 9;
  controller.setActionPreferences(key.id, { animation: false });
  await flushRender(harness);
  const second = latestSvg(key);

  assert.equal(second, first);
  assert.match(second, /data-agent-motion="working"/u);
});

test("dial preferences select all size and theme layouts and send SDK heading", async () => {
  const { controller, harness } = controllerWithSnapshot();
  const dial = fakeDial("navigation-dial");
  controller.registerPlusDial("navigation", dial as unknown as DialAction);
  await flushRender(harness);

  controller.setActionPreferences(dial.id, { textSize: "normal", theme: "light" });
  await flushRender(harness);
  controller.setActionPreferences(dial.id, { textSize: "large", theme: "light", label: "Navigation" });
  await flushRender(harness);
  const labeled = dial.feedback.at(-1) as Record<string, unknown> | undefined;
  assert.equal(labeled?.heading, "Navigation");
  assert.equal("title" in (labeled ?? {}), false);
  controller.setActionPreferences(dial.id, { textSize: "large", theme: "dark" });
  await flushRender(harness);

  assert.deepEqual(dial.layouts.slice(0, 4), [
    MICROPLUS_DIAL_LAYOUT,
    "static/layouts/microplus-dial-light.json",
    "static/layouts/microplus-dial-large-light.json",
    "static/layouts/microplus-dial-large.json",
  ]);
  assert.ok(dial.feedback.length > 0, "dial did not render feedback after layout initialization");

  controller.setActionPreferences(dial.id, { textSize: "normal", theme: "auto" });
  await flushRender(harness);
  harness.snapshot = { ...harness.snapshot, theme: "light" };
  await flushRender(harness);
  assert.deepEqual(dial.layouts.slice(-2), [
    MICROPLUS_DIAL_LAYOUT,
    "static/layouts/microplus-dial-light.json",
  ]);
});

test("all four native dial layouts tile the full LCD without overlapping SDK elements", async () => {
  const fixtures = [
    ["microplus-dial.json", 10],
    ["microplus-dial-light.json", 10],
    ["microplus-dial-large.json", 10],
    ["microplus-dial-large-light.json", 10],
  ] as const;

  for (const [filename, headingSize] of fixtures) {
    const layout = JSON.parse(await readFile(new URL(`../static/layouts/${filename}`, import.meta.url), "utf8")) as {
      items: Array<{ key: string; type: string; rect: number[]; font?: { size?: number } }>;
    };
    const byKey = new Map(layout.items.map((item) => [item.key, item]));
    assert.equal(byKey.has("title"), false, `${filename}: reserved SDK title key must not be used`);
    assert.equal(byKey.get("heading")?.type, "text", `${filename}: heading text is missing`);
    assert.equal(byKey.get("heading")?.font?.size, headingSize, `${filename}: heading size is wrong`);
    const elementKeys = new Set(["icon", "heading", "value", "detail", "status", "progress"]);
    const elements = layout.items.filter((item) => elementKeys.has(item.key));
    const backdrop = layout.items.filter((item) => /^backdrop-\d+$/u.test(item.key));
    const surface = byKey.get("surface");
    assert.equal(elements.length, 6, `${filename}: expected all six SDK feedback elements`);
    assert.equal(backdrop.length, 1, `${filename}: expected one interaction ribbon`);
    assert.ok(backdrop.every((item) => item.type === "pixmap"), `${filename}: every backdrop tile must be a pixmap`);
    assert.equal(surface?.type, "pixmap", `${filename}: full glass surface is missing`);
    assert.deepEqual(surface?.rect, [0, 0, 200, 100], `${filename}: surface must cover the LCD`);

    const rectangles = [...elements, ...backdrop].map((item) => {
      assert.equal(item.rect.length, 4, `${filename}:${item.key} has an invalid rect`);
      const [x = -1, y = -1, width = -1, height = -1] = item.rect;
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, `${filename}:${item.key} has invalid dimensions`);
      assert.ok(x + width <= 200 && y + height <= 100, `${filename}:${item.key} leaves the LCD bounds`);
      return { key: item.key, x, y, width, height };
    });
    for (let left = 0; left < rectangles.length; left += 1) {
      for (let right = left + 1; right < rectangles.length; right += 1) {
        const a = rectangles[left];
        const b = rectangles[right];
        assert.ok(a && b);
        const overlaps = a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height;
        assert.equal(overlaps, false, `${filename}:${a.key} overlaps ${b.key}`);
      }
    }
    assert.ok(surface, `${filename}: surface missing`);
  }
});
