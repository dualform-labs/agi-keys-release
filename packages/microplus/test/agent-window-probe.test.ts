import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  AGENT_WINDOW_PROBE_EXPRESSION,
  readAgentWindowProbe,
} from "../src/agent-window-probe.js";
import type { ActiveComposerState } from "../src/renderer-runtime.js";

function probeFixture(pathnames: string[], rawThreadKey = "task-a", focused = false): {
  doc: Document;
  resolve: (doc: Document) => ActiveComposerState;
} {
  const hostRoot: any = { tag: 3, stateNode: {}, return: null, child: null, sibling: null };
  hostRoot.stateNode.current = hostRoot;
  const providers = pathnames.map((pathname) => ({
    tag: 10,
    type: { _context: { displayName: "Location" } },
    memoizedProps: {
      value: {
        navigationType: "PUSH",
        location: { pathname, search: "", hash: "", state: null, key: pathname },
      },
    },
    return: hostRoot,
    child: null,
    sibling: null,
  }) as any);
  for (let index = 0; index + 1 < providers.length; index += 1) providers[index]!.sibling = providers[index + 1]!;
  hostRoot.child = providers[0] ?? null;
  const composer = { "__reactFiber$test": {
    return: providers[0] ?? hostRoot,
    child: null,
    sibling: null,
  } } as unknown as Element;
  const composerFiber = (composer as any)["__reactFiber$test"];
  composerFiber.stateNode = composer;
  if (providers[0]) providers[0].child = composerFiber;
  else hostRoot.child = composerFiber;
  const root = { "__reactContainer$test": hostRoot };
  const doc = {
    getElementById: (id: string) => id === "root" ? root : null,
    hasFocus: () => focused,
    visibilityState: "visible",
  } as unknown as Document;
  return {
    doc,
    resolve: () => ({ root: composer, ...(rawThreadKey ? { activeThreadKey: rawThreadKey } : {}) }),
  };
}

test("memory-router local route and committed composer yield an exact canonical key", () => {
  const fixture = probeFixture(["/local/task-a"], "task-a", true);
  const result = readAgentWindowProbe(fixture.doc, fixture.resolve);
  assert.equal(result.activeThreadKey, "local:task-a");
  assert.equal(result.identityAvailable, true);
  assert.equal(result.composerPresent, true);
  assert.equal(result.focusedVisible, true);
  assert.match(result.activeComposerKey ?? "", /^composer-/u);
});

test("probe ignores stale top-level URL and rejects ambiguous or mismatched committed identity", () => {
  const previousLocation = (globalThis as any).location;
  (globalThis as any).location = { pathname: "/local/stale-launch-route" };
  try {
    const mismatch = probeFixture(["/local/task-a"], "task-b");
    assert.equal(readAgentWindowProbe(mismatch.doc, mismatch.resolve).identityAvailable, false);
    const ambiguous = probeFixture(["/local/task-a", "/local/task-b"], "task-a");
    assert.equal(readAgentWindowProbe(ambiguous.doc, () => ({ root: null })).identityAvailable, false);
  } finally {
    if (previousLocation === undefined) delete (globalThis as any).location;
    else (globalThis as any).location = previousLocation;
  }
});

test("probe follows the committed fiber and ignores an attached stale alternate", () => {
  const fixture = probeFixture(["/local/task-a"], "task-a");
  const composerRoot = fixture.resolve(fixture.doc).root as any;
  const committed = composerRoot["__reactFiber$test"];
  const staleRoot: any = { tag: 3, stateNode: committed.return.return.stateNode, return: null };
  const staleProvider: any = {
    tag: 10,
    type: { _context: { displayName: "Location" } },
    memoizedProps: { value: {
      navigationType: "PUSH",
      location: { pathname: "/local/stale", search: "", hash: "", state: null, key: "stale" },
    } },
    return: staleRoot,
  };
  const attachedStale = { return: staleProvider, alternate: committed };
  composerRoot["__reactFiber$test"] = attachedStale;

  const result = readAgentWindowProbe(fixture.doc, fixture.resolve);
  assert.equal(result.activeThreadKey, "local:task-a");
  assert.equal(result.identityAvailable, true);
});

test("generated probe is passive and contains no renderer imports, fetches, or dispatches", () => {
  assert.doesNotMatch(AGENT_WINDOW_PROBE_EXPRESSION, /\b(?:import|fetch|dispatchMessage|dispatchHostMessage)\s*\(/u);
  assert.doesNotMatch(AGENT_WINDOW_PROBE_EXPRESSION, /initialRoute|window\.location|codex-micro/u);
});

test("shared bailout subtree uses committed logical parents despite stale return links", () => {
  const fixture = probeFixture(["/local/task-a"]);
  const composer = fixture.resolve(fixture.doc).root as any;
  const fiber = composer["__reactFiber$test"];
  const currentProvider = fiber.return;
  const currentRoot = currentProvider.return;
  const staleRoot = { tag: 3, stateNode: currentRoot.stateNode, return: null };
  fiber.return = {
    tag: 10,
    type: { _context: { displayName: "Location" } },
    memoizedProps: { value: { ...currentProvider.memoizedProps.value,
      location: { ...currentProvider.memoizedProps.value.location, pathname: "/local/stale" } } },
    return: staleRoot,
  };
  assert.equal(fiber.alternate, undefined);
  assert.equal(readAgentWindowProbe(fixture.doc, fixture.resolve).activeThreadKey, "local:task-a");
});

test("detached, cyclic and non-task-looking unknown routes are unavailable", () => {
  const fixture = probeFixture(["/local/task-a"]);
  const composer = fixture.resolve(fixture.doc).root as any;
  const provider = composer["__reactFiber$test"].return;
  provider.child = null;
  assert.equal(readAgentWindowProbe(fixture.doc, fixture.resolve).identityAvailable, false);
  provider.child = provider;
  assert.equal(readAgentWindowProbe(fixture.doc, fixture.resolve).identityAvailable, false);
  const unknown = probeFixture(["/future-task/task-a"]);
  assert.equal(readAgentWindowProbe(unknown.doc, () => ({ root: null })).identityAvailable, false);
  const remote = probeFixture(["/remote/task-a"]);
  assert.equal(readAgentWindowProbe(remote.doc, remote.resolve).identityAvailable, false);
});

test("serialized probe executes the real composer selector without Micro assets or sidebar", () => {
  const fixture = probeFixture(["/local/task-a"], "task-a", true);
  const composer = fixture.resolve(fixture.doc).root as any;
  const anchor = { getClientRects: () => [1], closest: () => composer };
  const idElement = { getAttribute: () => "task-a" };
  composer.closest = () => null;
  composer.querySelector = (selector: string) => selector === "[data-above-composer-conversation-id]"
    ? idElement : selector === "[data-composer-navigation-target]" || selector === "[data-codex-composer]"
      ? anchor : null;
  Object.assign(fixture.doc, {
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === "[data-codex-composer-root]" ? [composer]
      : selector === "[data-codex-composer]" ? [anchor] : [],
  });
  const result = runInNewContext(AGENT_WINDOW_PROBE_EXPRESSION, {
    document: fixture.doc,
    location: { pathname: "/index.html", search: "?initialRoute=%2Flocal%2Fstale" },
    fetch: () => { throw new Error("Background probe must not fetch"); },
  }, { timeout: 1000 });
  assert.equal(result.activeThreadKey, "local:task-a");
  assert.equal(result.identityAvailable, true);
  assert.equal(result.focusedVisible, true);
});
