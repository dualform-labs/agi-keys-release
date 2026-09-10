import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexSessionOwnershipIndex } from "../src/session-ownership.js";
import type { MicroSnapshot } from "../src/types.js";

const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";

test("a missing tracked session uses the ownership refresh TTL", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-negative-ownership-");
  try {
    const index = new CodexSessionOwnershipIndex([root], 5_000);
    const now = Date.now();
    assert.equal((await index.annotate(snapshotFor(firstId), now)).slots[0]?.ownedByHost, false);

    await writeFile(join(root, `rollout-now-${firstId}.jsonl`), "{}\n");
    assert.equal((await index.annotate(snapshotFor(firstId), now + 1)).slots[0]?.ownedByHost, false);
    assert.equal((await index.annotate(snapshotFor(firstId), now + 5_001)).slots[0]?.ownedByHost, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a task without a local rollout cannot retain a stale working status", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-unowned-status-");
  try {
    const snapshot = snapshotFor(firstId);
    snapshot.slots[0]!.status = "working";
    const annotated = await new CodexSessionOwnershipIndex([root], 60_000)
      .annotate(snapshot, Date.now());

    assert.equal(annotated.slots[0]?.ownedByHost, false);
    assert.equal(annotated.slots[0]?.status, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a rollout symlink never establishes host ownership or context usage", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-symlink-ownership-");
  try {
    const target = join(root, "outside.jsonl");
    const link = join(root, `rollout-link-${firstId}.jsonl`);
    await writeFile(target, JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { total_tokens: 90_000 }, model_context_window: 100_000 }
      }
    }) + "\n");
    await symlink(target, link);

    const snapshot = snapshotFor(firstId);
    snapshot.activeThreadKey = `local:${firstId}`;
    const index = new CodexSessionOwnershipIndex([root], 0);
    const annotated = await index.annotate(snapshot, Date.now());

    assert.equal(annotated.slots[0]?.ownedByHost, false);
    assert.equal(annotated.slots[0]?.contextUsedPercent, undefined);
    assert.equal(index.getActiveThreadContextUsage(annotated), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symlinked session root or ancestor cannot establish working ownership", async () => {
  const realRoot = await makeCanonicalTempDirectory("codex-deck-real-sessions-");
  const rootContainer = await makeCanonicalTempDirectory("codex-deck-root-link-");
  const ancestorTarget = await makeCanonicalTempDirectory("codex-deck-ancestor-target-");
  const ancestorContainer = await makeCanonicalTempDirectory("codex-deck-ancestor-link-");
  const rootLink = join(rootContainer, "sessions");
  const ancestorLink = join(ancestorContainer, "codex-home");
  const ancestorRoot = join(ancestorLink, "sessions");
  try {
    await symlink(realRoot, rootLink, "dir");
    await symlink(ancestorTarget, ancestorLink, "dir");
    await mkdir(join(ancestorTarget, "sessions"));
    const workingRollout = JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_reasoning" }
    }) + "\n";
    await writeFile(join(realRoot, `rollout-root-${firstId}.jsonl`), workingRollout);
    await writeFile(join(ancestorRoot, `rollout-ancestor-${firstId}.jsonl`), workingRollout);

    for (const linkedRoot of [rootLink, ancestorRoot]) {
      const snapshot = snapshotFor(firstId);
      const annotated = await new CodexSessionOwnershipIndex([linkedRoot], 0)
        .annotate(snapshot, Date.now());
      assert.equal(annotated.slots[0]?.ownedByHost, false, linkedRoot);
      assert.equal(annotated.slots[0]?.status, "unknown", linkedRoot);
      assert.equal(annotated.hostSessions?.length, 0, linkedRoot);
    }
  } finally {
    await rm(rootLink, { force: true });
    await rm(ancestorLink, { force: true });
    await rm(realRoot, { recursive: true, force: true });
    await rm(rootContainer, { recursive: true, force: true });
    await rm(ancestorTarget, { recursive: true, force: true });
    await rm(ancestorContainer, { recursive: true, force: true });
  }
});

