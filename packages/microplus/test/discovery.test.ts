import assert from "node:assert/strict";
import test from "node:test";
import {
  codexDebugTargetKey,
  enumerateCodexMainTargets,
  listenerBelongsToProcess,
  parseCodexDebugProcesses,
  parseWindowsCodexDebugProcesses,
  resolveForegroundCodexTarget,
  resolveMacCodexDebugPort,
  resolveWindowsCodexDebugPort,
  selectCodexObservationTarget,
} from "../src/codex-debug-discovery.js";

const CODEX = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT";

test("macOS discovery rejects a loopback endpoint advertised by an unrelated app", async () => {
  const psOutput = [
    "  91 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-address=127.0.0.1 --remote-debugging-port=41001",
    `  92 ${CODEX}`
  ].join("\n");
  const processes = parseCodexDebugProcesses(psOutput, CODEX);

  assert.deepEqual(processes, []);
  assert.equal(await resolveMacCodexDebugPort({
    psOutput,
    executablePath: CODEX,
    statePort: 41001,
    ownsListener: async () => true,
    isCodexEndpoint: async () => true
  }), null);
});

test("stale state port cannot bypass exact Codex process and listener identity", async () => {
  const psOutput = [
    "  91 /Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-address=127.0.0.1 --remote-debugging-port=41001",
    `  92 ${CODEX} --remote-debugging-address=127.0.0.1 --remote-debugging-port=42002`
  ].join("\n");
  const listeners = new Map([
    [91, "p91\nn127.0.0.1:41001\n"],
    [92, "p92\nn127.0.0.1:42002\n"]
  ]);

  const selected = await resolveMacCodexDebugPort({
    psOutput,
    executablePath: CODEX,
    statePort: 41001,
    ownsListener: async (process) => listenerBelongsToProcess(listeners.get(process.pid) ?? "", process.pid, process.port),
    isCodexEndpoint: async () => true
  });

  assert.equal(selected, 42002);
  assert.equal(listenerBelongsToProcess("p91\nn127.0.0.1:42002\n", 92, 42002), false);
  assert.equal(listenerBelongsToProcess("p92\nn*:42002\n", 92, 42002), false);
  assert.equal(listenerBelongsToProcess("p92\nn127.0.0.1:41001\np93\nn127.0.0.1:42002\n", 92, 42002), false);
});

test("Windows discovery rejects a stale state endpoint not owned by the advertised Codex PID", async () => {
  const attestationOutput = [
    "501|41001|777|127.0.0.1|Listen",
    "502|42002|502|127.0.0.1|Listen",
  ].join("\n");

  assert.deepEqual(parseWindowsCodexDebugProcesses(attestationOutput), [{ pid: 502, port: 42002 }]);
  const checked: number[] = [];
  const selected = await resolveWindowsCodexDebugPort({
    attestationOutput,
    statePort: 41001,
    isCodexEndpoint: async ({ port }) => {
      checked.push(port);
      return true;
    },
  });

  assert.equal(selected, 42002);
  assert.deepEqual(checked, [42002]);
});

test("Windows discovery fails closed when socket ownership attestation is unavailable", async () => {
  let endpointChecks = 0;
  const selected = await resolveWindowsCodexDebugPort({
    attestationOutput: "",
    statePort: 41001,
    isCodexEndpoint: async () => {
      endpointChecks += 1;
      return true;
    },
  });

  assert.equal(selected, null);
  assert.equal(endpointChecks, 0);
});

test("main target discovery rejects attacker-controlled app origins", () => {
  const targets = [
    { id: "attacker", type: "page", url: "app://attacker/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/attacker" },
    { id: "userinfo", type: "page", url: "app://user@codex/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/userinfo" },
    { id: "avatar", type: "page", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/avatar" },
    { id: "hotkey", type: "page", url: "app://-/index.html?initialRoute=%2Fhotkey-window", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/hotkey" },
    { id: "current", type: "page", url: "app://-/index.html?window=1", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/current" },
    { id: "compatible", type: "page", url: "app://codex/index.html?window=2", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/compatible" },
  ];

  assert.deepEqual(enumerateCodexMainTargets(targets).map((target) => target.id), ["current", "compatible"]);
});

test("cold-start observation selects one exact session renderer while Codex is background", () => {
  const targets = [
    { id: "shell", type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/shell" },
    { id: "session", type: "page", url: "app://-/index.html?initialRoute=%2Flocal%2F11111111-1111-4111-8111-111111111111", webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/session" },
    { id: "hotkey", type: "page", url: "app://-/index.html?initialRoute=%2Fhotkey-window", webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/hotkey" },
  ];

  assert.equal(selectCodexObservationTarget(targets, undefined)?.id, "session");
  assert.equal(selectCodexObservationTarget([
    ...targets,
    { id: "other-session", type: "page", url: "app://-/index.html?initialRoute=%2Flocal%2F22222222-2222-4222-8222-222222222222", webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/other-session" },
  ], undefined), undefined);
  assert.equal(selectCodexObservationTarget(targets, undefined, codexDebugTargetKey(targets[0]!))?.id, "shell");
});

test("global dictation is auxiliary and duplicate windows of one task select deterministically", () => {
  const route = "%2Flocal%2F11111111-1111-4111-8111-111111111111";
  const targets = [
    { id: "session-b", type: "page", url: `app://-/index.html?initialRoute=${route}`, webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/session-b" },
    { id: "dictation", type: "page", url: "app://-/index.html?initialRoute=%2Fglobal-dictation", webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/dictation" },
    { id: "session-a", type: "page", url: `app://-/index.html?initialRoute=${route}`, webSocketDebuggerUrl: "ws://127.0.0.1:41001/devtools/page/session-a" },
  ];

  assert.deepEqual(enumerateCodexMainTargets(targets).map(({ id }) => id).sort(), ["session-a", "session-b"]);
  const selected = selectCodexObservationTarget(targets, undefined);
  const reordered = selectCodexObservationTarget([...targets].reverse(), undefined);
  assert.ok(selected);
  assert.equal(reordered?.id, selected.id);
});

test("foreground target resolution probes every main app window and selects exactly one focused visible renderer", async () => {
  const targets = [
    { id: "aux", type: "page", url: "app://codex/avatar-overlay", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/aux" },
    { id: "background", type: "page", url: "app://codex/index.html?window=1", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/background" },
    { id: "foreground", type: "page", url: "app://codex/index.html?window=2", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/foreground" },
  ];
  assert.deepEqual(enumerateCodexMainTargets(targets).map((target) => target.id), ["background", "foreground"]);
  const probed: string[] = [];
  const selected = await resolveForegroundCodexTarget(targets, async (target) => {
    probed.push(target.id!);
    return target.id === "foreground"
      ? { hasFocus: true, visibilityState: "visible" }
      : { hasFocus: false, visibilityState: "visible" };
  });
  assert.deepEqual(probed, ["background", "foreground"]);
  assert.equal(selected?.id, "foreground");
});

test("foreground target resolution fails closed for zero or multiple focused visible renderers", async () => {
  const targets = [
    { id: "a", type: "page", url: "app://codex/index.html?a", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/a" },
    { id: "b", type: "page", url: "app://codex/index.html?b", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/b" },
  ];
  assert.equal(await resolveForegroundCodexTarget(targets, async () => ({ hasFocus: false, visibilityState: "visible" })), undefined);
  assert.equal(await resolveForegroundCodexTarget(targets, async () => ({ hasFocus: true, visibilityState: "visible" })), undefined);
  assert.equal(await resolveForegroundCodexTarget(targets, async () => ({ hasFocus: true, visibilityState: "hidden" })), undefined);
});
