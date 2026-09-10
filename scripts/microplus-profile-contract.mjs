import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const PROFILE_NAME = "Codex Micro Plus";
export const CODEX_APP_IDENTIFIER = "/Applications/ChatGPT.app";
export const PLUGIN_UUID = "io.local.codexdeck.microplus";
export const HOST_ADAPTOR_UUID = "com.elgato.streamdeck.keys.adaptor";
export const HOST_ADAPTOR_POSITION = "3,0";
export const PLUGIN_MANIFEST_URL = new URL("../packages/microplus/static/manifest.json", import.meta.url);

// These values describe the physical Stream Deck+ contract. Keep them
// independent from any generated profile so the validator remains useful
// when the generator or a live profile is malformed.
export const EXPECTED_ACTIVE_PAGE_COUNT = 5;
export const EXPECTED_KEYPAD_COUNT = 8;
export const EXPECTED_PLUGIN_DIAL_COUNT = 3;
export const EXPECTED_ENCODER_COUNT = EXPECTED_PLUGIN_DIAL_COUNT + 1;

export const KEYPAD_POSITIONS = ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1", "3,0", "3,1"];
export const ENCODER_POSITIONS = ["0,0", "1,0", "2,0", HOST_ADAPTOR_POSITION];
export const PLUGIN_DIAL_IDS = ["dial-agent", "dial-reasoning", "dial-conversation"];
export const PLUGIN_DIAL_UUIDS = PLUGIN_DIAL_IDS.map((id) => `${PLUGIN_UUID}.${id}`);
export const EXPECTED_DIAL_MODES = ["agent-slots", "reasoning", "native-navigation"];

export const PAGE_DEFINITIONS = [
  {
    name: "Codex Micro+ · Tasks",
    keys: [
      ["agent-1", "Task1", { slot: 0 }],
      ["agent-2", "Task2", { slot: 1 }],
      ["agent-3", "Task3", { slot: 2 }],
      ["agent-4", "Task4", { slot: 3 }],
      ["agent-5", "Task5", { slot: 4 }],
      ["agent-6", "Task6", { slot: 5 }],
      ["new-task", "New task", {}],
      ["keycap-pin", "Pin", { keycapId: "MAGIC" }],
    ],
    dials: [
      ["dial-agent", "Task", { mode: "agent-slots" }],
      ["dial-reasoning", "Reasoning", { mode: "reasoning" }],
      ["dial-conversation", "Navigation", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · Core controls",
    keys: [
      ["fast", "ACT06 · Physical key", { physicalId: "ACT06" }],
      ["approve", "ACT07 · Physical key", { physicalId: "ACT07" }],
      ["decline", "ACT08 · Physical key", { physicalId: "ACT08" }],
      ["fork", "ACT09 · Physical key", { physicalId: "ACT09" }],
      ["dictation", "ACT10 · Physical key", { physicalId: "ACT10", mode: "push-to-talk" }],
      ["act11", "ACT11 · Physical key", { physicalId: "ACT11" }],
      ["send", "ACT12 · Physical key", { physicalId: "ACT12" }],
      ["keycap-openai-docs", "OpenAI docs", { keycapId: "OAI" }],
    ],
    dials: [
      ["dial-agent", "Task", { mode: "agent-slots" }],
      ["dial-reasoning", "Reasoning", { mode: "reasoning" }],
      ["dial-conversation", "Navigation", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · Navigation and reasoning",
    keys: [
      ["plan", "JOY_UP · Physical direction", { direction: "up" }],
      ["forward", "JOY_RIGHT · Physical direction", { direction: "right" }],
      ["sidebar", "JOY_DOWN · Physical direction", { direction: "down" }],
      ["back", "JOY_LEFT · Physical direction", { direction: "left" }],
      ["reasoning", "ENC_CLK · Physical press", {}],
      ["reasoning-down", "Reasoning −", { delta: -1 }],
      ["reasoning-up", "Reasoning +", { delta: 1 }],
      ["keycap-diff", "Review", { keycapId: "DIFF" }],
    ],
    dials: [
      ["dial-agent", "Task", { mode: "agent-slots" }],
      ["dial-reasoning", "Reasoning", { mode: "reasoning" }],
      ["dial-conversation", "Navigation", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · Development",
    keys: [
      ["keycap-terminal", "Terminal", { keycapId: "TERM" }],
      ["keycap-browser", "Browser", { keycapId: "NAV" }],
      ["keycap-open-folder", "Folder", { keycapId: "FOLD" }],
      ["keycap-add-files", "Attach files", { keycapId: "UPL" }],
      ["keycap-git-commit", "Git", { keycapId: "GIT" }],
      ["keycap-pull-request", "Create PR", { keycapId: "PR" }],
      ["keycap-create-branch", "Branch", { keycapId: "BRANCH" }],
      ["keycap-merge", "Merge", { keycapId: "MRG" }],
    ],
    dials: [
      ["dial-agent", "Task", { mode: "agent-slots" }],
      ["dial-reasoning", "Reasoning", { mode: "reasoning" }],
      ["dial-conversation", "Navigation", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · Voice and status",
    keys: [
      ["keycap-mic", "PTT", { keycapId: "MIC" }],
      ["keycap-add-photos", "Add photos", { keycapId: "PAINT" }],
      ["keycap-side-chat", "Side chat", { keycapId: "PARTY" }],
      ["usage-limit", "Remaining", { mode: "auto", display: "usage" }],
      ["usage-overview", "5h / week", { display: "usage" }],
      ["rate-limit-reset", "Reset", { display: "usage" }],
      ["keycap-download", "Save Markdown", { keycapId: "DWN" }],
      ["keycap-settings", "Settings", { keycapId: "SETUP" }],
    ],
    dials: [
      ["dial-agent", "Task", { mode: "agent-slots" }],
      ["dial-reasoning", "Reasoning", { mode: "reasoning" }],
      ["dial-conversation", "Navigation", { mode: "native-navigation" }],
    ],
  },
];

export async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${path} (${error.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${path} (${error.message})`);
  }
}

export async function listPageDirectories(profileRoot) {
  const profileDirectory = join(profileRoot, "Profiles");
  const entries = await readdir(profileDirectory, { withFileTypes: true }).catch(() => []);
  const directories = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(profileDirectory, entry.name);
    const manifestPath = join(directory, "manifest.json");
    if (await stat(manifestPath).then((value) => value.isFile()).catch(() => false)) {
      directories.set(entry.name.toLowerCase(), directory);
    }
  }
  return directories;
}

export function normalizeProfileId(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
