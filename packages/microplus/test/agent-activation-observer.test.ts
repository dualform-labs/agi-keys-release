import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexMicroRendererBridge,
  matchesActiveThreadSelection,
  selectActiveComposerState,
} from "../src/codex-micro-renderer-bridge.js";

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
  visibilityState = "visible";
  constructor(readonly roots: FakeElement[], readonly sidebar: FakeElement | null = null) {}
  hasFocus(): boolean { return true; }
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

function composerRoot(rawId: string): { root: FakeElement; input: FakeElement } {
  const root = new FakeElement("root");
  const navigation = new FakeElement("navigation", {}, root);
  const input = new FakeElement("composer", {}, root);
  const conversation = new FakeElement("conversation", { "data-above-composer-conversation-id": rawId }, root);
  root.children.push(navigation, input, conversation);
  return { root, input };
}

function matches(doc: FakeDocument, requestedThreadKey: string): boolean {
  const generatedResolver = Function(`return (${selectActiveComposerState.toString()})`)() as typeof selectActiveComposerState;
  const generatedMatcher = Function(`return (${matchesActiveThreadSelection.toString()})`)() as typeof matchesActiveThreadSelection;
  return generatedMatcher(doc as unknown as Document, requestedThreadKey, generatedResolver);
}

test("observer rejects a scoped task key when only a raw composer identity is available", () => {
  const active = composerRoot("conversation-1");
  const doc = new FakeDocument([active.root]);
  doc.activeElement = active.input;
  assert.equal(matches(doc, "local:host-a:conversation-1"), false);
  assert.equal(matches(doc, "local:host-b:conversation-1"), false);
});

test("observer fixes the old raw-first failure by using the exact canonical sidebar identity", () => {
  const active = composerRoot("conversation-1");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "local:host-a:conversation-1" });
  const doc = new FakeDocument([active.root], sidebar);
  doc.activeElement = active.input;
  const oldRawFirstIdentity = active.root.querySelector("[data-above-composer-conversation-id]")?.getAttribute("data-above-composer-conversation-id");
  assert.equal(oldRawFirstIdentity, "conversation-1");
  assert.notEqual(oldRawFirstIdentity, "local:host-a:conversation-1");
  assert.equal(matches(doc, "local:host-a:conversation-1"), true);
  assert.equal(matches(doc, "local:host-b:conversation-1"), false);
});

test("observer does not ignore a differently focused composer in favor of the selected sidebar key", () => {
  const selected = composerRoot("selected");
  const focused = composerRoot("focused");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "local:host-a:selected" });
  const doc = new FakeDocument([selected.root, focused.root], sidebar);
  doc.activeElement = focused.input;
  assert.equal(matches(doc, "local:host-a:selected"), false);
  assert.equal(matches(doc, "focused"), false);
});

test("observer rejects ambiguous composers that expose the same raw conversation id", () => {
  const first = composerRoot("collision");
  const second = composerRoot("collision");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "local:host-a:collision" });
  const doc = new FakeDocument([first.root, second.root], sidebar);
  doc.activeElement = second.input;
  assert.equal(matches(doc, "local:host-a:collision"), false);
});

test("observer timeout exposes only its fixed content-free diagnostic", async () => {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    refresh(): Promise<void>;
    evaluate<T>(expression: string): Promise<T>;
    observeThreadActivated(threadKey: string): Promise<void>;
  };
  const expressions: string[] = [];
  bridge.refresh = async () => undefined;
  bridge.evaluate = async <T>(candidate: string) => {
    expressions.push(candidate);
    return false as T;
  };
  await assert.rejects(bridge.observeThreadActivated("local:host-a:conversation-secret"), /^Error: E_AGENT_ACTIVATION_UNCHANGED$/);
  assert.ok(expressions.some((expression) => /waitForActive\(25\)/.test(expression)));
  assert.ok(expressions.every((expression) => expression.includes("document.hasFocus()")));
  assert.ok(expressions.every((expression) => expression.includes('visibilityState === "visible"')));
  assert.ok(expressions.every((expression) => !/document\.querySelector\(["']\[data-above-composer-conversation-id/.test(expression)));
});

test("observer refreshes to the newly foreground window and accepts only its exact scoped key", async () => {
  const source = composerRoot("other-thread");
  const foreground = composerRoot("conversation-1");
  const sidebar = new FakeElement("sidebar", { "data-app-action-sidebar-thread-id": "local:host-a:conversation-1" });
  const sourceDocument = new FakeDocument([source.root]);
  sourceDocument.activeElement = source.input;
  const foregroundDocument = new FakeDocument([foreground.root], sidebar);
  foregroundDocument.activeElement = foreground.input;
  let currentDocument = sourceDocument;
  let refreshes = 0;
  const expressions: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    refresh(): Promise<void>;
    evaluate<T>(expression: string): Promise<T>;
    observeThreadActivated(threadKey: string): Promise<void>;
  };
  bridge.refresh = async () => {
    refreshes += 1;
    if (refreshes >= 2) currentDocument = foregroundDocument;
  };
  bridge.evaluate = async <T>(expression: string) => {
    expressions.push(expression);
    const evaluate = Function("document", `return (${expression})`) as (document: FakeDocument) => Promise<T>;
    return await evaluate(currentDocument);
  };

  await bridge.observeThreadActivated("local:host-a:conversation-1");

  assert.ok(refreshes >= 2, "activation proof must re-read the foreground target after source acknowledgement");
  assert.ok(expressions.some((expression) => expression.includes("local:host-a:conversation-1")));
  assert.ok(expressions.every((expression) => expression.includes("matchesActiveThreadSelection")));
  assert.ok(expressions.every((expression) => !/document\.querySelector\(["']\[data-above-composer-conversation-id/.test(expression)));
});
