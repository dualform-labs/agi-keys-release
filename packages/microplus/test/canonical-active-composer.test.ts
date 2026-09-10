import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION,
  selectCanonicalActiveComposerState,
} from "../src/agent-window-probe.js";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import type { ActiveComposerState } from "../src/renderer-runtime.js";
import type { MicroSnapshot, OperationRequest } from "../src/types.js";

class FakeElement {
  readonly isConnected = true;

  constructor(
    readonly kind: "root" | "navigation" | "conversation" | "composer" | "sidebar",
    readonly attributes: Record<string, string> = {},
    readonly parent: FakeElement | null = null,
    readonly children: FakeElement[] = [],
  ) {}

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return name in this.attributes; }
  getClientRects(): Array<{ width: number }> { return [{ width: 100 }]; }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === "[data-codex-composer-root]" && node.kind === "root") return node;
      if (selector === '[hidden], [aria-hidden="true"], [inert]') {
        if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return node;
        return null;
      }
    }
    return null;
  }
  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-composer-navigation-target]") return this.children.find((child) => child.kind === "navigation") ?? null;
    if (selector === "[data-codex-composer]") return this.children.find((child) => child.kind === "composer") ?? null;
    if (selector === "[data-above-composer-conversation-id]") return this.children.find((child) => child.kind === "conversation") ?? null;
    if (selector.includes("data-codex-intelligence-trigger")) return this.children.find((child) => child.kind === "navigation") ?? null;
    return null;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  visibilityState = "visible";
  private readonly root: FakeElement;
  private readonly input: FakeElement;
  private readonly conversation: FakeElement;
  private readonly locationProvider: any;
  private readonly reactRoot: object;
  private sidebar: FakeElement | null = null;

  constructor(rawThreadKey: string, pathname: string) {
    const hostRoot: any = { tag: 3, stateNode: {}, return: null, child: null, sibling: null };
    hostRoot.stateNode.current = hostRoot;
    this.locationProvider = {
      tag: 10,
      type: { _context: { displayName: "Location" } },
      memoizedProps: {
        value: {
          navigationType: "PUSH",
          location: { pathname, search: "", hash: "", state: null, key: pathname },
        },
      },
      return: hostRoot,
      child: null,
      sibling: null,
    };
    hostRoot.child = this.locationProvider;
    this.root = new FakeElement("root");
    const navigation = new FakeElement("navigation", {}, this.root);
    this.input = new FakeElement("composer", {}, this.root);
    this.conversation = new FakeElement("conversation", {
      "data-above-composer-conversation-id": rawThreadKey,
    }, this.root);
    this.root.children.push(navigation, this.input, this.conversation);
    const composerFiber: any = {
      return: this.locationProvider,
      child: null,
      sibling: null,
      stateNode: this.root,
    };
    this.locationProvider.child = composerFiber;
    (this.root as any)["__reactFiber$test"] = composerFiber;
    this.reactRoot = { "__reactContainer$test": hostRoot };
    this.activeElement = this.input;
  }

  hasFocus(): boolean { return true; }
  getElementById(id: string): object | null { return id === "root" ? this.reactRoot : null; }
  querySelectorAll(selector: string): FakeElement[] {
    if (selector === "[data-codex-composer-root]") return [this.root];
    if (selector === "[data-codex-composer]") return [this.input];
    return [];
  }
  querySelector(selector: string): FakeElement | null {
    return selector.includes("data-app-action-sidebar-thread-id") ? this.sidebar : null;
  }
  setView(rawThreadKey: string, pathname: string, sidebarThreadKey?: string): void {
    this.conversation.attributes["data-above-composer-conversation-id"] = rawThreadKey;
    this.locationProvider.memoizedProps.value.location.pathname = pathname;
    this.locationProvider.memoizedProps.value.location.key = pathname;
    this.sidebar = sidebarThreadKey == null ? null : new FakeElement("sidebar", {
      "data-app-action-sidebar-thread-id": sidebarThreadKey,
      "data-app-action-sidebar-thread-active": "true",
    });
  }
}

function generatedResolver(): (document: Document) => ActiveComposerState {
  return Function(`return ${CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION}`)() as ReturnType<typeof generatedResolver>;
}

