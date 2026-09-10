import assert from "node:assert/strict";
import test from "node:test";
import {
  KEY_CONTACT_DURATION_MS,
  renderActionKey,
  renderCatalogKeycap,
  renderFallbackKeycap,
  renderHostTargetKey,
  renderImportedKeycap,
  renderKeyContact,
  renderRateLimitResetKey,
  renderUsageLimitKey,
  renderUsageOverviewKey,
} from "../src/render.js";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";

const decode = (image: string) => decodeURIComponent(image.slice(image.indexOf(",") + 1));

test("contact responds across catalog keys without changing labels or claiming a result", () => {
  for (const id of OFFICIAL_KEYCAP_IDS) {
    const base = renderCatalogKeycap(id, "dark", "ja");
    if (!base) continue;
    const before = decode(base).match(/<text\b[^>]*>[\s\S]*?<\/text>/g);
    const press = renderKeyContact(base, "press", 0, "dark");
    const later = renderKeyContact(base, "press", 66, "dark");
    const release = renderKeyContact(base, "release", 66, "dark");
    assert.notEqual(press, later, id);
    assert.notEqual(later, release, id);
    assert.deepEqual(decode(release).match(/<text\b[^>]*>[\s\S]*?<\/text>/g), before, id);
    assert.doesNotMatch(decode(press), /data-operation-phase|data-operation-progress|<animate/);
    assert.equal(renderKeyContact(base, "release", KEY_CONTACT_DURATION_MS, "dark"), base);
    assert.equal(renderKeyContact(base, "press", NaN, "dark"), base);
    assert.equal(renderKeyContact(base, "press", -1, "dark"), base);
  }
});

test("light and dark contact accents remain distinct, peak at 90ms, then fade to the configured expiry", () => {
  const base = renderCatalogKeycap("MIC", "dark", "en")!;
  assert.equal(KEY_CONTACT_DURATION_MS, 320);
  assert.match(decode(renderKeyContact(base, "press", 0, "light")), /#B32967/);
  assert.match(decode(renderKeyContact(base, "press", 0, "dark")), /#FFB8D5/);

  const washOpacity = (ageMs: number): number => {
    const svg = decode(renderKeyContact(base, "press", ageMs, "dark"));
    const match = /data-contact-wash="true"[^>]*opacity="([0-9.]+)"/u.exec(svg);
    assert.ok(match, `contact wash should be present at ${ageMs}ms`);
    return Number(match[1]);
  };
  assert.equal(washOpacity(90), 1, "the contact remains at full strength through the peak");
  assert.ok(washOpacity(91) < 1, "the contact begins fading after the peak");
  assert.equal(renderKeyContact(base, "release", KEY_CONTACT_DURATION_MS + 1, "dark"), base);
});

test("light contact wash sits behind the catalog glyph and preserves key copy", () => {
  const base = renderCatalogKeycap("MIC", "light", "en")!;
  const source = decode(base);
  const contact = decode(renderKeyContact(base, "press", 0, "light"));
  const textNodes = (svg: string): string[] => svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) ?? [];
  const washIndex = contact.indexOf('<rect data-contact-wash="true"');
  const glyphIndex = contact.indexOf('<g data-icon-source="microplus-original-catalog"');
  const labelIndex = contact.indexOf('<text data-key-label="true"');

  assert.ok(washIndex >= 0, "light contact must add its broad wash");
  assert.ok(washIndex < glyphIndex && glyphIndex < labelIndex, "wash must precede the glyph and label");
  assert.match(contact, /<linearGradient id="contact-glass"[\s\S]*?<stop stop-color="#B32967" stop-opacity="\.48"\/><stop offset="\.55" stop-color="#B32967" stop-opacity="\.17"\/><stop offset="1" stop-color="#B32967" stop-opacity="\.05"\/>/);
  assert.match(contact, /<rect data-contact-wash="true"[^>]*fill="url\(#contact-glass\)" opacity="1\.000"/);
  assert.match(contact, /data-contact-sweep="true"/);
  assert.match(contact, /data-contact-layer="true" clip-path="url\(#key-contact-clip\)"/);
  assert.match(contact, /<clipPath id="key-contact-clip"><rect x="8" y="8" width="128" height="128" rx="14"\/><\/clipPath>/);
  assert.match(contact, /data-contact-specular="true"/);
  assert.match(contact, /<g data-icon-source="microplus-original-catalog"[^>]*color="#B32967"[^>]*stroke="#B32967"/);
  assert.deepEqual(textNodes(contact), textNodes(source), "contact feedback must not rewrite key text");
});

test("contact wash reaches fallback, custom, and text-only key surfaces", () => {
  const imported = renderImportedKeycap('<svg viewBox="0 0 24 24"><path d="M2 12h20M12 2v20" fill="none" stroke="currentColor" stroke-width="2"/></svg>', "light");
  const cases: Array<[string, string]> = [
    ["fallback", renderFallbackKeycap("ACT11 無効", "light", "en")],
    ["custom", imported],
    ["action", renderActionKey({ identity: "ACT10", current: "MIC", target: "MAPPED", state: "ready", theme: "light", language: "en" })],
    ["host", renderHostTargetKey("MAC", "ready", "light", "en")],
    ["usage", renderUsageLimitKey(undefined, "five-hour", "light", "ready", undefined, "en")],
    ["overview", renderUsageOverviewKey([], "light", "ready", undefined, "en")],
    ["reset", renderRateLimitResetKey(null, 0, "light", "ready", undefined, "en")],
  ];
  const textNodes = (svg: string): string[] => svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) ?? [];

  for (const [name, base] of cases) {
    const source = decode(base);
    const contact = decode(renderKeyContact(base, "press", 0, "light"));
    assert.match(contact, /data-contact-wash="true"/, `${name}: contact wash is missing`);
    assert.match(contact, /data-key-contact="press"/, `${name}: contact trace is missing`);
    assert.deepEqual(textNodes(contact), textNodes(source), `${name}: contact feedback must preserve text`);
  }
});

test("contact color follows key semantics and fallback copy joins the tactile motion", () => {
  const contact = (id: Parameters<typeof renderCatalogKeycap>[0]) => decode(renderKeyContact(renderCatalogKeycap(id, "dark", "en")!, "press", 0, "dark"));
  assert.match(contact("GIT"), /#9ED8FF/, "development controls use the blue system accent");
  assert.match(contact("REJ"), /#FFB4B4/, "destructive controls use the red system accent");
  assert.match(contact("PAINT"), /#FFC2F0/, "creative controls use the pink system accent");

  const fallback = decode(renderKeyContact(renderFallbackKeycap("ACT11 無効", "dark", "ja"), "press", 40, "dark"));
  assert.match(fallback, /<g data-icon-source="fallback-label"[^>]*transform="translate\([^)]*\) scale\([^)]*\) translate\(0 0\)"/);
  assert.match(fallback, /data-contact-wash="true"/);
});
