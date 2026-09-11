import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";
import type { UsageWindow } from "../src/types.js";
import {
  renderAgentSvg,
  renderFallbackKeycap,
  renderUsageLimitKey,
  renderUsageOverviewKey,
} from "../src/render.js";
import { visualStatusFromMicro } from "../src/status.js";

const execFileAsync = (file: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
  execFile(file, args, (error: Error | null) => error ? reject(error) : resolve());
});

type SvgAttributes = Record<string, string>;
type TextNode = { attributes: SvgAttributes; content: string };

function decodeDataUrl(value: string): string {
  const comma = value.indexOf(",");
  assert.ok(comma >= 0, "renderer returned a malformed data URL");
  return decodeURIComponent(value.slice(comma + 1));
}

function attributes(markup: string): SvgAttributes {
  const result: SvgAttributes = {};
  const expression = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of markup.matchAll(expression)) {
    const name = match[1];
    const value = match[3];
    if (name != null && value != null) result[name] = value;
  }
  return result;
}

function textNodes(markup: string): TextNode[] {
  const nodes: TextNode[] = [];
  for (const match of markup.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    nodes.push({ attributes: attributes(match[1] ?? ""), content: match[2] ?? "" });
  }
  return nodes;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function assert144Svg(svg: string): void {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const rootAttrs = attributes(root);
  assert.equal(rootAttrs.width, "144");
  assert.equal(rootAttrs.height, "144");
  assert.equal(rootAttrs.viewBox, "0 0 144 144");
}

function contrastRatio(foreground: string, background: string): number {
  const toRgb = (value: string): [number, number, number] => {
    const normalized = value.trim().replace(/^#/, "");
    const hex = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
    assert.match(hex, /^[0-9a-f]{6}$/i, `expected a solid hex color, got ${value}`);
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  };
  const luminance = (value: string): number => {
    const [r, g, b] = toRgb(value).map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function keycapStops(svg: string): string[] {
  const gradient = svg.match(/<linearGradient\s+id="keycap"[\s\S]*?<\/linearGradient>/i)?.[0] ?? "";
  return [...gradient.matchAll(/stop-color="(#[0-9a-f]{3}(?:[0-9a-f]{3})?)"/gi)]
    .map((match) => match[1])
    .filter((value): value is string => value != null);
}

type PixelBounds = { left: number; top: number; right: number; bottom: number };

/** Decode the 8-bit RGBA PNG emitted by macOS sips without adding an image dependency. */
function darkPixelBounds(png: Buffer): PixelBounds {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "expected a PNG raster");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed: Buffer[] = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") compressed.push(data);
    offset += length + 12;
    if (type === "IEND") break;
  }
  assert.equal(bitDepth, 8, "raster fixture must use 8-bit channels");
  assert.equal(colorType, 6, "raster fixture must use RGBA channels");
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(height * stride);
  const paeth = (left: number, up: number, upLeft: number): number => {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
  };
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset++] ?? 0;
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] ?? 0 : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] ?? 0 : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] ?? 0 : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upLeft)
                : assert.fail(`unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (raw + predictor) & 0xff;
    }
  }
  const bounds: PixelBounds = { left: width, top: height, right: -1, bottom: -1 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * stride + x * bytesPerPixel;
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const alpha = pixels[index + 3] ?? 0;
      if (alpha >= 180 && red < 70 && green < 80 && blue < 90) {
        bounds.left = Math.min(bounds.left, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x);
        bounds.bottom = Math.max(bounds.bottom, y);
      }
    }
  }
  assert.ok(bounds.right >= bounds.left && bounds.bottom >= bounds.top, "raster fixture has no dark glyph pixels");
  return bounds;
}

function agentTitleNodes(svg: string): TextNode[] {
  const slot = svg.match(/<g\s+data-agent-slot="1"[^>]*>([\s\S]*?)<\/g>/i)?.[1] ?? "";
  return textNodes(slot).filter((node) => Number(node.attributes.y) !== 24);
}

function titleAdvance(text: string, fontSize: number, letterSpacing: number): number {
  let units = 0;
  let visibleCharacters = 0;
  for (const character of stripMarkup(text)) {
    if (/\p{M}/u.test(character)) continue;
    visibleCharacters += 1;
    if (/\s/u.test(character)) units += 0.32;
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|[\uAC00-\uD7AF]/u.test(character)) units += 1;
    else if (/[ilI1.,:;'|!]/.test(character)) units += 0.3;
    else if (/[MW@%&]/.test(character)) units += 0.88;
    else if (/[A-ZÄÖÜ]/.test(character)) units += 0.63;
    else units += 0.54;
  }
  return units * fontSize + Math.max(0, visibleCharacters - 1) * letterSpacing;
}

function usageWindow(remainingPercent: number): UsageWindow {
  return {
    id: "fixture-five-hour",
    kind: "five-hour",
    usedPercent: 100 - remainingPercent,
    remainingPercent,
    windowDurationMins: 5 * 60,
    resetsAt: 1_800_000_000,
  };
}

test("long Japanese, Latin, and mixed titles stay inside the 144px keycap", () => {
  const fixtures = [
    "日本語の長いタイトルを表示してクリップしない確認用",
    "WWWWWWWWWWWWWWWWWWWWWWWW wide Latin title",
    "日本語Mixed title with ABC123 and extremely long suffix",
  ];

  for (const title of fixtures) {
    const svg = renderAgentSvg(0, title, "idle", false, 0, "light");
    assert144Svg(svg);
    const lines = agentTitleNodes(svg);
    assert.ok(lines.length >= 1 && lines.length <= 2, `${title}: title must occupy at most two lines`);

    for (const line of lines) {
      const fontSize = Number(line.attributes["font-size"]);
      const y = Number(line.attributes.y);
      const spacing = Number(line.attributes["letter-spacing"] ?? 0);
      assert.ok(Number.isFinite(fontSize) && fontSize >= 10, `${title}: title font is missing`);
      assert.ok(Number.isFinite(y) && y - fontSize * 0.9 >= 30 && y + fontSize * 0.3 <= 96, `${title}: title line leaves its vertical safe area`);
      assert.ok(titleAdvance(line.content, fontSize, spacing) <= 112, `${title}: title line exceeds the safe 112px text width`);
    }
  }
});

test("unknown native state remains explicit and never renders as ready", () => {
  const status = visualStatusFromMicro("future-native-status");
  assert.equal(status, "unknown");
  const svg = renderAgentSvg(0, "Task", status, false, 0, "light");
  assert144Svg(svg);
  assert.match(svg, /data-agent-status-label="unknown"/);
  assert.doesNotMatch(svg, /data-agent-status-label="idle"/);
  assert.doesNotMatch(svg, /data-agent-motion="idle"/);

  const statusNode = textNodes(svg).find((node) => node.attributes["data-agent-status-label"] === "unknown");
  assert.ok(statusNode, "unknown state must have a visible status label");
  assert.match(stripMarkup(statusNode.content), /不明|未取得|信号なし|unknown/i);
  assert.doesNotMatch(stripMarkup(statusNode.content), /準備完了|ready/i);
});

test("unavailable goal and question metadata is visible on an assigned agent", () => {
  const svg = renderAgentSvg(0, "Task", "idle", false, 0, "light", undefined, "ready", undefined, true, "en", {
    metadataAvailability: "unavailable",
  });

  assert.match(svg, /data-agent-attention="metadata-unavailable"/);
  assert.match(svg, />DETAILS N\/A</);
  const japanese = renderAgentSvg(0, "Task", "idle", false, 0, "light", undefined, "ready", undefined, true, "ja", { metadataAvailability: "unavailable" });
  assert.match(japanese, />詳細未取得</);
  assert.doesNotMatch(japanese, /状態不明/);
  assert.doesNotMatch(svg, /SIGNALS UNKNOWN|状態不明/);
  assert.match(svg, /data-agent-status-frame="idle"/);
});

test("combined microphone ACT11 fallback is readable in a 144px light keycap", () => {
  const svg = decodeDataUrl(renderFallbackKeycap("ACT11 無効", "light"));
  assert144Svg(svg);
  assert.match(svg, /data-icon-source="fallback-label"/);
  assert.match(svg, /data-keycap-id="ACT11 無効"/);

  const labels = textNodes(svg).filter((node) => node.attributes["data-icon-source"] === "fallback-label");
  assert.ok(labels.length >= 2, "ACT11 fallback must expose one text node per line");
  const labelText = labels.map((node) => stripMarkup(node.content)).join("");
  assert.match(labelText, /ACT11/);
  assert.match(labelText, /無効/);
  assert.ok(labels.length <= 2, "ACT11 fallback must use at most two lines");
  for (const label of labels) {
    const fontSize = Number(label.attributes["font-size"]);
    assert.ok(fontSize >= 14, "ACT11 fallback text is too small to read");
    const spacing = Number(label.attributes["letter-spacing"] ?? 0);
    assert.ok(titleAdvance(label.content, fontSize, spacing) <= 112, "ACT11 fallback line exceeds the safe width");
  }

  const fill = labels[0]?.attributes.fill;
  const stops = keycapStops(svg);
  assert.ok(fill && stops.length > 0, "ACT11 fallback must provide text and keycap colors");
  for (const stop of stops) assert.ok(contrastRatio(fill!, stop) >= 4.5, `ACT11 label contrast is too low against ${stop}`);
});

test("light theme uses readable status text against every keycap gradient stop", () => {
  const statuses = ["empty", "idle", "thinking", "complete", "input", "error"] as const;
  for (const status of statuses) {
    const svg = renderAgentSvg(0, "表示確認", status, false, 0, "light");
    const label = textNodes(svg).find((node) => node.attributes["data-agent-status-label"] === status);
    assert.ok(label, `${status}: status label is missing`);
    const fill = label.attributes.fill;
    assert.ok(fill, `${status}: status label color is missing`);
    for (const stop of keycapStops(svg)) {
      assert.ok(contrastRatio(fill!, stop) >= 3, `${status}: status label contrast is too low against ${stop}`);
    }
  }
});

test("usage rendering distinguishes real zero from unknown and stale values", () => {
  const zero = decodeDataUrl(renderUsageLimitKey(usageWindow(0), "five-hour", "dark", "ready"));
  assert.match(zero, /data-usage-value="0"/);
  assert.match(zero, />0<|>0<\/text>/);

  const unknown = decodeDataUrl(renderUsageLimitKey(undefined, "five-hour", "dark", "ready"));
  assert.doesNotMatch(unknown, /data-usage-value=/);
  assert.doesNotMatch(unknown, /data-usage-remaining=/);
  assert.match(unknown, />—<|>—<\/text>/);

  const overviewUnknown = decodeDataUrl(renderUsageOverviewKey([], "dark", "ready"));
  assert.doesNotMatch(overviewUnknown, /data-usage-remaining=/);
  assert.doesNotMatch(overviewUnknown, /data-usage-value=/);
  assert.match(overviewUnknown, /—/);

  const malformed = decodeDataUrl(renderUsageLimitKey(usageWindow(Number.NaN), "five-hour", "dark", "ready"));
  assert.doesNotMatch(malformed, /data-usage-value=/);
  assert.doesNotMatch(malformed, /NaN/);
  assert.match(malformed, />—<|>—<\/text>/);

  for (const health of ["degraded", "connecting", "offline"] as const) {
    const stale = decodeDataUrl(renderUsageLimitKey(usageWindow(73), "five-hour", "dark", health));
    assert.doesNotMatch(stale, /data-usage-value=/, `${health}: stale usage must not look current`);
    assert.doesNotMatch(stale, /data-usage-remaining=/, `${health}: stale usage must not draw a current bar`);
    assert.match(stale, />—<|>—<\/text>/, `${health}: stale usage must be visibly unknown`);
  }

  const overview = decodeDataUrl(renderUsageOverviewKey([usageWindow(73), {
    ...usageWindow(41),
    id: "fixture-weekly",
    kind: "weekly",
    windowDurationMins: 7 * 24 * 60,
  }], "dark", "degraded"));
  assert.doesNotMatch(overview, /data-usage-remaining=/, "stale overview must not draw current bars");
  assert.doesNotMatch(overview, />73%<|>41%<\/text>/, "stale overview must not expose old percentages");
  assert.match(overview, /data-usage-state="stale"|data-usage-window-state="stale"/);
});

test("display fixtures rasterize at the native 144px size", async (t) => {
  try {
    await execFileAsync("sips", ["--help"]);
  } catch {
    t.skip("macOS sips is unavailable; markup acceptance tests still cover the fixture");
    return;
  }

  const fixtureDirectory = await mkdtemp(join(tmpdir(), "codex-micro-display-"));
  const fixtures: Record<string, string> = {
    "title-ja": renderAgentSvg(0, "日本語の長いタイトルを表示してクリップしない確認用", "idle", false, 0, "light"),
    "title-latin": renderAgentSvg(0, "WWWWWWWWWWWWWWWWWWWWWWWW wide Latin title", "thinking", false, 0, "dark"),
    "title-mixed": renderAgentSvg(0, "日本語Mixed title with ABC123 and extremely long suffix", "complete", false, 0, "light"),
    "unknown-state": renderAgentSvg(0, "Task", "unknown", false, 0, "light"),
    "act11-disabled": decodeDataUrl(renderFallbackKeycap("ACT11 無効", "light")),
    "usage-unknown": decodeDataUrl(renderUsageLimitKey(undefined, "five-hour", "dark", "ready")),
    "usage-zero": decodeDataUrl(renderUsageLimitKey(usageWindow(0), "five-hour", "dark", "ready")),
  };

  for (const [name, svg] of Object.entries(fixtures)) {
    assert144Svg(svg);
    const svgPath = join(fixtureDirectory, `${name}.svg`);
    const pngPath = join(fixtureDirectory, `${name}.png`);
    await writeFile(svgPath, svg, "utf8");
    await execFileAsync("sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
    const png = await readFile(pngPath);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${basename(pngPath)} is not a PNG`);
    assert.equal(png.readUInt32BE(16), 144, `${basename(pngPath)} width`);
    assert.equal(png.readUInt32BE(20), 144, `${basename(pngPath)} height`);
    assert.ok(png.length > 256, `${basename(pngPath)} raster fixture is empty`);
    if (name === "act11-disabled") {
      const bounds = darkPixelBounds(png);
      assert.ok(bounds.left >= 10 && bounds.right <= 133, `ACT11 glyph touches the 144px raster edge (${bounds.left}..${bounds.right})`);
    }
  }
  t.diagnostic(`display raster fixtures: ${fixtureDirectory}`);
});