function snapshot(activeThreadKey = "local:task-a"): MicroSnapshot {
  return {
    slots: [{ id: 0, threadKey: activeThreadKey, title: "Task A", status: "idle", selected: true }],
    activeThreadKey,
    activeComposerKey: "composer-1",
    layout: {
      version: 1,
      slots: { ACT10: { keycapId: "MIC" } },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "never",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch: 7,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

test("serialized canonical resolver keeps local identity through sidebar toggles and rejects another task", () => {
  const resolver = generatedResolver();
  const document = new FakeDocument("task-a", "/local/task-a");
  assert.equal(resolver(document as unknown as Document).activeThreadKey, "local:task-a");

  document.setView("task-a", "/local/task-a", "local:task-a");
  assert.equal(resolver(document as unknown as Document).activeThreadKey, "local:task-a");

  document.setView("task-b", "/local/task-b", "local:task-b");
  assert.equal(resolver(document as unknown as Document).activeThreadKey, "local:task-b");
  assert.notEqual(resolver(document as unknown as Document).activeThreadKey, "local:task-a");

  document.setView("raw-unknown", "/future/raw-unknown");
  assert.equal(resolver(document as unknown as Document).activeThreadKey, "raw-unknown");
  assert.equal(selectCanonicalActiveComposerState(document as unknown as Document).activeThreadKey, "raw-unknown");
});

test("serialized resolver guards PTT down while release keeps the old renderer lease", async () => {
  const resolver = generatedResolver();
  const document = new FakeDocument("task-a", "/local/task-a");
  const operationBase: OperationRequest = {
    version: 1,
    requestId: "request-down",
    operationId: "operation-down",
    connectionEpoch: 3,
    pageEpoch: 7,
    physicalId: "ACT10",
    phase: "down",
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
    activeThreadKey: "local:task-a",
    activeComposerKey: "composer-1",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  const socket = { readyState: 1, close: () => undefined } as WebSocket;
  bridge.socket = socket;
  bridge.targetIdentity = "target-a";
  bridge.connectionEpoch = 3;
  bridge.pageEpoch = 7;
  bridge.lastSnapshot = snapshot();
  let operationSequence = 0;
  bridge.beginOperation = async (_physicalId: string, phase: "down" | "up" | "safety-up") => ({
    ...operationBase,
    requestId: `request-${++operationSequence}`,
    operationId: `operation-${operationSequence}`,
    phase,
  });
  bridge.observeOperation = async () => undefined;
  const calls: Array<{ act: number; operation: OperationRequest }> = [];
  bridge.dispatch = async (
    _eventName: string,
    payload: { event: { act: number } },
    _expectedEventName: string,
    operation: OperationRequest,
    _operationSocket: WebSocket | undefined,
    onBeforeCdpSubmit?: () => void,
  ) => {
    if (payload.event.act === 1) {
      const current = resolver(document as unknown as Document);
      if (current.activeThreadKey !== operation.activeThreadKey) throw new Error("E_ACTIVE_THREAD_STALE");
      onBeforeCdpSubmit?.();
    }
    calls.push({ act: payload.event.act, operation });
  };

  // No sidebar and matching sidebar selection are the same canonical task.
  await bridge.sendAction("ACT10", 1);
  document.setView("task-a", "/local/task-a", "local:task-a");
  await bridge.releaseAction("ACT10");
  assert.deepEqual(calls.map(({ act }) => act), [1, 0]);

  // A different committed local route is rejected before the native down.
  document.setView("task-b", "/local/task-b", "local:task-b");
  await assert.rejects(() => bridge.sendAction("ACT10", 1), /E_ACTIVE_THREAD_STALE/u);
  assert.deepEqual(calls.map(({ act }) => act), [1, 0]);

  // A second down on task A may be released after the foreground moved to B;
  // the release uses the retained old operation lease.
  document.setView("task-a", "/local/task-a", "local:task-a");
  await bridge.sendAction("ACT10", 1);
  document.setView("task-b", "/local/task-b", "local:task-b");
  await bridge.releaseAction("ACT10");
  assert.deepEqual(calls.map(({ act }) => act), [1, 0, 1, 0]);
  assert.equal(calls.at(-1)?.operation.phase, "up");
  assert.equal(calls.at(-1)?.operation.activeThreadKey, "local:task-a");
  assert.equal(bridge.heldPttOperations.size, 0);
});
