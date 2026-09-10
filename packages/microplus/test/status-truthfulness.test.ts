import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MissingMicroLauncherError } from "../src/bridge-error.js";
import { DeckController } from "../src/controller.js";
import { buildRuntimeOverrideExpression } from "../launcher/runtime-override.js";

test("missing launcher reaches the offline controller state", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as {
    microBridge: { refresh(): Promise<never> };
    health: { state: string; reason?: string };
    refreshOnce(): Promise<void>;
  };
  internals.microBridge = { refresh: async () => { throw new MissingMicroLauncherError(); } };

  await internals.refreshOnce();

  assert.equal(internals.health.state, "offline");
  assert.equal(internals.health.reason, "missing-launcher");
});

test("native handler bootstrap declares input-only capability without a fabricated battery", async () => {
  const bridgeSource = await readFile(new URL("../src/codex-micro-renderer-bridge.ts", import.meta.url), "utf8");
  const runtimeExpression = buildRuntimeOverrideExpression();

  for (const source of [bridgeSource, runtimeExpression]) {
    assert.doesNotMatch(source, /percentage\s*:\s*100/);
    assert.doesNotMatch(source, /isCharging\s*:\s*true/);
    assert.match(source, /controlPlaneStatus["']?\s*:\s*["']unavailable["']/);
  }
});