test("an unassigned slot remains empty instead of becoming unknown", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-empty-slot-");
  try {
    const snapshot = snapshotFor(firstId);
    snapshot.slots[0] = { ...snapshot.slots[0]!, threadKey: null, status: "off" };
    const annotated = await new CodexSessionOwnershipIndex([root], 60_000)
      .annotate(snapshot, Date.now());

    assert.equal(annotated.slots[0]?.status, "off");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a newly tracked session refreshes within the TTL", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-new-tracked-");
  try {
    const index = new CodexSessionOwnershipIndex([root], 60_000);
    const now = Date.now();
    await index.annotate(snapshotFor(firstId), now);

    await writeFile(join(root, `rollout-now-${secondId}.jsonl`), "{}\n");
    assert.equal((await index.annotate(snapshotFor(secondId), now + 1)).slots[0]?.ownedByHost, true);

    await writeFile(join(root, `rollout-now-${firstId}.jsonl`), "{}\n");
    assert.equal((await index.annotate(snapshotFor(firstId), now + 2)).slots[0]?.ownedByHost, false);
    assert.equal((await index.annotate(snapshotFor(firstId), now + 60_002)).slots[0]?.ownedByHost, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selecting a cached completion acknowledges its exact revision without rescanning", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-selected-completion-");
  try {
    await writeFile(join(root, `rollout-now-${firstId}.jsonl`),
      '{"type":"event_msg","payload":{"type":"task_complete"}}\n');
    const index = new CodexSessionOwnershipIndex([root], 60_000);
    const now = Date.now();
    const first = await index.annotate(snapshotFor(firstId), now);
    assert.equal(first.hostSessions?.find(({ threadId }) => threadId === firstId)?.status, "complete");

    const selected = snapshotFor(firstId);
    selected.slots[0]!.selected = true;
    const acknowledged = await index.annotate(selected, now + 1);
    assert.equal(acknowledged.hostSessions?.find(({ threadId }) => threadId === firstId)?.status, "idle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a tracked rollout outside the recent 128 still supplies context", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-old-tracked-");
  try {
    const dated = join(root, "2026", "09", "09");
    await mkdir(dated, { recursive: true });
    const trackedPath = join(dated, `rollout-old-${firstId}.jsonl`);
    const tokenCount = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { total_tokens: 80_000 }, model_context_window: 100_000 }
      }
    });
    await writeFile(trackedPath, `${tokenCount}\n`);
    const now = Date.now();
    await utimes(trackedPath, new Date(now - 86_400_000), new Date(now - 86_400_000));
    await Promise.all(Array.from({ length: 128 }, async (_, index) => {
      const suffix = (index + 100).toString(16).padStart(12, "0");
      await writeFile(join(dated, `rollout-new-20000000-0000-4000-8000-${suffix}.jsonl`), "{}\n");
    }));

    const annotated = await new CodexSessionOwnershipIndex([root], 60_000)
      .annotate(snapshotFor(firstId), now);
    assert.equal(annotated.slots[0]?.ownedByHost, true);
    assert.equal(annotated.slots[0]?.contextUsedPercent, 80);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active thread context usage is exposed only for its matching local rollout", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-active-context-");
  try {
    const record = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { total_tokens: 42_000 }, model_context_window: 100_000 }
      }
    });
    await writeFile(join(root, `rollout-active-${firstId}.jsonl`), `${record}\n`);
    const index = new CodexSessionOwnershipIndex([root], 0);
    const snapshot = snapshotFor("20000000-0000-4000-8000-000000000001");
    snapshot.activeThreadKey = `local:${firstId}`;

    await index.annotate(snapshot, Date.now());

    assert.deepEqual(index.getActiveThreadContextUsage(snapshot), {
      threadKey: `local:${firstId}`,
      sessionId: firstId,
      contextUsedPercent: 42,
      contextRevision: 0
    });

    snapshot.activeThreadKey = `local:${secondId}`;
    assert.equal(index.getActiveThreadContextUsage(snapshot), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active context revisions follow valid token-count byte offsets monotonically", async () => {
  const root = await makeCanonicalTempDirectory("codex-deck-context-revision-");
  try {
    const path = join(root, `rollout-active-${firstId}.jsonl`);
    const firstRecord = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { total_tokens: 10_000 }, model_context_window: 100_000 }
      }
    });
    const secondRecord = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { total_tokens: 90_000 }, model_context_window: 100_000 }
      }
    });
    await writeFile(path, `${firstRecord}\n`);
    const index = new CodexSessionOwnershipIndex([root], 0);
    const snapshot = snapshotFor("20000000-0000-4000-8000-000000000002");
    snapshot.activeThreadKey = `local:${firstId}`;
    const first = await index.annotate(snapshot, Date.now());
    const firstUsage = index.getActiveThreadContextUsage(first);
    assert.equal(firstUsage?.contextUsedPercent, 10);
    assert.equal(firstUsage?.contextRevision, 0);

    await writeFile(path, `${firstRecord}\n${secondRecord}\n`);
    const second = await index.annotate(snapshot, Date.now() + 1);
    const secondUsage = index.getActiveThreadContextUsage(second);
    assert.equal(secondUsage?.contextUsedPercent, 90);
    assert.equal(secondUsage?.contextRevision, Buffer.byteLength(`${firstRecord}\n`));
    assert.ok((secondUsage?.contextRevision ?? -1) > (firstUsage?.contextRevision ?? -1));
    assert.deepEqual(Object.keys(secondUsage ?? {}).sort(), [
      "contextRevision",
      "contextUsedPercent",
      "sessionId",
      "threadKey"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function snapshotFor(threadId: string): MicroSnapshot {
  return {
    slots: [{ id: 0, threadKey: `local:${threadId}`, title: "Task", status: "idle", selected: false }],
    layout: {
      version: 1,
      slots: {},
      analogStick: { up: {}, right: {}, down: {}, left: {} }
    },
    agentSource: "recent",
    lightingAutoOff: "3-minutes",
    theme: "dark",
    connectionEpoch: 1,
    pageEpoch: 1,
    mappingFingerprint: "mapping",
    targetIdentity: "target"
  };
}

async function makeCanonicalTempDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

for (const ending of [
  [{type:"event_msg",payload:{type:"task_complete"}}, {type:"response_item",payload:{type:"message",role:"assistant"}}],
  [{type:"response_item",payload:{type:"message",role:"assistant",channel:"final"}}],
  [{type:"response_item",payload:{type:"message",role:"assistant",phase:"final_answer"}}],
  [{type:"event_msg",payload:{type:"turn_aborted"}}],
]) {
 test(`terminal records release busy status: ${JSON.stringify(ending)}`,async()=>{
  const root=await makeCanonicalTempDirectory("codex-terminal-status-");
  const file=join(root,`rollout-now-${firstId}.jsonl`);
  const records=[{type:"event_msg",payload:{type:"task_started"}},...ending];
  await writeFile(file,records.map(x=>JSON.stringify(x)).join("\n")+"\n");
  const snapshot=snapshotFor(firstId);snapshot.activeThreadKey=`local:${firstId}`;
  const result=await new CodexSessionOwnershipIndex([root],0).annotate(snapshot);
  assert.equal(result.hostSessions?.find(s=>s.threadId===firstId)?.status,"idle");
  await writeFile(file,[...records,{type:"event_msg",payload:{type:"task_started"}}].map(x=>JSON.stringify(x)).join("\n")+"\n");
  const restarted=await new CodexSessionOwnershipIndex([root],0).annotate(snapshot);
  assert.equal(restarted.hostSessions?.find(s=>s.threadId===firstId)?.status,"working");
 });
}
