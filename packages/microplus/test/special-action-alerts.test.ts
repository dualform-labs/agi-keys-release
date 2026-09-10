import assert from "node:assert/strict";
import test from "node:test";
import { SideToMainAction } from "../src/side-to-main-action.js";
import { ContextCompactionAction } from "../src/context-compaction-action.js";

for (const [name, ActionClass, method] of [
  ["side draft", SideToMainAction, "moveSideDraftToMain"],
  ["context compaction", ContextCompactionAction, "pressContextCompaction"],
] as const) {
  test(`${name} ignores an older failed invocation after a newer success`, async () => {
    let rejectOld!: (error: Error) => void;
    const old = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    let calls = 0;
    let alerts = 0;
    const controller = {
      isCurrentAction: () => true,
      [method]: () => ++calls === 1 ? old : Promise.resolve(),
    };
    const runtime = new ActionClass(controller as any);
    const event = { action: { id: name, showAlert: async () => { alerts += 1; } } } as any;
    const first = runtime.onKeyDown(event);
    await runtime.onKeyDown(event);
    rejectOld(new Error("E_OPERATION_UNOBSERVED"));
    await first;
    assert.equal(calls, 2);
    assert.equal(alerts, 0);
  });
}

test("context compaction's own key-up does not hide its current invocation failure", async () => {
  let rejectPress!: (error: Error) => void;
  const press = new Promise<void>((_resolve, reject) => { rejectPress = reject; });
  let alerts = 0;
  const controller = {
    isCurrentAction: () => true,
    pressContextCompaction: () => press,
    releaseConfiguredDisplayAction: () => undefined,
  };
  const runtime = new ContextCompactionAction(controller as any);
  const event = { action: { id: "context-current", showAlert: async () => { alerts += 1; } } } as any;
  const pending = runtime.onKeyDown(event);
  await runtime.onKeyUp(event);
  rejectPress(new Error("E_CONTEXT_COMPACTION_UNAVAILABLE"));
  await pending;
  assert.equal(alerts, 1);
});
