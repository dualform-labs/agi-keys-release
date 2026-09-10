import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeckController } from "../src/controller.js";
import { releaseOnDeviceDisconnect } from "../src/device-disconnect.js";
import type { MicroActionSlot, MicroSnapshot, MutationConfirmation } from "../src/types.js";

type Dispatch = { phase: "down" | "up"; physicalId: string };

function snapshot(): MicroSnapshot {
  return {
    slots: [
      { id: 0, threadKey: "thread-a", title: "A", status: "idle", selected: true },
      ...Array.from({ length: 5 }, (_, offset) => ({
        id: offset + 1,
        threadKey: null,
        title: null,
        status: "off" as const,
        selected: false,
      })),
    ],
    activeThreadKey: "thread-a",
    layout: {
      version: 1,
      slots: {
        ACT10: { keycapId: "MIC" },
        ACT11: { keycapId: "MIC1" },
      },
      analogStick: { up: {}, right: {}, down: {}, left: {} },
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 3,
    pageEpoch: 7,
    mappingFingerprint: "mapping-a",
    targetIdentity: "target-a",
  };
}

function confirmation(): MutationConfirmation {
  return { dispatch: "accepted", metadata: "matched", semanticOutcome: "confirmed" };
}

function configuredController(dispatches: Dispatch[]): {
  controller: DeckController;
  finishFirstDown: () => void;
  closeCount: () => number;
} {
  const calls: Dispatch[] = dispatches;
  let closes = 0;
  let firstDown = true;
  let releaseFirstDown!: () => void;
  const firstDownGate = new Promise<void>((resolve) => { releaseFirstDown = resolve; });
  const bridge = {
    async sendAction(slot: MicroActionSlot, act: number): Promise<MutationConfirmation> {
      calls.push({ phase: act === 1 ? "down" : "up", physicalId: slot });
      if (act === 1 && firstDown) {
        firstDown = false;
        await firstDownGate;
      }
      return confirmation();
    },
    async releaseAction(slot: MicroActionSlot): Promise<MutationConfirmation> {
      calls.push({ phase: "up", physicalId: slot });
      return confirmation();
    },
    close(): void { closes += 1; },
  };
  const controller = new DeckController();
  Object.assign(controller as unknown as { microBridge: typeof bridge; snapshot: MicroSnapshot; health: { state: "ready"; changedAt: number } }, {
    microBridge: bridge,
    snapshot: snapshot(),
    health: { state: "ready", changedAt: 0 },
  });
  return { controller, finishFirstDown: releaseFirstDown, closeCount: () => closes };
}

test("device disconnect releases a pending PTT exactly once and leaves the controller usable", async () => {
  const dispatches: Dispatch[] = [];
  const { controller, finishFirstDown, closeCount } = configuredController(dispatches);

  const down = controller.pressMicroAction("ptt-pending", "ACT10");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatches, [{ phase: "down", physicalId: "ACT10" }]);

  const release = controller.releaseHeldInputs();
  finishFirstDown();
  await Promise.all([down, release]);
  await controller.releaseHeldInputs();

  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT10" },
    { phase: "up", physicalId: "ACT10" },
  ]);
  assert.equal(closeCount(), 0, "disconnect release must not close the bridge");

  await controller.pressMicroAction("ptt-after-disconnect", "ACT10");
  await controller.releaseInput("ptt-after-disconnect");
  assert.deepEqual(dispatches, [
    { phase: "down", physicalId: "ACT10" },
    { phase: "up", physicalId: "ACT10" },
    { phase: "down", physicalId: "ACT10" },
    { phase: "up", physicalId: "ACT10" },
  ]);
});

test("device disconnect runs both release paths and logs each rejected path independently", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  await releaseOnDeviceDisconnect(
    {
      releaseHeldInputs: async () => {
        calls.push("inputs");
        throw new Error("input release failed");
      },
    },
    {
      releaseAll: async () => {
        calls.push("dictation");
        throw new Error("dictation release failed");
      },
    },
    { error: (message) => logs.push(message) },
  );

  assert.deepEqual(calls, ["inputs", "dictation"]);
  assert.deepEqual(logs, [
    "Held input disconnect release failed: unavailable",
    "Global dictation disconnect release failed: unavailable",
  ]);
});

test("plugin wires device disconnect to release-only handling", async () => {
  const source = await readFile(new URL("../src/plugin.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /streamDeck\.devices\.onDeviceDidDisconnect\(\(\) => \{\s*void releaseOnDeviceDisconnect\(controller, globalDictationHold, streamDeck\.logger\);\s*\}\);/u,
  );
  const handler = source.match(/streamDeck\.devices\.onDeviceDidDisconnect\(\(\) => \{([\s\S]*?)\}\);/u)?.[1] ?? "";
  assert.doesNotMatch(handler, /\.stop\(|\.close\(/u);
});
