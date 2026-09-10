import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  DIAL_RUNTIME_26903,
  isExactComposerTextInsertion,
  rendererFailureCode,
  selectNativeComposerTextController,
  selectNativeExternalUrlOpener,
  selectNativeMicroHostBus,
} from "../src/codex-micro-renderer-bridge.js";
import type { MicroSnapshot, MutationConfirmation, OperationRequest } from "../src/types.js";

function snapshot(): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, selected: false, status: "off" as const })),
    activeThreadKey: "local:thread-a",
    activeComposerKey: "composer-1",
    layout: {
      version: 1,
      slots: {},
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch: 7,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

type Harness = {
  socket: WebSocket;
  targetIdentity: string;
  runKeycap(keycapId: "OAI" | "YOLO" | "YEET"): Promise<MutationConfirmation>;
  refresh(): Promise<MicroSnapshot>;
  evaluate<T>(expression: string): Promise<T>;
  observeOperation(
    operation: OperationRequest,
    direction?: unknown,
    postcondition?: unknown,
  ): Promise<MutationConfirmation>;
  connectionEpoch: number;
  pageEpoch: number;
  lastSnapshot: MicroSnapshot;
};

function harness(expressions: string[]): Harness {
  const current = snapshot();
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as Harness;
  bridge.connectionEpoch = current.connectionEpoch;
  bridge.pageEpoch = current.pageEpoch;
  bridge.targetIdentity = current.targetIdentity;
  bridge.socket = { readyState: WebSocket.OPEN, close: () => undefined } as unknown as WebSocket;
  bridge.lastSnapshot = current;
  bridge.refresh = async () => current;
  bridge.observeOperation = async (_operation, _direction, postcondition) => ({
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: postcondition ? "confirmed" : "unverified",
    observedSnapshot: current,
  });
  bridge.evaluate = async <T>(expression: string) => {
    expressions.push(expression);
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1]
      ?? expression.match(/return "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    if (expression.includes('keycapGetter("OAI")')) {
      return {
        operationId,
        postcondition: { kind: "external-url-dispatched", activeThreadKey: null, activeComposerKey: null },
      } as T;
    }
    return {
      operationId,
      postcondition: {
        kind: "composer-text-inserted",
        activeThreadKey: "local:thread-a",
        activeComposerKey: "composer-1",
      },
    } as T;
  };
  return bridge;
}

