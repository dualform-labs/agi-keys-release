import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import {
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_APP_PRIMARY_SHA256,
  CURRENT_MICRO_COMMANDS_SHA256,
  CURRENT_NATIVE_BRIDGE_SHA256,
  DIAL_RUNTIME_26903,
  MODEL_PICKER_FAILURE_CODES,
  readNativeCurrentModel,
  selectNativeModelPickerOwner,
  rendererFailureCode,
  selectBoundModelPicker,
} from "../src/codex-micro-renderer-bridge.js";
import { safeDialFailureCode } from "../src/controller.js";

class FakeElement {
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  constructor(readonly kind: "root" | "trigger" | "menu" | "view" | "other") {}
  dispatched: string[] = [];
  textContent: string | null = null;
  parent: FakeElement | null = null;
  onDispatch?: (event: { key?: string }) => void;
  onFocus?: () => void;
  focusSideEffect?: () => void;
  focusDelayMs = 0;
  focusBlocked = false;
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-composer-navigation-target]") {
      return this.children.find((child) => child.kind === "trigger") ?? null;
    }
    if (selector.includes("data-codex-intelligence-trigger")) {
      return this.children.find((child) => child.kind === "trigger") ?? null;
    }
    if (selector === "[data-model-picker-view]" || selector === '[data-model-picker-view="advanced"]') {
      const view = this.children.find((child) => child.kind === "view") ?? null;
      return selector.includes("advanced") && view?.getAttribute("data-model-picker-view") !== "advanced" ? null : view;
    }
    if (selector === "[data-model-picker-model-row]") {
      if (this.hasAttribute("data-model-picker-model-row")) return this;
      for (const child of this.children) {
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    if (selector === '[data-model-selected="true"]:not([data-disabled])') {
      for (const child of this.children) {
        if (child.getAttribute("data-model-selected") === "true" && !child.hasAttribute("data-disabled")) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    if (selector.startsWith('[role="menuitem"]')) {
      for (const child of this.children) {
        if (child.getAttribute("role") === "menuitem" && !child.hasAttribute("data-disabled")) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    if (selector.startsWith('[role="menuitemradio"]')) {
      const rows = this.children.filter((child) => child.getAttribute("role") === "menuitemradio");
      if (selector.includes('aria-checked="true"')) {
        return rows.find((row) => row.getAttribute("aria-checked") === "true" && !row.hasAttribute("data-disabled")) ?? null;
      }
      return rows.find((row) => !row.hasAttribute("data-disabled")) ?? null;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    if (selector.includes("data-codex-intelligence-trigger")) {
      const matches: FakeElement[] = [];
      for (const child of this.children) {
        if (child.kind === "trigger") matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    if (selector === '[data-model-picker-view-toggle="true"]') {
      const matches: FakeElement[] = [];
      for (const child of this.children) {
        if (child.getAttribute("data-model-picker-view-toggle") === "true") matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    if (selector.startsWith('[role="menuitemradio"]') || selector.startsWith('[role="menuitem"]')) {
      const matches: FakeElement[] = [];
      for (const child of this.children) {
        if (child.matches(selector)) matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    return [];
  }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === '[inert], [hidden], [aria-hidden="true"]'
        && (node.hasAttribute("inert") || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true")) return node;
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
      if (selector === '[role="menuitem"]' && node.getAttribute("role") === "menuitem") return node;
      if (selector === '[role="menu"]' && node.getAttribute("role") === "menu") return node;
    }
    return null;
  }
  contains(candidate: FakeElement): boolean {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }
  dispatchEvent(event: { key?: string }): boolean {
    this.dispatched.push(event.key ?? "");
    this.onDispatch?.(event);
    return true;
  }
  matches(selector: string): boolean {
    if (selector === '[role="menu"][data-state="open"]') {
      return this.getAttribute("role") === "menu" && this.getAttribute("data-state") === "open";
    }
    if (selector === '[role="menuitemradio"]:not([data-disabled])') {
      return this.getAttribute("role") === "menuitemradio" && !this.hasAttribute("data-disabled");
    }
    if (selector === '[role="menuitemradio"][aria-checked="true"]:not([data-disabled])') {
      return this.getAttribute("role") === "menuitemradio"
        && this.getAttribute("aria-checked") === "true" && !this.hasAttribute("data-disabled");
    }
    if (selector === '[data-model-selected="true"]:not([data-disabled])') {
      return this.getAttribute("data-model-selected") === "true" && !this.hasAttribute("data-disabled");
    }
    return selector === '[role="menuitem"]:not([data-disabled])'
      && this.getAttribute("role") === "menuitem" && !this.hasAttribute("data-disabled");
  }
  focus(): void {
    if (this.focusBlocked) return;
    const apply = () => {
      this.focusSideEffect?.();
      this.onFocus?.();
    };
    if (this.focusDelayMs > 0) setTimeout(apply, this.focusDelayMs);
    else apply();
  }
  append(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly visibilityState = "visible";
  hasFocus(): boolean { return true; }
  constructor(readonly menus: FakeElement[], readonly roots: FakeElement[] = []) {}
  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[role="menu"][data-state="open"]') return this.menus;
    if (selector === '[data-codex-composer-root]') return this.roots;
    if (selector.includes("data-codex-intelligence-trigger")) {
      return this.roots.flatMap((root) => root.children.filter((child) => child.kind === "trigger"));
    }
    if (selector === '[data-codex-composer]') return [];
    return [];
  }
  querySelector(): FakeElement | null { return null; }
  getElementById(id: string): FakeElement | null {
    const visit = (element: FakeElement): FakeElement | null => {
      if (element.getAttribute("id") === id) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    for (const element of [...this.roots, ...this.menus]) {
      const match = visit(element);
      if (match) return match;
    }
    return null;
  }
}

function openRoot(contentId = "model-menu"): FakeElement {
  const root = new FakeElement("root");
  const trigger = new FakeElement("trigger");
  trigger.attributes.set("aria-expanded", "true");
  trigger.attributes.set("aria-controls", contentId);
  root.append(trigger);
  return root;
}

function modelMenu(contentId = "model-menu"): FakeElement {
  const menu = new FakeElement("menu");
  menu.attributes.set("id", contentId);
  menu.attributes.set("role", "menu");
  menu.attributes.set("data-state", "open");
  const view = new FakeElement("view");
  view.attributes.set("data-model-picker-view", "advanced");
  menu.append(view);
  return menu;
}

function modelRow(role: "menuitemradio" | "menuitem", selected = false, label = "Model"): FakeElement {
  const row = new FakeElement("other");
  row.attributes.set("role", role);
  row.attributes.set("aria-label", label);
  row.attributes.set("data-test-model-id", label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model");
  if (role === "menuitemradio") row.attributes.set("aria-checked", selected ? "true" : "false");
  if (selected) row.attributes.set("data-model-selected", "true");
  return row;
}

function attachNativeModelOwner(document: FakeDocument, root: FakeElement): any {
  const trigger = root.children.find((child) => child.kind === "trigger");
  if (!trigger) return null;
  const existingKey = Object.getOwnPropertyNames(trigger).find((key) => key.startsWith("__reactFiber$"));
  if (existingKey) return (trigger as any)[existingKey]?.return ?? null;
  const rows = document.menus.flatMap((menu) => menu.querySelectorAll('[role="menuitemradio"]:not([data-disabled])')
    .concat(menu.querySelectorAll('[role="menuitem"]:not([data-disabled])')))
    .filter((row, index, all) => row.hasAttribute("data-test-model-id") && all.indexOf(row) === index);
  const selected = rows.find((row) => row.getAttribute("aria-checked") === "true"
    || row.getAttribute("data-model-selected") === "true") ?? rows[0];
  const advanced = document.menus.some((menu) => menu.querySelector('[data-model-picker-view]') != null);
  const models = rows.map((row) => ({
    model: row.getAttribute("data-test-model-id")!,
    displayName: row.getAttribute("aria-label") ?? "Model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({ reasoningEffort })),
  }));
  function NativePIrFixture(props: {
    modelPickerTriggerConfig?: unknown;
    onBeforeSelectModel?: unknown;
    onSelectModel?: unknown;
    triggerButton?: unknown;
  }): unknown {
    return [props.modelPickerTriggerConfig, props.onBeforeSelectModel, props.onSelectModel, props.triggerButton];
  }
  const hostRoot: any = { return: null, alternate: null, stateNode: null, tag: 3 };
  hostRoot.stateNode = { current: hostRoot };
  const composerFiber: any = { return: hostRoot, alternate: null, stateNode: root };
  const ownerFiber: any = { return: composerFiber, alternate: null, stateNode: null, type: NativePIrFixture, memoizedProps: null };
  const replaceOwner = (patch: Record<string, unknown>): void => {
    ownerFiber.memoizedProps = { ...ownerFiber.memoizedProps, ...patch };
  };
  ownerFiber.memoizedProps = {
    disabled: false,
    daybreak: null,
    hasWorkModeAccess: advanced,
    menuFooter: null,
    model: selected?.getAttribute("data-test-model-id") ?? models[0]?.model ?? "model",
    modelOptions: models.map((model) => ({ model, disabledReason: null })),
    modelOptionsDisabled: false,
    models,
    modelPickerTriggerConfig: advanced ? {} : null,
    onBeforeSelectModel: () => true,
    onOpenChange: () => {},
    onSelectDefault: undefined,
    onSelectModel: (modelId: string) => replaceOwner({ model: modelId, selectionMode: "model" }),
    onSelectReasoningEffort: (reasoningEffort: string) => replaceOwner({ reasoningEffort }),
    reasoningEffort: "medium",
    selectionMode: "model",
    showReasoningEffortControls: true,
    triggerButton: {},
  };
  const triggerFiber: any = { return: ownerFiber, alternate: null, stateNode: trigger };
  hostRoot.child = composerFiber;
  composerFiber.child = ownerFiber;
  ownerFiber.child = triggerFiber;
  Object.defineProperty(trigger, "__reactFiber$test", { configurable: true, value: triggerFiber });
  assert.ok(readNativeCurrentModel(root as unknown as Element, trigger as unknown as Element, true));
  return ownerFiber;
}

function fixtureCurrentModel(root: FakeElement): ReturnType<typeof readNativeCurrentModel> {
  const trigger = root.children.find((child) => child.kind === "trigger")!;
  return readNativeCurrentModel(root as unknown as Element, trigger as unknown as Element, true);
}

test("model picker guard follows the native aria-controls ownership edge", () => {
  const root = openRoot();
  const menu = modelMenu();
  assert.equal(
    selectBoundModelPicker(new FakeDocument([menu], [root]) as unknown as Document, root as unknown as Element),
    menu,
  );

  root.children[0]?.attributes.set("aria-expanded", "false");
  assert.equal(
    selectBoundModelPicker(new FakeDocument([menu], [root]) as unknown as Document, root as unknown as Element),
    null,
  );
});

test("model picker guard rejects unrelated menus and ambiguous open triggers", () => {
  const root = openRoot();
  const unrelated = new FakeElement("menu");
  assert.equal(
    selectBoundModelPicker(new FakeDocument([unrelated], [root]) as unknown as Document, root as unknown as Element),
    null,
  );
  const owned = modelMenu();
  assert.equal(
    selectBoundModelPicker(new FakeDocument([owned, modelMenu("other-menu")], [root]) as unknown as Document, root as unknown as Element),
    owned,
  );

  const otherOpenRoot = openRoot();
  assert.equal(
    selectBoundModelPicker(new FakeDocument([modelMenu()], [root, otherOpenRoot]) as unknown as Document, root as unknown as Element),
    null,
  );
});

test("model picker selector reports fixed content-free stages", () => {
  const stage = (document: FakeDocument, root: FakeElement | null): string | undefined => {
    let value: string | undefined;
    selectBoundModelPicker(document as unknown as Document, root as unknown as Element | null, (code) => {
      value = code;
    });
    return value;
  };

  assert.equal(stage(new FakeDocument([]), null), "E_MODEL_PICKER_NO_COMPOSER");
  assert.equal(stage(new FakeDocument([]), new FakeElement("root")), "E_MODEL_PICKER_NO_TRIGGER");

  const closed = openRoot();
  closed.children[0]!.attributes.set("aria-expanded", "false");
  assert.equal(stage(new FakeDocument([], [closed]), closed), "E_MODEL_PICKER_TRIGGER_CLOSED");

  const counted = openRoot();
  assert.equal(stage(new FakeDocument([], [counted, openRoot("other")]), counted), "E_MODEL_PICKER_OPEN_TRIGGER_COUNT");

  const owner = openRoot();
  assert.equal(stage(new FakeDocument([], [openRoot("other")]), owner), "E_MODEL_PICKER_OPEN_TRIGGER_OWNER");

  const noControls = openRoot();
  noControls.children[0]!.attributes.delete("aria-controls");
  assert.equal(stage(new FakeDocument([], [noControls]), noControls), "E_MODEL_PICKER_NO_ARIA_CONTROLS");

  const missing = openRoot();
  assert.equal(stage(new FakeDocument([], [missing]), missing), "E_MODEL_PICKER_CONTENT_MISSING");

  const closedMenu = modelMenu();
  closedMenu.attributes.set("data-state", "closed");
  const closedContentRoot = openRoot();
  assert.equal(stage(new FakeDocument([closedMenu], [closedContentRoot]), closedContentRoot), "E_MODEL_PICKER_CONTENT_NOT_OPEN_MENU");
});

test("model picker diagnostic stages pass both safe public allowlists", () => {
  for (const code of MODEL_PICKER_FAILURE_CODES) {
    assert.equal(rendererFailureCode({
      result: { exceptionDetails: { exception: { description: `Error: ${code}\n    at eval:1` } } },
    }), code);
    assert.equal(safeDialFailureCode(new Error(code)), code);
  }
  assert.equal(rendererFailureCode({
    result: { exceptionDetails: { exception: { description: "Error: E_MODEL_PICKER_PRIVATE_VALUE" } } },
  }), undefined);
  assert.equal(safeDialFailureCode(new Error("E_MODEL_PICKER_PRIVATE_VALUE")), "E_DIAL_UNKNOWN");
});

test("model dial public methods are wired to the guarded picker interaction", () => {
  const rotate = CodexMicroRendererBridge.prototype.rotateModelPicker.toString();
  const press = CodexMicroRendererBridge.prototype.pressModelPicker.toString();
  assert.match(rotate, /runModelPickerInteraction/);
  assert.match(press, /runModelPickerInteraction/);
});

test("reasoning dial commits through the active model owner's supported effort order", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.append(modelRow("menuitemradio", true, "Model A"));
  const document = new FakeDocument([menu], [root]);
  document.activeElement = root.children.find((child) => child.kind === "trigger")!;
  const owner = attachNativeModelOwner(document, root);

  await executeOpenPickerInteraction("reasoning", "increase", document, root);
  assert.equal(owner.memoizedProps.reasoningEffort, "high");
  await executeOpenPickerInteraction("reasoning", "decrease", document, root);
  assert.equal(owner.memoizedProps.reasoningEffort, "medium");
});

type PickerDirection = "increase" | "decrease";

async function executeOpenPickerInteraction(
  interaction: "rotate" | "press" | "reasoning",
  direction: PickerDirection | undefined,
  document: FakeDocument,
  expectedComposer: FakeElement,
  inspectExpression?: (expression: string) => void,
  appPrimarySha256 = CURRENT_APP_PRIMARY_SHA256,
  appPrimaryAsset = "app-primary-test.js",
  legacyPrimaryCache?: Map<string, boolean>,
): Promise<void> {
  const bridge = new CodexMicroRendererBridge(() => {});
  const operation = {
    version: 1 as const,
    requestId: "request-model-picker",
    operationId: "operation-model-picker",
    connectionEpoch: 1,
    pageEpoch: 1,
    physicalId: interaction === "press" ? "ENC_CLK"
      : interaction === "reasoning" ? direction === "increase" ? "KEYCAP_MIND+" : "KEYCAP_MIND-"
        : direction === "increase" ? "ENC_CW" : "ENC_CC",
    phase: "invoke" as const,
    mappingFingerprint: "mapping",
    targetIdentity: "target",
    activeComposerKey: "composer-1",
  };
  const socket = { readyState: WebSocket.OPEN } as WebSocket;
  Object.assign(bridge as unknown as Record<string, unknown>, {
    socket,
    targetIdentity: operation.targetIdentity,
    connectionEpoch: operation.connectionEpoch,
  });
  (bridge as any).operationTargetLeases.set(operation.operationId, {
    socket,
    targetIdentity: operation.targetIdentity,
    connectionEpoch: operation.connectionEpoch,
  });
  const globals = globalThis as any;
  const prior = {
    document: globals.document,
    Element: globals.Element,
    KeyboardEvent: globals.KeyboardEvent,
    composerIds: globals.__codexDeckComposerIds,
    crypto: Object.getOwnPropertyDescriptor(globalThis, "crypto"),
    fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    performance: Object.getOwnPropertyDescriptor(globalThis, "performance"),
    legacyPrimaryCache: Object.getOwnPropertyDescriptor(globalThis, "__codexDeckVerifiedAppPrimary"),
    reviewedPrimaryCache: Object.getOwnPropertyDescriptor(globalThis, "__agiKeysVerifiedAppPrimary26908"),
  };
  const appPrimaryUrl = `app://codex/assets/${appPrimaryAsset}`;
  const runtimeAssets = new Map<string, readonly [string, string]>([
    ["app://codex/assets/codex-micro-bridge-test.js", ["bridge-source", CURRENT_NATIVE_BRIDGE_SHA256]],
    ["app://codex/assets/app-initial-test.js", ["app-initial-source", CURRENT_APP_INITIAL_SHA256]],
    [appPrimaryUrl, ["app-primary-source", appPrimarySha256]],
    ["app://codex/assets/codex-micro-commands-test.js", ["commands-source", CURRENT_MICRO_COMMANDS_SHA256]],
  ]);
  const restoreGlobal = (name: string, descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globals[name];
  };
  globals.document = document as unknown as Document;
  globals.Element = FakeElement;
  globals.KeyboardEvent = class {
    constructor(readonly type: string, readonly init: { key?: string }) {}
    get key(): string | undefined { return this.init.key; }
  };
  globals.__codexDeckComposerIds = { ids: new WeakMap([[expectedComposer, "composer-1"]]), next: 1 };
  if (legacyPrimaryCache) globals.__codexDeckVerifiedAppPrimary = legacyPrimaryCache;
  else delete globals.__codexDeckVerifiedAppPrimary;
  delete globals.__agiKeysVerifiedAppPrimary26908;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "app://codex/index.html" } });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { getEntriesByType: () => [...runtimeAssets.keys()].map((name) => ({ name })) },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string) => ({ text: async () => runtimeAssets.get(url)?.[0] ?? "" }),
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => {
      const source = new TextDecoder().decode(bytes);
      const record = [...runtimeAssets.values()].find(([candidate]) => candidate === source);
      if (!record) throw new Error("unexpected fixture source");
      return Uint8Array.from(Buffer.from(record[1], "hex")).buffer;
    } } },
  });
  const bindFocus = (element: FakeElement): void => {
    element.onFocus = () => { document.activeElement = element; };
    for (const child of element.children) bindFocus(child);
  };
  for (const element of [...document.roots, ...document.menus]) bindFocus(element);
  attachNativeModelOwner(document, expectedComposer);
  try {
    Object.assign(bridge as unknown as Record<string, unknown>, {
      beginOperation: async () => operation,
      evaluate: async (expression: string) => {
        inspectExpression?.(expression);
        return await Function(`return (${expression})`)();
      },
      observeOperation: async () => ({ dispatch: "accepted", metadata: "matched", semanticOutcome: "unverified" }),
    });
    if (interaction === "press") await bridge.pressModelPicker();
    else if (interaction === "reasoning") await bridge.adjustReasoning(direction!);
    else await bridge.rotateModelPicker(direction!);
  } finally {
    globals.document = prior.document;
    globals.Element = prior.Element;
    globals.KeyboardEvent = prior.KeyboardEvent;
    globals.__codexDeckComposerIds = prior.composerIds;
    restoreGlobal("crypto", prior.crypto);
    restoreGlobal("fetch", prior.fetch);
    restoreGlobal("location", prior.location);
    restoreGlobal("performance", prior.performance);
    restoreGlobal("__codexDeckVerifiedAppPrimary", prior.legacyPrimaryCache);
    restoreGlobal("__agiKeysVerifiedAppPrimary26908", prior.reviewedPrimaryCache);
  }
}

test("model rotation accepts the reviewed 26.903 primary asset without pinning its hashed filename", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const rows = [modelRow("menuitemradio", true, "Model A"), modelRow("menuitemradio", false, "Model B")];
  for (const row of rows) menu.querySelector('[data-model-picker-view]')!.append(row);
  const document = new FakeDocument([menu], [root]);

  const currentPrimaryUrl = "app://codex/assets/app-primary-e25aaf15dbaf.js";
  await executeOpenPickerInteraction(
    "rotate",
    "increase",
    document,
    root,
    undefined,
    DIAL_RUNTIME_26903.primary,
    "app-primary-e25aaf15dbaf.js",
    new Map([[currentPrimaryUrl, false]]),
  );

  assert.equal(fixtureCurrentModel(root)?.modelId, rows[1]!.getAttribute("data-test-model-id"));
});

test("model rotation rejects an unreviewed primary asset hash", async () => {
  const root = openRoot();
  const menu = modelMenu();
  for (const row of [modelRow("menuitemradio", true, "Model A"), modelRow("menuitemradio", false, "Model B")]) {
    menu.querySelector('[data-model-picker-view]')!.append(row);
  }
  const document = new FakeDocument([menu], [root]);

  await assert.rejects(
    executeOpenPickerInteraction(
      "rotate",
      "increase",
      document,
      root,
      undefined,
      "f".repeat(64),
      "app-primary-unreviewed.js",
    ),
    /E_MODEL_PICKER_PRIMARY_ASSET/,
  );
});

test("closed Codex picker activates its bound Radix trigger instead of the native slash-command path", async () => {
  const root = openRoot();
  const trigger = root.children[0]!;
  trigger.attributes.set("aria-expanded", "false");
  trigger.attributes.set("data-state", "closed");
  trigger.attributes.delete("aria-controls");
  const menu = modelMenu();
  menu.attributes.set("data-state", "closed");
  trigger.onDispatch = (event) => {
    if (event.key !== "Enter") return;
    trigger.attributes.set("aria-expanded", "true");
    trigger.attributes.set("data-state", "open");
    trigger.attributes.set("aria-controls", "model-menu");
    menu.attributes.set("data-state", "open");
  };

  let slashCommandUiOpened = 0;
  const nativeOpenModelPicker = () => { slashCommandUiOpened += 1; };
  nativeOpenModelPicker();
  assert.equal(selectBoundModelPicker(new FakeDocument([menu], [root]) as unknown as Document, root as unknown as Element), null);

  let evaluator = "";
  const document = new FakeDocument([menu], [root]);
  await executeOpenPickerInteraction("press", undefined, document, root, (expression) => { evaluator = expression; });

  assert.equal(slashCommandUiOpened, 1);
  assert.deepEqual(trigger.dispatched, ["Enter"]);
  assert.equal(selectBoundModelPicker(document as unknown as Document, root as unknown as Element), menu);
  assert.doesNotMatch(evaluator, /commandRunner\('composer\.openModelPicker'/);
  assert.ok(evaluator.indexOf("bridgeSha256 !==") < evaluator.indexOf("boundTrigger.dispatchEvent"));
});

test("generated model evaluator commits the expected native model and keeps Enter for explicit press", async () => {
  for (const [direction, selectedIndex, expectedIndex] of [
    ["increase", 0, 1],
    ["decrease", 1, 0],
  ] as const) {
    const root = openRoot();
    const menu = modelMenu();
    const rows = [modelRow("menuitemradio", selectedIndex === 0, "Model A"), modelRow("menuitemradio", selectedIndex === 1, "Model B")];
    for (const row of rows) menu.querySelector('[data-model-picker-view]')!.append(row);
    const document = new FakeDocument([menu], [root]);
    document.activeElement = rows[selectedIndex]!;
    attachNativeModelOwner(document, root);
    await executeOpenPickerInteraction("rotate", direction, document, root);
    assert.equal(fixtureCurrentModel(root)?.modelId, rows[expectedIndex]!.getAttribute("data-test-model-id"));
    assert.deepEqual(rows.flatMap((row) => row.dispatched), []);
  }

  const root = openRoot();
  const menu = modelMenu();
  const selected = modelRow("menuitemradio", true);
  menu.querySelector('[data-model-picker-view]')!.append(selected);
  const document = new FakeDocument([menu], [root]);
  await executeOpenPickerInteraction("press", undefined, document, root);
  assert.deepEqual(selected.dispatched, ["Enter"]);
});

test("generated rotate evaluator uses the native owner without toggling picker views", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.attributes.set("data-model-picker-view", "simple");
  const toggle = new FakeElement("other");
  toggle.attributes.set("data-model-picker-view-toggle", "true");
  toggle.onDispatch = (event) => {
    if (event.key === "Enter") view.attributes.set("data-model-picker-view", "advanced");
  };
  const row = modelRow("menuitemradio", true, "Model A");
  const next = modelRow("menuitemradio", false, "Model B");
  view.append(toggle);
  view.append(row);
  view.append(next);
  const document = new FakeDocument([menu], [root]);
  attachNativeModelOwner(document, root);
  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.deepEqual(toggle.dispatched, []);
  assert.equal(fixtureCurrentModel(root)?.modelId, next.getAttribute("data-test-model-id"));
});

test("generated evaluator commits through the native legacy owner without opening its submenu", async () => {
  const root = openRoot();
  const menu = modelMenu();
  menu.children = [];
  const submenuTrigger = new FakeElement("other");
  submenuTrigger.attributes.set("role", "menuitem");
  const modelMarker = new FakeElement("other");
  modelMarker.attributes.set("data-model-picker-model-row", "true");
  submenuTrigger.append(modelMarker);
  menu.append(submenuTrigger);

  const submenu = new FakeElement("menu");
  submenu.attributes.set("id", "model-submenu");
  submenu.attributes.set("role", "menu");
  submenu.attributes.set("data-state", "closed");
  const previous = modelRow("menuitem", false, "GPT-5.6 Sol");
  const selected = modelRow("menuitem", true, "GPT-6 Astra");
  submenu.append(previous);
  submenu.append(selected);
  submenuTrigger.onDispatch = (event) => {
    if (event.key === "ArrowRight") {
      submenuTrigger.attributes.set("aria-controls", "model-submenu");
      submenu.attributes.set("data-state", "open");
    }
  };

  const document = new FakeDocument([menu, submenu], [root]);
  attachNativeModelOwner(document, root);
  await executeOpenPickerInteraction("rotate", "decrease", document, root);
  assert.deepEqual(submenuTrigger.dispatched, []);
  assert.equal(fixtureCurrentModel(root)?.modelId, previous.getAttribute("data-test-model-id"));
});

test("legacy rotation locates the current model by ID even while native selection mode is default", async () => {
  const root = openRoot();
  const menu = modelMenu();
  menu.children = [];
  const rows = [
    modelRow("menuitem", false, "Model A"),
    modelRow("menuitem", true, "Model B"),
    modelRow("menuitem", false, "Model C"),
  ];
  for (const row of rows) menu.append(row);
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps = { ...owner.memoizedProps, selectionMode: "default" };

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, rows[2]!.getAttribute("data-test-model-id"));
});

test("advanced model rotation excludes native Default because its callback resets model and effort together", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const current = modelRow("menuitemradio", true, "Model A");
  const next = modelRow("menuitemradio", false, "Model B");
  view.append(current);
  view.append(next);
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  let defaultSelections = 0;
  owner.memoizedProps = {
    ...owner.memoizedProps,
    onSelectDefault: () => { defaultSelections += 1; },
  };

  await executeOpenPickerInteraction("rotate", "decrease", document, root);
  assert.deepEqual(fixtureCurrentModel(root), {
    modelId: next.getAttribute("data-test-model-id"),
    modelLabel: "Model B",
    selectionMode: "model",
  });
  assert.equal(defaultSelections, 0);
});

