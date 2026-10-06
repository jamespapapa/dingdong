import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Memory } from "../shared/domain.ts";
import { memoryChunks, normalizeMemoryText } from "./memory-text.ts";

export type MemoryCandidate = {
  memory_id: string;
  start: number;
  end: number;
  rank: number;
};

// Adapted from moa e22869b: independent SQLite records with explicit transactions.
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_time ON records(kind,updated_at);`);
    const existed = this.db
      .prepare("SELECT name FROM sqlite_master WHERE name='memory_chunks'")
      .get();
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks USING fts5(
      memory_id UNINDEXED, project_id UNINDEXED, start UNINDEXED, end UNINDEXED, title, content,
      tokenize='unicode61 remove_diacritics 2');`);
    if (!existed || this.get("settings", "memoryIndexVersion") !== 1)
      this.rebuildMemoryIndex();
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  list<T>(kind: string): T[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM records WHERE kind=? ORDER BY updated_at DESC,rowid DESC",
        )
        .all(kind) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  put<T>(kind: string, id: string, value: T): T {
    if (kind === "memories" && !this.db.isTransaction)
      return this.transaction(() => this.put(kind, id, value));
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at",
      )
      .run(kind, id, JSON.stringify(value), new Date().toISOString());
    if (kind === "memories") this.indexMemory(value as Memory);
    return value;
  }
  remove(kind: string, id: string): void {
    if (kind === "memories" && !this.db.isTransaction)
      return this.transaction(() => this.remove(kind, id));
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
    if (kind === "memories")
      this.db.prepare("DELETE FROM memory_chunks WHERE memory_id=?").run(id);
  }
  private indexMemory(m: Memory) {
    this.db.prepare("DELETE FROM memory_chunks WHERE memory_id=?").run(m.id);
    const insert = this.db.prepare(
      "INSERT INTO memory_chunks(memory_id,project_id,start,end,title,content) VALUES(?,?,?,?,?,?)",
    );
    for (const c of memoryChunks(m.content))
      insert.run(
        m.id,
        m.projectId,
        c.start,
        c.end,
        normalizeMemoryText(m.title),
        normalizeMemoryText(c.text),
      );
  }
  rebuildMemoryIndex() {
    this.transaction(() => {
      this.db.exec("DELETE FROM memory_chunks");
      for (const m of this.list<Memory>("memories")) this.indexMemory(m);
      this.put("settings", "memoryIndexVersion", 1);
    });
  }
  memoryCandidates(
    projectId: string,
    terms: string[],
    includeInactive: boolean,
    at: string,
    layer?: "core" | "episode",
    excludedIds: string[] = [],
  ): MemoryCandidate[] {
    const eligibility = `project_id=? AND memory_id NOT IN (SELECT value FROM json_each(?)) AND (? IS NULL OR COALESCE(json_extract(r.body,'$.layer'),'core')=?) AND (?=1 OR (json_extract(r.body,'$.status')='confirmed' AND (json_extract(r.body,'$.validUntil') IS NULL OR json_extract(r.body,'$.validUntil')>?)))`;
    const join = `FROM memory_chunks JOIN records r ON r.kind='memories' AND r.id=memory_id`;
    const args = [
      projectId,
      JSON.stringify(excludedIds),
      layer || null,
      layer || null,
      Number(includeInactive),
      at,
    ];
    if (!terms.length)
      return this.db
        .prepare(
          `SELECT memory_id,start,end,0 AS rank ${join} WHERE ${eligibility} ORDER BY r.updated_at DESC,memory_id,start LIMIT 200`,
        )
        .all(...args) as MemoryCandidate[];
    const match = terms.map((t) => `"${t}"*`).join(" OR ");
    const hits = this.db
      .prepare(
        `SELECT memory_id,start,end,bm25(memory_chunks,0,0,0,0,2,1) AS rank ${join} WHERE memory_chunks MATCH ? AND ${eligibility} ORDER BY rank LIMIT 200`,
      )
      .all(match, ...args) as MemoryCandidate[];
    // Unicode substring fallback covers Korean compound words that unicode61
    // indexes as one token. It is bounded and still applies canonical scope/status.
    if (hits.length < 200 && terms.some((t) => /[^\x00-\x7F]/.test(t))) {
      const condition = terms
        .map(() => "(instr(title,?)>0 OR instr(content,?)>0)")
        .join(" OR ");
      const extra = this.db
        .prepare(
          `SELECT memory_id,start,end,0 AS rank ${join} WHERE ${eligibility} AND (${condition}) ORDER BY r.updated_at DESC,memory_id,start LIMIT 200`,
        )
        .all(...args, ...terms.flatMap((t) => [t, t])) as MemoryCandidate[];
      const seen = new Set(hits.map((h) => `${h.memory_id}:${h.start}`));
      for (const h of extra)
        if (!seen.has(`${h.memory_id}:${h.start}`) && hits.length < 200)
          hits.push(h);
    }
    return hits;
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
