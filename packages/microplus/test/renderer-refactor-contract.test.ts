import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as bridgeExports from '../src/codex-micro-renderer-bridge.js';

test('module refactor preserves public imports and exact emitted renderer program', async () => {
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/renderer-refactor-baseline.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(bridgeExports).sort(), baseline.exports);
  const bridge = new bridgeExports.CodexMicroRendererBridge(() => undefined) as any;
  let expression = '';
  bridge.socket = { readyState: 1 };
  bridge.targetIdentity = 'mock-target';
  bridge.ensureObservationTarget = async () => undefined;
  bridge.evaluate = async (value: string) => {
    expression = value;
    return { slots: [], layout: { version: 1, slots: {}, analogStick: { up: null, right: null, down: null, left: null } }, agentSource: 'recent', lightingAutoOff: 'never', theme: 'dark', connectionEpoch: 0, pageEpoch: 0, mappingFingerprint: '', targetIdentity: '' };
  };
  bridge.sessionOwnership = { annotate: async (snapshot: unknown) => snapshot, getActiveThreadContextUsage: () => undefined };
  await bridge.refresh();
  assert.ok(expression);
  assert.equal(Buffer.byteLength(expression), baseline.expressionBytes);
  assert.equal(createHash('sha256').update(expression).digest('hex'), baseline.expressionSha256);
});
