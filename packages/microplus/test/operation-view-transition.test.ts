import assert from "node:assert/strict";
import test from "node:test";
import { CodexMicroRendererBridge } from "../src/codex-micro-renderer-bridge.js";
import { KeycapTerminal } from "../src/actions.js";
import type { DeckController } from "../src/controller.js";
import type { KeyDownEvent } from "@elgato/streamdeck";
import type { MicroSnapshot, MutationConfirmation, OperationRequest } from "../src/types.js";

const operation: OperationRequest = {
  version: 1, requestId: "request-ui", operationId: "operation-ui",
  connectionEpoch: 3, pageEpoch: 7, mappingFingerprint: "mapping-a",
  targetIdentity: "window-a", physicalId: "KEYCAP_SETUP", phase: "invoke",
  activeThreadKey: "local:thread-a", activeComposerKey: "composer-1",
};

function harness() {
  // The renderer readback boundary is synthetic; the production observer runs unchanged.
  const snapshot = {
    connectionEpoch: 3, pageEpoch: 7, mappingFingerprint: "mapping-a", targetIdentity: "window-a",
  } as MicroSnapshot;
  const bridge = new CodexMicroRendererBridge(() => {}) as unknown as {
    refresh(): Promise<MicroSnapshot>;
    observeOperation(op: OperationRequest, direction: undefined, postcondition?: unknown): Promise<MutationConfirmation>;
  };
  bridge.refresh = async () => snapshot;
  return { bridge, snapshot };
}

const nativeUi = {
  kind: "native-ui-changed", keycapId: "SETUP",
  before: { route: "other", terminalVisible: false, reviewVisible: false, browserTabCount: 0 },
  after: { route: "settings", terminalVisible: false, reviewVisible: false, browserTabCount: 0 },
};

test("verified native surface transition may remove the source composer", async () => {
  const { bridge } = harness();
  assert.equal((await bridge.observeOperation(operation, undefined, nativeUi)).semanticOutcome, "confirmed");
});

test("explicit null external URL scope does not reinstate the source composer", async () => {
  const { bridge } = harness();
  assert.equal((await bridge.observeOperation(operation, undefined, {
    kind: "external-url-dispatched", activeThreadKey: null, activeComposerKey: null,
  })).semanticOutcome, "confirmed");
});

test("a surface transition cannot excuse a different live task or stale connection", async () => {
  const { bridge, snapshot } = harness();
  snapshot.activeThreadKey = "local:unrelated";
  await assert.rejects(bridge.observeOperation(operation, undefined, nativeUi), /E_ACTIVE_THREAD_STALE/);
  snapshot.activeThreadKey = "local:thread-a";
  snapshot.activeComposerKey = "composer-2";
  await assert.rejects(bridge.observeOperation(operation, undefined, nativeUi), /E_ACTIVE_COMPOSER_STALE/);
  snapshot.connectionEpoch = 4;
  await assert.rejects(bridge.observeOperation(operation, undefined, nativeUi), /E_CONNECTION_STALE/);
});

test("a generic accepted dispatch still requires the original active view", async () => {
  const { bridge } = harness();
  await assert.rejects(bridge.observeOperation(operation, undefined), /E_ACTIVE_THREAD_STALE/);
});

test("the actual key wrapper shows no SDK warning for a verified view transition but warns on a wrong task", async () => {
  const { bridge, snapshot } = harness();
  let alerts = 0;
  const terminalTransition = {
    ...nativeUi, keycapId: "TERM",
    after: { ...nativeUi.before, terminalVisible: true },
  };
  const controller = {
    runKeycap: () => bridge.observeOperation(operation, undefined, terminalTransition),
    isCurrentAction: () => true,
  } as unknown as DeckController;
  const key = new KeycapTerminal(controller);
  const event = {
    action: { id: "terminal-key", showAlert: async () => { alerts += 1; } },
  } as unknown as KeyDownEvent;
  await key.onKeyDown(event);
  assert.equal(alerts, 0);
  snapshot.activeThreadKey = "local:wrong-task";
  await key.onKeyDown(event);
  assert.equal(alerts, 1);
});
