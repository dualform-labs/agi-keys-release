import assert from "node:assert/strict";
import test from "node:test";
import { safeActionFailureCode } from "../src/action-feedback.js";
import {
  RENDERER_FAILURE_CODES,
  RESET_FAILURE_CODES,
} from "../src/codex-micro-renderer-bridge.js";
import { safeDialFailureCode } from "../src/controller.js";

test("generic action feedback preserves reviewed draft-transfer failures", () => {
  assert.equal(
    safeActionFailureCode(new Error("E_DRAFT_TRANSFER_SOURCE_EMPTY")),
    "E_DRAFT_TRANSFER_SOURCE_EMPTY",
  );
  assert.equal(safeActionFailureCode(new Error("E_MAPPING_INACTIVE")), "E_MAPPING_INACTIVE");
  assert.equal(safeActionFailureCode(new Error("E_INPUT_OWNED")), "E_INPUT_OWNED");
  assert.equal(safeActionFailureCode(new Error("E_RELEASE_UNVERIFIED")), "E_RELEASE_UNVERIFIED");
  assert.equal(
    safeActionFailureCode(new Error("E_EXTERNAL_URL_NOT_ALLOWED")),
    "E_EXTERNAL_URL_NOT_ALLOWED",
  );
});

test("generic action feedback preserves every reviewed renderer failure", () => {
  for (const code of RENDERER_FAILURE_CODES) {
    assert.equal(safeActionFailureCode(new Error(code)), code, code);
  }
  for (const code of RESET_FAILURE_CODES) {
    assert.equal(safeActionFailureCode(new Error(code)), code, code);
  }
  assert.equal(
    safeActionFailureCode(new Error("E_RELEASE_ALREADY_ATTEMPTED")),
    "E_RELEASE_ALREADY_ATTEMPTED",
  );
  assert.equal(safeActionFailureCode(new Error("E_DUPLICATE_DOWN")), "E_DUPLICATE_DOWN");
});

test("generic action feedback does not label key failures as dial failures", () => {
  assert.equal(safeActionFailureCode(new Error("private failure detail")), "E_ACTION_UNKNOWN");
  assert.equal(safeDialFailureCode(new Error("private failure detail")), "E_DIAL_UNKNOWN");
});

test("window-routing diagnostics preserve the failure stage without exposing task details", () => {
  for (const code of [
    "E_AGENT_WINDOW_UNVERIFIED", "E_AGENT_SOURCE_UNVERIFIED",
    "E_AGENT_WINDOW_CREATION_UNCERTAIN", "E_AGENT_SOURCE_CHANGED",
    "E_AGENT_WINDOW_AMBIGUOUS",
    "E_AGENT_NEW_WINDOW_UNSUPPORTED",
  ]) assert.equal(safeActionFailureCode(new Error(code)), code);
  assert.equal(safeActionFailureCode(new Error("E_AGENT_SOURCE_CHANGED: private-task-id")), "E_ACTION_UNKNOWN");
});
