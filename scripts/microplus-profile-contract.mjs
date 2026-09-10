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
    name: "Codex Micro+ · 6タスク",
    keys: [
      ["agent-1", "タスク1", { slot: 0 }],
      ["agent-2", "タスク2", { slot: 1 }],
      ["agent-3", "タスク3", { slot: 2 }],
      ["agent-4", "タスク4", { slot: 3 }],
      ["agent-5", "タスク5", { slot: 4 }],
      ["agent-6", "タスク6", { slot: 5 }],
      ["new-task", "新規", {}],
      ["keycap-pin", "ピン留め", { keycapId: "MAGIC" }],
    ],
    dials: [
      ["dial-agent", "タスク", { mode: "agent-slots" }],
      ["dial-reasoning", "思考", { mode: "reasoning" }],
      ["dial-conversation", "左右操作", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · 主要操作",
    keys: [
      ["fast", "ACT06 · 物理キー", { physicalId: "ACT06" }],
      ["approve", "ACT07 · 物理キー", { physicalId: "ACT07" }],
      ["decline", "ACT08 · 物理キー", { physicalId: "ACT08" }],
      ["fork", "ACT09 · 物理キー", { physicalId: "ACT09" }],
      ["dictation", "ACT10 · 物理キー", { physicalId: "ACT10", mode: "push-to-talk" }],
      ["act11", "ACT11 · 物理キー", { physicalId: "ACT11" }],
      ["send", "ACT12 · 物理キー", { physicalId: "ACT12" }],
      ["keycap-openai-docs", "公式Docs", { keycapId: "OAI" }],
    ],
    dials: [
      ["dial-agent", "タスク", { mode: "agent-slots" }],
      ["dial-reasoning", "思考", { mode: "reasoning" }],
      ["dial-conversation", "左右操作", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · 移動と思考",
    keys: [
      ["plan", "JOY_UP · 物理方向", { direction: "up" }],
      ["forward", "JOY_RIGHT · 物理方向", { direction: "right" }],
      ["sidebar", "JOY_DOWN · 物理方向", { direction: "down" }],
      ["back", "JOY_LEFT · 物理方向", { direction: "left" }],
      ["reasoning", "ENC_CLK · 物理押下", {}],
      ["reasoning-down", "思考 −", { delta: -1 }],
      ["reasoning-up", "思考 +", { delta: 1 }],
      ["keycap-diff", "レビュー", { keycapId: "DIFF" }],
    ],
    dials: [
      ["dial-agent", "タスク", { mode: "agent-slots" }],
      ["dial-reasoning", "思考", { mode: "reasoning" }],
      ["dial-conversation", "左右操作", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · 開発操作",
    keys: [
      ["keycap-terminal", "ターミナル", { keycapId: "TERM" }],
      ["keycap-browser", "ブラウザー", { keycapId: "NAV" }],
      ["keycap-open-folder", "フォルダ", { keycapId: "FOLD" }],
      ["keycap-add-files", "ファイル添付", { keycapId: "UPL" }],
      ["keycap-git-commit", "Git", { keycapId: "GIT" }],
      ["keycap-pull-request", "PR作成", { keycapId: "PR" }],
      ["keycap-create-branch", "ブランチ", { keycapId: "BRANCH" }],
      ["keycap-merge", "マージ", { keycapId: "MRG" }],
    ],
    dials: [
      ["dial-agent", "タスク", { mode: "agent-slots" }],
      ["dial-reasoning", "思考", { mode: "reasoning" }],
      ["dial-conversation", "左右操作", { mode: "native-navigation" }],
    ],
  },
  {
    name: "Codex Micro+ · 音声と状態",
    keys: [
      ["keycap-mic", "PTT", { keycapId: "MIC" }],
      ["keycap-add-photos", "写真追加", { keycapId: "PAINT" }],
      ["keycap-side-chat", "サイドチャット", { keycapId: "PARTY" }],
      ["usage-limit", "残量", { mode: "auto", display: "usage" }],
      ["usage-overview", "5時間／週", { display: "usage" }],
      ["rate-limit-reset", "リセット", { display: "usage" }],
      ["keycap-download", "Markdown保存", { keycapId: "DWN" }],
      ["keycap-settings", "設定", { keycapId: "SETUP" }],
    ],
    dials: [
      ["dial-agent", "タスク", { mode: "agent-slots" }],
      ["dial-reasoning", "思考", { mode: "reasoning" }],
      ["dial-conversation", "左右操作", { mode: "native-navigation" }],
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