test("a single compatible model is a no-op in Default mode and never invokes a reset callback", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const only = modelRow("menuitemradio", false, "Model A");
  view.append(only);
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  let modelSelections = 0;
  let defaultSelections = 0;
  owner.memoizedProps = {
    ...owner.memoizedProps,
    selectionMode: "default",
    onSelectDefault: () => { defaultSelections += 1; },
    onSelectModel: () => { modelSelections += 1; },
  };

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(modelSelections, 0);
  assert.equal(defaultSelections, 0);
  assert.equal(fixtureCurrentModel(root)?.selectionMode, "default");
});

test("advanced detection follows the two native flags when trigger config is absent", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const rows = [modelRow("menuitemradio", true, "Model A"), modelRow("menuitemradio", false, "Model B")];
  for (const row of rows) view.append(row);
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps = { ...owner.memoizedProps, modelPickerTriggerConfig: null };

  await executeOpenPickerInteraction("rotate", "decrease", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, rows[1]!.getAttribute("data-test-model-id"));
});

test("rotation excludes native disabled model options and preserves advanced wrap", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const selected = modelRow("menuitemradio", true, "Model A");
  const blocked = modelRow("menuitemradio", false, "Blocked");
  const visible = modelRow("menuitemradio", false, "Model B");
  for (const row of [selected, blocked, visible]) view.append(row);
  const document = new FakeDocument([menu], [root]);
  document.activeElement = selected;
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps.modelOptions[1].disabledReason = { id: "blocked" };

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, visible.getAttribute("data-test-model-id"));
  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, selected.getAttribute("data-test-model-id"));
});

