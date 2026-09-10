import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type TriggerDescription = Record<string, string>;
type LocalizedAction = {
  Name: string;
  Tooltip?: string;
  Encoder?: { TriggerDescription?: TriggerDescription };
};
type Localization = {
  Name: string;
  Description: string;
  [uuid: string]: string | LocalizedAction;
};
type ManifestAction = {
  UUID: string;
  Name: string;
  Tooltip?: string;
  Encoder?: { TriggerDescription?: TriggerDescription };
};

const manifest = JSON.parse(readFileSync(new URL("../static/manifest.json", import.meta.url), "utf8")) as {
  Name: string;
  Description: string;
  Actions: ManifestAction[];
};
const en = JSON.parse(readFileSync(new URL("../static/en.json", import.meta.url), "utf8")) as Localization;
const ja = JSON.parse(readFileSync(new URL("../static/ja.json", import.meta.url), "utf8")) as Localization;
const ids = new Set(manifest.Actions.map(({ UUID }) => UUID));

test("native localization files use direct UUID action entries for all 67 actions", () => {
  assert.equal(manifest.Actions.length, 67);
  for (const locale of [en, ja]) {
    assert.equal(typeof locale.Name, "string");
    assert.equal(typeof locale.Description, "string");
    assert.equal("Actions" in locale, false, "SDK localization uses UUID keys at the resource root");

    const localeIds = new Set(Object.keys(locale).filter((key) => key.startsWith("io.local.codexdeck.microplus.")));
    assert.deepEqual(localeIds, ids);
    for (const action of manifest.Actions) {
      const localized = locale[action.UUID] as LocalizedAction | undefined;
      assert.ok(localized, `${action.UUID} must be localized`);
      assert.equal(typeof localized.Name, "string", `${action.UUID} Name`);
      assert.equal(typeof localized.Tooltip, "string", `${action.UUID} Tooltip`);
      if (action.Encoder?.TriggerDescription) {
        assert.deepEqual(
          Object.keys(localized.Encoder?.TriggerDescription ?? {}).sort(),
          Object.keys(action.Encoder.TriggerDescription).sort(),
          `${action.UUID} trigger description keys`,
        );
      } else {
        assert.equal(localized.Encoder, undefined, `${action.UUID} must not expose encoder localization`);
      }
    }
  }
  for (const action of manifest.Actions) {
    const localized = en[action.UUID] as LocalizedAction;
    assert.equal(localized.Name, action.Name, `${action.UUID} English Name follows manifest default`);
    assert.equal(localized.Tooltip, action.Tooltip, `${action.UUID} English Tooltip follows manifest default`);
    assert.deepEqual(localized.Encoder?.TriggerDescription, action.Encoder?.TriggerDescription, `${action.UUID} English trigger descriptions follow manifest defaults`);
  }
  assert.equal(en.Name, manifest.Name);
  assert.equal(en.Description, manifest.Description);
});

test("build copies native localization resources into the plugin root", () => {
  const build = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(build, /static\/en\.json/);
  assert.match(build, /static\/ja\.json/);
  assert.match(build, /resolve\(output, "en\.json"\)/);
  assert.match(build, /resolve\(output, "ja\.json"\)/);
});
