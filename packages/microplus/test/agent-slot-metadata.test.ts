import assert from "node:assert/strict";
import test from "node:test";
import { readAgentSlotMetadata, agentSlotMetadataNamespace } from "../src/codex-micro-renderer-bridge.js";

const atoms = {
  I4: Symbol("threadByKey"),
  jCt: Symbol("threadGoal"),
  gCt: Symbol("requests"),
  uCt: Symbol("pendingRequestType"),
  vCt: Symbol("resumeState"),
  LCt: Symbol("runtimeStatus"),
  v3: Symbol("pendingChip"),
  F2: Symbol("threadPinned"),
};

function generatedReader(): typeof readAgentSlotMetadata {
  return Function(`return (${readAgentSlotMetadata.toString()})`)() as typeof readAgentSlotMetadata;
}

function metadataStore(values: Map<unknown, unknown>) {
  return {
    get(atom: unknown, parameter?: unknown) {
      return values.get(`${String(atom)}:${String(parameter)}`) ?? values.get(atom);
    },
  };
}

test("slot metadata exposes exact goal status and question boolean without content", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-1" } }],
    [atoms.jCt, { status: "blocked", objective: "must never leave renderer" }],
    [atoms.gCt, [{ method: "item/tool/requestUserInput", params: { questions: ["secret"] } }]],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "active", activeFlags: [] }],
  ]);

  const result = generatedReader()({ threadKey: "local:conversation-1" }, metadataStore(values), atoms);
  assert.deepEqual(result, { metadataAvailability: "available", goalStatus: "blocked", pendingQuestion: true });
  assert.equal(JSON.stringify(result).includes("objective"), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("slot metadata recognizes runtime waiting-on-user-input without serializing flags", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-2" } }],
    [atoms.jCt, null],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "needs_resume"],
    [atoms.LCt, { type: "active", activeFlags: ["waitingOnUserInput"] }],
  ]);

  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-2" }, metadataStore(values), atoms),
    { metadataAvailability: "available", pendingQuestion: true },
  );
});

test("slot metadata recognizes the native pending request object", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-pending" } }],
    [atoms.jCt, null],
    [atoms.gCt, []],
    [atoms.uCt, { type: "userInput", item: { questions: ["must stay private"] } }],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "idle", activeFlags: [] }],
  ]);
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-pending" }, metadataStore(values), atoms),
    { metadataAvailability: "available", pendingQuestion: true },
  );
});

test("slot metadata remains available when optional selectors are incomplete", () => {
  const incomplete = { ...atoms } as Record<string, unknown>;
  delete incomplete.uCt;
  assert.deepEqual(
    generatedReader()(
      { threadKey: "local:conversation-1" },
      metadataStore(new Map([
        [atoms.I4, { kind: "local", conversation: { id: "conversation-1" } }],
        [atoms.jCt, null],
      ])),
      incomplete,
    ),
    { metadataAvailability: "available" },
  );
});

test("slot metadata stays unavailable when no detail selector can be read", () => {
  const onlyIdentity = { I4: atoms.I4 };
  assert.deepEqual(
    generatedReader()(
      { threadKey: "local:conversation-no-details" },
      metadataStore(new Map([[atoms.I4, { kind: "local", conversation: { id: "conversation-no-details" } }]])),
      onlyIdentity,
    ),
    { metadataAvailability: "unavailable" },
  );
});

test("slot metadata accepts passive approval and pin details without goal selectors", () => {
  const nativeDetails = { I4: atoms.I4, v3: atoms.v3, F2: atoms.F2 };
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-native-only" } }],
    [atoms.v3, null],
    [atoms.F2, true],
  ]);
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-native-only" }, metadataStore(values), nativeDetails),
    { metadataAvailability: "available", approvalPending: false, threadPinned: true },
  );
});

test("slot metadata omits a false question state when a detail read is transiently unavailable", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-transient" } }],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
  ]);
  const store = {
    get(atom: unknown, parameter?: unknown) {
      if (atom === atoms.LCt) throw new Error("store is between snapshots");
      return values.get(`${String(atom)}:${String(parameter)}`) ?? values.get(atom);
    },
  };
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-transient" }, store, atoms),
    { metadataAvailability: "available" },
  );
});

test("slot metadata preserves a positive question signal when an unrelated detail read throws", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-question" } }],
    [atoms.gCt, [{ method: "item/tool/requestUserInput" }]],
  ]);
  const store = {
    get(atom: unknown, parameter?: unknown) {
      if (atom === atoms.jCt) throw new Error("goal selector changed");
      return values.get(`${String(atom)}:${String(parameter)}`) ?? values.get(atom);
    },
  };
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-question" }, store, atoms),
    { metadataAvailability: "available", pendingQuestion: true },
  );
});

test("slot metadata distinguishes an observed empty state from unavailable selectors", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-empty" } }],
    [atoms.jCt, null],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "idle", activeFlags: [] }],
  ]);

  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-empty" }, metadataStore(values), atoms),
    { metadataAvailability: "available", pendingQuestion: false },
  );
});

