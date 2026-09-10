import assert from "node:assert/strict";
import test from "node:test";
import { KEY_ICON_CATALOG } from "../src/key-icon-catalog.js";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";
import { renderCatalogKeycap, renderActionFeedback } from "../src/render.js";
const decode = (s: string) => decodeURIComponent(s.slice(s.indexOf(',') + 1));
test("voice keys change into a readable animated waveform only during activity", () => {
  for (const id of ["MIC", "MIC1"]) {
    const base = renderCatalogKeycap(id)!;
    assert.doesNotMatch(decode(base), /voice-wave/);
    const frames = [0, 3].map(frame => decode(renderActionFeedback(base, { phase: "held" }, "dark", "ja", frame)));
    for (const svg of frames) {
      assert.match(svg, /data-motion-kind="voice-wave"/);
      assert.doesNotMatch(svg, /hold-ring/);
      assert.doesNotMatch(svg, /M58 108h28/);
      assert.match(svg, /M58 94h28/);
      assert.equal((svg.match(/stroke-linecap="round"><path d="M3 /g) ?? []).length, 1);
    }
    assert.notEqual(frames[0], frames[1]);
    assert.doesNotMatch(decode(renderActionFeedback(base, { phase: "error" }, "dark", "ja", 0)), /voice-wave/);
  }
});
test("every native key ID has an original bilingual glyph in both themes", () => {
  assert.deepEqual(Object.keys(KEY_ICON_CATALOG).sort(), [...OFFICIAL_KEYCAP_IDS].sort());
  for (const id of OFFICIAL_KEYCAP_IDS) for (const theme of ["dark", "light"] as const) for (const language of ["ja", "en"] as const) {
    const image = renderCatalogKeycap(id, theme, language)!;
    const svg = decode(image);
    assert.match(svg, /data-icon-source="microplus-original-catalog"/);
    assert.ok(svg.includes(KEY_ICON_CATALOG[id][language]));
    assert.match(svg, /<(path|circle|rect) /);
    assert.notEqual(renderActionFeedback(image, { phase: "pending" }, theme, language, 0), renderActionFeedback(image, { phase: "pending" }, theme, language, 1));
  }
  assert.equal(renderCatalogKeycap("unrecognized"), undefined);
});
test("copy, archive, pin and draft PR describe their actual native operation", () => {
  assert.equal(KEY_ICON_CATALOG.DWN.en, "COPY MD");
  assert.equal(KEY_ICON_CATALOG.DEL.en, "ARCHIVE");
  assert.equal(KEY_ICON_CATALOG.MAGIC.en, "PIN");
  assert.equal(KEY_ICON_CATALOG.BRCH.en, "DRAFT PR");
});

test("catalog glyphs move with operation state while copy stays stationary", () => {
  for (const id of OFFICIAL_KEYCAP_IDS) {
    const base = renderCatalogKeycap(id)!;
    const a = decode(renderActionFeedback(base, { phase: "held" }, "dark", "ja", 0));
    const b = decode(renderActionFeedback(base, { phase: "held" }, "dark", "ja", 3));
    const glyph = (svg: string) => /<g[^>]*data-icon-source="microplus-original-catalog"[^>]*>/.exec(svg)?.[0];
    assert.notEqual(glyph(a), glyph(b), id);
    const label = (svg: string) => /<text[^>]*data-key-label="true"[^>]*>.*?<\/text>/.exec(svg)?.[0];
    assert.equal(label(a), label(b), id);
    assert.equal(renderActionFeedback(base, { phase: "error" }, "dark", "ja", 0), renderActionFeedback(base, { phase: "error" }, "dark", "ja", 3));
  }
});

test("custom labels replace the catalog caption rather than covering the glyph", async () => {
  const { customizeKeyImage } = await import('../src/render.js');
  const base = renderCatalogKeycap('CODEX', 'dark', 'en')!;
  const svg = decode(customizeKeyImage(base, { label: '送る', textSize: 'large' }));
  assert.match(svg, /data-key-label="true"[^>]*font-size="19.00"/);
  assert.match(svg, />送る<\/text>/);
  assert.doesNotMatch(svg, /data-custom-label-layer|>SEND<\/text>/);
  assert.match(svg, /data-icon-source="microplus-original-catalog"/);
});

test("animation off freezes actual catalog feedback without suppressing operation state", async () => {
  const { DeckController } = await import('../src/controller.js');
  const controller = new DeckController();
  const images: string[] = [];
  const harness = controller as unknown as {
    actionPreferences: Map<string, unknown>;
    fixedActions: Map<string, unknown>;
    health: { state: string };
    animationFrame: number;
    setOperationFeedback(id: string, feedback: { phase: 'held' }): Promise<void>;
    renderAnimated(): Promise<void>;
  };
  harness.health = { state: 'ready' };
  harness.actionPreferences.set('catalog-off', { animation: false });
  harness.fixedActions.set('catalog-off', { id: 'catalog-off', source: { kind: 'local', keycapId: 'CODEX' }, action: {
    id: 'catalog-off', setImage: async (image: string) => { images.push(decode(image)); }, setTitle: async () => {},
  }});
  await harness.setOperationFeedback('catalog-off', { phase: 'held' });
  assert.match(images.at(-1)!, /data-icon-source="microplus-original-catalog"/);
  assert.match(images.at(-1)!, /data-operation-phase="held"/);
  const count = images.length;
  harness.animationFrame = 6;
  await harness.renderAnimated();
  assert.equal(images.length, count);
  await harness.setOperationFeedback('catalog-off', { phase: 'held' });
  assert.equal(images.length, count);
});
