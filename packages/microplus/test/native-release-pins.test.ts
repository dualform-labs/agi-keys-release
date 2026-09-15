import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_APP_PRIMARY_SHA256,
  CURRENT_MICRO_COMMANDS_SHA256,
  CURRENT_MICRO_LAYOUT_ASSET,
  CURRENT_MICRO_LAYOUT_SHA256,
  CURRENT_MESSAGE_BUS_ASSET,
  CURRENT_MESSAGE_BUS_SHA256,
  CURRENT_MICRO_SLOT_SIGNALS_ASSET,
  CURRENT_MICRO_SLOT_SIGNALS_SHA256,
  CURRENT_NATIVE_BRIDGE_SHA256,
  rendererFailureCode,
  selectActiveComposerState,
} from "../src/codex-micro-renderer-bridge.js";

type ReleaseFixture = {
  bundleVersion: string;
  build: string;
  assets: Record<"bridge" | "appInitial" | "appPrimary" | "commands" | "layout" | "slotSignals" | "messageBus", { path: string; bytes: number; sha256: string }>;
  runtimeExports: Record<string, string>;
  modelPickerCommand: {
    id: string;
    catalogGetter: string;
    requiredAccess: null;
    renderer: string;
    source: string;
  };
};

class FakeElement {
  constructor(
    readonly kind: "root" | "navigation" | "conversation" | "composer" | "sidebar" | "other",
    readonly attributes: Record<string, string> = {},
    readonly parent: FakeElement | null = null,
    readonly children: FakeElement[] = [],
  ) {}

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
    }
    return null;
  }
  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-composer-navigation-target]") return this.children.find((child) => child.kind === "navigation") ?? null;
    if (selector.includes("data-codex-intelligence-trigger")) return this.children.find((child) => child.kind === "navigation") ?? null;
    if (selector === "[data-above-composer-conversation-id]") return this.children.find((child) => child.kind === "conversation") ?? null;
    return null;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  constructor(readonly roots: FakeElement[], readonly sidebar: FakeElement | null = null) {}
  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "[data-codex-composer-root]") return this.roots;
    if (selector === "[data-codex-composer]") return this.roots.flatMap((root) => root.children.filter((child) => child.kind === "composer"));
    return [];
  }
  querySelector(selector: string): FakeElement | null {
    if (selector.includes("data-app-action-sidebar-thread-id")) return this.sidebar;
    return null;
  }
}

function composerRoot(rawId: string | null): { root: FakeElement; input: FakeElement } {
  const root = new FakeElement("root");
  const navigation = new FakeElement("navigation", {}, root);
  const input = new FakeElement("composer", {}, root);
  const conversation = rawId == null ? [] : [new FakeElement("conversation", { "data-above-composer-conversation-id": rawId }, root)];
  root.children.push(navigation, input, ...conversation);
  return { root, input };
}

function generatedResolver(): (doc: FakeDocument) => { root: FakeElement | null; activeThreadKey?: string } {
  return Function(`return (${selectActiveComposerState.toString()})`)() as ReturnType<typeof generatedResolver>;
}

