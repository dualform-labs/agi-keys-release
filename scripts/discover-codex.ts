import {mkdir,writeFile} from 'node:fs/promises';
import {discoverCommands,serializeInventory} from '../packages/discovery/src/index.js';
const inventory=discoverCommands('/Applications/ChatGPT.app');
await mkdir('docs/evidence',{recursive:true});
await writeFile('docs/evidence/codex-command-inventory.json',serializeInventory(inventory));
console.log(JSON.stringify({commands:inventory.commands.length,keycaps:inventory.keycaps.length,executableRegistry:inventory.executableRegistry,diagnostics:inventory.diagnostics},null,2));
