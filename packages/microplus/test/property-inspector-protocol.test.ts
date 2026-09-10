import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS } from "../src/action-preferences.js";
import { OFFICIAL_KEYCAP_IDS } from "../src/keycaps.js";

type Listener = (event: { data?: string; target?: FakeElement }) => void;

class FakeElement {
  checked = false;
  hidden = false;
  value = "";
  placeholder = "";
  textContent = "";
  label = "";
  readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
  }
}

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

for (const inspector of ["common.html", "agent.html", "usage-limit.html", "context-compaction.html"]) {
  test(`${inspector} sends settings with the registered PI context and isolates action responses`, async () => {
    const actionId = inspector === "common.html" ? "io.local.codexdeck.microplus.rate-limit-reset" : "io.local.codexdeck.microplus.test-action";
    const html = await readFile(new URL(`../static/property-inspector/${inspector}`, import.meta.url), "utf8");
    const shared = await readFile(new URL("../static/property-inspector/shared.js", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(script, `${inspector} inline script missing`);
    assert.match(html, /<script\s+src=["']shared\.js["']><\/script>/u, `${inspector} must load the shared PI runtime`);
    assert.match(shared, /CodexPropertyInspector/u, "shared PI runtime is not packaged");
    const commandSelect = html.match(/<select id="pressCommand">([\s\S]*?)<\/select>/u)?.[1];
    assert.ok(commandSelect, `${inspector} must expose the full native command catalog`);
    const commandIds = [...commandSelect.matchAll(/<option value="([^"]+)">/gu)].map((match) => match[1]);
    assert.deepEqual(
      new Set(commandIds),
      new Set(OFFICIAL_KEYCAP_IDS.filter((id) => !(DISPLAY_PRESS_EXCLUDED_KEYCAP_IDS as readonly string[]).includes(id))),
      `${inspector} command catalog must match all 32 executable native commands`,
    );
    for (const value of ["disabled", "ptt", "command:CODEX", "command:NEW", "command:PARTY"]) {
      assert.match(html, new RegExp(`value=["']${value.replace(/[+:]/gu, "\\$&")}["']`), `${inspector} lacks ${value}`);
    }

    const elements = new Map<string, FakeElement>();
    const optionElements = [
      "", "ja", "en", "normal", "large", "auto", "dark", "light", "none", "disabled", "refresh", "focus", "ptt", "command",
      "command:CODEX", "command:NEW", "command:PARTY", "command:APPR", "command:REJ", "command:FAST",
      "model-next", "model-previous", "reasoning-increase", "reasoning-decrease", "five-hour", "weekly",
      "current-window", "new-window",
      "FAST", "APPR", "REJ", "SPLIT", "CODEX", "NEW", "MIND+", "MIND-", "DWN", "DEL", "NAV", "MAGIC", "DIFF", "PARTY", "TIME", "BUG",
      "PLAY", "GIT", "BRCH", "BRANCH", "MRG", "PR", "PAINT", "LAB", "OAI", "TERM", "SETUP", "FOLD", "UPL", "APPS", "YOLO", "YEET",
    ].map((value) => {
      const element = new FakeElement();
      element.value = value;
      return element;
    });
    const sockets: FakeWebSocket[] = [];
    const WebSocket = class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    };
    const window: Record<string, unknown> = {};
    const context = {
      document: {
        documentElement: { lang: "en" },
        getElementById: (id: string) => {
          const element = elements.get(id) ?? new FakeElement();
          elements.set(id, element);
          return element;
        },
        querySelectorAll: (selector: string) => selector.endsWith("option") ? optionElements : [],
      },
      JSON,
      Set,
      String,
      Number,
      WebSocket,
      window,
    };
    runInNewContext(shared, context);
    runInNewContext(script, context);

    const connect = window.connectElgatoStreamDeckSocket as (
      port: string,
      uuid: string,
      registerEvent: string,
      info: string,
      actionInfo: string,
    ) => void;
    assert.equal(typeof connect, "function");
    connect("12345", "property-inspector-uuid", "registerPropertyInspector", "{}", JSON.stringify({
      action: actionId,
      context: "action-instance-context",
      payload: {
        controller: "Encoder",
        settings: {
          language: "ja",
          futureSetting: "keep-me",
          ...(inspector === "agent.html" ? { unopenedTaskBehavior: "new-window" } : {}),
        },
      },
    }));
    const socket = sockets[0];
    assert.ok(socket);
    socket.dispatch("open");
    if (inspector === "common.html") assert.equal(elements.get("press-options")?.hidden, false, "usage reset press settings must be visible");

    if (inspector === "agent.html") {
      socket.dispatch("message", { data: JSON.stringify({
        event: "didReceiveGlobalSettings",
        payload: { settings: { showContextRings: false, futureGlobalSetting: "keep-me" } },
      }) });
      const contextRings = elements.get("show-context-rings");
      assert.ok(contextRings);
      contextRings.checked = true;
      contextRings.dispatch("change");
      assert.deepEqual(JSON.parse(socket.sent.at(-1) ?? "{}"), {
        event: "setGlobalSettings",
        context: "property-inspector-uuid",
        payload: { showContextRings: true, futureGlobalSetting: "keep-me" },
      });
      const unopenedTaskBehavior = elements.get("unopenedTaskBehavior");
      assert.ok(unopenedTaskBehavior);
      assert.equal(unopenedTaskBehavior.value, "new-window", "agent PI must restore the saved window route on load");
      unopenedTaskBehavior.value = "current-window";
      unopenedTaskBehavior.dispatch("change");
      let routeMessage = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
      assert.equal(routeMessage.payload?.unopenedTaskBehavior, "current-window");
      assert.equal(routeMessage.payload?.futureSetting, "keep-me", "unknown settings must survive route changes");
      socket.dispatch("message", { data: JSON.stringify({
        event: "didReceiveSettings",
        context: "action-instance-context",
        payload: { settings: { language: "en", unopenedTaskBehavior: "new-window" } },
      }) });
      assert.equal(unopenedTaskBehavior.value, "new-window", "agent PI must apply the saved route after a reload response");
      socket.dispatch("message", { data: JSON.stringify({
        event: "didReceiveSettings",
        context: "action-instance-context",
        payload: { settings: { unopenedTaskBehavior: "unexpected" } },
      }) });
      assert.equal(unopenedTaskBehavior.value, "current-window", "invalid route settings must display the safe default");
    }

    if (inspector === "context-compaction.html") {
      const focusBeforeAction = elements.get("focusBeforeAction");
      assert.ok(focusBeforeAction, "context compaction inspector must expose focusBeforeAction");
      focusBeforeAction.checked = true;
      focusBeforeAction.dispatch("change");
      const focusMessage = JSON.parse(socket.sent.at(-1) ?? "{}") as {
        action?: unknown;
        context?: unknown;
        payload?: Record<string, unknown>;
      };
      assert.equal(focusMessage.action, actionId);
      assert.equal(focusMessage.context, "property-inspector-uuid");
      assert.equal(focusMessage.payload?.focusBeforeAction, true);
      assert.equal(focusMessage.payload?.futureSetting, "keep-me", "unknown settings must survive focus changes");
    }

    const language = elements.get("language");
    assert.ok(language);
    language.value = "en";
    language.dispatch("change");
    const messages = socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
    assert.ok(messages.some((message) => message.event === "setSettings"
      && message.action === actionId
      && message.context === "property-inspector-uuid"
      && (message.payload as { language?: unknown }).language === "en"));
    assert.ok(!messages.some((message) => message.event === "setSettings" && message.context === "action-instance-context"));

    const pressBehavior = elements.get("pressBehavior");
    assert.ok(pressBehavior, `${inspector} must expose display press behavior`);
    pressBehavior.value = "command:CODEX";
    pressBehavior.dispatch("change");
    let latestPress = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
    assert.equal(latestPress.payload?.pressBehavior, "command");
    assert.equal(latestPress.payload?.pressCommand, "CODEX");
    assert.equal(latestPress.payload?.futureSetting, "keep-me");
    pressBehavior.value = "command";
    pressBehavior.dispatch("change");
    const retained = JSON.parse(socket.sent.at(-1) ?? "{}");
    assert.equal(retained.payload.pressCommand, "CODEX", `${inspector} must preserve the chosen command`);
    assert.equal(retained.payload.pressCatalog, true);
    pressBehavior.value = "command:CODEX";
    pressBehavior.dispatch("change");
    assert.equal(JSON.parse(socket.sent.at(-1) ?? "{}").payload.pressCatalog, false);
    pressBehavior.value = "ptt";
    pressBehavior.dispatch("change");
    latestPress = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
    assert.equal(latestPress.payload?.pressBehavior, "ptt");
    pressBehavior.value = "disabled";
    pressBehavior.dispatch("change");
    latestPress = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
    assert.equal(latestPress.payload?.pressBehavior, "disabled");
    assert.equal(elements.get("focus-title")?.textContent, "Bring ChatGPT / Codex to front");

    if (inspector === "common.html") {
      const touchBehavior = elements.get("dialTouchBehavior");
      const longPressBehavior = elements.get("dialLongPressBehavior");
      assert.ok(touchBehavior && longPressBehavior, "common encoder inspector must expose touch gesture settings");
      touchBehavior.value = "none";
      touchBehavior.dispatch("change");
      longPressBehavior.value = "press";
      longPressBehavior.dispatch("change");
      const gestureSettings = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
      assert.equal(gestureSettings.payload?.dialTouchBehavior, "none");
      assert.equal(gestureSettings.payload?.dialLongPressBehavior, "press");
    }

    if (inspector === "usage-limit.html") {
      const pressCommand = elements.get("pressCommand");
      const pressBehavior = elements.get("pressBehavior");
      const commandRow = elements.get("press-command-row");
      assert.ok(pressCommand && pressBehavior && commandRow);
      pressBehavior.value = "command:CODEX";
      pressBehavior.dispatch("change");
      pressBehavior.value = "command";
      pressBehavior.dispatch("change");
      let genericCommand = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
      assert.equal(genericCommand.payload?.pressBehavior, "command");
      assert.equal(genericCommand.payload?.pressCommand, "CODEX", "opening the catalog must preserve the selected command");
      assert.equal(genericCommand.payload?.pressCatalog, true);
      assert.equal(commandRow.hidden, false, "generic catalog selection must keep the full command row visible");
      socket.dispatch("message", { data: JSON.stringify({
        event: "didReceiveSettings",
        context: "action-instance-context",
        payload: { settings: { pressBehavior: "command", pressCommand: "CODEX", pressCatalog: true } },
      }) });
      assert.equal(pressBehavior.value, "command", "generic catalog behavior must survive a matching settings response");
      assert.equal(commandRow.hidden, false, "matching generic settings must keep the full command row visible");
      pressCommand.value = "TERM";
      pressCommand.dispatch("change");
      pressBehavior.value = "command";
      pressBehavior.dispatch("change");
      genericCommand = JSON.parse(socket.sent.at(-1) ?? "{}") as {
        action?: unknown;
        context?: unknown;
        payload?: { language?: unknown; pressBehavior?: unknown; pressCommand?: unknown };
      };
      assert.deepEqual(genericCommand, {
        event: "setSettings",
        action: actionId,
        context: "property-inspector-uuid",
        payload: {
          language: "en",
          futureSetting: "keep-me",
          pressCommand: "TERM",
          pressBehavior: "command",
          pressCatalog: true,
        },
      });
      assert.equal(commandRow.hidden, false);
      assert.equal(optionElements.find((element) => element.value === "FAST")?.textContent, "Fast mode");
      assert.equal(optionElements.find((element) => element.value === "model-next")?.textContent, "Next model");
      assert.equal(elements.get("command-group-conversation")?.label, "Conversation & reasoning");
    }

    language.value = "ja";
    socket.dispatch("message", { data: JSON.stringify({
      event: "didReceiveSettings",
      context: "another-action-instance",
      payload: { settings: { language: "en" } },
    }) });
    assert.equal(language.value, "ja", "an unrelated instance must not update this inspector");
    if (inspector === "context-compaction.html") {
      assert.equal(elements.get("focusBeforeAction")?.checked, true, "a foreign context must not update focusBeforeAction");
      assert.equal(elements.get("pressBehavior")?.value, "disabled", "a foreign context must not update pressBehavior");
    }
    socket.dispatch("message", { data: JSON.stringify({
      event: "didReceiveSettings",
      context: "action-instance-context",
      payload: { settings: { language: "en" } },
    }) });
    assert.equal(language.value, "en", "the selected instance must apply its settings response");

    if (inspector === "context-compaction.html") {
      const focusBeforeAction = elements.get("focusBeforeAction");
      const pressBehavior = elements.get("pressBehavior");
      assert.ok(focusBeforeAction && pressBehavior);
      focusBeforeAction.checked = true;
      socket.dispatch("message", { data: JSON.stringify({
        event: "didReceiveSettings",
        context: "action-instance-context",
        payload: { settings: { language: "en", focusBeforeAction: false, pressBehavior: "ptt" } },
      }) });
      assert.equal(language.value, "en", "the matching context must update language");
      assert.equal(focusBeforeAction.checked, false, "the matching context must update focusBeforeAction");
      assert.equal(pressBehavior.value, "ptt", "the matching context must update pressBehavior");

      focusBeforeAction.checked = true;
      focusBeforeAction.dispatch("change");
      const preserved = JSON.parse(socket.sent.at(-1) ?? "{}") as { payload?: Record<string, unknown> };
      assert.equal(preserved.payload?.futureSetting, "keep-me", "unknown settings must survive a matching response roundtrip");
    }

    if (inspector === "usage-limit.html") {
      connect("12345", "overview-property-inspector-uuid", "registerPropertyInspector", "{}", JSON.stringify({
        action: "io.local.codexdeck.microplus.usage-overview",
        context: "overview-action-instance-context",
        payload: { settings: { mode: "weekly", language: "en" } },
      }));
      assert.equal(elements.get("mode-row")?.hidden, true, "overview must not expose a single-window mode");
      assert.equal(elements.get("mode-help")?.hidden, true, "overview must not expose single-window help");
    }
    if (inspector === "common.html") {
      connect("12345", "ordinary-pi", "registerPropertyInspector", "{}", JSON.stringify({
        action: "io.local.codexdeck.microplus.test-action", context: "ordinary-context", payload: { settings: {} },
      }));
      assert.equal(elements.get("press-options")?.hidden, true, "non-display common actions must hide display press controls");
      connect("12345", "reset-property-inspector-uuid", "registerPropertyInspector", "{}", JSON.stringify({
        action: "io.local.codexdeck.microplus.rate-limit-reset",
        context: "reset-action-instance-context",
        payload: { settings: { language: "ja" } },
      }));
      assert.equal(elements.get("press-options")?.hidden, false, "rate-limit reset must expose display press controls");
      assert.equal(elements.get("pressBehavior")?.value, "none", "reset keeps its legacy default behavior");
    }
    if (inspector === "agent.html") {
      assert.match(elements.get("press-help")?.textContent ?? "", /current Codex Composer/);
    }
  });
}

test('recorded shortcut reaches instance settings and survives reread', async () => {
  const elements = new Map<string, FakeElement>();
  const listeners = new Map<string, (e:any)=>void>();
  const sockets: FakeWebSocket[] = [];
  const window:any = {addEventListener:(name:string, fn:(e:any)=>void)=>listeners.set(name,fn)};
  const context = {window, document:{documentElement:{lang:'ja'},querySelectorAll:()=>[],getElementById:(id:string)=>{
    if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id);
  }}, WebSocket:class extends FakeWebSocket {constructor(url:string){super(url);sockets.push(this);}}};
  for(const file of ['shortcut-recorder.js','shared.js']) runInNewContext(await readFile(new URL(`../static/property-inspector/${file}`,import.meta.url),'utf8'),context);
  window.CodexPropertyInspector.common();
  window.connectElgatoStreamDeckSocket('12345','pi-id','registerPropertyInspector','{}',JSON.stringify({action:'io.local.codexdeck.microplus.global-dictation',context:'voice-key',payload:{settings:{label:'Keep me'}}}));
  elements.get('shortcut-record')!.dispatch('click');
  const event={code:'AltRight',altKey:true,preventDefault(){},stopPropagation(){}};
  listeners.get('keydown')!(event);listeners.get('keyup')!({...event,altKey:false});
  const sent=JSON.parse(sockets[0]!.sent.at(-1)!);
  assert.equal(sent.context,'pi-id');assert.equal(sent.payload.label,'Keep me');
  assert.deepEqual(sent.payload.globalDictationShortcut,{code:'AltRight',modifiers:[]});
  sockets[0]!.dispatch('message',{data:JSON.stringify({event:'didReceiveSettings',context:'voice-key',payload:{settings:sent.payload}})});
  assert.equal(elements.get('shortcut-value')!.textContent,'右Option');
  elements.get('shortcut-record')!.dispatch('click');listeners.get('blur')!({});
  assert.equal(elements.get('shortcut-cancel')!.hidden,true);
  const before=sockets[0]!.sent.length;
  sockets[0]!.readyState=0;
  elements.get('shortcut-record')!.dispatch('click');
  listeners.get('keydown')!(event);listeners.get('keyup')!({...event,altKey:false});
  assert.equal(sockets[0]!.sent.length,before);
  assert.match(elements.get('shortcut-help')!.textContent,/未接続/);

});
