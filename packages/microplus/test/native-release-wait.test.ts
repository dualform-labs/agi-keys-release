import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
test("native release waits for delivery and bounds an uncleared modifier", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agi-keys-native-wait-"));
  const executable = join(directory, "helper");
  await run("/usr/bin/xcrun", ["swiftc", "-O", fileURLToPath(new URL("../native/global-dictation-helper.swift", import.meta.url)), "-o", executable], { timeout: 30_000 });
  // This explicit mode exits before permission checks or any posted events.
  const { stdout } = await run(executable, ["--test-release-wait"], { timeout: 5_000 });
  assert.equal(stdout.trim(), "RELEASE_WAIT_TEST_OK");
  const timestamps = await run(executable, ["--test-event-timestamps"], { timeout: 5_000 });
  assert.equal(timestamps.stdout.trim(), "EVENT_TIMESTAMPS_TEST_OK");
  const recorded = await run(executable, ["--test-recorded-shortcut"], { timeout: 5_000 });
  assert.equal(recorded.stdout.trim(), "RECORDED_SHORTCUT_TEST_OK");
  const toggle = await run(executable, ["--test-toggle-pair"], { timeout: 5_000 });
  assert.equal(toggle.stdout.trim(), "TOGGLE_PAIR_TEST_OK");
});