test("rotation skips models that cannot preserve the current reasoning effort", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const rows = [
    modelRow("menuitemradio", true, "Model A"),
    modelRow("menuitemradio", false, "Low Only"),
    modelRow("menuitemradio", false, "Model C"),
  ];
  for (const row of rows) view.append(row);
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps.modelOptions[1].model.supportedReasoningEfforts = [{ reasoningEffort: "low" }];
  const calls: Array<[string, string]> = [];
  owner.memoizedProps = {
    ...owner.memoizedProps,
    onSelectModel: (modelId: string, effort: string) => {
      calls.push([modelId, effort]);
      owner.memoizedProps = { ...owner.memoizedProps, model: modelId, selectionMode: "model" };
    },
  };

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.deepEqual(calls, [[rows[2]!.getAttribute("data-test-model-id")!, "medium"]]);
  assert.equal(fixtureCurrentModel(root)?.modelId, rows[2]!.getAttribute("data-test-model-id"));
});

test("rotation fails closed for duplicate options and a current model missing from native options", async () => {
  for (const condition of ["duplicate", "missing"] as const) {
    const root = openRoot();
    const menu = modelMenu();
    const view = menu.querySelector('[data-model-picker-view]')!;
    const rows = [modelRow("menuitemradio", true, "Model A"), modelRow("menuitemradio", false, "Model B")];
    for (const row of rows) view.append(row);
    const document = new FakeDocument([menu], [root]);
    const owner = attachNativeModelOwner(document, root);
    if (condition === "duplicate") {
      owner.memoizedProps.modelOptions.push(owner.memoizedProps.modelOptions[0]);
    } else {
      owner.memoizedProps = { ...owner.memoizedProps, model: "model-not-listed" };
    }
    await assert.rejects(
      executeOpenPickerInteraction("rotate", "increase", document, root),
      condition === "duplicate" ? /E_MODEL_PICKER_ROW_MODEL/ : /E_MODEL_PICKER_CURRENT_MODEL/,
    );
  }
});

