export const OFFICIAL_KEYCAP_IDS = [
  "FAST", "APPR", "REJ", "SPLIT", "MIC", "MIC1", "CODEX", "BUG", "OAI", "TERM", "DWN",
  "DEL", "NEW", "NAV", "MAGIC", "DIFF", "PLAY", "GIT", "BRCH", "BRANCH", "MRG", "PR",
  "PAINT", "LAB", "PARTY", "TIME", "MIND+", "MIND-", "EMPT1", "EMPT2", "EMPT3", "EMPT4",
  "SETUP", "FOLD", "UPL", "APPS", "YOLO", "YEET", "EMPT5"
] as const;

export type OfficialKeycapId = typeof OFFICIAL_KEYCAP_IDS[number];

/** The app catalog exposes these as configurable placeholders, not fixed Codex events. */
export const EXCLUDED_KEYCAP_IDS = ["EMPT1", "EMPT2", "EMPT3", "EMPT4", "EMPT5"] as const;

export const ADDITIONAL_KEYCAPS = [
  { id: "FAST", slug: "fast", name: "高速モード", tooltip: "Codex Microの高速モードを切り替えます。" },
  { id: "APPR", slug: "approve", name: "承認", tooltip: "現在のCodex要求を承認します。" },
  { id: "REJ", slug: "reject", name: "拒否", tooltip: "現在のCodex要求を拒否します。" },
  { id: "SPLIT", slug: "split", name: "チャットを分岐", tooltip: "現在のCodexチャットを分岐します。" },
  { id: "MIC", slug: "mic", name: "プッシュトゥトーク（大）", tooltip: "押している間だけCodexの音声入力を開始します。" },
  { id: "MIC1", slug: "mic-single", name: "プッシュトゥトーク", tooltip: "Codexの音声入力を開始します。" },
  { id: "NEW", slug: "new-task", name: "新しいチャット", tooltip: "Native Codex Microの新しいチャットを開きます。" },
  { id: "MIND+", slug: "reasoning-up", name: "推論を上げる", tooltip: "現在のComposerの推論レベルを上げます。" },
  { id: "MIND-", slug: "reasoning-down", name: "推論を下げる", tooltip: "現在のComposerの推論レベルを下げます。" },
  { id: "CODEX", slug: "codex", name: "メッセージ送信", tooltip: "現在のComposerのメッセージを送信します。" },
  { id: "BUG", slug: "bug", name: "フィードバック", tooltip: "Codexのフィードバック画面を開きます。" },
  { id: "OAI", slug: "openai-docs", name: "OpenAIドキュメント", tooltip: "OpenAI公式開発者ドキュメントを開きます。" },
  { id: "TERM", slug: "terminal", name: "ターミナル", tooltip: "Codexのターミナル表示を切り替えます。" },
  { id: "DWN", slug: "download", name: "チャットをMarkdownコピー", tooltip: "現在の会話をMarkdownとしてコピーします。" },
  { id: "DEL", slug: "archive", name: "チャットをアーカイブ", tooltip: "現在のCodexチャットをアーカイブします。" },
  { id: "NAV", slug: "browser", name: "ブラウザータブ", tooltip: "Codexのブラウザータブを開きます。" },
  { id: "MAGIC", slug: "pin", name: "チャットをピン留め", tooltip: "現在のチャットのピン留めを切り替えます。" },
  { id: "DIFF", slug: "diff", name: "レビュー表示", tooltip: "Codexのレビュー表示を切り替えます。" },
  { id: "PLAY", slug: "play", name: "主アクション実行", tooltip: "設定済み環境アクションの先頭を実行します。" },
  { id: "GIT", slug: "git-commit", name: "コミットまたはPush", tooltip: "Native CodexのGitコミット操作を開きます。" },
  { id: "BRCH", slug: "branch", name: "ドラフトPR作成", tooltip: "CodexでドラフトPR作成フローを開きます。" },
  { id: "BRANCH", slug: "create-branch", name: "ブランチ作成", tooltip: "Codexでブランチ作成フローを開きます。" },
  { id: "MRG", slug: "merge", name: "PRをマージ", tooltip: "CodexでPRマージフローを開きます。" },
  { id: "PR", slug: "pull-request", name: "PR作成", tooltip: "Native CodexのPR作成フローを開きます。" },
  { id: "PAINT", slug: "add-photos", name: "写真を追加", tooltip: "現在のComposerに写真を追加します。" },
  { id: "LAB", slug: "lab", name: "Codex Micro設定", tooltip: "Codex Micro設定を開きます。" },
  { id: "PARTY", slug: "side-chat", name: "サイドチャット", tooltip: "Codexのサイドチャットを開きます。" },
  { id: "TIME", slug: "tasks", name: "タスク管理", tooltip: "Codexのタスク管理を開きます。" },
  { id: "EMPT1", slug: "empty-1", name: "ショートカット枠1", tooltip: "Codex Microの空きキー1。Stream Deckでショートカットを割り当てて使用します。" },
  { id: "EMPT2", slug: "empty-2", name: "ショートカット枠2", tooltip: "Codex Microの空きキー2。Stream Deckでショートカットを割り当てて使用します。" },
  { id: "EMPT3", slug: "empty-3", name: "ショートカット枠3", tooltip: "Codex Microの空きキー3。Stream Deckでショートカットを割り当てて使用します。" },
  { id: "EMPT4", slug: "empty-4", name: "ショートカット枠4", tooltip: "Codex Microの空きキー4。Stream Deckでショートカットを割り当てて使用します。" },
  { id: "SETUP", slug: "settings", name: "設定", tooltip: "Codex設定を開きます。" },
  { id: "FOLD", slug: "open-folder", name: "フォルダーを開く", tooltip: "Codexでフォルダーを開きます。" },
  { id: "UPL", slug: "add-files", name: "ファイルを添付", tooltip: "現在のComposerにファイルやフォルダーを添付します。" },
  { id: "APPS", slug: "skills", name: "プラグイン", tooltip: "Codexのプラグイン一覧を開きます。" },
  { id: "YOLO", slug: "yolo", name: ":yolo:を入力", tooltip: "Composerに:yolo:を入力します。" },
  { id: "YEET", slug: "yeet", name: ":yeet:を入力", tooltip: "Composerに:yeet:を入力します。" },
  { id: "EMPT5", slug: "empty-5", name: "ショートカット枠5", tooltip: "Codex Microの空きキー5。Stream Deckでショートカットを割り当てて使用します。" }
] as const satisfies readonly { id: OfficialKeycapId; slug: string; name: string; tooltip: string }[];