test("release pins match independent metadata extracted from the installed app.asar", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/native-release-26.908.40834.json", import.meta.url), "utf8")) as ReleaseFixture;
  assert.equal(fixture.bundleVersion, "26.908.40834");
  assert.equal(fixture.build, "8881");
  assert.equal(CURRENT_NATIVE_BRIDGE_SHA256, fixture.assets.bridge.sha256);
  assert.equal(CURRENT_APP_INITIAL_SHA256, fixture.assets.appInitial.sha256);
  assert.equal(CURRENT_APP_PRIMARY_SHA256, fixture.assets.appPrimary.sha256);
  assert.equal(CURRENT_MICRO_COMMANDS_SHA256, fixture.assets.commands.sha256);
  assert.equal(CURRENT_MICRO_LAYOUT_ASSET, fixture.assets.layout.path.split("/").at(-1));
  assert.equal(CURRENT_MICRO_LAYOUT_SHA256, fixture.assets.layout.sha256);
  assert.equal(CURRENT_MICRO_SLOT_SIGNALS_ASSET, fixture.assets.slotSignals.path.split("/").at(-1));
  assert.equal(CURRENT_MICRO_SLOT_SIGNALS_SHA256, fixture.assets.slotSignals.sha256);
  assert.equal(CURRENT_MESSAGE_BUS_ASSET, fixture.assets.messageBus.path.split("/").at(-1));
  assert.equal(CURRENT_MESSAGE_BUS_SHA256, fixture.assets.messageBus.sha256);
  assert.equal(fixture.assets.commands.bytes, 519);
  assert.match(fixture.assets.commands.path, /^webview\/assets\/codex-micro-commands-[a-f0-9]+\.js$/);
  assert.deepEqual(fixture.runtimeExports, {
    commandRunner: "Wat", appScope: "e6t", access: "mqt", capability: "hU",
    slotThread: "ktt", slotGoal: "NOt", slotRequests: "hOt", slotPendingRequest: "uOt",
    slotResume: "_Ot", slotRuntime: "HOt", slotPendingChip: "pnt", slotPinned: "Oet",
    externalUrlOpener: "k8t", hostBus: "r",
  });
  assert.deepEqual(fixture.modelPickerCommand, {
    id: "composer.openModelPicker",
    catalogGetter: "n",
    requiredAccess: null,
    renderer: "electron",
    source: "codex_micro_encoder",
  });
});

test("generated renderer resolver follows focus and preserves canonical sidebar keys", () => {
  const local = composerRoot("same-id");
  const remote = composerRoot("remote-id");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "remote:remote-id" });
  const doc = new FakeDocument([local.root, remote.root], sidebar);
  doc.activeElement = remote.input;
  const state = generatedResolver()(doc);
  assert.equal(state.root, remote.root);
  assert.equal(state.activeThreadKey, "remote:remote-id");

  doc.activeElement = local.input;
  const moved = generatedResolver()(doc);
  assert.equal(moved.root, local.root);
  assert.equal(moved.activeThreadKey, "same-id");
});

test("generated renderer resolver rejects ambiguous same-id task identity", () => {
  const local = composerRoot("collision");
  const remote = composerRoot("collision");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "local:collision" });
  const doc = new FakeDocument([local.root, remote.root], sidebar);
  doc.activeElement = remote.input;
  const state = generatedResolver()(doc);
  assert.equal(state.root, remote.root);
  assert.equal(state.activeThreadKey, undefined);
});

test("generated renderer resolver retains the uniquely open composer while focus is in its portal", () => {
  const inactive = composerRoot("inactive-id");
  const active = composerRoot("active-id");
  active.root.children[0]!.attributes["aria-expanded"] = "true";
  const portalRow = new FakeElement("other");
  const doc = new FakeDocument([inactive.root, active.root]);
  doc.activeElement = portalRow;
  const state = generatedResolver()(doc);
  assert.equal(state.root, active.root);
  assert.equal(state.activeThreadKey, "active-id");
});

test("generated renderer resolver rejects ambiguous open-composer ownership", () => {
  const first = composerRoot("first-id");
  const second = composerRoot("second-id");
  first.root.children[0]!.attributes["aria-expanded"] = "true";
  second.root.children[0]!.attributes["data-state"] = "open";
  const doc = new FakeDocument([first.root, second.root]);
  doc.activeElement = new FakeElement("other");
  assert.equal(generatedResolver()(doc).root, null);
});

test("renderer diagnostics retain only allowlisted fixed codes", () => {
  assert.equal(rendererFailureCode({ result: { exceptionDetails: { exception: { description: "Error: E_ACTIVE_VIEW_UNAVAILABLE secret prompt" } } } }), undefined);
  assert.equal(rendererFailureCode({ result: { exceptionDetails: { exception: { description: "Error: E_ACTIVE_COMPOSER_STALE\n    at eval:1" } } } }), "E_ACTIVE_COMPOSER_STALE");
  assert.equal(rendererFailureCode({ result: { exceptionDetails: { exception: { description: "Error: E_ACTIVE_COMPOSER_STALE secret prompt" } } } }), undefined);
  assert.equal(rendererFailureCode({ result: { exceptionDetails: { text: "Unhandled content from renderer" } } }), undefined);
});