test("rotation reproduces native disabled and saving guards before invoking callbacks", async () => {
  for (const patch of [
    { disabled: true },
    { modelOptionsDisabled: true },
    { menuFooter: {} },
    { daybreak: { disabled: true, isSaving: false } },
    { daybreak: { disabled: false, isSaving: true } },
  ]) {
    const root = openRoot();
    const menu = modelMenu();
    const view = menu.querySelector('[data-model-picker-view]')!;
    view.append(modelRow("menuitemradio", true, "Model A"));
    view.append(modelRow("menuitemradio", false, "Model B"));
    const document = new FakeDocument([menu], [root]);
    const owner = attachNativeModelOwner(document, root);
    let callbacks = 0;
    owner.memoizedProps = {
      ...owner.memoizedProps,
      ...patch,
      onSelectModel: () => { callbacks += 1; },
    };
    await assert.rejects(
      executeOpenPickerInteraction("rotate", "increase", document, root),
      /E_MODEL_PICKER_COMMIT_BLOCKED/,
    );
    assert.equal(callbacks, 0);
  }
});

test("rotation passes the existing supported effort and waits for an asynchronous committed owner", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.append(modelRow("menuitemradio", true, "Model A"));
  view.append(modelRow("menuitemradio", false, "Custom Provider"));
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  const target = owner.memoizedProps.modelOptions[1].model;
  target.supportedReasoningEfforts = [{ reasoningEffort: "medium" }];
  target.defaultReasoningEffort = undefined;
  let receivedEffort: unknown = "not-called";
  owner.memoizedProps = {
    ...owner.memoizedProps,
    onSelectModel: (modelId: string, effort: unknown) => {
      receivedEffort = effort;
      setTimeout(() => {
        owner.memoizedProps = { ...owner.memoizedProps, model: modelId, selectionMode: "model" };
      }, 20);
    },
  };

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(receivedEffort, "medium");
  assert.equal(fixtureCurrentModel(root)?.modelId, target.model);
});

