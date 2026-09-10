(() => {
  const COMMON_DEFAULTS = {
    label: "",
    language: "ja",
    textSize: "normal",
    theme: "auto",
    showDetails: true,
    animation: true,
    focusBeforeAction: false,
    unopenedTaskBehavior: "current-window",
    pressBehavior: "none",
    pressCommand: "",
  };

  const DIAL_DEFAULTS = {
    ...COMMON_DEFAULTS,
    reverseDial: false,
    dialStep: 1,
    dialTouchBehavior: "press",
    dialLongPressBehavior: "none",
  };

  const DIRECT_COMMAND_IDS = new Set(["CODEX", "NEW", "PARTY", "APPR", "REJ", "FAST"]);

  const GROUP_LABELS = {
    ja: {
      "behavior-group-basic": "基本",
      "behavior-group-common": "よく使う操作",
      "behavior-group-model": "モデルと推論",
      "behavior-group-other": "その他",
      "command-group-conversation": "会話と推論",
      "command-group-chat": "チャットと表示",
      "command-group-development": "開発",
      "command-group-workspace": "ツールとワークスペース",
    },
    en: {
      "behavior-group-basic": "Basic",
      "behavior-group-common": "Common actions",
      "behavior-group-model": "Model & reasoning",
      "behavior-group-other": "Other",
      "command-group-conversation": "Conversation & reasoning",
      "command-group-chat": "Chat & view",
      "command-group-development": "Development",
      "command-group-workspace": "Tools & workspace",
    },
  };

  const COMMAND_LABELS = {
    ja: {
      FAST: "高速モード", APPR: "承認", REJ: "拒否", SPLIT: "チャットを分岐", CODEX: "メッセージ送信", NEW: "新しいチャット", "MIND+": "推論を上げる", "MIND-": "推論を下げる",
      DWN: "チャットをMarkdownコピー", DEL: "チャットをアーカイブ", NAV: "ブラウザータブ", MAGIC: "チャットをピン留め", DIFF: "レビュー表示", PARTY: "サイドチャット", TIME: "タスク管理", BUG: "フィードバック",
      PLAY: "主アクション実行", GIT: "コミットまたはPush", BRCH: "ドラフトPR作成", BRANCH: "ブランチ作成", MRG: "PRをマージ", PR: "PR作成", PAINT: "写真を追加", LAB: "Codex Micro設定",
      OAI: "OpenAIドキュメント", TERM: "ターミナル", SETUP: "設定", FOLD: "フォルダーを開く", UPL: "ファイルを添付", APPS: "プラグイン", YOLO: ":yolo:を入力", YEET: ":yeet:を入力",
    },
    en: {
      FAST: "Fast mode", APPR: "Approve", REJ: "Reject", SPLIT: "Split chat", CODEX: "Send message", NEW: "New task", "MIND+": "Increase reasoning", "MIND-": "Decrease reasoning",
      DWN: "Copy chat as Markdown", DEL: "Archive chat", NAV: "Browser tab", MAGIC: "Pin chat", DIFF: "Show review", PARTY: "Side chat", TIME: "Task manager", BUG: "Feedback",
      PLAY: "Run main action", GIT: "Commit or push", BRCH: "Create draft PR", BRANCH: "Create branch", MRG: "Merge PR", PR: "Create PR", PAINT: "Add photos", LAB: "Codex Micro settings",
      OAI: "OpenAI docs", TERM: "Terminal", SETUP: "Settings", FOLD: "Open folder", UPL: "Attach files", APPS: "Plugins", YOLO: "Type :yolo:", YEET: "Type :yeet:",
    },
  };

  const BASE_TRANSLATIONS = {
    ja: {
      labels: {
        "label-title": "表示名",
        "language-title": "言語",
        "text-size-title": "文字サイズ",
        "theme-title": "テーマ",
        "details-title": "詳細を表示",
        "animation-title": "アニメーション",
        "focus-title": "ChatGPT／Codexを最前面にする",
        "unopened-task-title": "未表示チャットの開き方",
        "unopened-task-help": "直近に使ったCodexウィンドウ内でタスクを切り替えます。",
        "press-title": "押した時",
        "press-command-title": "Codex操作",
        "press-help": "カスタム操作とVoice PTTは、表示中の枠ではなく現在のCodex Composerを操作します。",
        "reverse-dial-title": "回転を反転",
        "dial-step-title": "1目盛りの移動量",
        "dial-touch-title": "タッチ時",
        "dial-long-title": "タッチ長押し時",
        "context-rings-title": "コンテキストリング",
        "context-rings-help": "この設定は、このコンピューター上の6つのCodexエージェントキーすべてに適用されます。",
      },
      options: {
        ja: "日本語", en: "English", normal: "標準", large: "大", auto: "自動", dark: "ダーク", light: "ライト",
        "current-window": "現在のウィンドウ", "new-window": "新しいウィンドウ",
        none: "既定の操作", press: "ダイヤル押下を実行", disabled: "何もしない", refresh: "使用量を更新", focus: "ChatGPT／Codexを最前面にする", ptt: "Voice PTT（押している間）", command: "すべてのCodex操作から選ぶ",
        "command:CODEX": "現在のCodexに送信", "command:NEW": "新しいタスク", "command:PARTY": "サイドチャット", "command:APPR": "承認", "command:REJ": "拒否", "command:FAST": "高速モード",
        "model-next": "次のモデル", "model-previous": "前のモデル", "reasoning-increase": "推論を上げる", "reasoning-decrease": "推論を下げる", "": "選択してください",
      },
      groups: GROUP_LABELS.ja,
      placeholder: "既定",
    },
    en: {
      labels: {
        "label-title": "Label",
        "language-title": "Language",
        "text-size-title": "Text size",
        "theme-title": "Theme",
        "details-title": "Show details",
        "animation-title": "Animation",
        "focus-title": "Bring ChatGPT / Codex to front",
        "unopened-task-title": "When the chat is not open",
        "unopened-task-help": "Switches tasks within the most recently used Codex window.",
        "press-title": "On press",
        "press-command-title": "Codex action",
        "press-help": "Custom actions and Voice PTT operate the current Codex Composer; they do not select the displayed slot first.",
        "reverse-dial-title": "Reverse rotation",
        "dial-step-title": "Movement per tick",
        "dial-touch-title": "On touch",
        "dial-long-title": "On touch hold",
        "context-rings-title": "Context ring",
        "context-rings-help": "This global option applies to all six Codex agent keys on this computer.",
      },
      options: {
        ja: "Japanese", en: "English", normal: "Normal", large: "Large", auto: "Automatic", dark: "Dark", light: "Light",
        "current-window": "Current window", "new-window": "New window",
        none: "Default action", press: "Run dial press", disabled: "Do nothing", refresh: "Refresh usage", focus: "Bring ChatGPT / Codex to front", ptt: "Voice PTT (while held)", command: "Choose from all Codex actions",
        "command:CODEX": "Send to current Codex", "command:NEW": "New task", "command:PARTY": "Side chat", "command:APPR": "Approve", "command:REJ": "Reject", "command:FAST": "Fast mode",
        "model-next": "Next model", "model-previous": "Previous model", "reasoning-increase": "Increase reasoning", "reasoning-decrease": "Decrease reasoning", "": "Select an action",
      },
      groups: GROUP_LABELS.en,
      placeholder: "Default",
    },
  };

  const USAGE_TRANSLATIONS = {
    ja: {
      labels: {
        ...BASE_TRANSLATIONS.ja.labels,
        "label-title": "表示名", "language-title": "言語", "text-size-title": "文字サイズ", "theme-title": "テーマ", "details-title": "詳細を表示",
        "animation-title": "アニメーション", "focus-title": "ChatGPT／Codexを最前面にする", "press-title": "押した時", "press-command-title": "Codex操作", "mode-title": "使用枠",
      },
      options: {
        ja: "日本語", en: "English", normal: "標準", large: "大", auto: "自動", dark: "ダーク", light: "ライト",
        none: "追加操作なし", disabled: "何もしない", refresh: "使用量を更新", focus: "ChatGPT／Codexを最前面にする", ptt: "Voice PTT（押している間）", command: "すべてのCodex操作から選ぶ",
        "command:CODEX": "メッセージを送信", "command:NEW": "新しいタスク", "command:PARTY": "サイドチャット", "command:APPR": "承認", "command:REJ": "拒否", "command:FAST": "高速モード",
        "model-next": "次のモデル", "model-previous": "前のモデル", "reasoning-increase": "推論を上げる", "reasoning-decrease": "推論を下げる", "": "選択してください", "five-hour": "5時間", weekly: "週間",
      },
      groups: GROUP_LABELS.ja,
      commands: COMMAND_LABELS.ja,
      help: "自動は5時間枠を優先し、利用できない場合は週間枠に切り替えます。",
      placeholder: "既定",
    },
    en: {
      labels: {
        ...BASE_TRANSLATIONS.en.labels,
        "label-title": "Label", "language-title": "Language", "text-size-title": "Text size", "theme-title": "Theme", "details-title": "Show details",
        "animation-title": "Animation", "focus-title": "Bring ChatGPT / Codex to front", "press-title": "On press", "press-command-title": "Codex action", "mode-title": "Usage window",
      },
      options: {
        ja: "Japanese", en: "English", normal: "Normal", large: "Large", auto: "Automatic", dark: "Dark", light: "Light",
        none: "No extra action", disabled: "Do nothing", refresh: "Refresh usage", focus: "Bring ChatGPT / Codex to front", ptt: "Voice PTT (while held)", command: "Choose from all Codex actions",
        "command:CODEX": "Send message", "command:NEW": "New task", "command:PARTY": "Side chat", "command:APPR": "Approve", "command:REJ": "Reject", "command:FAST": "Fast mode",
        "model-next": "Next model", "model-previous": "Previous model", "reasoning-increase": "Increase reasoning", "reasoning-decrease": "Decrease reasoning", "": "Select a command", "five-hour": "5 hours", weekly: "Weekly",
      },
      groups: GROUP_LABELS.en,
      commands: { ...COMMAND_LABELS.en, NEW: "New chat" },
      help: "Automatic prefers the 5-hour window and falls back to weekly when it is unavailable.",
      placeholder: "Default",
    },
  };

  const CONTEXT_COMPACTION_TRANSLATIONS = {
    ja: {
      labels: {
        ...BASE_TRANSLATIONS.ja.labels,
        "press-help": "既定では現在のCodexタスクにネイティブ圧縮を要求します。表示操作を選ぶと圧縮は実行しません。",
      },
      options: {
        ...BASE_TRANSLATIONS.ja.options,
        none: "コンテキストを圧縮", disabled: "何もしない", refresh: "表示を更新", focus: "ChatGPT／Codexを最前面にする",
      },
      groups: GROUP_LABELS.ja,
      placeholder: "既定",
    },
    en: {
      labels: {
        ...BASE_TRANSLATIONS.en.labels,
        "press-help": "The default requests native compaction for the active Codex task. Display actions leave context unchanged.",
      },
      options: {
        ...BASE_TRANSLATIONS.en.options,
        none: "Compact context", disabled: "Do nothing", refresh: "Refresh display", focus: "Bring ChatGPT / Codex to front",
      },
      groups: GROUP_LABELS.en,
      placeholder: "Default",
    },
  };

  function element(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const target = element(id);
    if (target) target.textContent = value;
  }

  function setGroupLabel(id, value) {
    const target = element(id);
    if (target) target.label = value;
  }

  function applyLanguage(value, options) {
    const language = value === "en" ? "en" : "ja";
    const selected = options.locale === "usage"
      ? USAGE_TRANSLATIONS[language]
      : options.locale === "context-compaction"
        ? CONTEXT_COMPACTION_TRANSLATIONS[language]
        : BASE_TRANSLATIONS[language];
    for (const [id, text] of Object.entries(selected.labels)) setText(id, text);
    for (const option of document.querySelectorAll(options.optionSelector)) {
      const text = selected.options[option.value] ?? selected.commands?.[option.value] ?? COMMAND_LABELS[language][option.value];
      if (text !== undefined) option.textContent = text;
    }
    for (const [id, text] of Object.entries(selected.groups)) setGroupLabel(id, text);
    if (selected.help !== undefined) setText("mode-help", selected.help);
    if (selected.placeholder !== undefined) {
      const label = element("label");
      if (label) label.placeholder = selected.placeholder;
    }
    if (options.updateDocumentLanguage && document.documentElement) document.documentElement.lang = language;
  }

  function mount(options) {
    let websocket;
    let pluginContext;
    let actionUUID;
    // Stream Deck validates outbound PI commands with uuid, while inbound action events carry actionInfo.context.
    let commandContext;
    let actionContext;
    let settings = {};
    let globalSettings = {};

    const shortcutButton = element("shortcut-record");
    const shortcutCancel = element("shortcut-cancel");
    let shortcutState = "idle";
    function renderShortcut() {
      const en = settings.language === "en";
      const section = element("dictation-shortcut-options");
      if (section) section.hidden = actionUUID !== "io.local.codexdeck.microplus.global-dictation";
      const shortcut = settings.globalDictationShortcut ?? { code: "AltRight", modifiers: [] };
      setText("shortcut-title", en ? "Dictation toggle shortcut" : "音声入力の切替キー");
      const labels = { AltRight: en ? "Right Option" : "右Option", AltLeft: en ? "Left Option" : "左Option", MetaRight: en ? "Right Command" : "右Command", MetaLeft: en ? "Left Command" : "左Command" };
      setText("shortcut-value", typeof shortcut === "object" && shortcut ? [...(shortcut.modifiers ?? []), shortcut.code].map(code => labels[code] ?? code).join(" + ") : String(shortcut));
      setText("shortcut-record", en ? "Record shortcut" : "ショートカットを登録");
      setText("shortcut-cancel", en ? "Cancel" : "キャンセル");
      const messages = {
        idle: en ? "Match the app's toggle shortcut. Press and release the shortcut to register." : "アプリの録音切替と同じキーを登録してください。キーを押して離すと保存します。",
        recording: en ? "Press your shortcut. Escape cancels." : "登録するキーを押してください。Escapeでキャンセル。",
        unsupported: en ? "Unsupported key. Try another shortcut." : "このキーは未対応です。別のキーを押してください。",
        "release-first": en ? "Release all modifiers, then press the shortcut again." : "修飾キーをすべて離してから、もう一度押してください。",
        disconnected: en ? "Not connected. Shortcut was not saved; reconnect and try again." : "未接続のため保存できませんでした。再接続後に登録してください。",
        saved: en ? "Saved for this key." : "このキーに保存しました。",
        cancelled: en ? "Cancelled. Previous shortcut retained." : "キャンセルしました。以前の設定を保持します。"
      };
      setText("shortcut-help", messages[shortcutState]);
      if (shortcutCancel) shortcutCancel.hidden = !shortcutRecorder?.active;
    }
    const shortcutRecorder = window.CodexShortcutRecorder?.create(value => {
      if (websocket?.readyState !== WebSocket.OPEN) return false;
      settings = { ...settings, globalDictationShortcut: value }; sendSettings();
      return true;
    }, state => { shortcutState = state; renderShortcut(); });
    shortcutButton?.addEventListener("click", () => { shortcutRecorder.start(); shortcutState = "recording"; renderShortcut(); });
    shortcutCancel?.addEventListener("click", () => { shortcutRecorder.cancel(); shortcutState = "cancelled"; renderShortcut(); });
    if (shortcutRecorder) {
      window.addEventListener("keydown", event => shortcutRecorder.keydown(event), true);
      window.addEventListener("keyup", event => shortcutRecorder.keyup(event), true);
      window.addEventListener("blur", () => { if (shortcutRecorder.active) { shortcutRecorder.cancel(); shortcutState = "cancelled"; renderShortcut(); } });
    }

    const defaults = options.defaults;
    const checkboxIds = new Set(options.checkboxIds);
    const numberIds = new Set(options.numberIds ?? []);

    function applySettings(next) {
      settings = { ...settings, ...next };
      for (const id of options.preferenceIds) {
        const target = element(id);
        if (!target) continue;
        const configured = settings[id] ?? defaults[id];
        const value = id === "unopenedTaskBehavior"
          && configured !== "new-window"
          && configured !== "current-window"
          ? "current-window"
          : configured;
        if (checkboxIds.has(id)) target.checked = value === true;
        else target.value = String(value);
      }
      const pressBehavior = element("pressBehavior");
      const command = typeof settings.pressCommand === "string" ? settings.pressCommand : "";
      if (pressBehavior) {
        pressBehavior.value = settings.pressBehavior === "command" && settings.pressCatalog !== true && DIRECT_COMMAND_IDS.has(command)
          ? `command:${command}`
          : String(settings.pressBehavior ?? defaults.pressBehavior);
      }
      const commandRow = element("press-command-row");
      if (commandRow && pressBehavior) commandRow.hidden = pressBehavior.value !== "command";
      if (options.mode) {
        const mode = element("mode");
        if (mode) mode.value = ["auto", "five-hour", "weekly"].includes(settings.mode) ? settings.mode : "auto";
      }
      applyLanguage(settings.language, options);
      renderShortcut();
    }

    function sendSettings() {
      if (websocket?.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ event: "setSettings", action: actionUUID, context: commandContext, payload: settings }));
      }
    }

    function save(id, target) {
      const value = checkboxIds.has(id) ? target.checked : numberIds.has(id) ? Number(target.value) : target.value;
      settings = { ...settings, [id]: value };
      if (id === "language") { applyLanguage(target.value, options); renderShortcut(); }
      sendSettings();
    }

    function savePressBehavior(target) {
      if (target.value.startsWith("command:")) {
        settings = { ...settings, pressBehavior: "command", pressCatalog: false, pressCommand: target.value.slice("command:".length) };
      } else if (target.value === "command") {
        // Opening the catalog is a presentation change, not a new assignment.
        // Preserve the selected command until the user chooses its replacement.
        settings = { ...settings, pressBehavior: "command", pressCatalog: true };
      } else {
        settings = { ...settings, pressBehavior: target.value };
      }
      const commandRow = element("press-command-row");
      if (commandRow) commandRow.hidden = target.value !== "command";
      sendSettings();
    }

    window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
      const action = JSON.parse(actionInfo);
      pluginContext = uuid;
      actionUUID = action.action;
      commandContext = uuid;
      actionContext = action.context;
      options.configureAction?.(action);
      settings = {};
      applySettings(action.payload?.settings ?? {});
      websocket = new WebSocket(`ws://127.0.0.1:${port}`);
      websocket.addEventListener("open", () => {
        websocket.send(JSON.stringify({ event: registerEvent, uuid }));
        if (options.globalSettings) websocket.send(JSON.stringify({ event: "getGlobalSettings", context: pluginContext }));
      });
      websocket.addEventListener("message", (message) => {
        const event = JSON.parse(message.data);
        if (options.globalSettings && event.event === "didReceiveGlobalSettings") {
          globalSettings = event.payload?.settings ?? {};
          const contextRings = element("show-context-rings");
          if (contextRings) contextRings.checked = globalSettings.showContextRings !== false;
        }
        if (event.event === "didReceiveSettings" && event.context === actionContext) applySettings(event.payload?.settings ?? {});
      });
    };

    for (const id of options.preferenceIds) {
      const target = element(id);
      if (target) target.addEventListener("change", (event) => save(id, event.target));
    }
    const pressBehavior = element("pressBehavior");
    if (pressBehavior) pressBehavior.addEventListener("change", (event) => savePressBehavior(event.target));

    if (options.mode) {
      const mode = element("mode");
      if (mode) mode.addEventListener("change", (event) => {
        settings = { ...settings, mode: event.target.value };
        sendSettings();
      });
    }

    if (options.globalSettings) {
      const contextRings = element("show-context-rings");
      if (contextRings) contextRings.addEventListener("change", (event) => {
        globalSettings = { ...globalSettings, showContextRings: event.target.checked };
        if (websocket?.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ event: "setGlobalSettings", context: pluginContext, payload: globalSettings }));
        }
      });
    }
  }

  window.CodexPropertyInspector = Object.freeze({
    common(options = {}) {
      mount({
        locale: "base",
        optionSelector: "option",
        updateDocumentLanguage: true,
        preferenceIds: ["label", "language", "textSize", "theme", "showDetails", "animation", "focusBeforeAction", "reverseDial", "dialStep", "dialTouchBehavior", "dialLongPressBehavior", "pressCommand"],
        checkboxIds: ["showDetails", "animation", "focusBeforeAction", "reverseDial"],
        numberIds: ["dialStep"],
        defaults: DIAL_DEFAULTS,
        configureAction(action) {
          const dialOptions = element("dial-options");
          const pressOptions = element("press-options");
          if (dialOptions) dialOptions.hidden = action.payload?.controller !== "Encoder";
          if (pressOptions) pressOptions.hidden = action.action !== "io.local.codexdeck.microplus.rate-limit-reset";
        },
        ...options,
      });
    },
    agent(options = {}) {
      mount({
        locale: "base",
        optionSelector: "option",
        updateDocumentLanguage: true,
        preferenceIds: ["label", "language", "textSize", "theme", "showDetails", "animation", "focusBeforeAction", "unopenedTaskBehavior", "pressCommand"],
        checkboxIds: ["showDetails", "animation", "focusBeforeAction"],
        defaults: COMMON_DEFAULTS,
        globalSettings: true,
        ...options,
      });
    },
    usage(options = {}) {
      mount({
        locale: "usage",
        optionSelector: "option",
        updateDocumentLanguage: true,
        preferenceIds: ["label", "language", "textSize", "theme", "showDetails", "animation", "focusBeforeAction", "pressCommand"],
        checkboxIds: ["showDetails", "animation", "focusBeforeAction"],
        defaults: COMMON_DEFAULTS,
        mode: true,
        configureAction(action) {
          const isOverview = action.action === "io.local.codexdeck.microplus.usage-overview";
          const modeRow = element("mode-row");
          const modeHelp = element("mode-help");
          if (modeRow) modeRow.hidden = isOverview;
          if (modeHelp) modeHelp.hidden = isOverview;
        },
        ...options,
      });
    },
    contextCompaction(options = {}) {
      mount({
        locale: "context-compaction",
        optionSelector: "option",
        updateDocumentLanguage: true,
        preferenceIds: ["label", "language", "textSize", "theme", "showDetails", "animation", "focusBeforeAction", "pressCommand"],
        checkboxIds: ["showDetails", "animation", "focusBeforeAction"],
        defaults: COMMON_DEFAULTS,
        ...options,
      });
    },
  });
})();
