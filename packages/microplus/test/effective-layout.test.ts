import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectivePhysicalSlot } from "../src/effective-layout.js";
import type { MicroLayout } from "../src/types.js";
import { assertMicroActionDispatchable, DeckController } from "../src/controller.js";

function layout(overrides: Partial<MicroLayout> = {}): MicroLayout {
  return {
    version: 1,
    ...overrides,
    slots: {
      ACT06: { keycapId: "FAST" },
      ACT07: { keycapId: "APPR" },
      ACT08: { keycapId: "REJ" },
      ACT09: { keycapId: "SPLIT" },
      ACT10: { keycapId: "MIC1" },
      ACT11: { keycapId: "EMPT1" },
      ACT12: { keycapId: "CODEX" },
      ...overrides.slots,
    },
    analogStick: { up: {}, right: {}, down: {}, left: {} },
  };
}

test("combined microphone uses ACT10_ACT11 and marks ACT11 inactive", () => {
  const current = layout({
    separateMicrophoneKeys: false,
    slots: { ACT10_ACT11: { keycapId: "MIC" } },
  });

  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT10"), { keycapId: "MIC" });
  assert.equal(resolveEffectivePhysicalSlot(current, "ACT11"), undefined);
  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT07"), { keycapId: "APPR" });
});

test("combined microphone does not fall back to stale per-switch entries", () => {
  const current = layout({ separateMicrophoneKeys: false });

  assert.equal(resolveEffectivePhysicalSlot(current, "ACT10"), undefined);
  assert.equal(resolveEffectivePhysicalSlot(current, "ACT11"), undefined);
});

test("separate microphone keys use their direct physical bindings", () => {
  const current = layout({ separateMicrophoneKeys: true });

  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT10"), { keycapId: "MIC1" });
  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT11"), { keycapId: "EMPT1" });
  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT07"), { keycapId: "APPR" });
});

test("separate microphone remaps follow the current physical slots", () => {
  const current = layout({
    separateMicrophoneKeys: true,
    slots: {
      ACT10: { keycapId: "EMPT1" },
      ACT11: { keycapId: "MIC1" },
      ACT07: { keycapId: "CUSTOM_APPROVAL" },
    },
  });

  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT10"), { keycapId: "EMPT1" });
  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT11"), { keycapId: "MIC1" });
  assert.deepEqual(resolveEffectivePhysicalSlot(current, "ACT07"), { keycapId: "CUSTOM_APPROVAL" });
});

test("controller selects an effective microphone and rejects non-microphone remaps", () => {
  const harness = {
    health: { state: "ready" },
    snapshot: { layout: layout({ separateMicrophoneKeys: false, slots: { ACT10_ACT11: { keycapId: "MIC" } } }) }
  };
  const resolve = () => DeckController.prototype.resolveMicrophoneSlot.call(harness as unknown as DeckController);
  assert.equal(resolve(), "ACT10");
  harness.snapshot.layout = layout({ separateMicrophoneKeys: true, slots: { ACT10: { keycapId: "FAST" }, ACT11: { keycapId: "MIC1" } } });
  assert.equal(resolve(), "ACT11");
  harness.snapshot.layout = layout({ separateMicrophoneKeys: false, slots: { ACT10_ACT11: { keycapId: "FAST" } } });
  assert.throws(resolve, /E_MAPPING_INACTIVE/u);
  harness.health.state = "offline";
  assert.throws(resolve, /E_MAPPING_STALE/u);
});

test("inactive combined ACT11 is rejected before a native dispatch", () => {
  const current = layout({
    separateMicrophoneKeys: false,
    slots: { ACT10_ACT11: { keycapId: "MIC" } },
  });

  assert.throws(
    () => assertMicroActionDispatchable(current, "ACT11"),
    (error: unknown) => error instanceof Error && error.message === "E_MAPPING_INACTIVE",
  );
  assert.doesNotThrow(() => assertMicroActionDispatchable(current, "ACT10"));
});

test("controller does not send inactive combined ACT11 to the bridge", async () => {
  const controller = new DeckController();
  const internals = controller as unknown as {
    snapshot: { layout: MicroLayout };
    microBridge: { sendAction: () => Promise<void> };
    inputs: { press: () => Promise<void> };
  };
  let bridgeDispatches = 0;
  let inputPresses = 0;
  internals.snapshot = { layout: layout({ separateMicrophoneKeys: false, slots: { ACT10_ACT11: { keycapId: "MIC" } } }) };
  internals.microBridge = { sendAction: async () => { bridgeDispatches += 1; } };
  internals.inputs = { press: async () => { inputPresses += 1; } };

  await assert.rejects(
    controller.pressMicroAction("act11-test", "ACT11"),
    (error: unknown) => error instanceof Error && error.message === "E_MAPPING_INACTIVE",
  );
  assert.equal(inputPresses, 0);
  assert.equal(bridgeDispatches, 0);
});

test("physical ACT LCD keeps the live Codex keycap binding after the action label is neutralized", async () => {
  const controller = new DeckController();
  const images: string[] = [];
  const action = {
    id: "act06-lcd-test",
    setImage: async (image: string) => { images.push(image); },
    setTitle: async () => undefined,
  };
  const internals = controller as unknown as {
    health: { state: "ready" };
    snapshot: { theme: "dark"; layout: MicroLayout };
    microActions: Map<string, { action: typeof action; slot: "ACT06" }>;
    renderMicroAction(registration: { action: typeof action; slot: "ACT06" }): Promise<void>;
  };
  internals.health = { state: "ready" };
  internals.snapshot = {
    theme: "dark",
    layout: layout({ slots: { ACT06: { keycapId: "APPR" } } }),
  };
  internals.microActions.set(action.id, { action, slot: "ACT06" });

  await internals.renderMicroAction({ action, slot: "ACT06" });
  const svg = decodeURIComponent(images.at(-1)!.slice(images.at(-1)!.indexOf(",") + 1));
  assert.match(svg, /data-keycap-id="APPR"/);
  assert.match(svg, />承認</u);
});

test("combined microphone LCD resolves ACT10 to the composite binding and keeps ACT11 visibly inactive", async () => {
  const controller = new DeckController();
  const images: string[] = [];
  const action = {
    id: "act10-combined-lcd-test",
    setImage: async (image: string) => { images.push(image); },
    setTitle: async () => undefined,
  };
  const internals = controller as unknown as {
    health: { state: "ready" };
    snapshot: { theme: "dark"; layout: MicroLayout };
    microActions: Map<string, { action: typeof action; slot: "ACT10" }>;
    renderMicroAction(registration: { action: typeof action; slot: "ACT10" | "ACT11" }): Promise<void>;
  };
  internals.health = { state: "ready" };
  internals.snapshot = {
    theme: "dark",
    layout: layout({ separateMicrophoneKeys: false, slots: { ACT10_ACT11: { keycapId: "MIC" } } }),
  };
  internals.microActions.set(action.id, { action, slot: "ACT10" });

  await internals.renderMicroAction({ action, slot: "ACT10" });
  const compositeSvg = decodeURIComponent(images.at(-1)!.slice(images.at(-1)!.indexOf(",") + 1));
  assert.match(compositeSvg, /data-keycap-id="MIC"/);
  assert.match(compositeSvg, />押して話す</u);

  await internals.renderMicroAction({ action, slot: "ACT11" });
  const inactiveSvg = decodeURIComponent(images.at(-1)!.slice(images.at(-1)!.indexOf(",") + 1));
  assert.match(inactiveSvg, /data-keycap-id="ACT11 無効"/);
});
