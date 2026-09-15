import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import {
  CodexMicroRendererBridge,
  CURRENT_APP_INITIAL_SHA256,
  CURRENT_APP_PRIMARY_SHA256,
  moveSideDraftToMainInDocument,
} from "../src/codex-micro-renderer-bridge.js";
import type { MutationConfirmation, OperationRequest } from "../src/types.js";

type FakeController = ReturnType<typeof controller>;

function controller(text: string, options: { rich?: boolean; ignoreClear?: boolean; partialClear?: boolean } = {}) {
  let value = text;
  const writes: string[] = [];
  let focused = false;
  const input = {};
  const doc = {
    descendants(visit: (node: { type: { name: string }; marks: unknown[] }) => void) {
      visit({ type: { name: options.rich ? "atMention" : "paragraph" }, marks: [] });
      if (value) visit({ type: { name: "text" }, marks: [] });
    },
  };
  return {
    view: { dom: input, isDestroyed: false, state: { doc } },
    getPersistedText: () => value,
    setText(next: string) {
      writes.push(next);
      if (options.partialClear && next === "") value = value.slice(1);
      else if (!(options.ignoreClear && next === "")) value = next;
    },
    focus() { focused = true; },
    writes,
    get focused() { return focused; },
  };
}

function root(surfaceController: FakeController, attachment = false) {
  const child = { memoizedProps: { composerController: surfaceController }, pendingProps: null, child: null, sibling: null };
  const value = {
    isConnected: true,
    contains(candidate: unknown) { return candidate === surfaceController.view.dom; },
    getAttribute(name: string) { return name === "data-composer-placement" ? "thread" : null; },
    querySelector(selector: string) {
      return attachment && selector.includes("data-visible-attachments") ? {} : null;
    },
  };
  const hostFiber: any = {
    stateNode: value,
    memoizedProps: { surfacePlacement: { kind: "thread" } },
    child,
    sibling: null,
    return: null,
  };
  return { value, hostFiber };
}

function fixture(
  sourceText = "side draft",
  destinationText = "",
  options: {
    attachment?: boolean;
    rich?: boolean;
    ignoreSourceClear?: boolean;
    partialSourceClear?: boolean;
    extraSide?: boolean;
    currentScopeShape?: boolean;
    emptyScopeValue?: boolean;
  } = {},
) {
  const source = controller(sourceText, {
    ...(options.rich === undefined ? {} : { rich: options.rich }),
    ...(options.ignoreSourceClear === undefined ? {} : { ignoreClear: options.ignoreSourceClear }),
    ...(options.partialSourceClear === undefined ? {} : { partialClear: options.partialSourceClear }),
  });
  const destination = controller(destinationText);
  const sourceSurface = root(source, options.attachment);
  const destinationSurface = root(destination);
  if (options.currentScopeShape) {
    sourceSurface.hostFiber.memoizedProps = {
      showSideChatEmptyState: false,
      SideChatTab: function SideChatTab() {},
      surfacePlacement: { kind: "thread" },
    };
  }
  const roots = [sourceSurface.value, destinationSurface.value];
  const scopes = new Map<object, { get(): boolean; value?: { kind?: string; placement?: string } }>([
    [sourceSurface.value, options.currentScopeShape ? { get: () => true } : { get: () => true, value: { kind: "local", placement: "side" } }],
    [destinationSurface.value, options.currentScopeShape ? { get: () => true } : { get: () => true, value: { kind: "local", placement: "main" } }],
  ]);
  if (options.emptyScopeValue) for (const scope of scopes.values()) scope.value = {};
  sourceSurface.hostFiber.sibling = destinationSurface.hostFiber;
  let lastHost = destinationSurface.hostFiber;
  if (options.extraSide) {
    const extraController = controller("other");
    const extraSurface = root(extraController);
    roots.push(extraSurface.value);
    scopes.set(extraSurface.value, { get: () => true, value: { kind: "local", placement: "side" } });
    lastHost.sibling = extraSurface.hostFiber;
    lastHost = extraSurface.hostFiber;
  }
  const rootState: any = {};
  const committedRoot: any = { tag: 3, stateNode: rootState, child: sourceSurface.hostFiber, return: null };
  rootState.current = committedRoot;
  for (let host: any = sourceSurface.hostFiber; host; host = host.sibling) {
    host.return = committedRoot;
    host.stateNode["__reactFiber$test"] = host;
  }
  const document = { querySelectorAll: () => roots };
  const selectScope = (_doc: unknown, candidate: object) => scopes.get(candidate);
  return { document, selectScope, source, destination, sourceSurface, destinationSurface };
}

