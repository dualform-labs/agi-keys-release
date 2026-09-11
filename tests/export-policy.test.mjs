import assert from 'node:assert/strict';
import test from 'node:test';
import { excludeFromSourceExport } from '../scripts/export-policy.mjs';

test('local histories, task fixtures, and machine evidence are excluded', () => {
  for (const path of ['HANDOFF.md', 'DESIGN.md', 'TRASH/retired.json',
    'docs/evidence/desktop-fixture.json', 'docs/verification/run/test.log',
    'specs/codex-deck-plus/00_overview.md', 'packages/desktop/verify-fixture.ts',
    'packages/desktop/fixture-settings-evidence.json', 'docs/private-github.md',
    'docs/refactoring-20260909.md', 'scripts/publish-private.mjs',
    'Restore AGI Keys Connection.command', 'packages/desktop/NORMAL-START.md',
    'packages/desktop/EXPLICIT-INPUT-CONTRACT.md', 'packages/desktop/FOLLOWER-CONTRACT.md',
    'packages/desktop/README.md']) {
    assert.equal(excludeFromSourceExport(path), true, path);
  }
});

test('product sources, tests, and licenses remain exportable', () => {
  for (const path of ['LICENSE', 'NOTICE', 'README.md', 'package.json',
    'packages/microplus/src/global-dictation.ts', 'packages/desktop/fixture-observer.ts',
    'packages/microplus/test/global-dictation.test.ts', 'tests/desktop.test.ts',
    'scripts/export-policy.mjs']) {
    assert.equal(excludeFromSourceExport(path), false, path);
  }
});
