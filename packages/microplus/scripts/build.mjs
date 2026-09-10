import { build } from "esbuild";
import { appendFile, chmod, cp, mkdir, rename, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const repository = resolve("../..");
const buildId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const bundleOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};

async function preservePrevious(target, label) {
  try { await stat(target); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const destination = resolve(repository, "TRASH", `microplus-build-${buildId}`, label);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await rename(target, destination);
  await appendFile(resolve(repository, "TRASH-FILES.md"), `\n- ${relative(repository, target)} → ${relative(repository, destination)} — previous build retained before replacement.\n`);
}

async function bundle(entryPoint, outfile, options = {}) {
  await build({
    ...bundleOptions,
    entryPoints: [resolve(entryPoint)],
    outfile: resolve(outfile),
    ...options,
  });
}

async function copyLauncherAssets(destination) {
  const assets = [
    ["launcher/start-microplus.sh", "start-microplus.sh", 0o755],
    ["launcher/Start Codex Micro Plus.command", "Start Codex Micro Plus.command", 0o755],
    ["launcher/Start Codex Micro Plus.command", "Codex Keys.command", 0o755],
    ["LICENSE", "LICENSE"],
    ["THIRD_PARTY_NOTICE.md", "THIRD_PARTY_NOTICE.md"],
  ];
  for (const [source, target, mode] of assets) {
    const targetPath = resolve(destination, target);
    await cp(resolve(source), targetPath);
    if (mode !== undefined) await chmod(targetPath, mode);
  }
}

const output = resolve("dist/io.local.codexdeck.microplus.sdPlugin");
await preservePrevious(resolve("dist"), "dist");
await mkdir(output, { recursive: true });
await mkdir(resolve(output, "bin"), { recursive: true });
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', resolve('native/global-dictation-helper.swift'), '-o', resolve(output, 'bin/global-dictation-helper')], { stdio: 'inherit' });
await mkdir(resolve(output, "static"), { recursive: true });
await cp(resolve("static/imgs"), resolve(output, "static/imgs"), { recursive: true });
await cp(resolve("static/property-inspector"), resolve(output, "static/property-inspector"), { recursive: true });
await cp(resolve("static/layouts"), resolve(output, "static/layouts"), { recursive: true });
await cp(resolve("static/manifest.json"), resolve(output, "manifest.json"));
await cp(resolve("LICENSE"), resolve(output, "LICENSE"));
await cp(resolve("THIRD_PARTY_NOTICE.md"), resolve(output, "THIRD_PARTY_NOTICE.md"));

await bundle("src/plugin.ts", resolve(output, "bin/plugin.mjs"), { sourcemap: true });

const launcher = resolve("release/codex-micro-plus-launcher-macos");
await preservePrevious(launcher, "launcher");
await mkdir(launcher, { recursive: true });
await bundle("launcher/macos.ts", resolve(launcher, "codex-micro-plus-macos.mjs"));
await copyLauncherAssets(launcher);