test("rotation rejects a callback that returns without committing fresh owner state", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.append(modelRow("menuitemradio", true, "Model A"));
  view.append(modelRow("menuitemradio", false, "Model B"));
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps = { ...owner.memoizedProps, onSelectModel: () => {} };

  await assert.rejects(
    executeOpenPickerInteraction("rotate", "increase", document, root),
    /E_MODEL_PICKER_COMMIT_UNCHANGED/,
  );
  assert.equal(fixtureCurrentModel(root)?.modelId, "model-a");
});

test("rotation rejects a model callback that changes the preserved reasoning effort", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.append(modelRow("menuitemradio", true, "Model A"));
  view.append(modelRow("menuitemradio", false, "Model B"));
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps = {
    ...owner.memoizedProps,
    onSelectModel: (modelId: string) => {
      owner.memoizedProps = {
        ...owner.memoizedProps,
        model: modelId,
        reasoningEffort: "low",
        selectionMode: "model",
      };
    },
  };

  await assert.rejects(
    executeOpenPickerInteraction("rotate", "increase", document, root),
    /E_MODEL_PICKER_EFFORT_PRESERVATION/,
  );
});

test("rotation rejects an invalid current effort before invoking the model callback", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  view.append(modelRow("menuitemradio", true, "Model A"));
  view.append(modelRow("menuitemradio", false, "Model B"));
  const document = new FakeDocument([menu], [root]);
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps = { ...owner.memoizedProps, reasoningEffort: "unexpected effort" };
  let callbacks = 0;
  owner.memoizedProps = { ...owner.memoizedProps, onSelectModel: () => { callbacks += 1; } };
  await assert.rejects(
    executeOpenPickerInteraction("rotate", "increase", document, root),
    /E_MODEL_PICKER_EFFORT_PRESERVATION/,
  );
  assert.equal(callbacks, 0);
});

