import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { Store } from "../server/store.ts";
import { Core, type Operation } from "../server/core.ts";
import { searchMemories } from "../server/memory-search.ts";
import { memoryChunks } from "../server/memory-text.ts";
import { memoryInput, type Memory } from "../shared/domain.ts";

const at = "2026-10-06T00:00:00.000Z";
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "dingdong-memory-test-"));
  const file = path.join(dir, "db.sqlite");
  const store = new Store(file),
    core = new Core(store);
  let n = 0;
  const call = (name: Operation, input: unknown, key = `request-${++n}`) =>
    core.dispatch(name, input, "test-owner", key);
  const project = call("project_create", { name: "Synthetic memory test" });
  const write = (fields: Record<string, unknown> = {}) =>
    call("memory_write", {
      projectId: project.id,
      title: "Synthetic note",
      kind: "fact",
      content: "Synthetic observation",
      source: "Isolated test fixture",
      status: "confirmed",
      ...fields,
    }) as Memory;
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file, store, core, project, call, write };
}

test("matched passage survives core bootstrap and its citation reopens the original revision", (t) => {
  const f = fixture(t);
  const content =
    "운영 기록과 일반적인 확인 내용.\n".repeat(220) +
    "\nTAIL-RECOVERY-47: restore the blue archive.";
  const m = f.write({ content });
  const result = f.call("memory_search", {
    projectId: f.project.id,
    query: "TAIL-RECOVERY-47",
  });
  assert.equal(result.retrieval.embeddings, false);
  const hit = result.memories[0];
  assert.equal(hit.id, m.id);
  assert.ok(hit.excerpt.start > 2000);
  assert.match(hit.content, /blue archive/);
  assert.equal(hit.content, content.slice(hit.excerpt.start, hit.excerpt.end));
  const context = f.core.context(f.project.id, "TAIL-RECOVERY-47");
  assert.match(context.memories[0].content, /blue archive/);
  const exact = f.call("memory_get", {
    projectId: f.project.id,
    id: hit.id,
    revision: hit.revision,
    start: hit.excerpt.start,
    length: hit.excerpt.end - hit.excerpt.start,
  });
  assert.equal(exact.content, hit.content);
  assert.equal(exact.citation, hit.citation);
  assert.equal(exact.actor, "test-owner");
  const other = f.call("project_create", { name: "Different scope" });
  assert.throws(
    () => f.call("memory_get", { projectId: other.id, id: m.id }),
    /프로젝트/,
  );
  f.call("memory_state", { id: m.id, revision: 1, status: "forgotten" });
  assert.throws(
    () =>
      f.call("memory_get", { projectId: f.project.id, id: m.id, revision: 1 }),
    /버전/,
  );
  assert.throws(
    () => f.call("memory_get", { projectId: f.project.id, id: m.id }),
    /제외/,
  );
  assert.equal(
    f.call("memory_get", {
      projectId: f.project.id,
      id: m.id,
      includeInactive: true,
    }).status,
    "forgotten",
  );
});

test("durable criteria keep context space when recent episodes grow, with bounded evidence", (t) => {
  const f = fixture(t);
  const principle = f.write({
    content: "Publish only after owner review.",
    kind: "decision",
  });
  for (let i = 0; i < 60; i++)
    f.write({
      layer: "episode",
      title: `Work ${i}`,
      content: `Observation ${i} of a release. `.repeat(40),
    });
  const context = f.core.context(f.project.id, "release");
  assert.ok(context.memories.some((m) => m.id === principle.id));
  assert.ok(context.memories.some((m) => m.layer === "episode"));
  assert.ok(context.memories.length <= 16);
  assert.ok(JSON.stringify(context.memories).length <= 14000);
  assert.equal(
    JSON.stringify(context.memories).length,
    context.retrieval.memoryCharacters,
  );
});

test("episodes age from observation time; approval and correction do not refresh their age", (t) => {
  const f = fixture(t);
  const oldTime = "2026-09-06T00:00:00.000Z";
  const old = f.write({
    content: "An older observation",
    layer: "episode",
    observedAt: oldTime,
    status: "candidate",
  });
  const durable = f.write({
    content: "An evergreen criterion",
    observedAt: "2020-01-01T00:00:00.000Z",
  });
  const fresh = f.write({
    content: "A fresh observation",
    layer: "episode",
    observedAt: at,
  });
  f.call("memory_state", { id: old.id, revision: 1, status: "confirmed" });
  const hits = searchMemories(f.store, f.project.id, "", false, at);
  assert.equal(hits.find((m) => m.id === old.id)!.score, 0.5);
  assert.equal(hits.find((m) => m.id === fresh.id)!.score, 1);
  assert.equal(hits.find((m) => m.id === durable.id)!.score, 1);
  const replacement = f.write({
    content: "A corrected observation",
    replacesId: old.id,
    expectedRevision: 2,
  });
  assert.equal(replacement.layer, "episode");
  assert.equal(replacement.observedAt, oldTime);
  assert.equal(
    searchMemories(f.store, f.project.id, "", false, at).find(
      (m) => m.id === replacement.id,
    )!.score,
    0.5,
  );
});

