import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

test("action failure feedback has no runtime dependency on the Codex transport", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/action-feedback.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some((path) => path.endsWith("/failure-codes.ts")));
  for (const path of inputs) {
    assert.doesNotMatch(path, /(?:codex-micro-renderer-bridge|renderer-runtime|codex-debug-discovery)\.ts$/u);
    assert.doesNotMatch(path, /node_modules\/ws\//u);
  }
  for (const output of Object.values(result.metafile.outputs)) {
    assert.deepEqual(output.imports, [], "feedback contracts must not import native or network services");
  }
});
