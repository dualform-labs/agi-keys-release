import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto, createHash } from "node:crypto";
import { buildRuntimeOverrideExpression, buildRuntimeVerificationExpression } from "../launcher/runtime-override.js";
import { REVIEWED_LAUNCHER_RUNTIME } from "../launcher/reviewed-runtime.js";

async function exercise(expression: string, fault = "") {
  const imported: string[] = [];
  const client = { overrideAdapter: {}, checkGate: () => true, $emt: () => undefined };
  const original = client.overrideAdapter;
  let dispatched = 0;
  const bus = { handlers: new Map([
    ["codex-micro-device-state-changed", new Set([1])],
    ["codex-micro-hid-event", new Set([1])],
    ["codex-micro-joystick-event", new Set([1])],
  ]), dispatchHostMessage: () => { dispatched++; } };
  const contents = { initial: "reviewed initial fixture", primary: "reviewed primary fixture" };
  // Substitute test-only approved digests; hashing itself uses real WebCrypto.
  for (const kind of ["initial", "primary"] as const) expression = expression.replaceAll(
    REVIEWED_LAUNCHER_RUNTIME[kind], createHash("sha256").update(contents[kind]).digest("hex"));
  const urls = ["app://codex/assets/app-initial-good.js", "app://codex/assets/app-primary-good.js",
    "https://attacker.invalid/assets/app-initial-bad.js", "app://foreign/assets/app-primary-bad.js"];
  if (fault === "ambiguous") urls.push("app://codex/assets/app-initial-other.js");
  const document = { hasFocus: () => fault !== "unfocused", visibilityState: "visible",
    querySelectorAll: () => urls.map(src => ({ src })), querySelector: () => null };
  const evaluate = new Function("document", "performance", "location", "globalThis", "fetch", "crypto", "importModule",
    `return ${expression.replaceAll("import(", "importModule(")}`);
  const result = await evaluate(document, { getEntriesByType: () => [] },
    { href: fault === "foreign" ? "https://codex.invalid/index.html" : "app://codex/index.html" },
    { __STATSIG__: { firstInstance: client } },
    async (url: string) => ({ ok: true, arrayBuffer: async () => {
      const kind = url.includes("app-initial") ? "initial" : "primary";
      return new TextEncoder().encode(fault === kind ? "changed" : contents[kind]);
    } }), webcrypto, async (url: string) => { imported.push(url); return { _mn: bus }; });
  return { result, imported, dispatched, mutated: client.overrideAdapter !== original };
}

for (const [name, build] of [["override", buildRuntimeOverrideExpression], ["verification", buildRuntimeVerificationExpression]] as const) {
  test(`launcher ${name} imports only the reviewed current namespace`, async () => {
    const result = await exercise(build());
    assert.equal(result.result.ready, true);
    assert.deepEqual(result.imported, ["app://codex/assets/app-initial-good.js"]);
    assert.equal(result.dispatched, name === "override" ? 1 : 0);
  });
  for (const fault of ["initial", "primary", "ambiguous", "foreign", "unfocused"]) {
    test(`launcher ${name} rejects ${fault} before import or mutation`, async () => {
      const result = await exercise(build(), fault);
      assert.equal(result.result.ready, false);
      assert.deepEqual(result.imported, []);
      assert.equal(result.mutated, false);
      assert.equal(result.dispatched, 0);
    });
  }
}
