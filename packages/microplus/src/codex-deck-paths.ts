import { homedir } from "node:os";
import { posix } from "node:path";

export function codexDeckStateRoot(home = homedir()): string {
  return posix.join(home, "Library", "Application Support", "CodexMicroPlus");
}
