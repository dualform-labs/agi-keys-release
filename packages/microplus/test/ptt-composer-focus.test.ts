import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import {
  CodexMicroRendererBridge,
  focusSelectedComposerForPtt,
} from "../src/codex-micro-renderer-bridge.js";
import type { OperationRequest } from "../src/types.js";

class FakeElement {
  readonly children: FakeElement[] = [];
  focusEffect: (() => void) | null = null;

  constructor(
    readonly kind: "root" | "input" | "wrapper",
    readonly doc: FakeDocument,
    readonly parent: FakeElement | null = null,
    readonly visible = true,
    readonly hidden = false,
  ) {}

  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
      if (selector === '[hidden], [aria-hidden="true"], [inert]' && node.hidden) return node;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== "[data-codex-composer]") return [];
    const found: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      if (node.kind === "input") found.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }

  getClientRects(): Array<{ width: number }> { return this.visible ? [{ width: 100 }] : []; }

  contains(candidate: FakeElement | null): boolean {
    for (let node = candidate; node; node = node.parent) if (node === this) return true;
    return false;
  }

  focus(): void {
    if (this.focusEffect) this.focusEffect();
    else this.doc.activeElement = this;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
}

function fixture(): { doc: FakeDocument; root: FakeElement; input: FakeElement } {
  const doc = new FakeDocument();
  const root = new FakeElement("root", doc);
  const input = new FakeElement("input", doc, root);
  root.children.push(input);
  return { doc, root, input };
}

function focus(doc: FakeDocument, root: FakeElement | null): void {
  const generated = Function(`return (${focusSelectedComposerForPtt.toString()})`)() as typeof focusSelectedComposerForPtt;
  generated(doc as unknown as Document, root as unknown as Element | null);
}

test("PTT focus prepares only the unique visible input in the selected composer root", () => {
  const selected = fixture();
  const other = fixture();
  selected.doc.activeElement = new FakeElement("wrapper", selected.doc);

  focus(selected.doc, selected.root);

  assert.equal(selected.doc.activeElement, selected.input);
  assert.equal(other.doc.activeElement, null);
});

test("PTT focus rejects hidden, missing, or ambiguous inputs", () => {
  const hidden = fixture();
  const hiddenInput = new FakeElement("input", hidden.doc, hidden.root, true, true);
  hidden.root.children.splice(0, 1, hiddenInput);
  assert.throws(() => focus(hidden.doc, hidden.root), /E_PTT_COMPOSER_INPUT_UNAVAILABLE/u);

  const missing = fixture();
  missing.root.children.length = 0;
  assert.throws(() => focus(missing.doc, missing.root), /E_PTT_COMPOSER_INPUT_UNAVAILABLE/u);

  const ambiguous = fixture();
  ambiguous.root.children.push(new FakeElement("input", ambiguous.doc, ambiguous.root));
  assert.throws(() => focus(ambiguous.doc, ambiguous.root), /E_PTT_COMPOSER_INPUT_AMBIGUOUS/u);
});

test("PTT focus rejects a synchronous focus-handler switch to another composer", () => {
  const selected = fixture();
  const otherRoot = new FakeElement("root", selected.doc);
  const otherInput = new FakeElement("input", selected.doc, otherRoot);
  otherRoot.children.push(otherInput);
  selected.input.focusEffect = () => { selected.doc.activeElement = otherInput; };

  assert.throws(() => focus(selected.doc, selected.root), /E_PTT_COMPOSER_FOCUS_FAILED/u);
  assert.equal(selected.doc.activeElement, otherInput);
});

type DispatchHarness = {
  closed: boolean;
  socket: WebSocket;
  targetIdentity: string;
  connectionEpoch: number;
  evaluateOnSocket<T>(socket: WebSocket, expression: string): Promise<T>;
  dispatch(
    type: string,
    payload: object,
    requiredHandler: string,
    operation?: OperationRequest,
    operationSocket?: WebSocket,
  ): Promise<void>;
};

function operation(phase: "down" | "up", activeThreadKey: string | null = "thread-a"): OperationRequest {
  return {
    version: 1,
    requestId: `request-${phase}`,
    operationId: `operation-${phase}`,
    connectionEpoch: 2,
    pageEpoch: 3,
    physicalId: "ACT10",
    phase,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
    ...(activeThreadKey ? { activeThreadKey } : {}),
    activeComposerKey: "composer-1",
  };
}