test("rapid rotations re-read fresh native owner props and advance from the latest committed model", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const rows = [
    modelRow("menuitemradio", true, "Model A"),
    modelRow("menuitemradio", false, "Model B"),
    modelRow("menuitemradio", false, "Model C"),
  ];
  for (const row of rows) view.append(row);
  const document = new FakeDocument([menu], [root]);
  document.activeElement = rows[0]!;
  attachNativeModelOwner(document, root);

  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, rows[1]!.getAttribute("data-test-model-id"));
  await executeOpenPickerInteraction("rotate", "increase", document, root);
  assert.equal(fixtureCurrentModel(root)?.modelId, rows[2]!.getAttribute("data-test-model-id"));
});

test("rotation rejects a native before-select refusal but accepts a native boundary no-op", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const selected = modelRow("menuitemradio", true, "Model A");
  const blocked = modelRow("menuitemradio", false, "Model B");
  view.append(selected);
  view.append(blocked);
  const document = new FakeDocument([menu], [root]);
  document.activeElement = selected;
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps.onBeforeSelectModel = () => false;
  await assert.rejects(
    executeOpenPickerInteraction("rotate", "increase", document, root),
    /E_MODEL_PICKER_COMMIT_BLOCKED/,
  );

  const legacyRoot = openRoot("legacy-menu");
  const legacyMenu = modelMenu("legacy-menu");
  legacyMenu.children = [];
  const submenuTrigger = new FakeElement("other");
  submenuTrigger.attributes.set("role", "menuitem");
  submenuTrigger.attributes.set("aria-controls", "legacy-submenu");
  const marker = new FakeElement("other");
  marker.attributes.set("data-model-picker-model-row", "true");
  submenuTrigger.append(marker);
  legacyMenu.append(submenuTrigger);
  const submenu = new FakeElement("menu");
  submenu.attributes.set("id", "legacy-submenu");
  submenu.attributes.set("role", "menu");
  submenu.attributes.set("data-state", "open");
  const only = modelRow("menuitem", true, "Only Model");
  submenu.append(only);
  const legacyDocument = new FakeDocument([legacyMenu, submenu], [legacyRoot]);
  legacyDocument.activeElement = only;
  attachNativeModelOwner(legacyDocument, legacyRoot);
  await executeOpenPickerInteraction("rotate", "increase", legacyDocument, legacyRoot);
  assert.equal(fixtureCurrentModel(legacyRoot)?.modelId, only.getAttribute("data-test-model-id"));
});

