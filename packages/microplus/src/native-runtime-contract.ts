import type {
  OfficialKeycapId,
} from './keycaps.js';

export const CURRENT_NATIVE_BRIDGE_SHA256 = "4a72fcf16503f4e5a5a69feea1e45944acc3483afb76f1651254fc1f14aed91c";
export const CURRENT_APP_INITIAL_SHA256 = "737070f94a072d2b4ede9f326e3e1c4142fb82198961251c2e70479b3f926275";
export const CURRENT_APP_PRIMARY_SHA256 = "28d317396d30902ab5f2c01f069a7b9773f2299b35cc855272d4cf59b402c276";
export const CURRENT_MICRO_COMMANDS_SHA256 = "5d5e582c441c213d29121a4c56eceaca51d1d5097e61bf5d5e3a2512dd0bbbf7";
export const CURRENT_MICRO_LAYOUT_ASSET = "codex-micro-layout-ce53c0b4e6f2.js";
export const CURRENT_MICRO_LAYOUT_SHA256 = "eeb77c77780c02f39a644a8bcc0f474bec031870a43e47ea78b91ab8072e3594";
export const CURRENT_MICRO_SLOT_SIGNALS_ASSET = "codex-micro-slot-signals-1c73facc00e2.js";
export const CURRENT_MICRO_SLOT_SIGNALS_SHA256 = "f6d9db42ee933d617212cc1c1a79be6e932d9620714a114f913e1562416a5eba";
export const CURRENT_MESSAGE_BUS_ASSET = "message-bus-828b3d0e2c34.js";
export const CURRENT_MESSAGE_BUS_SHA256 = "daec5cd2b8cfe9074143c15bbde1f45b76fe40f668cd486f1eff7304e6d4f2ae";
// Audited against installed Codex 26.903.61454. Only model UI and explicitly listed keycaps
// use this contract; other operations retain their separately audited pins.
export const DIAL_RUNTIME_26903 = {
  primary: "0aa689053d9e32d7286dfb1d85ac62cadc3858086335518f15b1f97604eb61e9",
  bridge: "453a1b06114708bc37b5a889c583dc2b5b19887cd9d95d42e82a1dd15ce9a3ce",
  initial: "c87b94027faefdc31cc165975dc0f14b28e3f6d922f6a5188756c8f570f2b3d7",
  commands: "7ab9684b8daf493552e08e9be7db0ed235b17c6e9d1dec49f6b339e0f1421e84",
  layoutAsset: "codex-micro-layout-7db62f4a0fe5.js",
  layout: "b639ace41c685a334271a5a27f3d426cd639993bfb166f4c43825ecb06abd9b7",
} as const;
export const REVIEWED_STANDALONE_KEYCAPS_26903: Partial<Record<OfficialKeycapId, { type: string; url?: string; text?: string }>> = {
  OAI: { type: "external-url", url: "https://developers.openai.com" },
  YOLO: { type: "composer-text", text: ":yolo:" },
  YEET: { type: "composer-text", text: ":yeet:" },
};
export const REVIEWED_KEYCAP_COMMANDS_26903: Partial<Record<OfficialKeycapId, { command: string; requiredAccess: string | null }>> = {
  FAST: { command: "composer.toggleFastMode", requiredAccess: null },
  "MIND+": { command: "composer.increaseReasoningEffort", requiredAccess: null },
  "MIND-": { command: "composer.decreaseReasoningEffort", requiredAccess: null },
  TERM: { command: "toggleTerminal", requiredAccess: "codexLocal" },
  DIFF: { command: "toggleReviewTab", requiredAccess: "codexLocal" },
  NAV: { command: "openBrowserTab", requiredAccess: null },
  SETUP: { command: "settings", requiredAccess: null },
  APPS: { command: "openSkills", requiredAccess: "codexLocal" },
  NEW: { command: "newTask", requiredAccess: null },
  SPLIT: { command: "forkThread", requiredAccess: null },
  DEL: { command: "archiveThread", requiredAccess: null },
  LAB: { command: "settings", requiredAccess: null },
  DWN: { command: "copyConversationMarkdown", requiredAccess: null },
  PARTY: { command: "openSideChat", requiredAccess: "codexLocal" },
  TIME: { command: "manageTasks", requiredAccess: null },
  FOLD: { command: "openFolder", requiredAccess: "codexOrWorkLocal" },
  GIT: { command: "git.commit", requiredAccess: "codexLocal" },
  APPR: { command: "approval.approve", requiredAccess: null },
  REJ: { command: "approval.decline", requiredAccess: null },
  CODEX: { command: "composer.submit", requiredAccess: null },
  BUG: { command: "feedback", requiredAccess: null },
  MAGIC: { command: "toggleThreadPin", requiredAccess: null },
  PLAY: { command: "environmentAction1", requiredAccess: null },
  BRCH: { command: "git.createDraftPullRequest", requiredAccess: null },
  BRANCH: { command: "git.createBranch", requiredAccess: null },
  MRG: { command: "git.mergePullRequest", requiredAccess: null },
  PR: { command: "git.createPullRequest", requiredAccess: "codexLocal" },
  PAINT: { command: "composer.addPhotos", requiredAccess: null },
  UPL: { command: "composer.addFiles", requiredAccess: null },
};
// 26.908 retains these public keycap actions while changing the runtime
// exports that execute them. Keep the release contract explicit so a valid
// layout digest cannot silently authorize a remapped key.
export const REVIEWED_STANDALONE_KEYCAPS_26908 = REVIEWED_STANDALONE_KEYCAPS_26903;
export const REVIEWED_KEYCAP_COMMANDS_26908 = REVIEWED_KEYCAP_COMMANDS_26903;
export const ALLOWED_NATIVE_EXTERNAL_URLS = ["https://developers.openai.com/"] as const;