test("slot metadata reads the native approval chip and sidebar pin selectors without content", () => {
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-native-state" } }],
    [atoms.jCt, null],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "idle", activeFlags: [] }],
    [atoms.v3, "approval"],
    [atoms.F2, false],
  ]);
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-native-state" }, metadataStore(values), atoms),
    {
      metadataAvailability: "available",
      pendingQuestion: false,
      approvalPending: true,
      threadPinned: false,
    },
  );
  values.set(atoms.v3, null);
  values.set(atoms.F2, true);
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-native-state" }, metadataStore(values), atoms),
    {
      metadataAvailability: "available",
      pendingQuestion: false,
      approvalPending: false,
      threadPinned: true,
    },
  );
});

test("slot metadata rejects unknown goal states and unavailable remote metadata", () => {
  const localValues = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "conversation-3" } }],
    [atoms.jCt, { status: "inferred-blocked", objective: "private" }],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "idle", activeFlags: [] }],
  ]);
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-3" }, metadataStore(localValues), atoms),
    { metadataAvailability: "available", pendingQuestion: false },
  );

  const remoteValues = new Map<unknown, unknown>([[atoms.I4, { kind: "remote", task: { id: "task-1" } }]]);
  assert.deepEqual(
    generatedReader()({ threadKey: "remote:task-1" }, metadataStore(remoteValues), atoms),
    { metadataAvailability: "unavailable" },
  );
});

test("slot metadata requires the parameter-aware AppScope getter used by native selectors", () => {
  const task = { kind: "local", conversation: { id: "conversation-scoped" } };
  const rawNodeStore = {
    get(atom: unknown) {
      // A raw node store accepts only resolved atoms. Its second argument is
      // ignored, so reading the parameterized I4 selector cannot find a task.
      if (atom === atoms.I4) return null;
      return undefined;
    },
  };
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-scoped" }, rawNodeStore, atoms),
    { metadataAvailability: "unavailable" },
  );

  const appScope = {
    get(atom: unknown, parameter?: unknown) {
      if (atom === atoms.I4 && parameter === "local:conversation-scoped") return task;
      if (atom === atoms.jCt && parameter === "conversation-scoped") return { status: "blocked" };
      if (atom === atoms.gCt && parameter === "conversation-scoped") return [];
      if (atom === atoms.uCt && parameter === "conversation-scoped") return null;
      if (atom === atoms.vCt && parameter === "conversation-scoped") return "resumed";
      if (atom === atoms.LCt && parameter === "conversation-scoped") return { type: "idle", activeFlags: [] };
      throw new Error("unexpected selector");
    },
  };
  assert.deepEqual(
    generatedReader()({ threadKey: "local:conversation-scoped" }, appScope, atoms),
    { metadataAvailability: "available", goalStatus: "blocked", pendingQuestion: false },
  );
});

test("26.903 metadata references expose goal and pending state without guessing pin state", () => {
  const current = { B3: atoms.I4, nEt: atoms.jCt, BTt: atoms.gCt, PTt: atoms.uCt,
    HTt: atoms.vCt, cEt: atoms.LCt, S6: atoms.v3, F2: Symbol("unrelated-current-export") };
  const normalize = Function(`return (${agentSlotMetadataNamespace.toString()})`)() as typeof agentSlotMetadataNamespace;
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "current-task" } }],
    [atoms.jCt, { status: "blocked", objective: "private" }],
    [atoms.gCt, [{ method: "item/tool/requestUserInput" }]],
    [atoms.v3, "approval"],
  ]);
  const result = generatedReader()({ threadKey: "local:current-task" }, metadataStore(values), normalize(current, true));
  assert.deepEqual(result, { metadataAvailability: "available", goalStatus: "blocked", pendingQuestion: true, approvalPending: true });
  assert.equal("threadPinned" in result, false);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.deepEqual(generatedReader()({ threadKey: "local:current-task" }, metadataStore(values), normalize({}, true)), { metadataAvailability: "unavailable" });
});

test("26.908 metadata references expose goal, pending, approval, and pin state", () => {
  const current = {
    ktt: atoms.I4, NOt: atoms.jCt, hOt: atoms.gCt, uOt: atoms.uCt,
    _Ot: atoms.vCt, HOt: atoms.LCt, pnt: atoms.v3, Oet: atoms.F2,
  };
  const normalize = Function(`return (${agentSlotMetadataNamespace.toString()})`)() as typeof agentSlotMetadataNamespace;
  const values = new Map<unknown, unknown>([
    [atoms.I4, { kind: "local", conversation: { id: "current-task" } }],
    [atoms.jCt, { status: "active", objective: "private" }],
    [atoms.gCt, []],
    [atoms.uCt, null],
    [atoms.vCt, "resumed"],
    [atoms.LCt, { type: "active", activeFlags: [] }],
    [atoms.v3, null],
    [atoms.F2, true],
  ]);
  const result = generatedReader()({ threadKey: "local:current-task" }, metadataStore(values), normalize(current, false));
  assert.deepEqual(result, {
    metadataAvailability: "available",
    goalStatus: "active",
    pendingQuestion: false,
    approvalPending: false,
    threadPinned: true,
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.deepEqual(generatedReader()({ threadKey: "local:current-task" }, metadataStore(values), normalize({}, false)), { metadataAvailability: "unavailable" });
});
