import assert from "node:assert/strict";
import test from "node:test";
import { MissingMicroLauncherError, bridgeFailureCode } from "../src/bridge-error.js";

test("missing launcher has a distinct content-free diagnostic", () => {
  assert.equal(bridgeFailureCode(new MissingMicroLauncherError()), "missing-launcher");
});

test("reviewed connection and integrity codes remain content-free diagnostics", () => {
  for (const code of [
    "E_ACTIVE_VIEW_UNAVAILABLE",
    "E_BRIDGE_CLOSED",
    "E_CDP_PROTOCOL",
    "E_CONNECTION_STALE",
    "E_DEBUG_WEBSOCKET_CONNECT",
    "E_DEBUG_WEBSOCKET_TIMEOUT",
    "E_FOREGROUND_TARGET_STALE",
    "E_FOREGROUND_TARGET_UNAVAILABLE",
    "E_INVALID_DEBUG_WEBSOCKET",
    "E_MAPPING_STALE",
    "E_PAGE_STALE",
    "E_RELEASE_TARGET_GONE",
    "E_RENDERER_EVALUATION",
    "E_RENDERER_EVALUATION_TIMEOUT",
    "E_BRIDGE_DISCONNECTED",
    "E_TARGET_STALE",
  ]) {
    assert.equal(bridgeFailureCode(new Error(code)), code);
  }
  const named = new Error("private composer text");
  named.name = "E_CDP_PROTOCOL";
  assert.equal(bridgeFailureCode(named), "E_CDP_PROTOCOL");
});

test("untrusted exception names and messages never enter bridge diagnostics", () => {
  const error = new Error("private composer text");
  error.name = "private token";
  for (const value of [
    error,
    new Error("E_FOREGROUND_TARGET_UNAVAILABLE: private target details"),
    new Error("E_INVALID_DEBUG_WEBSOCKET: private target details"),
    new Error("E_RENDERER_EVALUATION_TIMEOUT: private renderer details"),
    { name: "E_FOREGROUND_TARGET_UNAVAILABLE", message: "private text" },
    { name: "missing-launcher", message: "private text" },
    "private text",
    null,
  ]) {
    assert.equal(bridgeFailureCode(value), "unavailable");
  }
});