test("non-command keycaps use the pinned current app runtime instead of the removed vscode asset", async () => {
  const expressions: string[] = [];
  const bridge = harness(expressions);

  const results = await Promise.all([
    bridge.runKeycap("OAI"),
    bridge.runKeycap("YOLO"),
    bridge.runKeycap("YEET"),
  ]);

  assert.equal(expressions.length, 3);
  const reviewed = [
    { type: "external-url", url: "https://developers.openai.com" },
    { type: "composer-text", text: ":yolo:" },
    { type: "composer-text", text: ":yeet:" },
  ];
  expressions.forEach((expression, index) => {
    assert.ok(expression.includes(DIAL_RUNTIME_26903.initial));
    assert.ok(expression.includes(DIAL_RUNTIME_26903.layoutAsset));
    const start = expression.indexOf("      const reviewedStandalone =");
    const end = expression.indexOf("      const expectedTransitionCommand =", start);
    assert.ok(start >= 0 && end > start);
    const verify = Function("action", "currentKeycapLayout", expression.slice(start, end));
    verify(reviewed[index], true);
    assert.throws(() => verify({ type: "command", command: "sendFollowUp" }, true), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
    assert.throws(() => verify({ ...reviewed[index], text: "changed", url: "https://example.com" }, true), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
  });
  assert.match(expressions[0]!, /d2t: appInitial\.A6t/);
  assert.match(expressions[1]!, /Kun: appInitial\._mn/);

  for (const expression of expressions) {
    assert.doesNotMatch(expression, /vscode-api-/);
    assert.match(expression, new RegExp(CURRENT_APP_INITIAL_SHA256));
  }
  assert.match(expressions[0]!, /namespace\.d2t/);
  assert.match(expressions[1]!, /namespace\.Kun/);
  assert.match(expressions[2]!, /namespace\.Kun/);
  assert.deepEqual(results.map((result) => result.semanticOutcome), ["confirmed", "confirmed", "confirmed"]);
});

test("a generic evaluator acknowledgement cannot masquerade as a standalone action result", async () => {
  const expressions: string[] = [];
  const bridge = harness(expressions);
  bridge.evaluate = async <T>(expression: string) => {
    const operationId = expression.match(/operationId: "([0-9a-f-]{36})"/)?.[1]
      ?? expression.match(/return "([0-9a-f-]{36})"/)?.[1];
    assert.ok(operationId);
    return operationId as T;
  };

  await assert.rejects(bridge.runKeycap("OAI"), /E_OPERATION_UNOBSERVED/);
  await assert.rejects(bridge.runKeycap("YOLO"), /E_OPERATION_UNOBSERVED/);
  await assert.rejects(bridge.runKeycap("YEET"), /E_OPERATION_UNOBSERVED/);
});

test("standalone runtime selectors accept only the pinned current native exports", () => {
  const dispatchHostMessage = () => undefined;
  const bus = { dispatchHostMessage };
  const openExternal = () => true;
  const namespace = { Kun: bus, d2t: openExternal };

  assert.equal(
    selectNativeMicroHostBus(namespace, CURRENT_APP_INITIAL_SHA256, CURRENT_APP_INITIAL_SHA256),
    bus,
  );
  assert.equal(
    selectNativeExternalUrlOpener(namespace, CURRENT_APP_INITIAL_SHA256, CURRENT_APP_INITIAL_SHA256),
    openExternal,
  );
  assert.equal(selectNativeMicroHostBus(namespace, "changed", CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeExternalUrlOpener(namespace, "changed", CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeMicroHostBus({ Kun: {} }, CURRENT_APP_INITIAL_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
  assert.equal(selectNativeExternalUrlOpener({ d2t: true }, CURRENT_APP_INITIAL_SHA256, CURRENT_APP_INITIAL_SHA256), undefined);
});

test("composer readback accepts one exact insertion and rejects replacement or unrelated edits", () => {
  assert.equal(isExactComposerTextInsertion("draft", "dra:yolo:ft", ":yolo:"), true);
  assert.equal(isExactComposerTextInsertion("draft", "draft:yeet:", ":yeet:"), true);
  assert.equal(isExactComposerTextInsertion("draft", ":yeet:draft", ":yeet:"), true);
  assert.equal(isExactComposerTextInsertion("draft", "dra:yeet:t", ":yeet:"), false);
  assert.equal(isExactComposerTextInsertion("draft", "draft", ":yeet:"), false);
  assert.equal(isExactComposerTextInsertion("draft", "draftextra", ":yeet:"), false);
});

test("composer controller selector requires one committed owner under the active root", () => {
  const editorDom = {} as Element;
  const controller = {
    view: { dom: editorDom, isDestroyed: false },
    getPersistedText: () => "",
    setText: () => undefined,
    focus: () => undefined,
  };
  const composerRoot = {
    isConnected: true,
    contains: (candidate: unknown) => candidate === editorDom,
  } as unknown as Element & Record<string, unknown>;
  const controllerFiber: any = { memoizedProps: { composerController: controller }, child: null, sibling: null };
  const hostFiber = { stateNode: composerRoot, child: controllerFiber, sibling: null };
  const rootState = { current: null as unknown };
  const committedRoot = { tag: 3, stateNode: rootState, child: hostFiber, sibling: null };
  rootState.current = committedRoot;
  const attachedRoot = { tag: 3, stateNode: rootState, return: null };
  Object.assign(composerRoot, { "__reactFiber$test": { return: attachedRoot } });

  assert.equal(selectNativeComposerTextController(composerRoot), controller);
  controllerFiber.sibling = {
    memoizedProps: { composerController: { ...controller, view: { dom: editorDom, isDestroyed: false } } },
    child: null,
    sibling: null,
  };
  assert.equal(selectNativeComposerTextController(composerRoot), undefined);
});

test("standalone runtime failures remain content-free diagnostics", () => {
  const response = (code: string) => ({
    result: { exceptionDetails: { text: `Uncaught (in promise) Error: ${code}` } },
  });
  assert.equal(rendererFailureCode(response("E_MICRO_STANDALONE_RUNTIME_CHANGED")), "E_MICRO_STANDALONE_RUNTIME_CHANGED");
  assert.equal(rendererFailureCode(response("E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE")), "E_MICRO_COMPOSER_CONTROLLER_UNAVAILABLE");
});