test("rotation revalidates the bound composer after a synchronous native callback", async () => {
  const root = openRoot();
  const menu = modelMenu();
  const view = menu.querySelector('[data-model-picker-view]')!;
  const selected = modelRow("menuitemradio", true, "Model A");
  const expected = modelRow("menuitemradio", false, "Model B");
  view.append(selected);
  view.append(expected);
  const document = new FakeDocument([menu], [root]);
  document.activeElement = selected;

  const replacementRoot = openRoot("replacement-menu");
  const owner = attachNativeModelOwner(document, root);
  owner.memoizedProps.onSelectModel = () => {
    document.roots.splice(0, document.roots.length, replacementRoot);
  };

  await assert.rejects(
    executeOpenPickerInteraction("rotate", "increase", document, root),
    /E_ACTIVE_COMPOSER_STALE/,
  );
});

test("generated evaluator rejects a picker without model rows and a stale composer", async () => {
  const root = openRoot();
  const emptyMenu = modelMenu();
  const document = new FakeDocument([emptyMenu], [root]);
  await assert.rejects(
    executeOpenPickerInteraction("press", undefined, document, root),
    /E_MODEL_PICKER_MODEL_ROW/,
  );

  const replacementRoot = openRoot();
  const replacementMenu = modelMenu();
  const replacementDocument = new FakeDocument([replacementMenu], [replacementRoot]);
  await assert.rejects(
    executeOpenPickerInteraction("press", undefined, replacementDocument, root),
    /E_ACTIVE_COMPOSER_STALE/,
  );
  assert.deepEqual(replacementMenu.dispatched, []);
});
