import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  renderActionKey,
  renderAgentKey,
  renderContextCompactionKey,
  renderPlusDialSvg,
  renderUsageLimitKey,
} from "../src/render.js";

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Viewport = {
  width: number;
  height: number;
  viewBox: Bounds;
};

type GeometryReport = {
  viewport: Viewport;
  shapes: Bounds[];
  occupiedPixels: number;
  rasterPixels: number;
};

type SvgSample = {
  name: string;
  image: string;
};

const NUMBER = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
const SHAPE_TAGS = new Set(["rect", "circle", "ellipse", "line", "polygon", "polyline", "path", "text"]);

function decodeImage(image: string): string {
  const value = image.trim();
  if (!value) throw new Error("image is empty");
  if (!value.startsWith("data:")) return value;

  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("data URL has no payload");
  const metadata = value.slice(0, comma).toLowerCase();
  const payload = value.slice(comma + 1);
  if (!payload) throw new Error("data URL payload is empty");
  if (metadata.includes(";base64")) return Buffer.from(payload, "base64").toString("utf8");
  try {
    return decodeURIComponent(payload);
  } catch (error) {
    throw new Error("data URL payload is not URI encoded", { cause: error });
  }
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attribute = /([A-Za-z_:][A-Za-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(source)) != null) {
    attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function finiteNumber(value: string | undefined, fallback = 0): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`non-finite SVG number: ${value}`);
  return parsed;
}

function numberList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map((entry) => finiteNumber(entry));
}

function bounds(minX: number, minY: number, maxX: number, maxY: number): Bounds | undefined {
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return undefined;
  if (maxX <= minX || maxY <= minY) return undefined;
  return { minX, minY, maxX, maxY };
}

function expandStroke(geometry: Bounds, attributes: Map<string, string>): Bounds {
  const strokeWidth = Math.max(0, finiteNumber(attributes.get("stroke-width")));
  const halfStroke = strokeWidth / 2;
  return {
    minX: geometry.minX - halfStroke,
    minY: geometry.minY - halfStroke,
    maxX: geometry.maxX + halfStroke,
    maxY: geometry.maxY + halfStroke,
  };
}

