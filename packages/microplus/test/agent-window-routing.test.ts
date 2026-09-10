import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentWindowCreationGuard,
  assertCompleteAgentWindowObservations,
  assertAgentSourceUnchanged,
  localAgentWindowPath,
  selectAgentWindowFromCompleteScan,
  selectExistingAgentWindow,
} from "../src/agent-window-routing.js";

test("existing exact task window wins independently of unopened-task behavior", () => {
  const result = selectExistingAgentWindow([
    { targetKey: "source", activeThreadKey: "local:source", focusedVisible: true },
    { targetKey: "destination", activeThreadKey: "local:task-a", focusedVisible: false },
  ], "local:task-a", "source");
  assert.deepEqual(result, { kind: "existing", targetKey: "destination" });
});

test("duplicate task windows require one focused or previously known target", () => {
  const duplicates = [
    { targetKey: "window-a", activeThreadKey: "local:task-a", focusedVisible: false },
    { targetKey: "window-b", activeThreadKey: "local:task-a", focusedVisible: false },
  ];
  assert.deepEqual(selectExistingAgentWindow(duplicates, "local:task-a", "window-b"), {
    kind: "existing",
    targetKey: "window-b",
  });
  assert.throws(() => selectExistingAgentWindow(duplicates, "local:task-a"), /E_AGENT_WINDOW_AMBIGUOUS/);
  assert.deepEqual(selectExistingAgentWindow([
    { ...duplicates[0]!, focusedVisible: true },
    duplicates[1]!,
  ], "local:task-a"), { kind: "existing", targetKey: "window-a" });
});

test("unopened task is reported without selecting an unrelated window", () => {
  assert.deepEqual(selectExistingAgentWindow([
    { targetKey: "source", activeThreadKey: "local:other", focusedVisible: true },
  ], "local:task-a", "source"), { kind: "unopened" });
});

test("new-window route accepts only the installed local key shape", () => {
  assert.equal(localAgentWindowPath("local:019-task-a"), "/local/019-task-a");
  assert.equal(localAgentWindowPath("local:a/b"), null);
  assert.equal(localAgentWindowPath("local:host-a:019-task-a"), null);
  assert.equal(localAgentWindowPath("remote:019-task-a"), null);
  assert.equal(localAgentWindowPath("cloud:019-task-a"), null);
});

test("uncertain native creation blocks duplicates until an enumerated window confirms it", () => {
  const guard = new AgentWindowCreationGuard();
  guard.begin("local:task-a");
  assert.throws(() => guard.begin("local:task-a"), /E_AGENT_WINDOW_CREATION_UNCERTAIN/);
  guard.confirm("local:task-a");
  assert.doesNotThrow(() => guard.begin("local:task-a"));
});

test("source preservation requires a known source and exact unchanged identity", () => {
  assert.doesNotThrow(() => assertAgentSourceUnchanged("local:source", "local:source"));
  assert.throws(() => assertAgentSourceUnchanged(null, null), /E_AGENT_SOURCE_UNVERIFIED/);
  assert.throws(() => assertAgentSourceUnchanged("local:source", "local:task-a"), /E_AGENT_SOURCE_CHANGED/);
  assert.doesNotThrow(() => assertAgentSourceUnchanged(null, null, "composer-a", "composer-a"));
  assert.throws(
    () => assertAgentSourceUnchanged(null, null, "composer-a", "composer-b"),
    /E_AGENT_SOURCE_UNVERIFIED/,
  );
});

test("a partial renderer scan cannot classify the task as unopened", () => {
  assert.doesNotThrow(() => assertCompleteAgentWindowObservations(2, 2));
  assert.throws(() => assertCompleteAgentWindowObservations(2, 1), /E_AGENT_WINDOW_UNVERIFIED/);
  assert.throws(() => assertCompleteAgentWindowObservations(0, 0), /E_AGENT_WINDOW_UNVERIFIED/);
});

test("partial scan failure occurs before an unopened-task action can run", () => {
  let actionCount = 0;
  assert.throws(() => {
    const selection = selectAgentWindowFromCompleteScan(2, [
      { targetKey: "source", activeThreadKey: "local:source", focusedVisible: true },
    ], "local:task-a", "source");
    if (selection.kind === "unopened") actionCount += 1;
  }, /E_AGENT_WINDOW_UNVERIFIED/);
  assert.equal(actionCount, 0);
});

test("an exact existing window can be selected despite an unrelated unobserved renderer", () => {
  assert.deepEqual(selectAgentWindowFromCompleteScan(3, [
    { targetKey: "source", activeThreadKey: "local:source", focusedVisible: true },
    { targetKey: "destination", activeThreadKey: "local:task-a", focusedVisible: false },
  ], "local:task-a", "source"), {
    kind: "existing",
    targetKey: "destination",
  });
});
