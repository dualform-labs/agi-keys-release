import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  selectTrustedRendererAssetUrl,
  trustedRendererAssetUrls,
  validateLoopbackWebSocketUrl,
} from "../src/renderer-security.js";
import { readResetAttempt, writeResetAttempt } from "../src/reset-outcome-store.js";

test("renderer asset discovery accepts only exact same-app asset URLs", () => {
  const urls = [
    "https://attacker.invalid/assets/codex-micro-layout-bad.js",
    "app://other/assets/codex-micro-layout-other.js",
    "app://codex/assets/../codex-micro-layout-bad.js",
    "app://codex/assets/codex-micro-layout-good.js?swap=1",
    "app://codex/assets/codex-micro-layout-good.js",
  ];
  assert.deepEqual(trustedRendererAssetUrls(urls, "app://codex/index.html"), [
    "app://codex/assets/codex-micro-layout-good.js",
  ]);
  assert.equal(
    selectTrustedRendererAssetUrl(urls, "app://codex/index.html", "codex-micro-layout-"),
    "app://codex/assets/codex-micro-layout-good.js",
  );
});

test("renderer asset discovery fails closed on ambiguous or non-app matches", () => {
  assert.equal(selectTrustedRendererAssetUrl([
    "app://codex/assets/app-initial-a.js",
    "app://codex/assets/app-initial-b.js",
  ], "app://codex/index.html", "app-initial-"), undefined);
  assert.deepEqual(trustedRendererAssetUrls([
    "https://codex.invalid/assets/app-initial-a.js",
  ], "https://codex.invalid/index.html"), []);
});

test("debug WebSocket destination must use the verified IPv4 loopback port", () => {
  assert.equal(
    validateLoopbackWebSocketUrl("ws://127.0.0.1:42002/devtools/page/main", 42002),
    "ws://127.0.0.1:42002/devtools/page/main",
  );
  for (const url of [
    "ws://attacker.invalid:42002/devtools/page/main",
    "wss://127.0.0.1:42002/devtools/page/main",
    "ws://127.0.0.1:41001/devtools/page/main",
    "ws://127.0.0.1:42002/socket",
    "ws://127.0.0.1:42002/devtools/page/main?redirect=1",
  ]) assert.throws(() => validateLoopbackWebSocketUrl(url, 42002), /E_INVALID_DEBUG_WEBSOCKET/);
});

test("pending reset metadata survives restart in an atomic mode-0600 file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "microplus-reset-store-"));
  const path = join(directory, "attempt.json");
  const pending = { version: 1 as const, redeemRequestId: "request-123", creditId: "credit-456" };
  await writeResetAttempt(pending, path);
  assert.deepEqual(await readResetAttempt(path), pending);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const boundary = { version: 1 as const, redeemRequestId: "12345678", creditId: "c".repeat(240) };
  await writeResetAttempt(boundary, path);
  assert.deepEqual(await readResetAttempt(path), boundary);
});

test("corrupt reset state fails closed instead of looking like no prior attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "microplus-reset-corrupt-"));
  const path = join(directory, "attempt.json");
  await writeFile(path, "{broken", { mode: 0o600 });
  await assert.rejects(readResetAttempt(path), /E_RESET_STATE_INVALID/);
  await writeFile(path, '{"version":1,"redeemRequestId":"request-123","outcome":null}\n', { mode: 0o600 });
  await assert.rejects(readResetAttempt(path), /E_RESET_STATE_INVALID/);
  await writeFile(path, '{"version":1,"redeemRequestId":"short"}\n', { mode: 0o600 });
  await assert.rejects(readResetAttempt(path), /E_RESET_STATE_INVALID/);
});
