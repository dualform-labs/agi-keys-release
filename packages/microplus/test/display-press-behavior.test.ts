import assert from "node:assert/strict";
import test from "node:test";
import type { KeyDownEvent } from "@elgato/streamdeck";
import { UsageLimit, UsageOverview } from "../src/actions.js";
import { DeckController } from "../src/controller.js";
import type { MicroSnapshot, MutationConfirmation } from "../src/types.js";

type DisplayAction = UsageLimit | UsageOverview;

type ControllerHarness = {
  microBridge: {
    refresh(): Promise<MicroSnapshot>;
    runKeycap(keycapId: string): Promise<MutationConfirmation>;
    rotateModelPicker(direction: "increase" | "decrease"): Promise<MutationConfirmation>;
    adjustReasoning(direction: "increase" | "decrease"): Promise<MutationConfirmation>;
  };
  focusApplication(): Promise<void>;
};

function snapshot(): MicroSnapshot {
  return {
    slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: null, title: null, status: "off", selected: false })),
    activeComposerKey: "composer-display-test",
    layout: { version: 1, slots: {}, analogStick: { up: {}, right: {}, down: {}, left: {} } },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping-display-test",
    targetIdentity: "target-display-test",
  };
}

function fixture(): {
  controller: DeckController;
  calls: string[];
  actionEvent(id: string): { event: KeyDownEvent; alerts: () => number };
} {
  const controller = new DeckController();
  const calls: string[] = [];
  const current = snapshot();
  const confirmation: MutationConfirmation = {
    dispatch: "accepted",
    metadata: "matched",
    semanticOutcome: "unverified",
  };
  const harness = controller as unknown as ControllerHarness;
  harness.microBridge = {
    refresh: async () => { calls.push("refresh"); return current; },
    runKeycap: async (keycapId) => { calls.push(`command:${keycapId}`); return confirmation; },
    rotateModelPicker: async (direction) => { calls.push(`model:${direction}`); return confirmation; },
    adjustReasoning: async (direction) => { calls.push(`reasoning:${direction}`); return confirmation; },
  };
  harness.focusApplication = async () => { calls.push("focus"); };
  return {
    controller,
    calls,
    actionEvent: (id) => {
      let alertCount = 0;
      return {
        event: {
          action: {
            id,
            showAlert: async () => { alertCount += 1; },
          },
        } as unknown as KeyDownEvent,
        alerts: () => alertCount,
      };
    },
  };
}

function displayActions(controller: DeckController): [DisplayAction, DisplayAction] {
  return [new UsageLimit(controller), new UsageOverview(controller)];
}

test("display-only keys default to their existing preparation behavior without a mutation", async () => {
  const { controller, calls, actionEvent } = fixture();
  const [usageLimit, usageOverview] = displayActions(controller);

  await usageLimit.onKeyDown(actionEvent("usage-default").event);
  controller.setActionPreferences("usage-focused-default", { focusBeforeAction: true });
  await usageOverview.onKeyDown(actionEvent("usage-focused-default").event);

  assert.deepEqual(calls, ["focus"]);
});

test("refresh behavior refreshes real bridge state after the normal preparation guard", async () => {
  const { controller, calls, actionEvent } = fixture();
  const action = new UsageLimit(controller);
  controller.setActionPreferences("usage-refresh", { pressBehavior: "refresh", focusBeforeAction: true });

  await action.onKeyDown(actionEvent("usage-refresh").event);

  assert.deepEqual(calls, ["focus", "refresh"]);
});

test("focus behavior invokes the focus boundary without issuing a bridge mutation", async () => {
  const { controller, calls, actionEvent } = fixture();
  const action = new UsageOverview(controller);
  controller.setActionPreferences("usage-focus", { pressBehavior: "focus" });

  await action.onKeyDown(actionEvent("usage-focus").event);

  assert.deepEqual(calls, ["focus"]);
});

test("both display-only usage actions can invoke a validated native command", async () => {
  const { controller, calls, actionEvent } = fixture();
  const [usageLimit, usageOverview] = displayActions(controller);
  controller.setActionPreferences("usage-limit-command", { pressBehavior: "command", pressCommand: "TERM" });
  controller.setActionPreferences("usage-overview-command", { pressBehavior: "command", pressCommand: "CODEX" });

  await usageLimit.onKeyDown(actionEvent("usage-limit-command").event);
  await usageOverview.onKeyDown(actionEvent("usage-overview-command").event);

  assert.deepEqual(calls, ["command:TERM", "command:CODEX"]);
});

test("model display press behaviors use logical picker direction independent of dial reversal", async () => {
  const { controller, calls, actionEvent } = fixture();
  const [usageLimit, usageOverview] = displayActions(controller);
  controller.setActionPreferences("model-next", {
    pressBehavior: "model-next",
    focusBeforeAction: true,
    reverseDial: true,
  });
  controller.setActionPreferences("model-previous", {
    pressBehavior: "model-previous",
    focusBeforeAction: true,
  });

  await usageLimit.onKeyDown(actionEvent("model-next").event);
  await usageOverview.onKeyDown(actionEvent("model-previous").event);

  assert.deepEqual(calls, ["focus", "model:increase", "focus", "model:decrease"]);
});

test("reasoning display press behaviors preserve preparation and native adjustment direction", async () => {
  const { controller, calls, actionEvent } = fixture();
  const [usageLimit, usageOverview] = displayActions(controller);
  controller.setActionPreferences("reasoning-increase", {
    pressBehavior: "reasoning-increase",
    focusBeforeAction: true,
  });
  controller.setActionPreferences("reasoning-decrease", { pressBehavior: "reasoning-decrease" });

  await usageLimit.onKeyDown(actionEvent("reasoning-increase").event);
  await usageOverview.onKeyDown(actionEvent("reasoning-decrease").event);

  assert.deepEqual(calls, ["focus", "reasoning:increase", "reasoning:decrease"]);
});

test("arbitrary strings, placeholders, and hold-to-talk keycaps cannot reach the native command bridge", async () => {
  for (const pressCommand of ["https://example.invalid", "rm -rf /", "EMPT1", "MIC", "MIC1"]) {
    const { controller, calls, actionEvent } = fixture();
    const action = new UsageLimit(controller);
    const key = actionEvent(`usage-invalid-${pressCommand}`);
    controller.setActionPreferences(key.event.action.id, { pressBehavior: "command", pressCommand });

    await action.onKeyDown(key.event);

    assert.deepEqual(calls, [], `${pressCommand} reached an external boundary`);
    assert.equal(key.alerts(), 1, `${pressCommand} did not surface a safe failure`);
  }
});
