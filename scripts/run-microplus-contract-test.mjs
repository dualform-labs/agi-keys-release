#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contracts = {
  mapping: { flag: "--physical-position", file: "tests/microplus-mapping.test.ts" },
  transport: { flag: "--fuzz", file: "tests/microplus-transport.test.ts" },
  failure: { flag: "--timeout", file: "tests/microplus-failure.test.ts" },
};

const [contractName, ...args] = process.argv.slice(2);
const contract = contracts[contractName];
if (!contract) throw new Error(`Unknown contract test: ${String(contractName)}`);
for (const arg of args) {
  if (arg !== contract.flag) throw new Error(`${contractName} accepts only ${contract.flag}`);
}

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const testPath = resolve(repoRoot, contract.file);
const tsxExecutable = resolve(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
// Keep SDK/plugin logs out of the checkout. The directory is intentionally
// retained for post-test inspection and is never removed by this runner.
const testCwd = await mkdtemp(join(tmpdir(), "codex-microplus-contract-"));
process.stdout.write(`contract=${contractName} cwd=${testCwd} test=${testPath}\n`);

await new Promise((resolveRun, reject) => {
  const child = spawn(tsxExecutable, ["--test", testPath], { cwd: testCwd, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolveRun();
    else reject(new Error(`${contractName} contract tests failed (${signal ?? `exit ${code}`})`));
  });
});