function pathBounds(path: string): Bounds | undefined {
  // This is intentionally a conservative geometry oracle. It records every
  // finite coordinate-like number in a path, which is sufficient to reject
  // empty/degenerate paths without duplicating the renderer's path logic.
  const values = [...path.matchAll(new RegExp(NUMBER, "g"))].map((match) => Number(match[0]));
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined;
  const xs = values.filter((_value, index) => index % 2 === 0);
  const ys = values.filter((_value, index) => index % 2 === 1);
  return bounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

function textBounds(attributes: Map<string, string>, text: string): Bounds | undefined {
  if (!text.trim()) return undefined;
  const x = finiteNumber(attributes.get("x"));
  const y = finiteNumber(attributes.get("y"));
  const fontSize = Math.max(1, finiteNumber(attributes.get("font-size"), 12));
  // An estimate is enough for occupancy: key backgrounds provide exact large
  // rectangles, while this keeps a text-only SVG from being called empty.
  const width = Math.max(fontSize, [...text.trim()].length * fontSize * 0.45);
  return bounds(x, y - fontSize, x + width, y + fontSize * 0.25);
}

function shapeBounds(tag: string, attributes: Map<string, string>, body: string): Bounds | undefined {
  switch (tag) {
    case "rect": {
      const x = finiteNumber(attributes.get("x"));
      const y = finiteNumber(attributes.get("y"));
      return bounds(x, y, x + finiteNumber(attributes.get("width")), y + finiteNumber(attributes.get("height")));
    }
    case "circle": {
      const cx = finiteNumber(attributes.get("cx"));
      const cy = finiteNumber(attributes.get("cy"));
      const radius = Math.abs(finiteNumber(attributes.get("r")));
      return bounds(cx - radius, cy - radius, cx + radius, cy + radius);
    }
    case "ellipse": {
      const cx = finiteNumber(attributes.get("cx"));
      const cy = finiteNumber(attributes.get("cy"));
      const rx = Math.abs(finiteNumber(attributes.get("rx")));
      const ry = Math.abs(finiteNumber(attributes.get("ry")));
      return bounds(cx - rx, cy - ry, cx + rx, cy + ry);
    }
    case "line": {
      const x1 = finiteNumber(attributes.get("x1"));
      const y1 = finiteNumber(attributes.get("y1"));
      const x2 = finiteNumber(attributes.get("x2"));
      const y2 = finiteNumber(attributes.get("y2"));
      return bounds(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
    }
    case "polygon":
    case "polyline": {
      const points = numberList(attributes.get("points"));
      if (points.length < 4) return undefined;
      const xs = points.filter((_value, index) => index % 2 === 0);
      const ys = points.filter((_value, index) => index % 2 === 1);
      return bounds(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    case "path":
      return pathBounds(attributes.get("d") ?? "");
    case "text":
      return textBounds(attributes, body);
    default:
      return undefined;
  }
}

function parseViewport(svg: string): Viewport {
  const root = /^\s*<svg\b([^>]*)>/u.exec(svg);
  if (!root) throw new Error("SVG root is missing");
  const attributes = parseAttributes(root[1] ?? "");
  const width = finiteNumber(attributes.get("width"));
  const height = finiteNumber(attributes.get("height"));
  const viewBox = numberList(attributes.get("viewbox"));
  if (viewBox.length !== 4) throw new Error("SVG viewBox must contain four numbers");
  const [minX, minY, viewWidth, viewHeight] = viewBox;
  if (viewWidth == null || viewHeight == null || viewWidth <= 0 || viewHeight <= 0) throw new Error("SVG viewBox is degenerate");
  if (width <= 0 || height <= 0) throw new Error("SVG width/height is degenerate");
  return {
    width,
    height,
    viewBox: { minX: minX ?? 0, minY: minY ?? 0, maxX: (minX ?? 0) + viewWidth, maxY: (minY ?? 0) + viewHeight },
  };
}

function validateXml(svg: string): void {
  const xmllint = spawnSync("/usr/bin/xmllint", ["--nonet", "--noout", "-"], {
    input: svg,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (!xmllint.error) {
    if (xmllint.status !== 0) throw new Error(`malformed SVG XML: ${xmllint.stderr.trim() || "xmllint failed"}`);
    return;
  }

  // Keep the test executable on hosts without libxml2. This fallback is only
  // a structural check; geometry assertions below remain the primary oracle.
  const stack: string[] = [];
  let rootSeen = false;
  const tokens = svg.replace(/<!--[\s\S]*?-->/g, "").match(/<[^>]*>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      if (token.includes(">") || (stack.length === 0 && token.trim() !== "")) throw new Error("malformed SVG text");
      continue;
    }
    if (/^<\?xml\b/u.test(token) || /^<!DOCTYPE\b/u.test(token)) continue;
    const close = /^<\/([A-Za-z][A-Za-z0-9:._-]*)\s*>$/u.exec(token);
    if (close) {
      if (stack.pop() !== close[1]) throw new Error("mismatched SVG closing tag");
      continue;
    }
    const open = /^<([A-Za-z][A-Za-z0-9:._-]*)\b[^>]*?(\/?)>$/u.exec(token);
    if (!open) throw new Error("malformed SVG tag");
    if (stack.length === 0) {
      if (rootSeen || open[1]!.toLowerCase() !== "svg") throw new Error("SVG must have one root element");
      rootSeen = true;
    }
    if (open[2] !== "/") stack.push(open[1]!);
  }
  if (!rootSeen || stack.length !== 0) throw new Error("unclosed SVG tag");
}

function parseGeometry(svg: string): Bounds[] {
  const shapes: Bounds[] = [];
  const source = svg.replace(/<!--[\s\S]*?-->/g, "");
  const nonRendered = new Set(["defs", "clippath", "mask", "pattern", "symbol", "marker"]);
  const stack: string[] = [];
  const tag = /<\/?([A-Za-z][A-Za-z0-9:._-]*)(?:\s+([^>]*?))?\s*\/?>(?:)/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(source)) != null) {
    const element = match[1]!.toLowerCase();
    const closing = match[0]!.startsWith("</");
    if (closing) {
      if (stack.at(-1) === element) stack.pop();
      continue;
    }
    const hidden = stack.some((ancestor) => nonRendered.has(ancestor));
    const attributes = parseAttributes(match[2] ?? "");
    if (!hidden && SHAPE_TAGS.has(element)) {
      let body = "";
      if (element === "text") {
        const end = source.indexOf("</text>", tag.lastIndex);
        if (end >= 0) body = source.slice(tag.lastIndex, end);
      }
      const geometry = shapeBounds(element, attributes, body);
      if (geometry) shapes.push(expandStroke(geometry, attributes));
    }
    if (!/\/\s*>$/u.test(match[0]!)) stack.push(element);
  }
  return shapes;
}

function rasterize(shapes: Bounds[], viewBox: Bounds, size = 32): { occupiedPixels: number; rasterPixels: number } {
  const pixels = new Uint8Array(size * size);
  const width = viewBox.maxX - viewBox.minX;
  const height = viewBox.maxY - viewBox.minY;
  for (const shape of shapes) {
    const minX = Math.max(viewBox.minX, shape.minX);
    const minY = Math.max(viewBox.minY, shape.minY);
    const maxX = Math.min(viewBox.maxX, shape.maxX);
    const maxY = Math.min(viewBox.maxY, shape.maxY);
    if (maxX <= minX || maxY <= minY) continue;
    const firstX = Math.max(0, Math.floor(((minX - viewBox.minX) / width) * size));
    const firstY = Math.max(0, Math.floor(((minY - viewBox.minY) / height) * size));
    const lastX = Math.min(size - 1, Math.ceil(((maxX - viewBox.minX) / width) * size) - 1);
    const lastY = Math.min(size - 1, Math.ceil(((maxY - viewBox.minY) / height) * size) - 1);
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) pixels[y * size + x] = 1;
    }
  }
  return { occupiedPixels: pixels.reduce((sum, pixel) => sum + pixel, 0), rasterPixels: pixels.length };
}

function inspectSvg(image: string): GeometryReport {
  const svg = decodeImage(image);
  if (!svg.trim()) throw new Error("SVG output is empty");
  if (/\b(?:NaN|Infinity|undefined)\b/u.test(svg)) throw new Error("SVG output contains a non-finite placeholder");
  validateXml(svg);
  const viewport = parseViewport(svg);
  const viewWidth = viewport.viewBox.maxX - viewport.viewBox.minX;
  const viewHeight = viewport.viewBox.maxY - viewport.viewBox.minY;
  if (viewWidth < 16 || viewHeight < 16) throw new Error("SVG viewBox is too small for a Stream Deck surface");
  if (viewport.width < 32 || viewport.height < 32) throw new Error("SVG pixel dimensions are too small");
  const shapes = parseGeometry(svg);
  if (shapes.length === 0) throw new Error("SVG has no drawable geometry");
  const raster = rasterize(shapes, viewport.viewBox);
  if (raster.occupiedPixels < Math.max(4, Math.floor(raster.rasterPixels * 0.05))) {
    throw new Error("SVG geometry is empty or entirely outside its viewBox");
  }
  return { viewport, shapes, ...raster };
}

const samples: SvgSample[] = [
  {
    name: "action",
    image: renderActionKey({ identity: "SEND", current: "送信", target: "TASK-01", state: "ready", theme: "dark", language: "ja" }),
  },
  {
    name: "agent",
    image: renderAgentKey(2, "Build task", "thinking", true, 3, "light", "A03", "ready", 62, true, "en", { goalStatus: "active", pendingQuestion: true }),
  },
  {
    name: "context",
    image: renderContextCompactionKey({ contextUsedPercent: 42, contextRevision: 7, health: "ready", state: "ready", theme: "dark", language: "en" }),
  },
  {
    name: "usage",
    image: renderUsageLimitKey({ id: "five-hour", kind: "five-hour", usedPercent: 55, remainingPercent: 45, windowDurationMins: 300, resetsAt: null }, "five-hour", "dark", "ready", { observedAt: 1000, now: 1000 }, "en"),
  },
  {
    name: "dial",
    image: renderPlusDialSvg({ kind: "usage", health: "ready", observedValue: 45, detail: "Current", theme: "dark", language: "en", interactionAgeMs: 60, interactionDirection: 1 }),
  },
];

test("representative Micro Plus SVG outputs have valid XML and visible geometry", () => {
  for (const sample of samples) {
    const report = inspectSvg(sample.image);
    const viewWidth = report.viewport.viewBox.maxX - report.viewport.viewBox.minX;
    const viewHeight = report.viewport.viewBox.maxY - report.viewport.viewBox.minY;
    assert.ok(report.shapes.length > 0, `${sample.name}: no shapes`);
    assert.ok(report.occupiedPixels >= 4, `${sample.name}: raster is empty`);
    assert.ok(viewWidth >= 16 && viewHeight >= 16, `${sample.name}: degenerate viewBox`);
    assert.ok(report.viewport.width >= 32 && report.viewport.height >= 32, `${sample.name}: degenerate pixel size`);
  }
});

test("the oracle rejects empty, malformed, one-by-one, and degenerate-viewBox SVG", () => {
  const invalid: Array<[string, string]> = [
    ["empty", ""],
    ["non-svg", "not an image"],
    ["malformed", '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="100" height="100"></svg>'],
    ["one-by-one", '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'],
    ["empty-geometry", '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"></svg>'],
    ["off-canvas", '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect x="300" y="300" width="2" height="2"/></svg>'],
  ];
  for (const [name, svg] of invalid) {
    assert.throws(() => inspectSvg(svg), /./u, `${name} must be rejected`);
  }
});