test("deduplication preserves source records and Korean normalization preserves original text", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++)
    f.write({
      title: `Deployment ${i}`,
      content: "Deployment requires a review before rollout.",
    });
  const note = f.write({
    content: "한국어 고객상담기록의 원문을 보존합니다. 🙂",
  });
  assert.equal(
    f.call("memory_search", { projectId: f.project.id, query: "deployment" })
      .memories.length,
    1,
  );
  assert.equal(f.store.list("memories").length, 9);
  for (const query of ["한국어".normalize("NFD"), "상담기록"]) {
    const hit = f.call("memory_search", { projectId: f.project.id, query })
      .memories[0];
    assert.equal(hit.id, note.id);
    assert.equal(hit.content, note.content);
  }
  const text = "🙂a".repeat(2000);
  for (const chunk of memoryChunks(text)) {
    assert.equal(chunk.text, text.slice(chunk.start, chunk.end));
    assert.equal(Buffer.from(chunk.text, "utf8").toString("utf8"), chunk.text);
    assert.ok(chunk.text.length <= 1400);
  }
});

test("candidate limit is applied after project, state and expiry filtering; rebuild cannot reactivate notes", (t) => {
  const f = fixture(t);
  const other = f.call("project_create", { name: "Other project" });
  const active = f.write({ content: "SEARCHTOKEN active evidence" });
  for (let i = 0; i < 250; i++)
    f.write({ content: `SEARCHTOKEN candidate ${i}`, status: "candidate" });
  f.write({ content: "SEARCHTOKEN wrong project", projectId: other.id });
  f.write({
    content: "SEARCHTOKEN expired",
    validUntil: "2020-01-01T00:00:00.000Z",
  });
  const forgotten = f.write({ content: "SEARCHTOKEN forgotten" });
  f.call("memory_state", {
    id: forgotten.id,
    revision: 1,
    status: "forgotten",
  });
  const superseded = f.write({ content: "SEARCHTOKEN superseded" });
  f.write({
    replacesId: superseded.id,
    expectedRevision: 1,
    content: "Replacement without that keyword",
  });
  f.store.rebuildMemoryIndex();
  assert.deepEqual(
    f
      .call("memory_search", { projectId: f.project.id, query: "SEARCHTOKEN" })
      .memories.map((m: Memory) => m.id),
    [active.id],
  );
});

test("old database migrates and derived index rebuild preserves memories, history and OAuth state", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dingdong-migration-test-"));
  const file = path.join(dir, "db.sqlite");
  const old = new DatabaseSync(file);
  old.exec(
    "CREATE TABLE records (kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id))",
  );
  const memory: Memory = {
    id: "old",
    projectId: "p",
    kind: "fact",
    title: "Old note",
    content: "PREMIGRATION evidence",
    source: "Synthetic old fixture",
    status: "confirmed",
    validUntil: null,
    revision: 1,
    actor: "fixture",
    createdAt: at,
    updatedAt: at,
  };
  const insert = old.prepare("INSERT INTO records VALUES(?,?,?,?)");
  insert.run("memories", memory.id, JSON.stringify(memory), at);
  insert.run(
    "memory_history",
    "old:0",
    JSON.stringify({ ...memory, revision: 0 }),
    at,
  );
  insert.run(
    "oauth_clients",
    "fixture",
    JSON.stringify({ client_id: "fixture" }),
    at,
  );
  old.close();
  let migrated = new Store(file);
  try {
    assert.equal(
      searchMemories(migrated, "p", "PREMIGRATION", false, at)[0].layer,
      "core",
    );
    assert.deepEqual(migrated.get("memories", "old"), memory);
    migrated.db.exec("DROP TABLE memory_chunks");
    migrated.close();
    migrated = new Store(file);
    assert.equal(
      searchMemories(migrated, "p", "PREMIGRATION", false, at)[0].id,
      "old",
    );
    assert.equal(migrated.get<Memory>("memory_history", "old:0")!.revision, 0);
    assert.deepEqual(migrated.get("oauth_clients", "fixture"), {
      client_id: "fixture",
    });
    assert.throws(() =>
      migrated.put("memories", "bad", { ...memory, id: "bad", content: null }),
    );
    assert.equal(migrated.get("memories", "bad"), undefined);
    assert.equal(
      migrated.db
        .prepare(
          "SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id='bad'",
        )
        .get()!.n,
      0,
    );
  } finally {
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adding optional memory fields preserves idempotency hashes of old clients", (t) => {
  const f = fixture(t);
  const raw = {
    projectId: f.project.id,
    kind: "fact",
    title: "Old request",
    content: "Old payload",
    source: "Fixture",
  };
  const oldSchema = memoryInput.omit({ layer: true, observedAt: true });
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        operation: "memory_write",
        input: oldSchema.parse(raw),
      }),
    )
    .digest("hex");
  const key = createHash("sha256")
    .update("test-owner:legacy-request")
    .digest("hex");
  f.store.put("idempotency", key, { hash, result: { id: "old-result" } });
  assert.deepEqual(f.call("memory_write", raw, "legacy-request"), {
    id: "old-result",
  });
  assert.equal(f.store.list("memories").length, 0);
});