function generatedMover(): typeof moveSideDraftToMainInDocument {
  return Function(`return (${moveSideDraftToMainInDocument.toString()})`)() as typeof moveSideDraftToMainInDocument;
}

test("the exact generated evaluator writes and verifies main before clearing side", () => {
  const value = fixture("draft\nline two");
  const outcome = generatedMover()(
    value.document as unknown as Document,
    value.selectScope as never,
    {},
    {},
    {},
  );
  assert.equal(outcome, "moved");
  assert.deepEqual(value.destination.writes, ["draft\nline two"]);
  assert.deepEqual(value.source.writes, [""]);
  assert.equal(value.source.getPersistedText(), "");
  assert.equal(value.destination.getPersistedText(), "draft\nline two");
  assert.equal(value.destination.focused, true);
});

test("current Codex scopes without value metadata use committed side-chat identity", () => {
  const value = fixture("current side draft", "", { currentScopeShape: true });
  const outcome = generatedMover()(
    value.document as unknown as Document,
    value.selectScope as never,
    {},
    {},
    {},
  );
  assert.equal(outcome, "moved");
  assert.equal(value.source.getPersistedText(), "");
  assert.equal(value.destination.getPersistedText(), "current side draft");
  assert.equal(value.destination.focused, true);
});

test("26.908 empty scope values use committed identity and preserve the full draft", () => {
  const value = fixture("draft\n日本語", "", { currentScopeShape: true, emptyScopeValue: true });
  assert.equal(generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}), "moved");
  assert.equal(value.destination.getPersistedText(), "draft\n日本語");
  assert.equal(value.source.getPersistedText(), "");
  assert.equal(value.destination.focused, true);
});

test("empty scope values still require an unambiguous side composer", () => {
  const value = fixture("keep this draft", "", { currentScopeShape: true, emptyScopeValue: true });
  delete value.sourceSurface.hostFiber.memoizedProps.SideChatTab;
  assert.throws(() => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS/);
  assert.deepEqual(value.source.writes, []);
  assert.deepEqual(value.destination.writes, []);
});

