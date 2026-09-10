import assert from "node:assert/strict";
import test from "node:test";
import { readFocusedModelCandidate } from "../src/codex-micro-renderer-bridge.js";

test("candidate comes only from the focused enabled row inside the advanced model view", () => {
  let enabled = true;
  const row = { matches: () => enabled, getAttribute: () => "  Model   B  ", textContent: "Model B description" } as unknown as Element;
  const picker = { querySelector: (selector: string) => selector === '[data-model-picker-view="advanced"]'
    ? { contains: (value: unknown) => value === row } : null } as unknown as Element;
  assert.equal(readFocusedModelCandidate(picker, row), "Model B");
  assert.equal(readFocusedModelCandidate(picker, {} as Element), null);
  enabled = false;
  assert.equal(readFocusedModelCandidate(picker, row), null);
  assert.equal(readFocusedModelCandidate(null, row), null);
  assert.equal(readFocusedModelCandidate(picker, null), null);
});

test("empty candidate is unknown rather than the currently selected model", () => {
  const row = { matches: () => true, getAttribute: () => null, textContent: " " } as unknown as Element;
  const picker = { querySelector: () => ({ contains: () => true }) } as unknown as Element;
  assert.equal(readFocusedModelCandidate(picker, row), null);
});
