import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { CodexMicroRendererBridge, DIAL_RUNTIME_26903 } from "../src/codex-micro-renderer-bridge.js";
import { CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION } from "../src/agent-window-probe.js";

const additionalCommands = {
  PARTY: { command: "openSideChat", requiredAccess: "codexLocal" },
  LAB: { command: "settings", requiredAccess: null },
  DWN: { command: "copyConversationMarkdown", requiredAccess: null },
  NEW: { command: "newTask", requiredAccess: null },
  SPLIT: { command: "forkThread", requiredAccess: null },
  DEL: { command: "archiveThread", requiredAccess: null },
  TERM: { command: "toggleTerminal", requiredAccess: "codexLocal" },
  DIFF: { command: "toggleReviewTab", requiredAccess: "codexLocal" },
  NAV: { command: "openBrowserTab", requiredAccess: null },
  SETUP: { command: "settings", requiredAccess: null },
  APPS: { command: "openSkills", requiredAccess: "codexLocal" },

  TIME: { command: "manageTasks", requiredAccess: null },
  FOLD: { command: "openFolder", requiredAccess: "codexOrWorkLocal" },
  "APPR": {
    "command": "approval.approve",
    "requiredAccess": null
  },
  "REJ": {
    "command": "approval.decline",
    "requiredAccess": null
  },
  "CODEX": {
    "command": "composer.submit",
    "requiredAccess": null
  },
  "BUG": {
    "command": "feedback",
    "requiredAccess": null
  },
  "MAGIC": {
    "command": "toggleThreadPin",
    "requiredAccess": null
  },
  "PLAY": {
    "command": "environmentAction1",
    "requiredAccess": null
  },
  "BRCH": {
    "command": "git.createDraftPullRequest",
    "requiredAccess": null
  },
  "BRANCH": {
    "command": "git.createBranch",
    "requiredAccess": null
  },
  "MRG": {
    "command": "git.mergePullRequest",
    "requiredAccess": null
  },
  "PR": {
    "command": "git.createPullRequest",
    "requiredAccess": "codexLocal"
  },
  "PAINT": {
    "command": "composer.addPhotos",
    "requiredAccess": null
  },
  "UPL": {
    "command": "composer.addFiles",
    "requiredAccess": null
  }
} as const;

