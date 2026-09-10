import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverCommands,
  serializeInventory,
  type AsarReader,
} from '../packages/discovery/src/index.js';

function fixtureApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'codex-deck-discovery-'));
  const archive = join(root, 'Contents', 'Resources');
  // The extractor only hashes/stat-checks this file; the fake asar reader
  // below supplies its members without unpacking anything to disk.
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(archive, 'app.asar'), 'fixture-archive');
  return root;
}

function fakeReader(): { reader: AsarReader; calls: string[] } {
  const calls: string[] = [];
  const files: Record<string, Buffer> = {
    'webview/assets/app-initial-fixture.js': Buffer.from(
      'Q2i=[{id:`micro.foo`,titleIntlId:`codex.command.foo`,descriptionIntlId:`codex.commandDescription.foo`,availableIn:[`electron`],electron:{defaultKeybindings:[{key:`CmdOrCtrl+F`}],platformDefaultKeybindings:{macOS:[{key:`Command+F`}]}}}];J2i=[{id:`micro.bar`,electron:{menuTitle:`Bar`,defaultKeybindings:[{key:`Enter`}]}}];_xi=new Map([[`micro.bar`,h]])',
    ),
    'webview/assets/codex-micro-commands-fixture.js': Buffer.from(
      'import{n as e}from`app-initial-fixture.js`;var c=a.filter(e=>e.kind===`webview`&&n(e,`electron`)||e.kind===`electron-only`&&r(e.id));',
    ),
    'webview/assets/codex-micro-layout-fixture.js': Buffer.from(
      'var s,c=e((()=>{s=[{id:`FAST`,icon:`lightning-outline`,size:`single`,action:{type:`command`,command:`micro.foo`}},{id:`EMPT1`,icon:`empty`,size:`single`,action:{type:`custom-shortcut`}}]}));',
    ),
    'webview/assets/codex-micro-settings-fixture.js': Buffer.from(
      'function pi(e){switch(n.id){case`FAST`:{return q({defaultMessage:`Run foo`})}}}function mi(e){}',
    ),
  };
  return {
    reader: {
      listPackage: () => Object.keys(files),
      extractFile: (_archivePath, member) => {
        calls.push(member);
        const result = files[member.replace(/^\/+/, '')];
        if (!result) throw new Error(`missing fixture member ${member}`);
        return result;
      },
    },
    calls,
  };
}

function currentIdentifierReader(): AsarReader {
  const files: Record<string, Buffer> = {
    'webview/assets/app-initial-current.js': Buffer.from(
      'e7i=[{id:`micro.electron`,electron:{menuTitle:`Electron`}}];i7i=[{id:`micro.current`,titleIntlId:`codex.command.current`,availableIn:[`electron`]}]',
    ),
    'webview/assets/codex-micro-commands-current.js': Buffer.from('current-command-filter'),
    'webview/assets/codex-micro-layout-current.js': Buffer.from('var s=[]'),
    'webview/assets/codex-micro-settings-current.js': Buffer.from('function pi(){}function mi(){}'),
  };
  return {
    listPackage: () => Object.keys(files),
    extractFile: (_archivePath, member) => {
      const result = files[member.replace(/^\/+/, '')];
      if (!result) throw new Error(`missing fixture member ${member}`);
      return result;
    },
  };
}

