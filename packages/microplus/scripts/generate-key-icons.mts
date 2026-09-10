import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KEY_ICON_CATALOG } from '../src/key-icon-catalog.js';
import { ADDITIONAL_KEYCAPS } from '../src/keycaps.js';
const output = fileURLToPath(new URL('../static/imgs/', import.meta.url));
const assets = new Map<string, string>();
for (const key of ADDITIONAL_KEYCAPS) assets.set(`keycap-${key.slug}`, KEY_ICON_CATALOG[key.id].glyph);
for (const [asset, id] of Object.entries({ approve: 'APPR', decline: 'REJ', reject: 'REJ', dictation: 'MIC', fast: 'FAST', fork: 'SPLIT', 'new-task': 'NEW', 'reasoning-up': 'MIND+', 'reasoning-down': 'MIND-', send: 'CODEX' } as const)) assets.set(asset, KEY_ICON_CATALOG[id].glyph);
assets.set('back', '<path d="M15 4l-8 8 8 8"/>');
assets.set('forward', '<path d="M9 4l8 8-8 8"/>');
assets.set('sidebar', '<path d="M12 3v18M5 14l7 7 7-7"/>');
assets.set('reasoning', '<circle cx="12" cy="14" r="7"/><path d="M12 1v9M9 7l3 3 3-3"/>');
assets.set('plan', '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>');
assets.set('usage-limit', '<path d="M3 18V7M8 18v-7M13 18V4M18 18V9M2 21h20"/>');
assets.set('usage-overview', '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 4v6M14 14v6"/>');
assets.set('rate-limit-reset', '<path d="M4 8a9 9 0 1 1-1 8M4 2v6h6"/>');
let count = 0;
for (const [name, glyph] of assets) for (const scale of [1, 2]) {
 const path = `${output}action-${name}${scale === 2 ? '@2x' : ''}.svg`;
 if (!existsSync(path)) continue;
 const size = 28 * scale;
 writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28"><g transform="translate(2 2)" fill="none" stroke="#e8edf2" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>\n`);
 count++;
}
console.log(`Generated ${count} native action-list icons.`);
