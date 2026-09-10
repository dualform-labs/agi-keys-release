import assert from "node:assert/strict";
import test from "node:test";
import { InputCoordinator } from "../src/input-coordination.js";

test("a rejected down rolls back ownership for the same and competing owners", async () => {
  const coordinator = new InputCoordinator();
  await assert.rejects(
    coordinator.press("failed-owner", "microphone", async () => { throw new Error("down failed"); }, async () => undefined),
    /down failed/u,
  );

  const calls: string[] = [];
  await coordinator.press("next-owner", "microphone", async () => { calls.push("down"); }, async () => { calls.push("up"); });
  await coordinator.release("next-owner");
  await coordinator.press("failed-owner", "microphone", async () => { calls.push("down-again"); }, async () => { calls.push("up-again"); });
  await coordinator.release("failed-owner");

  assert.deepEqual(calls, ["down", "up", "down-again", "up-again"]);
});

test("release is ordered after its owner's pending down", async () => {
  const coordinator = new InputCoordinator();
  const calls: string[] = [];
  let finishDown!: () => void;
  const downGate = new Promise<void>((resolve) => { finishDown = resolve; });

  const down = coordinator.press("placement-a", "ACT10", async () => {
    calls.push("down:start");
    await downGate;
    calls.push("down:end");
  }, async () => { calls.push("up"); });
  const up = coordinator.release("placement-a");

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["down:start"]);
  finishDown();
  await Promise.all([down, up]);
  assert.deepEqual(calls, ["down:start", "down:end", "up"]);
});

test("a physical resource has one owner and a rejected contender cannot release it", async () => {
  const coordinator = new InputCoordinator();
  const calls: string[] = [];
  await coordinator.press("physical", "ACT10", async () => { calls.push("physical:down"); }, async () => { calls.push("physical:up"); });

  await assert.rejects(
    coordinator.press("semantic", "ACT10", async () => { calls.push("semantic:down"); }, async () => { calls.push("semantic:up"); }),
    /E_INPUT_OWNED/
  );
  await coordinator.release("semantic");
  assert.deepEqual(calls, ["physical:down"]);
  await coordinator.release("physical");
  assert.deepEqual(calls, ["physical:down", "physical:up"]);
});

test("failed down is released once immediately and a later key-up is harmless", async () => {
  const coordinator = new InputCoordinator();
  let releases = 0;
  const reasons: string[] = [];
  await assert.rejects(coordinator.press("owner", "ACT10", async () => {
    throw new Error("observer timeout after dispatch");
  }, async (reason) => { releases += 1; reasons.push(reason); }));

  assert.equal(releases, 1);
  assert.deepEqual(reasons, ["rollback"]);
  await coordinator.release("owner");
  await coordinator.release("owner");
  assert.equal(releases, 1);
});

test("failed rollback retains ownership so key-up can retry the release", async () => {
  const coordinator = new InputCoordinator();
  let releases = 0;
  await assert.rejects(coordinator.press("owner", "ACT10", async () => {
    throw new Error("down observer failed");
  }, async (reason) => {
    releases += 1;
    assert.equal(reason, releases === 1 ? "rollback" : "key-up");
    if (releases === 1) throw new Error("release observer failed");
  }), /E_RELEASE_UNVERIFIED/u);

  await assert.rejects(
    coordinator.press("other", "ACT10", async () => undefined, async () => undefined),
    /E_INPUT_OWNED/u,
  );
  await coordinator.release("owner");
  assert.equal(releases, 2);
});

test("rapid double-tap queues both complete down/up generations", async () => {
  const coordinator = new InputCoordinator();
  const calls: string[] = [];
  const press = () => coordinator.press("placement", "ACT06",
    async () => { calls.push("down"); }, async () => { calls.push("up"); });

  const events = [press(), coordinator.release("placement"), press(), coordinator.release("placement")];
  await Promise.all(events);
  assert.deepEqual(calls, ["down", "up", "down", "up"]);
});

test("shutdown release waits behind pending downs and releases every owner", async () => {
  const coordinator = new InputCoordinator();
  const calls: string[] = [];
  let finishDown!: () => void;
  const gate = new Promise<void>((resolve) => { finishDown = resolve; });
  const down = coordinator.press("ptt", "microphone", async () => {
    calls.push("down");
    await gate;
  }, async () => { calls.push("up"); });
  const shutdown = coordinator.releaseAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["down"]);
  finishDown();
  await Promise.all([down, shutdown]);
  assert.deepEqual(calls, ["down", "up"]);
});


test("failed key-up retains resource until a successful retry", async () => {
  const coordinator = new InputCoordinator();
  let releases = 0;
  let competingDowns = 0;
  await coordinator.press("owner", "ACT10", async () => "accepted", async () => {
    if (++releases === 1) throw new Error("up uncertain");
  });
  await assert.rejects(coordinator.release("owner"), /up uncertain/);
  await assert.rejects(coordinator.press("other", "ACT10", async () => { competingDowns++; }, async () => undefined), /E_INPUT_OWNED/);
  assert.equal(competingDowns, 0);
  assert.equal(await coordinator.release("owner"), "accepted");
  await coordinator.press("other", "ACT10", async () => { competingDowns++; }, async () => undefined);
  await coordinator.releaseAll();
  assert.equal(releases, 2);
  assert.equal(competingDowns, 1);
});
