import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexMicroRendererBridge,
  safeRendererTargetLabel,
} from "../src/codex-micro-renderer-bridge.js";

test("renderer target diagnostics strip query, hash, and credentials from the logged label", () => {
  const messages: string[] = [];
  const bridge = new CodexMicroRendererBridge((message) => messages.push(message)) as unknown as {
    logConnectedTarget(port: number, targetUrl: string): void;
  };

  bridge.logConnectedTarget(
    65299,
    "app://codex/index.html?secret=do-not-log&window=foreground#token-fragment",
  );

  assert.deepEqual(messages, [
    "Native Codex-Micro-Brücke verbunden (Port 65299, app://codex/index.html).",
  ]);
  assert.ok(!messages.join("\n").includes("secret"));
  assert.ok(!messages.join("\n").includes("token-fragment"));
});

test("renderer target diagnostics fail closed for malformed URLs", () => {
  assert.equal(safeRendererTargetLabel("not a URL?secret=do-not-log#fragment"), "renderer");
  assert.equal(safeRendererTargetLabel("https://user:password@example.test/path?q=1#hash"), "https://example.test/path");
});
