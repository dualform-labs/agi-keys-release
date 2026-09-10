import assert from "node:assert/strict";
import test from "node:test";
import { DeckController } from "../src/controller.js";

type ResetHarness = {
  resetHolds: Map<string, number>;
  resetRequestIds: Map<string, string>;
  rateLimitResetActions: Map<string, unknown>;
  snapshot: { usage: { observedAt?: number; resetCreditsAvailable: number; resetCreditsApplicable: number } };
  microBridge: { consumeRateLimitReset(requestId: string): Promise<{ code: "reset" | "already_redeemed"; refresh: "updated" | "failed" | "unavailable" }> };
  refreshInFlight?: Promise<void>;
  prepareAction(actionId: string): Promise<void>;
  refresh(): Promise<void>;
};

const heldAction = { id: "reset-placement" };

test("confirmed reset remains successful when the follow-up refresh fails", async () => {
  const refreshFailure = Promise.reject<void>(new Error("render failed after confirmed consume"));
  void refreshFailure.catch(() => undefined);
  const harness: ResetHarness = {
    prepareAction: async (id) => { assert.equal(id, heldAction.id); },
    refresh: async function () { await this.refreshInFlight; },
    resetHolds: new Map([[heldAction.id, Date.now() - 2_000]]),
    resetRequestIds: new Map(),
    rateLimitResetActions: new Map(),
    snapshot: { usage: { resetCreditsAvailable: 1, resetCreditsApplicable: 1 } },
    microBridge: { consumeRateLimitReset: async () => ({ code: "reset", refresh: "failed" }) },
    refreshInFlight: refreshFailure,
  };

  Object.setPrototypeOf(harness, new DeckController());
  const result = await DeckController.prototype.finishRateLimitReset.call(harness as unknown as DeckController, heldAction);
  assert.equal(result, true);
});

test("an uncertain reset retry reuses its request id", async () => {
  const requestIds: string[] = [];
  let attempt = 0;
  const harness: ResetHarness = {
    prepareAction: async (id) => { assert.equal(id, heldAction.id); },
    refresh: async function () { await this.refreshInFlight; },
    resetHolds: new Map([[heldAction.id, Date.now() - 2_000]]),
    resetRequestIds: new Map(),
    rateLimitResetActions: new Map(),
    snapshot: { usage: { resetCreditsAvailable: 1, resetCreditsApplicable: 1 } },
    microBridge: {
      consumeRateLimitReset: async (requestId) => {
        requestIds.push(requestId);
        attempt += 1;
        if (attempt === 1) throw new Error("uncertain transport result");
        return { code: "already_redeemed", refresh: "updated" };
      },
    },
    refreshInFlight: Promise.resolve(),
  };

  Object.setPrototypeOf(harness, new DeckController());
  await assert.rejects(DeckController.prototype.finishRateLimitReset.call(harness as unknown as DeckController, heldAction));
  harness.resetHolds.set(heldAction.id, Date.now() - 2_000);
  assert.equal(await DeckController.prototype.finishRateLimitReset.call(harness as unknown as DeckController, heldAction), true);
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1]);
});

test("an unknown or stale cached credit count still reaches the bridge authoritative reset query", async () => {
  let consumeCalls = 0;
  const harness: ResetHarness = {
    prepareAction: async (id) => { assert.equal(id, heldAction.id); },
    refresh: async function () { await this.refreshInFlight; },
    resetHolds: new Map([[heldAction.id, Date.now() - 2_000]]),
    resetRequestIds: new Map(),
    rateLimitResetActions: new Map(),
    snapshot: { usage: { resetCreditsAvailable: 0, resetCreditsApplicable: 0 } },
    microBridge: {
      consumeRateLimitReset: async () => {
        consumeCalls += 1;
        return { code: "reset", refresh: "updated" };
      },
    },
    refreshInFlight: Promise.resolve(),
  };

  Object.setPrototypeOf(harness, new DeckController());
  assert.equal(await DeckController.prototype.finishRateLimitReset.call(harness as unknown as DeckController, heldAction), true);
  harness.snapshot.usage.observedAt = Date.now() - 10 * 60 * 1000;
  harness.resetHolds.set(heldAction.id, Date.now() - 2_000);
  assert.equal(await DeckController.prototype.finishRateLimitReset.call(harness as unknown as DeckController, heldAction), true);
  assert.equal(consumeCalls, 2);
});