test('discovery is data-only, provenance-bearing, and keeps executable symbols separate', () => {
  const app = fixtureApp();
  try {
    const { reader, calls } = fakeReader();
    const inventory = discoverCommands(app, { asar: reader, now: () => new Date('2026-09-07T09:00:00.000Z') });
    const foo = inventory.commands.find((entry) => entry.id === 'micro.foo');
    const bar = inventory.commands.find((entry) => entry.id === 'micro.bar');
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.discoveredAt, '2026-09-07T09:00:00.000Z');
    assert.equal(inventory.support.status, 'unverified');
    assert.equal(foo?.label, 'Run foo');
    assert.deepEqual(foo?.keybindings.electron, {
      default: ['CmdOrCtrl+F'],
      macOS: ['Command+F'],
    });
    assert.deepEqual(foo?.microKeycapIds, ['FAST']);
    assert.equal(foo?.bindingFeasibility.status, 'micro-keycap');
    assert.deepEqual(foo?.sources.map((source) => source.archivePath), [
      '/webview/assets/app-initial-fixture.js',
      '/webview/assets/codex-micro-layout-fixture.js',
      '/webview/assets/codex-micro-settings-fixture.js',
    ]);
    assert.equal(bar?.label, 'Bar');
    assert.deepEqual(inventory.executableRegistry.entries, [{
      commandId: 'micro.bar',
      handlerSymbol: 'h',
      handlerPresent: true,
      executableHere: false,
    }]);
    assert.equal(inventory.executableRegistry.executableHere, false);
    assert.equal(inventory.keycaps.find((entry) => entry.id === 'EMPT1')?.action.type, 'custom-shortcut');
    assert.equal(inventory.sources.length, 4);
    assert.equal(inventory.sources.every((source) => /^[0-9a-f]{64}$/.test(source.sha256)), true);
    assert.deepEqual(calls.sort(), [
      'webview/assets/app-initial-fixture.js',
      'webview/assets/codex-micro-commands-fixture.js',
      'webview/assets/codex-micro-layout-fixture.js',
      'webview/assets/codex-micro-settings-fixture.js',
    ]);
    assert.match(serializeInventory(inventory), /"executableRegistry":/);
    assert.equal(serializeInventory(inventory).endsWith('\n'), true);
    assert.equal(createHash('sha256').update('fixture-archive').digest('hex'), inventory.app.archiveSha256);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('discovery accepts the current explicit command-array identifiers without evaluating source', () => {
  const app = fixtureApp();
  try {
    const inventory = discoverCommands(app, { asar: currentIdentifierReader() });
    assert.equal(inventory.diagnostics.includes('Renderer command descriptor source was not found.'), false);
    assert.equal(inventory.commands.find((entry) => entry.id === 'micro.current')?.registryKind, 'webview');
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('current installed ChatGPT bundle exposes the observed Micro catalog', { skip: !existsSync('/Applications/ChatGPT.app/Contents/Resources/app.asar') }, () => {
  const inventory = discoverCommands('/Applications/ChatGPT.app');
  assert.equal(inventory.app.bundleIdentifier, 'com.openai.codex');
  assert.equal(inventory.app.bundleShortVersion, '26.903.61454');
  assert.equal(inventory.app.archiveBytes, 306575758);
  assert.equal(inventory.app.archiveSha256, 'ce970dc84795cb12ee33cc6f4c6b918affc2e15602b051fdb3af04913d5056f1');
  assert.equal(inventory.diagnostics.length, 0);
  assert.equal(inventory.support.status, 'unverified');
  assert.ok(inventory.commands.some((entry) => entry.id === 'composer.toggleFastMode'));
  assert.ok(inventory.commands.some((entry) => entry.id === 'approval.approve'));
  assert.ok(inventory.commands.some((entry) => entry.id === 'composer.submit'));
  assert.equal(inventory.commands.find((entry) => entry.id === 'newTask')?.label, 'New chat');
  assert.equal(inventory.commands.filter((entry) => entry.id.startsWith('focusTab')).length, 9);
  assert.equal(inventory.commands.some((entry) => entry.id.includes('${')), false);
  assert.deepEqual(inventory.keycaps.find((entry) => entry.id === 'FAST')?.action, {
    type: 'command',
    commandId: 'composer.toggleFastMode',
  });
  assert.equal(inventory.keycaps.find((entry) => entry.id === 'FAST')?.label, 'Toggle Fast mode');
  assert.equal(inventory.commands.find((entry) => entry.id === 'approval.approve')?.keybindings.electron?.default?.[0], 'Enter');
  assert.equal(inventory.executableRegistry.executableHere, false);
  assert.ok(inventory.sources.some((source) => source.archivePath.includes('app-initial-')));
  assert.ok(inventory.sources.some((source) => source.archivePath.includes('codex-micro-commands-')));
  assert.ok(inventory.sources.some((source) => source.archivePath.includes('codex-micro-layout-')));
  assert.ok(inventory.sources.some((source) => source.archivePath.includes('codex-micro-settings-')));
});