test("current Codex side identity must be complete and unique", () => {
  const partial = fixture("side", "", { currentScopeShape: true });
  delete partial.sourceSurface.hostFiber.memoizedProps.SideChatTab;
  assert.throws(
    () => generatedMover()(partial.document as unknown as Document, partial.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS/,
  );
  assert.deepEqual(partial.source.writes, []);
  assert.deepEqual(partial.destination.writes, []);

  const duplicate = fixture("side", "", { currentScopeShape: true });
  duplicate.destinationSurface.hostFiber.memoizedProps = {
    showSideChatEmptyState: false,
    SideChatTab: function SideChatTab() {},
    surfacePlacement: { kind: "thread" },
  };
  assert.throws(
    () => generatedMover()(duplicate.document as unknown as Document, duplicate.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS/,
  );
  assert.deepEqual(duplicate.source.writes, []);
  assert.deepEqual(duplicate.destination.writes, []);
});

test("current Codex attachment transfer is explicitly rejected", () => {
  const value = fixture("side", "", { attachment: true, currentScopeShape: true });
  assert.throws(
    () => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_ATTACHMENTS_UNSUPPORTED/,
  );
  assert.deepEqual(value.source.writes, []);
  assert.deepEqual(value.destination.writes, []);
});

test("an existing main draft fails closed without changing either composer", () => {
  const value = fixture("side", "main");
  assert.throws(
    () => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_DESTINATION_NOT_EMPTY/,
  );
  assert.deepEqual(value.source.writes, []);
  assert.deepEqual(value.destination.writes, []);
  assert.equal(value.source.getPersistedText(), "side");
  assert.equal(value.destination.getPersistedText(), "main");
});

test("attachments, rich editor nodes, and ambiguous side surfaces are rejected", () => {
  for (const options of [{ attachment: true }, { rich: true }, { extraSide: true }]) {
    const value = fixture("side", "", options);
    assert.throws(
      () => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
      /E_DRAFT_TRANSFER_(?:ATTACHMENTS_UNSUPPORTED|RICH_CONTENT_UNSUPPORTED|SURFACE_AMBIGUOUS)/,
    );
    assert.deepEqual(value.source.writes, []);
    assert.deepEqual(value.destination.writes, []);
  }
});

test("a source clear that does not take effect rolls the verified destination back", () => {
  const value = fixture("side", "", { ignoreSourceClear: true });
  assert.throws(
    () => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_SOURCE_READBACK/,
  );
  assert.equal(value.source.getPersistedText(), "side");
  assert.equal(value.destination.getPersistedText(), "");
  assert.deepEqual(value.destination.writes, ["side", ""]);
});

test("a partial source clear keeps the verified destination copy", () => {
  const value = fixture("side", "", { partialSourceClear: true });
  assert.throws(
    () => generatedMover()(value.document as unknown as Document, value.selectScope as never, {}, {}, {}),
    /E_DRAFT_TRANSFER_SOURCE_PARTIAL_CLEAR/,
  );
  assert.equal(value.source.getPersistedText(), "ide");
  assert.equal(value.destination.getPersistedText(), "side");
  assert.deepEqual(value.destination.writes, ["side"]);
});

test("the public bridge route pins both native composer assets", () => {
  const source = CodexMicroRendererBridge.prototype.moveSideDraftToMain.toString();
  assert.match(source, /KEYCAP_SIDE_TO_MAIN/);
  assert.ok(CURRENT_APP_INITIAL_SHA256.length === 64);
  assert.ok(CURRENT_APP_PRIMARY_SHA256.length === 64);
});

test("verified side draft readback is returned as a confirmed semantic result", async () => {
  const operation = {
    operationId: "side-transfer-operation",
    targetIdentity: "side-transfer-target",
    connectionEpoch: 3,
  } as OperationRequest;
  const unverified: MutationConfirmation = {
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
  };
  const bridge = new CodexMicroRendererBridge(() => undefined) as unknown as {
    moveSideDraftToMain(): Promise<MutationConfirmation>;
    beginOperation(): Promise<OperationRequest>;
    evaluate<T>(expression: string): Promise<T>;
    observeOperation(): Promise<MutationConfirmation>;
    socket: WebSocket;
    targetIdentity: string;
    connectionEpoch: number;
    operationTargetLeases: Map<string, { socket: WebSocket; targetIdentity: string; connectionEpoch: number }>;
  };
  const socket = { readyState: WebSocket.OPEN } as WebSocket;
  bridge.socket = socket;
  bridge.targetIdentity = operation.targetIdentity;
  bridge.connectionEpoch = operation.connectionEpoch;
  bridge.operationTargetLeases.set(operation.operationId, {
    socket,
    targetIdentity: operation.targetIdentity,
    connectionEpoch: operation.connectionEpoch,
  });
  bridge.beginOperation = async () => operation;
  bridge.evaluate = async <T>(expression: string) => {
    assert.ok(expression.includes(CURRENT_APP_INITIAL_SHA256));
    assert.ok(expression.includes(CURRENT_APP_PRIMARY_SHA256));
    assert.match(expression, /appInitial\.e6t/);
    assert.match(expression, /appInitial\.mqt/);
    assert.match(expression, /appInitial\.hU/);
    assert.doesNotMatch(expression, /appInitial\.V1t|appInitial\.QHt|appInitial\.AL/);
    return operation.operationId as T;
  };
  bridge.observeOperation = async () => unverified;

  assert.deepEqual(await bridge.moveSideDraftToMain(), {
    ...unverified,
    semanticOutcome: "confirmed",
  });
});
