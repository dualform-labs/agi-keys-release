import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_USER_ICON_BYTES, MAX_USER_ICON_ID_LENGTH, readUserIconSvg } from "../src/user-icon.js";

const execFile = promisify(execFileCallback);

async function makeIconRoot(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

test("reads a simple custom SVG id with hyphens and underscores", async (t) => {
  const root = await makeIconRoot("agi-keys-user-icon-valid-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0\"/></svg>";
  await writeFile(join(root, "custom-icon_v2.svg"), svg, "utf8");

  assert.equal(await readUserIconSvg(root, "custom-icon_v2"), svg);
});

test("rejects traversal, absolute, null, and oversized ids before opening a path", async (t) => {
  const root = await makeIconRoot("agi-keys-user-icon-id-");
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const id of [
    "../outside",
    "nested/icon",
    "nested\\icon",
    "/absolute",
    "C:outside",
    "icon\u0000name",
    "",
    "x".repeat(MAX_USER_ICON_ID_LENGTH + 1),
  ]) {
    await assert.rejects(readUserIconSvg(root, id), /E_USER_ICON_INVALID_ID/u, id);
  }
  await assert.rejects(readUserIconSvg(root, null), /E_USER_ICON_INVALID_ID/u);
});

test("rejects a symlinked icon root instead of reading outside it", async (t) => {
  const parent = await makeIconRoot("agi-keys-user-icon-root-");
  t.after(() => rm(parent, { recursive: true, force: true }));
  const outside = join(parent, "outside");
  const linkedRoot = join(parent, "icons");
  await mkdir(outside);
  await writeFile(join(outside, "escape.svg"), "outside", "utf8");
  await symlink(outside, linkedRoot, "dir");

  await assert.rejects(readUserIconSvg(linkedRoot, "escape"), /E_USER_ICON_ROOT_UNSAFE/u);
});

test("rejects a final icon symlink and non-regular files", async (t) => {
  const root = await makeIconRoot("agi-keys-user-icon-entry-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = join(root, "outside.svg");
  await writeFile(outside, "outside", "utf8");
  await symlink(outside, join(root, "linked.svg"), "file");
  await mkdir(join(root, "directory.svg"));

  await assert.rejects(readUserIconSvg(root, "linked"), /ELOOP|E_USER_ICON_NOT_REGULAR/u);
  await assert.rejects(readUserIconSvg(root, "directory"), /E_USER_ICON_NOT_REGULAR/u);
});

test("rejects oversized SVG content after checking the actual file size", async (t) => {
  const root = await makeIconRoot("agi-keys-user-icon-size-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "large.svg"), Buffer.alloc(MAX_USER_ICON_BYTES + 1, 0x61));

  await assert.rejects(readUserIconSvg(root, "large"), /E_USER_ICON_TOO_LARGE/u);
});

test("rejects a FIFO without waiting for a writer", async (t) => {
  const root = await makeIconRoot("agi-keys-user-icon-fifo-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const fifo = join(root, "pipe.svg");
  await execFile("mkfifo", [fifo]);

  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("FIFO read blocked")), 500);
  });
  await assert.rejects(Promise.race([readUserIconSvg(root, "pipe"), timeout]), /E_USER_ICON_NOT_REGULAR/u);
});
