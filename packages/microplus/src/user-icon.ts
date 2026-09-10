import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { lstat, open } from "node:fs/promises";

/** Keep custom icon names simple and bounded before they reach a filesystem path. */
export const MAX_USER_ICON_ID_LENGTH = 128;

/** Keep an imported SVG from consuming unbounded memory during a key render. */
export const MAX_USER_ICON_BYTES = 256 * 1024;

const SIMPLE_USER_ICON_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_USER_ICON_ID_LENGTH}}$`, "u");
const READ_CHUNK_BYTES = 64 * 1024;

export function isSafeUserIconId(value: unknown): value is string {
  return typeof value === "string" && SIMPLE_USER_ICON_ID.test(value);
}

/**
 * Read a user-provided SVG only from a non-symlinked icon root and a regular file.
 * The controller deliberately turns every failure into its existing keycap fallback.
 */
export async function readUserIconSvg(root: string, keycapId: unknown): Promise<string> {
  if (!isSafeUserIconId(keycapId)) throw new Error("E_USER_ICON_INVALID_ID");

  const safeRoot = resolve(root);
  await assertNoSymlinkedDirectoryPath(safeRoot);

  const path = `${safeRoot}/${keycapId}.svg`;
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await open(path, flags);
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new Error("E_USER_ICON_NOT_REGULAR");
    if (details.size > MAX_USER_ICON_BYTES) throw new Error("E_USER_ICON_TOO_LARGE");

    // Read exactly the size observed after opening. This bounds the allocation and
    // bytes read while the file is being rendered; size changes observed during
    // the read are rejected below.
    const expectedBytes = details.size;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes < expectedBytes) {
      const length = Math.min(READ_CHUNK_BYTES, expectedBytes - totalBytes);
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await handle.read(chunk, 0, length, totalBytes);
      if (bytesRead === 0) break;
      chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes !== expectedBytes) throw new Error("E_USER_ICON_CHANGED");
    if (expectedBytes < MAX_USER_ICON_BYTES) {
      const probe = Buffer.alloc(1);
      const { bytesRead } = await handle.read(probe, 0, 1, expectedBytes);
      if (bytesRead !== 0) throw new Error("E_USER_ICON_CHANGED");
    }
    const finalDetails = await handle.stat();
    if (finalDetails.size !== expectedBytes) throw new Error("E_USER_ICON_CHANGED");
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function assertNoSymlinkedDirectoryPath(path: string): Promise<void> {
  let current = path;
  while (true) {
    const details = await lstat(current);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error("E_USER_ICON_ROOT_UNSAFE");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
