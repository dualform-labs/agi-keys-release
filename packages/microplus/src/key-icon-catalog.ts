import type { OfficialKeycapId } from "./keycaps.js";

export type KeyIcon = { ja: string; en: string; glyph: string };
const icon = (ja: string, en: string, glyph: string): KeyIcon => ({ ja, en, glyph });
const mic = '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/>';
const branch = '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 7v2c0 4-12 2-12 7"/>';
const settings = '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>';
const empty = (n: number) => icon(`空き ${n}`, `SLOT ${n}`, '<rect x="4" y="4" width="16" height="16" rx="4" stroke-dasharray="2 3"/><path d="M9 12h6M12 9v6"/>');

/** Original paths. Names describe native behavior rather than historical key IDs. */
export const KEY_ICON_CATALOG: Record<OfficialKeycapId, KeyIcon> = {
  FAST: icon("高速", "FAST", '<path d="M14 2L5 13h6l-1 9 9-12h-6z"/>'),
  APPR: icon("承認", "APPROVE", '<circle cx="12" cy="12" r="9"/><path d="M7 12l3 3 7-7"/>'),
  REJ: icon("拒否", "REJECT", '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>'),
  SPLIT: icon("分岐", "FORK CHAT", '<path d="M12 21V11M12 11L5 4M12 11l7-7M5 9V4h5M14 4h5v5"/>'),
  MIC: icon("押して話す", "HOLD TO TALK", mic),
  MIC1: icon("押して話す", "HOLD TO TALK", mic),
  CODEX: icon("送信", "SEND", '<path d="M12 20V4M5 11l7-7 7 7"/>'),
  BUG: icon("報告", "FEEDBACK", '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M9 7V5a3 3 0 0 1 6 0v2M3 10h4M17 10h4M3 16h4M17 16h4M12 10v7"/>'),
  OAI: icon("開発資料", "DOCS", '<path d="M12 5c-4-3-8-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-1-1-5-2-9 1zM12 5v15"/>'),
  TERM: icon("端末", "TERMINAL", '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 9l3 3-3 3M12 15h5"/>'),
  DWN: icon("コピー", "COPY MD", '<rect x="7" y="7" width="13" height="15" rx="2"/><path d="M16 7V3H3v14h4M10 12h7M10 16h5"/>'),
  DEL: icon("保管", "ARCHIVE", '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>'),
  NEW: icon("新規", "NEW CHAT", '<path d="M20 13v5a2 2 0 0 1-2 2H8l-5 2V5a2 2 0 0 1 2-2h8M18 2v8M14 6h8"/>'),
  NAV: icon("ブラウザー", "BROWSER", '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="M2 8h20M6 5.5h.1M9 5.5h.1M9 12l-3 3 3 3M15 12l3 3-3 3"/>'),
  MAGIC: icon("ピン", "PIN", '<path d="M8 3h8l-1 7 4 4v2H5v-2l4-4zM12 16v6"/>'),
  DIFF: icon("差分", "REVIEW", '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18M6 9h3M7.5 7.5v3M15 15h3"/>'),
  PLAY: icon("実行", "RUN", '<path d="M7 3l14 9L7 21z"/>'),
  GIT: icon("コミット", "COMMIT", '<circle cx="12" cy="12" r="5"/><path d="M2 12h5M17 12h5"/>'),
  BRCH: icon("下書きPR", "DRAFT PR", branch + '<path d="M13 19h8" stroke-dasharray="1 2"/>'),
  BRANCH: icon("ブランチ", "BRANCH", branch),
  MRG: icon("マージ", "MERGE", '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 6v3c0 4 6 2 6 7v2M18 6v3c0 4-6 2-6 7"/>'),
  PR: icon("PR作成", "CREATE PR", '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/><path d="M6 6v12M18 18V8c0-3-2-4-5-4M16 1l-3 3 3 3"/>'),
  PAINT: icon("写真", "PHOTO", '<rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="M3 18l6-6 4 4 4-6 5 7"/>'),
  LAB: icon("Micro設定", "MICRO SETTINGS", '<path d="M9 2h6M10 2v7L4 19q-1 3 2 3h12q3 0 2-3L14 9V2M7 15h10"/>'),
  PARTY: icon("サイド会話", "SIDE CHAT", '<path d="M14 12v3H7l-4 3V3h14v5M10 9h11v12l-4-2h-7z"/>'),
  TIME: icon("タスク", "TASKS", '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6 8l1 1 2-2M12 8h5M6 14l1 1 2-2M12 14h5"/>'),
  "MIND+": icon("推論＋", "THINK +", '<path d="M8 18H5V8l7-5 7 5v10h-3M8 18v3h8v-3M12 8v7M8.5 11.5h7"/>'),
  "MIND-": icon("推論−", "THINK −", '<path d="M8 18H5V8l7-5 7 5v10h-3M8 18v3h8v-3M8.5 11.5h7"/>'),
  EMPT1: empty(1), EMPT2: empty(2), EMPT3: empty(3), EMPT4: empty(4), EMPT5: empty(5),
  SETUP: icon("設定", "SETTINGS", settings),
  FOLD: icon("フォルダー", "FOLDER", '<path d="M2 6V4h7l3 3h10v13H2zM2 10h20"/>'),
  UPL: icon("添付", "ATTACH", '<path d="M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2M6 15l9-9"/>'),
  APPS: icon("プラグイン", "PLUGINS", '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 17.5h7M17.5 14v7"/>'),
  YOLO: icon(":yolo:", ":yolo:", '<circle cx="12" cy="12" r="9"/><path d="M7 9h2M15 9h2M7 14q5 6 10 0"/>'),
  YEET: icon(":yeet:", ":yeet:", '<path d="M3 16h7M6 20h4M11 15L21 3M14 3h7v7M4 8l3-3 4 3-4 3z"/>'),
};
