import assert from "node:assert/strict";
import test from "node:test";
import { selectNativeCommandScope } from "../src/codex-micro-renderer-bridge.js";

const appScopeToken = {};
const accessAtom = {};
const capabilityAtom = {};

type FakeScope = {
  name: string;
  scope: unknown;
  node: object;
  chain: object;
  get(atom: unknown, parameter?: { name?: string }): unknown;
  set(): void;
  watch(): void;
  when(): void;
};

function scope(
  name: string,
  access: boolean,
  capabilities: { local: boolean; cloud: boolean } | null = { local: true, cloud: false },
  identity: { node?: object; chain?: object } = {},
): FakeScope {
  return {
    name,
    scope: appScopeToken,
    node: identity.node ?? {},
    chain: identity.chain ?? {},
    get(atom, parameter) {
      if (atom === accessAtom) return access;
      if (atom === capabilityAtom && capabilities && parameter?.name === "automations.local") {
        return { isCapable: capabilities.local };
      }
      if (atom === capabilityAtom && capabilities && parameter?.name === "automations.cloud") {
        return { isCapable: capabilities.cloud };
      }
      throw new Error("unavailable atom");
    },
    set() {},
    watch() {},
    when() {},
  };
}

function hookRef(value: FakeScope, next: object | null = null) {
  return { memoizedState: { current: value }, next };
}

function generatedSelector(): typeof selectNativeCommandScope {
  return Function(`return (${selectNativeCommandScope.toString()})`)() as typeof selectNativeCommandScope;
}

function select(composerRoot: object | null, requireCapabilities = false) {
  return generatedSelector()(
    { getElementById: () => null } as unknown as Document,
    composerRoot as Element | null,
    appScopeToken,
    accessAtom,
    capabilityAtom,
    requireCapabilities,
  ) as FakeScope | undefined;
}

test("generated selector reads the nearest native Db(AppScope) hook ref", () => {
  const hiddenRoute = scope("hidden-route", false);
  const activeComposer = scope("active-composer", true);
  const composerRoot = {
    "__reactFiber$test": {
      memoizedState: null,
      return: {
        memoizedState: hookRef(activeComposer),
        return: { memoizedState: hookRef(hiddenRoute), return: null },
      },
    },
  };
  assert.equal(select(composerRoot)?.name, "active-composer");
});

test("provider context values alone are not mistaken for executable scope wrappers", () => {
  const providerChain = new Map([["scope", { store: { get: () => true } }]]);
  const composerRoot = {
    "__reactFiber$test": {
      dependencies: { firstContext: { memoizedValue: providerChain, next: null } },
      memoizedState: null,
      return: null,
    },
  };
  assert.equal(select(composerRoot), undefined);
});

test("side chat accepts an AppScope without materialized automation capabilities", () => {
  const partyScope = scope("party-access-scope", true, null);
  const composerRoot = {
    "__reactFiber$test": { memoizedState: hookRef(partyScope), return: null },
  };
  assert.equal(select(composerRoot, false)?.name, "party-access-scope");
});

test("manage tasks still requires native capability selector results", () => {
  const incomplete = scope("incomplete-automation-scope", true, null);
  const composerRoot = {
    "__reactFiber$test": { memoizedState: hookRef(incomplete), return: null },
  };
  assert.equal(select(composerRoot, true), undefined);
});

test("same-fiber distinct AppScope identities fail closed", () => {
  const first = scope("first", true);
  const second = scope("second", true);
  const composerRoot = {
    "__reactFiber$test": {
      memoizedState: hookRef(first, hookRef(second)),
      return: null,
    },
  };
  assert.equal(select(composerRoot), undefined);
});

test("duplicate hook refs for the same native node and chain are deduplicated", () => {
  const node = {};
  const chain = {};
  const first = scope("first-wrapper", true, null, { node, chain });
  const duplicate = scope("second-wrapper", true, null, { node, chain });
  const composerRoot = {
    "__reactFiber$test": {
      memoizedState: hookRef(first, hookRef(duplicate)),
      return: null,
    },
  };
  assert.equal(select(composerRoot)?.name, "first-wrapper");
});

test("route-wide fallback accepts only one native AppScope identity", () => {
  const only = scope("only", true);
  const fiber: { memoizedState: object; child: object | null; sibling: null } = {
    memoizedState: hookRef(only),
    child: null,
    sibling: null,
  };
  const container = { "__reactContainer$test": fiber };
  const selected = generatedSelector()(
    { getElementById: () => container } as unknown as Document,
    null,
    appScopeToken,
    accessAtom,
    capabilityAtom,
  ) as FakeScope;
  assert.equal(selected.name, "only");

  const second = scope("second", false);
  fiber.child = { memoizedState: hookRef(second), child: null, sibling: null };
  assert.equal(generatedSelector()(
    { getElementById: () => container } as unknown as Document,
    null,
    appScopeToken,
    accessAtom,
    capabilityAtom,
  ), undefined);
});


test("passive metadata can use a unique window scope without composer focus", () => {
  const target = scope("window", false);
  const container = { __reactContainer$test: { memoizedState: hookRef(target) } };
  const doc = { getElementById: () => container, hasFocus: () => false } as unknown as Document;
  const composer = { __reactFiber$test: { memoizedState: null } } as unknown as Element;
  const read = generatedSelector();
  assert.equal(read(doc, composer, appScopeToken, accessAtom, capabilityAtom), undefined);
  assert.equal(read(doc, composer, appScopeToken, accessAtom, capabilityAtom, false, true), target);
  Object.assign(container.__reactContainer$test, { sibling: { memoizedState: hookRef(scope("other", false)) } });
  assert.equal(read(doc, composer, appScopeToken, accessAtom, capabilityAtom, false, true), undefined);
});