// Execute the emitted compatibility/dispatch boundary. Composer discovery and
// asset IO are fixtures; this is not a live Codex or physical dial test.
async function invoke(key: "MIND+" | "MIND-" | "FAST" | "MIC" | "GIT" | keyof typeof additionalCommands, options: {
  wrongHash?: boolean; wrongCommand?: boolean; requiredAccess?: boolean; staleThread?: boolean; denyAccess?: boolean; missingAccess?: boolean; missingScope?: boolean; noCapabilities?: boolean; cloudOnly?: boolean; noTransition?: boolean;
} = {}) {
  const calls: string[] = [];
  const bridge = new CodexMicroRendererBridge(() => undefined) as any;
  bridge.beginOperation = async () => ({ operationId: "op", activeThreadKey: "local:task", activeComposerKey: "composer-1" });
  bridge.withOperationTargetLease = async (_operation: unknown, action: () => unknown) => action();
  bridge.observeOperation = async (_operation: unknown, _direction: unknown, postcondition: any) => {
    if (["TERM", "DIFF", "NAV", "SETUP", "APPS", "LAB"].includes(key)) {
      assert.equal(postcondition?.kind, "native-ui-changed");
      assert.equal(postcondition?.keycapId, key);
    }
    if (["NEW", "SPLIT", "DEL"].includes(key)) {
      assert.equal(postcondition?.kind, "active-view-transition");
      assert.equal(postcondition?.transition, key === "NEW" ? "new-task" : key === "SPLIT" ? "forked" : "archived");
      assert.notEqual(postcondition?.activeThreadKey, postcondition?.fromActiveThreadKey);
    }
    if (key === "PARTY") {
      assert.equal(postcondition?.kind, "side-chat-opened");
      assert.notEqual(postcondition?.sideComposerKey, postcondition?.activeComposerKey);
    }
    return { semanticOutcome: "confirmed" };
  };
  bridge.evaluate = async (expression: string) => {
    const appScope = {}, access = {}, capability = {};
    const scope = { scope: appScope, node: {}, chain: {}, set() {}, watch() {}, when() {},
      get(atom: unknown, args?: { name: string }) {
        if (atom === capability) {
          assert.ok(["automations.local", "automations.cloud"].includes(args?.name ?? ""));
          return { isCapable: !options.noCapabilities && (options.cloudOnly ? args?.name === "automations.cloud" : args?.name === "automations.local") };
        }
        assert.equal(atom, access); return !options.denyAccess;
      } };
    const root = { isConnected: true, __reactFiber$test: { memoizedState: { memoizedState: { current: options.missingScope ? null : scope }, next: null }, return: null } };
    const sideRoot = { isConnected: true, __reactFiber$test: { memoizedState: { memoizedState: { current: scope }, next: null }, return: null } };
    const extra = additionalCommands[key as keyof typeof additionalCommands];
    const expectedAccess = key === "GIT" ? "codexLocal" : extra?.requiredAccess;
    const command = extra?.command ?? (key === "GIT" ? "git.commit" : key === "FAST" ? "composer.toggleFastMode" : key === "MIND+" ? "composer.increaseReasoningEffort" : "composer.decreaseReasoningEffort");
    const urls = [DIAL_RUNTIME_26903.layoutAsset, "codex-micro-bridge-current.js", "app-initial-current.js", "codex-micro-commands-current.js"]
      .map(name => `app://-/assets/${name}`);
    const hashes = [DIAL_RUNTIME_26903.layout, DIAL_RUNTIME_26903.bridge, DIAL_RUNTIME_26903.initial,
      options.wrongHash ? "0".repeat(64) : DIAL_RUNTIME_26903.commands];
    const modules: Record<string, unknown> = {
      [urls[0]!]: { r: (id: string) => ({ id, action: { type: "command", command: options.wrongCommand ? "other" : command } }) },
      [urls[2]!]: { t3t: appScope, iKt: access, pR: capability, W7: (id: string) => { calls.push(id); return true; }, I5: () => { throw new Error("old export called"); } },
      [urls[3]!]: { n: (id: string) => ({ id, ...(options.requiredAccess ? { requiredAccess: "unexpected" } : expectedAccess && !options.missingAccess ? { requiredAccess: expectedAccess } : {}) }) },
    };
    const context = vm.createContext({
      URL, TextEncoder, Uint8Array, setTimeout, clearTimeout,
      location: { href: "app://-/index.html" },
      document: { visibilityState: "visible", hasFocus: () => true,
        defaultView: { location: { get pathname() { return calls.length ? key === "LAB" ? "/settings/codex-micro" : key === "SETUP" ? "/settings" : key === "APPS" ? "/skills" : "/" : "/"; } } },
        querySelectorAll: (selector: string) => {
          if (selector === "link[href], script[src]") return urls.map(href => ({ href }));
          if (selector === "[data-codex-composer-root]") return key === "PARTY" && calls.length && !options.noTransition ? [root, sideRoot] : [root];
          if (!calls.length) return [];
          const expectedSelector = key === "TERM" ? "[data-codex-terminal], [data-codex-xterm]"
            : key === "DIFF" ? "[data-diffs-header], [data-file-tree-id], [data-review-path]"
            : key === "NAV" ? "[data-browser-sidebar-browser-tab-id]" : null;
          return selector === expectedSelector ? [{ getAttribute: () => null }] : [];
        } },
      performance: { getEntriesByType: () => [] },
      fetch: async (url: string) => ({ text: async () => url }),
      crypto: { subtle: { digest: async (_type: string, bytes: Uint8Array) => {
        const url = new TextDecoder().decode(bytes);
        return Uint8Array.from(Buffer.from(hashes[urls.indexOf(url)]!, "hex"));
      } } },
      get testComposer() {
        return { root, activeThreadKey: options.staleThread ? "local:other"
          : calls.length && !options.noTransition && ["NEW", "SPLIT", "DEL"].includes(key)
            ? key === "DEL" ? null : "local:new-task" : "local:task" };
      },
      loadModule: async (url: string) => modules[url],
    });
    const executable = expression.replaceAll(CANONICAL_ACTIVE_COMPOSER_RESOLVER_EXPRESSION, "(() => globalThis.testComposer)")
      .replaceAll("import(", "loadModule(");
    return await vm.runInContext(executable, context);
  };
  try { await bridge.runKeycap(key); }
  catch (error) {
    if (options.noTransition) assert.equal(calls.length, 1, "an unobserved operation must not be retried");
    else assert.deepEqual(calls, [], "rejected dispatch must not invoke the native command");
    throw error;
  }
  return calls;
}

