import assert from "node:assert/strict";
import { mkdir, mkdtemp, lstat, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureSafeDirectoryPath, safeInstallRuntime } from "../launcher/macos.js";

test("launcher refuses to create a state path below a symlinked ancestor", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-launcher-path-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const realState = join(directory, "real-state");
  const symlinkedParent = join(directory, "state-parent");
  await mkdir(realState);
  await symlink(realState, symlinkedParent, "dir");

  await assert.rejects(
    ensureSafeDirectoryPath(join(symlinkedParent, "nested")),
    /E_CODEX_KEYS_PATH_UNSAFE/u
  );
  await assert.rejects(stat(join(realState, "nested")), { code: "ENOENT" });
});

test("launcher replaces a final runtime symlink without writing through it", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "codex-keys-launcher-runtime-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stateDirectory = join(directory, "state");
  const outsideTarget = join(directory, "outside-runtime.mjs");
  const source = join(directory, "new-runtime.mjs");
  const destination = join(stateDirectory, "codex-micro-plus-macos.mjs");
  await mkdir(stateDirectory);
  await writeFile(outsideTarget, "outside-before\n");
  await writeFile(source, "new-runtime\n");
  await symlink(outsideTarget, destination, "file");

  await safeInstallRuntime(source, destination);

  assert.equal(await readFile(outsideTarget, "utf8"), "outside-before\n");
  assert.equal(await readFile(destination, "utf8"), "new-runtime\n");
  assert.equal((await lstat(destination)).isFile(), true);
  assert.equal((await lstat(outsideTarget)).isFile(), true);
});
