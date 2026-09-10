import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import {
  JsonLineNativeWindowFocusTransport,
  NativeWindowFocusClient,
  type NativeWindowFocusRequest,
  type NativeWindowFocusResponse,
  type NativeWindowFocusTransport,
} from "../src/native-window-focus.js";

class FakeTransport implements NativeWindowFocusTransport {
  readonly requests: Array<Record<string, unknown>> = [];
  closed = false;
  responder: (request: NativeWindowFocusRequest) => NativeWindowFocusResponse = (request) => ({
    requestId: request.requestId,
    ok: true,
    token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: 1,
  });

  async request(request: NativeWindowFocusRequest, _timeoutMs: number): Promise<NativeWindowFocusResponse> {
    this.requests.push(request);
    return this.responder(request);
  }

  async close(): Promise<void> { this.closed = true; }
}

test("capture binds an opaque token to exact pid and bundle for verify and focus", async () => {
  const transport = new FakeTransport();
  const client = new NativeWindowFocusClient(transport);
  const registration = await client.capture(321, "com.openai.codex");
  await client.verifyCapture(registration);
  await client.focus(registration);

  assert.deepEqual(transport.requests.map(({ action, pid, bundleId, token, revision }) => ({
    action, pid, bundleId, token, revision,
  })), [
    { action: "capture", pid: 321, bundleId: "com.openai.codex", token: undefined, revision: undefined },
    { action: "verify-capture", pid: 321, bundleId: "com.openai.codex", token: registration.token, revision: 1 },
    { action: "focus", pid: 321, bundleId: "com.openai.codex", token: registration.token, revision: 1 },
  ]);
});

test("reset and close invalidate registrations without retrying focus", async () => {
  const transport = new FakeTransport();
  const client = new NativeWindowFocusClient(transport);
  const registration = await client.capture(321, "com.openai.codex");
  await client.reset();
  await assert.rejects(client.focus(registration), /E_WINDOW_FOCUS_REGISTRATION_STALE/);
  assert.equal(transport.requests.filter(({ action }) => action === "focus").length, 0);
  await client.close();
  await assert.rejects(client.capture(321, "com.openai.codex"), /E_WINDOW_FOCUS_HELPER_STOPPED/);
  assert.equal(transport.closed, true);
});

test("permission and stale-window failures remain terminal for that request", async () => {
  const transport = new FakeTransport();
  const client = new NativeWindowFocusClient(transport);
  transport.responder = (request) => ({
    requestId: request.requestId,
    ok: false,
    error: "E_WINDOW_FOCUS_PERMISSION",
  });
  await assert.rejects(client.capture(321, "com.openai.codex"), /E_WINDOW_FOCUS_PERMISSION/);
  assert.equal(transport.requests.length, 1, "requests are never automatically retried");
});

test("response correlation and exact registration object prevent substitution", async () => {
  const transport = new FakeTransport();
  const client = new NativeWindowFocusClient(transport);
  const registration = await client.capture(321, "com.openai.codex");
  await assert.rejects(client.focus({ ...registration }), /E_WINDOW_FOCUS_REGISTRATION_STALE/);
  transport.responder = (request) => ({ ...request, requestId: "wrong", ok: true });
  await assert.rejects(client.capture(321, "com.openai.codex"), /E_WINDOW_FOCUS_RESPONSE_INVALID/);
});

test("invalid app identities are rejected before transport", async () => {
  const transport = new FakeTransport();
  const client = new NativeWindowFocusClient(transport);
  await assert.rejects(client.capture(0, "com.openai.codex"), /E_WINDOW_FOCUS_APP_IDENTITY_INVALID/);
  await assert.rejects(client.capture(321, "invalid bundle/id"), /E_WINDOW_FOCUS_APP_IDENTITY_INVALID/);
  assert.equal(transport.requests.length, 0);
});

test("JSONL transport correlates a real child response and fails closed after helper exit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "window-focus-helper-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const helper = join(directory, "fake-helper");
  await writeFile(helper, `#!/usr/bin/env node
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", chunk => {
  input += chunk;
  const newline = input.indexOf("\\n");
  if (newline < 0) return;
  const request = JSON.parse(input.slice(0, newline));
  process.stdout.write(JSON.stringify({ requestId: request.requestId, ok: true }) + "\\n");
  setImmediate(() => process.exit(0));
});
`, { mode: 0o700 });
  await chmod(helper, 0o700);

  const transport = new JsonLineNativeWindowFocusTransport(helper);
  const response = await transport.request({ requestId: "request-1", action: "reset" }, 1_000);
  assert.deepEqual(response, { requestId: "request-1", ok: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(
    transport.request({ requestId: "request-2", action: "reset" }, 1_000),
    /E_WINDOW_FOCUS_HELPER_EXITED/,
  );
});

test("JSONL transport times out once without resending", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "window-focus-helper-timeout-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const helper = join(directory, "fake-helper");
  await writeFile(helper, `#!/usr/bin/env node
process.stdin.resume();
setTimeout(() => process.exit(0), 1000);
`, { mode: 0o700 });
  await chmod(helper, 0o700);

  const transport = new JsonLineNativeWindowFocusTransport(helper);
  await assert.rejects(
    transport.request({ requestId: "request-timeout", action: "reset" }, 25),
    /E_WINDOW_FOCUS_HELPER_TIMEOUT/,
  );
  await transport.close();
});