test("current reviewed runtime invokes both reasoning commands using W7", async () => {
  assert.deepEqual(await invoke("MIND+"), ["composer.increaseReasoningEffort"]);
  assert.deepEqual(await invoke("MIND-"), ["composer.decreaseReasoningEffort"]);
});

test("current reasoning runtime rejects mixed hashes, changed actions, access and stale targets", async () => {
  await assert.rejects(invoke("MIND+", { wrongHash: true }), /E_COMMAND_RUNNER_INCOMPATIBLE/);
  await assert.rejects(invoke("MIND+", { wrongCommand: true }), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
  await assert.rejects(invoke("MIND+", { requiredAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
  await assert.rejects(invoke("MIND+", { staleThread: true }), /E_ACTIVE_THREAD_STALE/);
});

test("reviewed reasoning compatibility does not enable unrelated keys", async () => {
  await assert.rejects(invoke("MIC"), /E_MICRO_KEYCAP_REGISTRY_UNAVAILABLE/);
});

test("reviewed Fast runtime invokes the exact command and rejects incompatible metadata", async () => {
  assert.deepEqual(await invoke("FAST"), ["composer.toggleFastMode"]);
  await assert.rejects(invoke("FAST", { wrongHash: true }), /E_COMMAND_RUNNER_INCOMPATIBLE/);
  await assert.rejects(invoke("FAST", { wrongCommand: true }), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
  await assert.rejects(invoke("FAST", { requiredAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
  await assert.rejects(invoke("FAST", { staleThread: true }), /E_ACTIVE_THREAD_STALE/);
});

test("reviewed Git command uses current scope access and rejects denied or changed access", async () => {
  assert.deepEqual(await invoke("GIT"), ["git.commit"]);
  await assert.rejects(invoke("GIT", { denyAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
  await assert.rejects(invoke("GIT", { requiredAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
  await assert.rejects(invoke("GIT", { wrongCommand: true }), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
  await assert.rejects(invoke("GIT", { wrongHash: true }), /E_COMMAND_RUNNER_INCOMPATIBLE/);
  await assert.rejects(invoke("GIT", { staleThread: true }), /E_ACTIVE_THREAD_STALE/);
});

test("required-access commands reject missing metadata and missing owning scope before dispatch", async () => {
  await assert.rejects(invoke("GIT", { missingAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
  await assert.rejects(invoke("GIT", { missingScope: true }), /E_COMMAND_SCOPE_UNAVAILABLE/);
});

for (const [key, expected] of Object.entries(additionalCommands)) {
  test(`current ${key} dispatch preserves exact command and access contract`, async () => {
    const id = key as keyof typeof additionalCommands;
    assert.deepEqual(await invoke(id), [id === "LAB" ? "codexMicroSettings" : expected.command]);
    await assert.rejects(invoke(id, { wrongCommand: true }), /E_MICRO_KEYCAP_ACTION_UNAVAILABLE/);
    await assert.rejects(invoke(id, { wrongHash: true }), /E_COMMAND_RUNNER_INCOMPATIBLE/);
    await assert.rejects(invoke(id, { requiredAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
    if (expected.requiredAccess) {
      await assert.rejects(invoke(id, { denyAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
      await assert.rejects(invoke(id, { missingScope: true }), /E_COMMAND_SCOPE_UNAVAILABLE/);
      await assert.rejects(invoke(id, { missingAccess: true }), /E_COMMAND_ACCESS_REQUIRED/);
    }
  });
}

test("automation command requires a local or cloud capability on the owning scope", async () => {
  assert.deepEqual(await invoke("TIME", { cloudOnly: true }), ["manageTasks"]);
  await assert.rejects(invoke("TIME", { noCapabilities: true }), /E_COMMAND_CAPABILITY_REQUIRED/);
  await assert.rejects(invoke("TIME", { missingScope: true }), /E_COMMAND_SCOPE_UNAVAILABLE/);
});

test("task transitions that never occur are rejected without retry", async () => {
  for (const key of ["NEW", "SPLIT", "DEL"] as const) {
    await assert.rejects(invoke(key, { noTransition: true }), /E_OPERATION_UNOBSERVED/);
  }
});

test("side-chat command requires an added composer and never retries missing results", async () => {
  await assert.rejects(invoke("PARTY", { noTransition: true }), /E_OPERATION_UNOBSERVED/);
});
