import assert from "node:assert/strict";
import test from "node:test";
import { DeckController } from "../src/controller.js";

type AgentDispatch = {
  slot: number;
  act: 0 | 1;
  expectedThreadKey?: string;
  unopenedTaskBehavior?: string;
};

function configureController(controller: DeckController, dispatches: AgentDispatch[]): void {
  Object.assign(controller as unknown as {
    snapshot: { slots: Array<{ threadKey: string | null }> };
    microBridge: {
      sendAgent: (slot: number, act: 0 | 1, expectedThreadKey?: string, unopenedTaskBehavior?: string) => Promise<void>;
      refresh: () => Promise<void>;
    };
  }, {
    snapshot: { slots: [{ threadKey: "thread-a" }] },
    microBridge: {
      sendAgent: async (
        slot: number,
        act: 0 | 1,
        expectedThreadKey?: string,
        unopenedTaskBehavior?: string,
      ) => {
        const dispatch: AgentDispatch = { slot, act };
        if (expectedThreadKey !== undefined) dispatch.expectedThreadKey = expectedThreadKey;
        if (unopenedTaskBehavior !== undefined) dispatch.unopenedTaskBehavior = unopenedTaskBehavior;
        dispatches.push(dispatch);
      },
      refresh: async () => undefined,
    },
  });
}

test("pressAgent forwards the exact normalized per-key unopened-task behavior for down and release", async () => {
  const controller = new DeckController();
  const dispatches: AgentDispatch[] = [];
  configureController(controller, dispatches);
  controller.setActionPreferences("agent-new-window", { unopenedTaskBehavior: "new-window" });

  await controller.pressAgent("agent-new-window", 0, "thread-a");
  await controller.releaseInput("agent-new-window");

  assert.deepEqual(dispatches, [
    { slot: 0, act: 1, expectedThreadKey: "thread-a", unopenedTaskBehavior: "new-window" },
    { slot: 0, act: 0, expectedThreadKey: "thread-a", unopenedTaskBehavior: "new-window" },
  ]);
});

test("pressAgent defaults invalid and missing unopened-task behavior to the current window", async () => {
  const controller = new DeckController();
  const dispatches: AgentDispatch[] = [];
  configureController(controller, dispatches);
  controller.setActionPreferences("agent-invalid", { unopenedTaskBehavior: "not-a-route" });

  await controller.pressAgent("agent-invalid", 0, "thread-a");
  await controller.releaseInput("agent-invalid");

  assert.deepEqual(dispatches.map(({ unopenedTaskBehavior }) => unopenedTaskBehavior), [
    "current-window",
    "current-window",
  ]);
});
