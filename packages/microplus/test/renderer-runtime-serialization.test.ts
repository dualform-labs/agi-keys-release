import assert from "node:assert/strict";
import test from "node:test";
import * as bridgeExports from "../src/codex-micro-renderer-bridge.js";
import {
  matchesActiveThreadSelection,
  moveSideDraftToMainInDocument,
  readAgentSlotMetadata,
  readFocusedModelCandidate,
  readNativeCurrentModel,
  selectActiveComposerState,
  selectBoundModelPicker,
  selectNativeCommandRunner,
  selectNativeCommandScope,
  selectNativeModelPickerOwner,
  selectVerifiedOpenedSideChat,
} from "../src/renderer-runtime.js";

function inject<T>(source: string): T {
  return Function(`"use strict"; ${source}`)() as T;
}

test("renderer runtime public helpers remain re-exported by the bridge", () => {
  assert.equal(bridgeExports.selectActiveComposerState, selectActiveComposerState);
  assert.equal(bridgeExports.selectNativeCommandScope, selectNativeCommandScope);
  assert.equal(bridgeExports.readNativeCurrentModel, readNativeCurrentModel);
  assert.equal(bridgeExports.moveSideDraftToMainInDocument, moveSideDraftToMainInDocument);
});

test("model and composer helpers execute from their injected sources without module globals", () => {
  const currentModel = inject<unknown>(`
    const selectModelOwner = (${selectNativeModelPickerOwner.toString()});
    const readCurrentModel = (${readNativeCurrentModel.toString()});
    return readCurrentModel(null, null, true, selectModelOwner);
  `);
  assert.equal(currentModel, null);

  const active = inject<{ root: null }>(`
    const resolveActiveComposer = (${selectActiveComposerState.toString()});
    const matchesActiveThread = (${matchesActiveThreadSelection.toString()});
    const doc = {
      activeElement: null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    if (matchesActiveThread(doc, "local:thread", resolveActiveComposer)) {
      throw new Error("unexpected match");
    }
    return resolveActiveComposer(doc);
  `);
  assert.deepEqual(active, { root: null });
});

test("scope, side-chat, and draft helpers execute with only injected dependencies", () => {
  const sideChat = inject<unknown>(`
    const selectScope = (${selectNativeCommandScope.toString()});
    const resolveActiveComposer = (${selectActiveComposerState.toString()});
    const selectOpenedSideChat = (${selectVerifiedOpenedSideChat.toString()});
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [],
    };
    return selectOpenedSideChat(
      doc, null, selectScope, {}, {}, {}, resolveActiveComposer
    );
  `);
  assert.equal(sideChat, null);

  const transferFailure = inject<string>(`
    const selectScope = (${selectNativeCommandScope.toString()});
    const moveDraft = (${moveSideDraftToMainInDocument.toString()});
    const doc = { querySelectorAll: () => [] };
    try {
      moveDraft(doc, selectScope, {}, {}, {});
      return "unexpected-success";
    } catch (error) {
      return error instanceof Error ? error.message : "non-error";
    }
  `);
  assert.equal(transferFailure, "E_DRAFT_TRANSFER_SURFACE_AMBIGUOUS");
});

test("metadata, picker, and command helpers execute as standalone injected functions", () => {
  const result = inject<{
    metadata: unknown;
    picker: unknown;
    focused: unknown;
    runnerSelected: boolean;
  }>(`
    const readMetadata = (${readAgentSlotMetadata.toString()});
    const selectPicker = (${selectBoundModelPicker.toString()});
    const readFocused = (${readFocusedModelCandidate.toString()});
    const selectRunner = (${selectNativeCommandRunner.toString()});
    const runner = () => true;
    return {
      metadata: readMetadata({ threadKey: null }, { get() {} }, {}),
      picker: selectPicker({ querySelectorAll: () => [] }, null),
      focused: readFocused(null, null),
      runnerSelected: selectRunner({ Wat: runner }, "a", "b", "a", "b") === runner,
    };
  `);
  assert.deepEqual(result, {
    metadata: { metadataAvailability: "unavailable" },
    picker: null,
    focused: null,
    runnerSelected: true,
  });
});
