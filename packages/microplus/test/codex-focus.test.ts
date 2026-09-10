import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { focusCodexApp, type FocusSpawn } from "../src/codex-focus.js";

class FakeChild extends EventEmitter {
  killedWith: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }
}

function harness(): { child: FakeChild; calls: Parameters<FocusSpawn>[]; spawn: FocusSpawn } {
  const child = new FakeChild();
  const calls: Parameters<FocusSpawn>[] = [];
  const spawn: FocusSpawn = (...args) => {
    calls.push(args);
    return child;
  };
  return { child, calls, spawn };
}

test("focus uses fixed open bundle arguments without a shell or output pipes", async () => {
  const { child, calls, spawn } = harness();
  const focused = focusCodexApp({ spawn, timeoutMs: 100 });
  child.emit("exit", 0, null);
  await focused;
  assert.deepEqual(calls, [[
    "/usr/bin/open",
    ["-b", "com.openai.codex"],
    { shell: false, stdio: "ignore", windowsHide: true },
  ]]);
});

test("focus returns only the fixed error for spawn and nonzero exit failures", async () => {
  await assert.rejects(
    focusCodexApp({ spawn: () => { throw new Error("secret stderr"); }, timeoutMs: 100 }),
    (error: Error) => error.name === "E_FOCUS_FAILED" && error.message === "E_FOCUS_FAILED",
  );

  const { child, spawn } = harness();
  const focused = focusCodexApp({ spawn, timeoutMs: 100 });
  child.emit("exit", 7, null);
  await assert.rejects(
    focused,
    (error: Error) => error.name === "E_FOCUS_FAILED" && error.message === "E_FOCUS_FAILED",
  );
});

test("focus kills a child and fails within the injected timeout", async () => {
  const { child, spawn } = harness();
  await assert.rejects(
    focusCodexApp({ spawn, timeoutMs: 5 }),
    (error: Error) => error.name === "E_FOCUS_FAILED" && error.message === "E_FOCUS_FAILED",
  );
  assert.equal(child.killedWith, "SIGTERM");
});
