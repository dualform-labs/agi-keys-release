import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveComposerState } from "../src/renderer-runtime.js";

type Kind = "root" | "navigation" | "conversation" | "composer" | "sidebar";

class FakeElement {
  readonly children: FakeElement[] = [];

  constructor(
    readonly kind: Kind,
    readonly attributes: Record<string, string> = {},
    readonly parent: FakeElement | null = null,
    readonly visible = true,
  ) {}

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  getClientRects(): Array<{ width: number }> { return this.visible ? [{ width: 100 }] : []; }

  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
      if (selector === '[hidden], [aria-hidden="true"], [inert]'
        && (node.hasAttribute("hidden") || node.hasAttribute("inert")
          || node.getAttribute("aria-hidden") === "true")) return node;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-composer-navigation-target]") {
      return this.children.find(({ kind }) => kind === "navigation") ?? null;
    }
    if (selector === "[data-codex-composer]") {
      return this.children.find(({ kind }) => kind === "composer") ?? null;
    }
    if (selector === "[data-above-composer-conversation-id]") {
      return this.children.find(({ kind }) => kind === "conversation") ?? null;
    }
    if (selector.includes("data-codex-intelligence-trigger")) {
      return this.children.find(({ kind }) => kind === "navigation") ?? null;
    }
    return null;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;

  constructor(
    readonly roots: FakeElement[],
    readonly sidebar: FakeElement | null = null,
  ) {}

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "[data-codex-composer-root]") return this.roots;
    if (selector === "[data-codex-composer]") {
      return this.roots.flatMap((root) => root.children.filter(({ kind }) => kind === "composer"));
    }
    return [];
  }

  querySelector(selector: string): FakeElement | null {
    return selector.includes("data-app-action-sidebar-thread-id") ? this.sidebar : null;
  }
}

function composerRoot(
  rawId: string,
  options: { navigation?: boolean; navigationVisible?: boolean; hidden?: boolean; inputVisible?: boolean } = {},
): { root: FakeElement; input: FakeElement } {
  const root = new FakeElement("root", options.hidden ? { "aria-hidden": "true" } : {});
  if (options.navigation !== false) {
    root.children.push(new FakeElement("navigation", {}, root, options.navigationVisible !== false));
  }
  const input = new FakeElement("composer", {}, root, options.inputVisible !== false);
  root.children.push(
    input,
    new FakeElement("conversation", { "data-above-composer-conversation-id": rawId }, root),
  );
  return { root, input };
}

function resolve(doc: FakeDocument): ReturnType<typeof selectActiveComposerState> {
  const generated = Function(`return (${selectActiveComposerState.toString()})`)() as typeof selectActiveComposerState;
  return generated(doc as unknown as Document);
}

test("voice-layout composer remains active when its navigation controls are conditionally absent", () => {
  const voice = composerRoot("voice-task", { navigation: false });
  const sidebar = new FakeElement("sidebar", {
    "data-app-action-sidebar-thread-id": "local:host-a:voice-task",
  });
  const doc = new FakeDocument([voice.root], sidebar);
  doc.activeElement = voice.input;

  assert.deepEqual(resolve(doc), {
    root: voice.root,
    activeThreadKey: "local:host-a:voice-task",
  });
});

test("voice-layout fallback still rejects two unfocused composer roots", () => {
  const first = composerRoot("first", { navigation: false });
  const second = composerRoot("second", { navigation: false });

  assert.deepEqual(resolve(new FakeDocument([first.root, second.root])), { root: null });
});

test("a responsive hidden navigation control does not hide its visible composer input", () => {
  const composer = composerRoot("responsive", { navigationVisible: false });

  assert.deepEqual(resolve(new FakeDocument([composer.root])), {
    root: composer.root,
    activeThreadKey: "responsive",
  });
});

test("hidden or layoutless voice roots cannot make active composer selection ambiguous", () => {
  const visible = composerRoot("visible", { navigation: false });
  const hidden = composerRoot("hidden", { navigation: false, hidden: true });
  const layoutless = composerRoot("layoutless", { navigation: false, inputVisible: false });

  assert.deepEqual(resolve(new FakeDocument([hidden.root, layoutless.root, visible.root])), {
    root: visible.root,
    activeThreadKey: "visible",
  });
});

test("a focused visible voice root wins without falling back to a stale visible task", () => {
  const stale = composerRoot("stale");
  const voice = composerRoot("voice", { navigation: false });
  const doc = new FakeDocument([stale.root, voice.root]);
  doc.activeElement = voice.input;

  assert.deepEqual(resolve(doc), { root: voice.root, activeThreadKey: "voice" });
});
