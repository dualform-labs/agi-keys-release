import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
if (!process.argv[2]) throw new Error('Pass the baseline render.ts module path.');
const before = await import(pathToFileURL(resolve(process.argv[2])).href);
import * as after from '../packages/microplus/src/render.js';
import { OFFICIAL_KEYCAP_IDS } from '../packages/microplus/src/keycaps.js';
let count = 0;
const equal = (a: unknown, b: unknown) => { assert.deepEqual(a, b); count++; };
for (const theme of ['dark', 'light'] as const) {
  for (const language of ['ja', 'en', undefined] as const) {
    for (const id of [...OFFICIAL_KEYCAP_IDS, 'UNKNOWN', 'MIC-custom', 'ACT11 無効']) {
      const a = before.renderCatalogKeycap(id, theme, language) ?? before.renderFallbackKeycap(id, theme, language);
      const b = after.renderCatalogKeycap(id, theme, language) ?? after.renderFallbackKeycap(id, theme, language);
      equal(a, b);
      for (const phase of ['press', 'release'] as const) for (const age of [0, 33, 70, 90, 160, 319, 320, NaN]) {
        equal(before.renderKeyContact(a, phase, age, theme), after.renderKeyContact(b, phase, age, theme));
      }
      for (const phase of ['pending', 'held', 'error', 'sent-unverified'] as const) {
        equal(before.renderActionFeedback(a, {phase}, theme, language, 2.5), after.renderActionFeedback(b, {phase}, theme, language, 2.5));
      }
    }
    for (const kind of ['model', 'reasoning', 'usage', 'commands', 'navigation'] as const) {
      for (const state of ['ready', 'pending', 'offline', 'error'] as const) for (const age of [0, 70, 180, 360]) {
        const input = {kind, state, theme, language, observedValue:'GPT-5.6', interactionAgeMs:age, animationFrame:2};
        equal(before.renderPlusDialFeedback(input), after.renderPlusDialFeedback(input));
        equal(before.renderDialSurface(kind, state, theme, age, -1), after.renderDialSurface(kind, state, theme, age, -1));
      }
    }
  }
}
console.log(`Byte-identical renderer comparisons: ${count}`);
