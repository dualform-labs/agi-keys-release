# Codex Keys for Stream Deck+

CodexをStream Deck+のキーとダイヤルから操作するMac用プラグインです。タスク名・現在のモデル・思考レベル・使用量を表示し、音声入力、送信、サイドチャットなどを自由に配置できます。Action Listは67件です。

現在は検証中です。0.1.0.60のショートカット登録と音声入力について、利用者の実機成功を確認しています。0.1.0.62のコンテキスト圧縮も利用者の実機成功を確認しています。全キー・ダイヤルと再起動後の接続復帰を網羅した最終受け入れは未完了です。

互換性のため、内部UUIDと既存ファイルパスは従来の`io.local.codexdeck.microplus`を保持します。

## 開発と検証

```sh
npm ci
npm ci --prefix packages/microplus
npm run check
npm test
npm run microplus:pack
```

ビルドにはmacOSのSwiftコンパイラーが必要です。生成物は`packages/microplus/dist/`へ出力されます。型検査・自動テスト・パッケージ検証と、実機のキー／ダイヤル／音声確認は別に記録します。

## コード構成

| パス | 責務 |
|---|---|
| `packages/microplus/src/` | Stream Deck入力、Codex接続、状態・描画 |
| `packages/microplus/static/property-inspector/` | Stream Deckアプリ内の設定画面 |
| `packages/microplus/launcher/` | 接続状態の確認・明示的な起動支援 |
| `packages/microplus/native/` | 登録したショートカットの押下・解放を送信 |
| `packages/discovery/` | Codexアプリ内コマンドの読み取り専用調査 |
| `packages/desktop/` | 製品とは分離した接続研究・検証アダプター |
| `scripts/` | ビルド検証、プロファイル管理 |

配布用ソースには製品コード・テスト・ライセンス・ビルド検証用スクリプトを含めます。ローカル作業記録、非公開リポジトリへの公開スクリプト、生成済みファイルに依存する復旧ショートカットは含めません。

旧版の司令塔構成からの移行は完了しました。旧Web manager、managed agent、一括実行、workflow、予約、通知は配布対象に含めません。公開前の確認事項は [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) を参照してください。

## 目標の操作面

- 6 Agent slot: タスク名、選択状態、待機、実行中、完了、入力待ち、エラー
- 7 ACT位置: ACT06〜ACT12を別々のActionとして表示・実行
- Plan、Back、Forward、Sidebar
- Reasoning、設定依存の左右操作
- New task、39件のカタログから実行可能な34種のkeycap action、使用量、reset credit
- Stream Deck+の左3ダイヤルとLCD。右端は全ページ共通のページ切替

## 接続の前提

Codex Micro相当の操作は公開APIではなく、Codexのnative Micro handlerへloopback CDP経由で接続します。Codexアプリを変更せず、endpointは`127.0.0.1`のランダムportだけを使います。互換性確認に失敗した操作は実行せず、キーとLCDへ未接続を表示します。

通常起動中のCodexを勝手に終了しません。開発中の型検査や模擬テストは、物理Stream DeckからCodexまでの動作証拠とは分けて扱います。

## 由来

Micro互換接続の基線にはMITライセンスの [dazer1234/codex-stream-deck](https://github.com/dazer1234/codex-stream-deck) を使用します。取り込んだコードと配布物には元ライセンスとnoticeを保持します。

### 音声入力キーのショートカット登録

Stream Deckアプリで音声入力キーを選び、「ショートカットを登録」をクリックして、アプリの録音切替に設定したキーを押して離します。設定はキーごとに保存されます。Escapeまたは設定画面からのフォーカス移動でキャンセルします。OSがショートカットを先に処理して画面が切り替わる場合、登録は完了しません。

初期値は右Optionです。対応する入力は左右のCommand・Option・Control・Shift、英字、数字、Space、Enter、F1〜F12と修飾キーの組み合わせです。アプリ側の設定を自動変更する機能ではありません。録音停止中から使い、押下中にアプリ側で手動切替をしないでください。0.1.0.60では利用者の実機成功を確認しています。すべてのショートカットや環境での確認を意味するものではありません。

## ライセンスと公開前確認

このリポジトリのコードには、別途表記された第三者コードを除き、[MITライセンス](LICENSE)を適用します。第三者コードの帰属は [THIRD_PARTY_NOTICE.md](packages/microplus/THIRD_PARTY_NOTICE.md) を参照してください。公開前の残確認は [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) に記載しています。

## リリース候補

導入と既知の制限は [RELEASE_NOTES.md](RELEASE_NOTES.md) を参照してください。Codex Keysは非公式プラグインであり、OpenAI、Elgato、Work Louderの公式製品ではありません。
