import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const formerProductWords = ["codex", "keys"];
const forbiddenBrandPatterns = [
  new RegExp(`${formerProductWords[0]}[ _-]?${formerProductWords[1]}`, "iu"),
  new RegExp(formerProductWords.join(""), "iu"),
  new RegExp(["io", "local", "codexdeck", "microplus"].join("\\."), "u"),
];

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter(Boolean);
}

function isReadmeSurface(path) {
  return /^README(?:\.|$)/iu.test(basename(path))
    || path.startsWith("docs/assets/readme-");
}

test("tracked product code contains only the AGI Keys brand and UUID", () => {
  const violations = [];

  for (const path of trackedFiles()) {
    if (isReadmeSurface(path) || path.startsWith("TRASH/")) continue;

    const contents = readFileSync(new URL(`../${path}`, import.meta.url));
    if (contents.includes(0)) continue;

    const text = contents.toString("utf8");
    for (const pattern of forbiddenBrandPatterns) {
      if (pattern.test(text)) violations.push(`${path}: ${pattern.source}`);
    }
  }

  assert.deepEqual(violations, []);
});