test("real dispatch expression focuses and revalidates only PTT down before marking it sent", async () => {
  const expressions: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as DispatchHarness;
  bridge.closed = false;
  bridge.targetIdentity = "target-a";
  bridge.connectionEpoch = 2;
  bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.evaluateOnSocket = async <T>(_socket: WebSocket, expression: string) => {
    expressions.push(expression);
    return "operation-down" as T;
  };

  await bridge.dispatch("codex-micro-hid-event", { event: { act: 1 } }, "codex-micro-hid-event", operation("down"));
  const down = expressions[0]!;
  const focusIndex = down.indexOf("focusPttComposer(document, verifiedActiveComposer.root)");
  const foregroundAfterFocusIndex = down.indexOf("assertMutationForeground(document);", focusIndex);
  const revalidationIndex = down.indexOf("verifiedActiveComposer = verifyExpectedComposer();", focusIndex);
  const sentIndex = down.indexOf("mutationDispatchStarted = true");
  assert.match(down, /const isPttDown = true/u);
  assert.ok(focusIndex > 0);
  assert.ok(foregroundAfterFocusIndex > focusIndex);
  assert.ok(revalidationIndex > foregroundAfterFocusIndex);
  assert.ok(sentIndex > revalidationIndex);
});

test("leased PTT up does not focus a composer", async () => {
  const expressions: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as DispatchHarness;
  bridge.closed = false;
  bridge.targetIdentity = "target-a";
  bridge.connectionEpoch = 2;
  const socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.socket = socket;
  bridge.evaluateOnSocket = async <T>(_socket: WebSocket, expression: string) => {
    expressions.push(expression);
    return "operation-up" as T;
  };

  await bridge.dispatch("codex-micro-hid-event", { event: { act: 0 } }, "codex-micro-hid-event", operation("up"), socket);
  assert.match(expressions[0]!, /const isPttDown = false/u);
  assert.match(expressions[0]!, /const allowBackgroundRelease = true/u);
});

test("PTT down supports an exact new-task composer with no thread key", async () => {
  const expressions: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as DispatchHarness;
  bridge.closed = false;
  bridge.targetIdentity = "target-a";
  bridge.connectionEpoch = 2;
  bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.evaluateOnSocket = async <T>(_socket: WebSocket, expression: string) => {
    expressions.push(expression);
    return "operation-down" as T;
  };

  await bridge.dispatch(
    "codex-micro-hid-event",
    { event: { act: 1 } },
    "codex-micro-hid-event",
    operation("down", null),
  );

  assert.match(expressions[0]!, /const expectedActiveThreadKey = isStateRelease \? null : null/u);
  assert.match(expressions[0]!, /isPttDown && activeThreadKey !== expectedActiveThreadKey/u);
  assert.doesNotMatch(expressions[0]!, /!expectedActiveThreadKey \|\| !expectedActiveComposerKey/u);
});

class DispatchDomElement {
  readonly children: DispatchDomElement[] = [];
  focusEffect: (() => void) | null = null;

  constructor(
    readonly kind: "root" | "input" | "conversation" | "outside" | "asset",
    readonly doc: DispatchDocument,
    readonly parent: DispatchDomElement | null = null,
    readonly attributes: Record<string, string> = {},
  ) {}

  get href(): string { return this.attributes.href ?? ""; }
  get src(): string { return this.attributes.src ?? ""; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  getClientRects(): Array<{ width: number }> { return [{ width: 100 }]; }

  closest(selector: string): DispatchDomElement | null {
    for (let node: DispatchDomElement | null = this; node; node = node.parent) {
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
    }
    return null;
  }

  querySelector(selector: string): DispatchDomElement | null {
    if (selector === "[data-composer-navigation-target]") return null;
    if (selector === "[data-codex-composer]") return this.children.find((child) => child.kind === "input") ?? null;
    if (selector === "[data-above-composer-conversation-id]") {
      return this.children.find((child) => child.kind === "conversation") ?? null;
    }
    if (selector.includes("data-codex-intelligence-trigger")) return null;
    return null;
  }

  querySelectorAll(selector: string): DispatchDomElement[] {
    return selector === "[data-codex-composer]"
      ? this.children.filter((child) => child.kind === "input")
      : [];
  }

  contains(candidate: DispatchDomElement | null): boolean {
    for (let node = candidate; node; node = node.parent) if (node === this) return true;
    return false;
  }

  focus(): void {
    if (this.focusEffect) this.focusEffect();
    else this.doc.activeElement = this;
  }
}

class DispatchDocument {
  readonly root = new DispatchDomElement("root", this);
  readonly input = new DispatchDomElement("input", this, this.root);
  readonly conversation = new DispatchDomElement("conversation", this, this.root, {
    "data-above-composer-conversation-id": "thread-a",
  });
  readonly asset = new DispatchDomElement("asset", this, null, {
    src: "app://codex/assets/app-test.js",
  });
  activeElement = new DispatchDomElement("outside", this);
  visibilityState = "visible";

