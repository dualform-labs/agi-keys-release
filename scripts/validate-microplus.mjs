#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { discoverMicroplusProfile, validateMicroplusProfile } from "./validate-microplus-profile.mjs";

const args = parseArgs(process.argv.slice(2));
await run(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "packages/microplus", "run", "validate"]);
if (args.profileRequested) {
  const profile = args.profilePath ? resolve(args.profilePath) : await discoverMicroplusProfile();
  process.stdout.write(`${JSON.stringify(await validateMicroplusProfile(profile), null, 2)}\n`);
}

function parseArgs(argv) {
  let profileRequested = false;
  let profilePath;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile") {
      profileRequested = true;
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        profilePath = next;
        index += 1;
      }
      continue;
    }
    if (value.startsWith("--profile=")) {
      profileRequested = true;
      profilePath = value.slice("--profile=".length);
      if (!profilePath) throw new Error("--profile requires a path when used with =");
      continue;
    }
    throw new Error(`Unknown option: ${value}`);
  }
  return { profileRequested, profilePath };
}

function run(command, commandArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, { cwd: process.cwd(), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${commandArgs.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}
