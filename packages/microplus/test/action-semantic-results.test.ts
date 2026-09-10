import assert from "node:assert/strict";
import test from "node:test";
import { DeckController } from "../src/controller.js";
import type { MutationConfirmation } from "../src/types.js";

const confirmed: MutationConfirmation = {
  dispatch: "accepted",
  metadata: "matched",
  semanticOutcome: "confirmed",
};

function newTaskHarness(result: MutationConfirmation): {
  controller: DeckController;
  requested: string[];
} {
  const controller = new DeckController();
  const requested: string[] = [];
  const internals = controller as unknown as {
    prepareAction(): Promise<void>;
    microBridge: { runKeycap(id: string): Promise<MutationConfirmation> };
  };
  internals.prepareAction = async () => undefined;
  internals.microBridge.runKeycap = async (id) => {
    requested.push(id);
    return result;
  };
  return { controller, requested };
}

test("semantic New Task uses the native NEW postcondition", async () => {
  const { controller, requested } = newTaskHarness(confirmed);

  await controller.createTask("new-task-action");

  assert.deepEqual(requested, ["NEW"]);
});

test("semantic New Task rejects a dispatch without an observed transition", async () => {
  const { controller } = newTaskHarness({ ...confirmed, semanticOutcome: "unverified" });

  await assert.rejects(() => controller.createTask("new-task-action"), /E_RESULT_UNVERIFIED/);
});