  constructor() { this.root.children.push(this.input, this.conversation); }
  hasFocus(): boolean { return true; }
  querySelector(): DispatchDomElement | null { return null; }
  querySelectorAll(selector: string): DispatchDomElement[] {
    if (selector === "link[href], script[src]") return [this.asset];
    if (selector === "[data-codex-composer-root]") return [this.root];
    if (selector === "[data-codex-composer]") return [this.input];
    return [];
  }
}

async function executeGeneratedPttDown(
  focusEffect?: (doc: DispatchDocument) => void,
): Promise<{ dispatched: unknown[]; error: Error | null; doc: DispatchDocument }> {
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as DispatchHarness;
  bridge.closed = false;
  bridge.targetIdentity = "target-a";
  bridge.connectionEpoch = 2;
  bridge.socket = { readyState: WebSocket.OPEN } as WebSocket;
  const doc = new DispatchDocument();
  if (focusEffect) doc.input.focusEffect = () => focusEffect(doc);
  const dispatched: unknown[] = [];
  const bus = {
    handlers: new Map([["codex-micro-hid-event", new Set([true])]]),
    dispatchHostMessage(message: unknown) { dispatched.push(message); },
  };
  const environment = globalThis as any;
  const saved = {
    document: environment.document,
    location: environment.location,
    namespace: environment.__pttTestNamespace,
    composerIds: environment.__codexDeckComposerIds,
  };
  environment.document = doc;
  environment.location = { href: "app://codex/index.html" };
  environment.__pttTestNamespace = { bus };
  environment.__codexDeckComposerIds = { ids: new WeakMap([[doc.root, "composer-1"]]), next: 1 };
  bridge.evaluateOnSocket = async <T>(_socket: WebSocket, expression: string) => {
    const executable = expression.replace("await import(url)", "globalThis.__pttTestNamespace");
    return await (0, eval)(executable) as T;
  };
  let error: Error | null = null;
  try {
    await bridge.dispatch(
      "codex-micro-hid-event",
      { event: { act: 1 } },
      "codex-micro-hid-event",
      operation("down"),
    );
  } catch (candidate) {
    error = candidate as Error;
  } finally {
    if (saved.document === undefined) delete environment.document;
    else environment.document = saved.document;
    if (saved.location === undefined) delete environment.location;
    else environment.location = saved.location;
    if (saved.namespace === undefined) delete environment.__pttTestNamespace;
    else environment.__pttTestNamespace = saved.namespace;
    if (saved.composerIds === undefined) delete environment.__codexDeckComposerIds;
    else environment.__codexDeckComposerIds = saved.composerIds;
  }
  return { dispatched, error, doc };
}

test("generated PTT dispatch focuses a nonfocused exact composer then sends one down", async () => {
  const result = await executeGeneratedPttDown();

  assert.equal(result.error, null);
  assert.equal(result.doc.activeElement, result.doc.input);
  assert.equal(result.dispatched.length, 1);
  assert.deepEqual((result.dispatched[0] as any).event, { act: 1 });
});

test("generated PTT dispatch sends no down when focus synchronously changes the same root thread", async () => {
  const result = await executeGeneratedPttDown((doc) => {
    doc.activeElement = doc.input;
    doc.conversation.attributes["data-above-composer-conversation-id"] = "thread-b";
  });

  assert.match(result.error?.message ?? "", /E_ACTIVE_THREAD_STALE/u);
  assert.equal((result.error as any)?.codexDeckPredispatch, true);
  assert.deepEqual(result.dispatched, []);
});
