import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import type { KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { DeckController } from "../src/controller.js";
import { GlobalDictationAction } from "../src/global-dictation-action.js";
import {
  customizeKeyImage,
  renderFallbackKeycap,
  renderRateLimitResetKey,
  renderUsageLimitKey,
  renderUsageOverviewKey,
} from "../src/render.js";
import type { UsageWindow } from "../src/types.js";

class FakeElement {
  checked = false;
  hidden = false;
  value = "";
  placeholder = "";
  textContent = "";
  label = "";
  readonly listeners = new Map<string, ((event: { target: FakeElement }) => void)[]>();

  addEventListener(type: string, listener: (event: { target: FakeElement }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
  }
}

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

test("common and agent PIs localize every visible control and document language", async () => {
  for (const inspector of ["common.html", "agent.html"] as const) {
    const mounted = await mountInspector(inspector, { language: "en" });
    const english = inspector === "agent.html"
      ? {
        "label-title": "Label", "language-title": "Language", "text-size-title": "Text size",
        "theme-title": "Theme", "details-title": "Show details", "animation-title": "Animation",
        "focus-title": "Bring ChatGPT / Codex to front", "press-title": "On press",
        "press-command-title": "Codex action", "press-help": "Custom actions and Voice PTT operate the current Codex Composer; they do not select the displayed slot first.",
        "context-rings-title": "Context ring", "context-rings-help": "This global option applies to all six Codex agent keys on this computer.",
      }
      : {
        "label-title": "Label", "language-title": "Language", "text-size-title": "Text size",
        "theme-title": "Theme", "details-title": "Show details", "animation-title": "Animation",
        "focus-title": "Bring ChatGPT / Codex to front", "press-title": "On press",
        "press-command-title": "Codex action", "press-help": "Custom actions and Voice PTT operate the current Codex Composer; they do not select the displayed slot first.",
        "dial-touch-title": "On touch", "dial-long-title": "On touch hold",
      };

    assert.equal(mounted.documentElement.lang, "en", `${inspector} must set document.lang for English`);
    for (const [id, text] of Object.entries(english)) assert.equal(mounted.elements.get(id)?.textContent, text, `${inspector}:${id}`);
    assert.equal(mounted.elements.get("label")?.placeholder, "Default", `${inspector}:label placeholder`);
    for (const [value, text] of Object.entries({
      normal: "Normal", large: "Large", auto: "Automatic", dark: "Dark", light: "Light",
      none: "Default action", disabled: "Do nothing", focus: "Bring ChatGPT / Codex to front",
    })) assert.equal(mounted.options.get(value)?.textContent, text, `${inspector}:${value}`);

    const language = mounted.elements.get("language");
    assert.ok(language);
    language.value = "ja";
    language.dispatch("change");
    assert.equal(mounted.documentElement.lang, "ja", `${inspector} must restore document.lang for Japanese`);
    assert.equal(mounted.elements.get("label-title")?.textContent, "表示名", `${inspector}:Japanese label title`);
    assert.equal(mounted.elements.get("label")?.placeholder, "既定", `${inspector}:Japanese label placeholder`);
    assert.equal(mounted.options.get("normal")?.textContent, "標準", `${inspector}:Japanese normal option`);
  }
});

test("custom labels replace usage, reset, overview, and fallback primary text without an overlay", () => {
  const fiveHour: UsageWindow = {
    id: "five-hour", kind: "five-hour", usedPercent: 42, remainingPercent: 58,
    windowDurationMins: 300, resetsAt: null,
  };
  const weekly: UsageWindow = {
    id: "weekly", kind: "weekly", usedPercent: 11, remainingPercent: 89,
    windowDurationMins: 10080, resetsAt: null,
  };

  const usage = decode(customizeKeyImage(renderUsageLimitKey(fiveHour, "five-hour", "dark", "ready", undefined, "en"), { label: "CUSTOM" }));
  assert.doesNotMatch(usage, /data-custom-label-layer="true"/u);
  assert.match(usage, /data-custom-label="true"[^>]*>CUSTOM<\/text>/u);
  assert.match(usage, /data-usage-value="58"/u);

  const overview = decode(customizeKeyImage(renderUsageOverviewKey([fiveHour, weekly], "dark", "ready", undefined, "en"), { label: "CUSTOM" }));
  assert.doesNotMatch(overview, /data-custom-label-layer="true"/u);
  assert.match(overview, /data-custom-label="true"[^>]*>CUSTOM<\/text>/u);
  assert.match(overview, /data-usage-window="5H"/u);
  assert.match(overview, /data-usage-window="WK"/u);

  const reset = decode(customizeKeyImage(renderRateLimitResetKey(4, 0, "dark", "ready", undefined, "en"), { label: "CUSTOM" }));
  assert.doesNotMatch(reset, /data-custom-label-layer="true"/u);
  assert.match(reset, /data-custom-label="true"[^>]*>CUSTOM<\/text>/u);
  assert.match(reset, /data-reset-credits="4"/u);

  const fallback = decode(customizeKeyImage(renderFallbackKeycap("ACT11 無効", "dark", "en"), { label: "CUSTOM" }));
  assert.doesNotMatch(fallback, /data-custom-label-layer="true"/u);
  const fallbackLabels = [...fallback.matchAll(/<text\b[^>]*data-icon-source="fallback-label"[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1] ?? "");
  assert.deepEqual(fallbackLabels, ["CUSTOM"], "fallback custom copy must replace all fallback lines");
});

test("global dictation resolves auto theme from the controller snapshot equivalent", async (t) => {
  const images: string[] = [];
  const controller = new DeckController();
  (controller as unknown as { snapshot: { theme: "dark" | "light" } }).snapshot = { theme: "light" };
  const hold = { press: async () => undefined, release: async () => undefined, stop: async () => undefined };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = fakeKey("dictation-auto-theme", images);
  t.after(async () => { await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent); });

  action.onWillAppear({ action: key, payload: { settings: { language: "en", theme: "auto" } } } as unknown as WillAppearEvent);
  await flush();
  assert.match(images.at(-1) ?? "", /data-theme="light"/u);
});

test("global dictation applies showDetails after held feedback so its detail is actually hidden", async (t) => {
  const images: string[] = [];
  const controller = { setActionPreferences: () => undefined, prepareAction: async () => undefined, theme: () => "dark" as const };
  const hold = { press: async () => undefined, release: async () => undefined, stop: async () => undefined };
  const action = new GlobalDictationAction(controller as never, hold);
  const key = fakeKey("dictation-hidden-details", images);
  t.after(async () => { await action.onWillDisappear({ action: key } as unknown as WillDisappearEvent); });

  action.onWillAppear({ action: key, payload: { settings: { language: "en", label: "CUSTOM", showDetails: false } } } as unknown as WillAppearEvent);
  await flush();
  await action.onKeyDown({ action: key } as unknown as KeyDownEvent);
  const held = images.at(-1) ?? "";
  assert.match(held, /data-operation-phase="held"/u);
  assert.doesNotMatch(held, /data-operation-detail(?:-text)?=|RIGHT ⌘ HELD/u);
  assert.match(held, /data-custom-label="true"[^>]*>CUSTOM<\/text>/u);
  await action.onKeyUp({ action: key } as unknown as KeyUpEvent);
});

function decode(image: string): string {
  return decodeURIComponent(image.slice(image.indexOf(",") + 1));
}

function fakeKey(id: string, images: string[]) {
  return {
    id,
    isKey: () => true,
    setImage: async (image?: string) => { if (image) images.push(decode(image)); },
    showAlert: async () => undefined,
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function mountInspector(inspector: "common.html" | "agent.html", settings: Record<string, unknown>): Promise<{
  elements: Map<string, FakeElement>;
  options: Map<string, FakeElement>;
  documentElement: { lang: string };
}> {
  const html = await readFile(new URL(`../static/property-inspector/${inspector}`, import.meta.url), "utf8");
  const shared = await readFile(new URL("../static/property-inspector/shared.js", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(script);
  const elements = new Map<string, FakeElement>();
  for (const match of html.matchAll(/\bid="([^"]+)"/gu)) {
    const id = match[1];
    if (id) elements.set(id, new FakeElement());
  }
  const options = new Map<string, FakeElement>();
  for (const match of html.matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>([^<]*)<\/option>/gu)) {
    const option = new FakeElement();
    option.value = match[1] ?? "";
    option.textContent = match[2] ?? "";
    options.set(option.value, option);
  }
  const documentElement = { lang: "ja" };
  const sockets: FakeWebSocket[] = [];
  const WebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  };
  const window: Record<string, unknown> = {};
  const context = {
    document: {
      documentElement,
      getElementById: (id: string) => {
        const element = elements.get(id) ?? new FakeElement();
        elements.set(id, element);
        return element;
      },
      querySelectorAll: (selector: string) => {
        assert.equal(selector, "option", `${inspector} must localize every select option`);
        return [...options.values()];
      },
    },
    JSON, Set, String, Number, WebSocket, window,
  };
  runInNewContext(shared, context);
  runInNewContext(script, context);
  const connect = window.connectElgatoStreamDeckSocket as (port: string, uuid: string, register: string, info: string, actionInfo: string) => void;
  connect("12345", "pi-test", "registerPropertyInspector", "{}", JSON.stringify({
    action: "io.local.codexdeck.microplus.test-action",
    context: "action-context",
    payload: { controller: inspector === "common.html" ? "Encoder" : "Keypad", settings },
  }));
  assert.ok(sockets[0]);
  return { elements, options, documentElement };
}
