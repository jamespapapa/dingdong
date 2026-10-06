import type { Memory } from "../shared/domain.ts";
import type { Store } from "./store.ts";
import { memoryTerms, normalizeMemoryText } from "./memory-text.ts";
import { memoryConflicts } from "./memory-conflicts.ts";

export type MemoryHit = Memory & {
  snippet: string;
  score: number;
  excerpt: { start: number; end: number; totalCharacters: number };
};
export const memoryLayer = (memory: Memory) => memory.layer || "core";
export const eligibleMemory = (memory: Memory, at: string) =>
  memory.status === "confirmed" &&
  (!memory.validUntil || memory.validUntil > at);

// Relevance-biased MMR inspired by OpenClaw's search pipeline. Exact repeated
// text contributes once to context; records themselves are never merged/deleted.
export function diverseMemories(hits: MemoryHit[], limit: number): MemoryHit[] {
  const selected: MemoryHit[] = [],
    seen = new Set<string>();
  const pool = hits.map((hit) => ({
    hit,
    tokens: new Set(memoryTerms(hit.snippet, 256)),
    similarity: 0,
  }));
  const maximum = Math.max(1e-9, ...hits.map((h) => h.score));
  while (pool.length && selected.length < limit) {
    pool.sort(
      (a, b) =>
        (0.7 * b.hit.score) / maximum -
        0.3 * b.similarity -
        ((0.7 * a.hit.score) / maximum - 0.3 * a.similarity),
    );
    const chosen = pool.shift()!;
    const identity = normalizeMemoryText(chosen.hit.content)
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(chosen.hit);
    for (const item of pool) {
      let intersection = 0;
      for (const token of chosen.tokens)
        if (item.tokens.has(token)) intersection++;
      const union = chosen.tokens.size + item.tokens.size - intersection;
      item.similarity = Math.max(
        item.similarity,
        union ? intersection / union : 0,
      );
    }
  }
  return selected;
}

export function searchMemories(
  store: Store,
  projectId: string,
  query: string,
  includeInactive = false,
  at = new Date().toISOString(),
  layer?: "core" | "episode",
): MemoryHit[] {
  const terms = memoryTerms(query);
  const candidates = store.memoryCandidates(
    projectId,
    terms,
    includeInactive,
    at,
    layer,
    includeInactive
      ? []
      : memoryConflicts(store, projectId, at).flatMap((c) =>
          c.memories.map((m) => m.id),
        ),
  );
  const maxRank = Math.max(
    1e-9,
    ...candidates.map((c) => Math.max(0, -c.rank)),
  );
  const best = new Map<string, MemoryHit>();
  for (const candidate of candidates) {
    const m = store.get<Memory>("memories", candidate.memory_id)!;
    // Recheck the canonical record, including after rebuilds and status changes.
    if (
      !m ||
      m.projectId !== projectId ||
      (!includeInactive && !eligibleMemory(m, at))
    )
      continue;
    const snippet = m.content.slice(candidate.start, candidate.end);
    const body = normalizeMemoryText(snippet),
      title = normalizeMemoryText(m.title);
    const coverage = terms.length
      ? terms.filter((t) => body.includes(t) || title.includes(t)).length /
        terms.length
      : 1;
    const titleCoverage = terms.length
      ? terms.filter((t) => title.includes(t)).length / terms.length
      : 0;
    const lexical = terms.length
      ? (0.5 * Math.max(0, -candidate.rank)) / maxRank +
        0.4 * coverage +
        0.1 * titleCoverage
      : 1;
    const age = Math.max(
      0,
      (Date.parse(at) - Date.parse(m.observedAt || m.createdAt)) / 86400000,
    );
    const recency = memoryLayer(m) === "episode" ? Math.pow(0.5, age / 30) : 1;
    const score = lexical * recency;
    const hit: MemoryHit = {
      ...m,
      layer: memoryLayer(m),
      snippet,
      score,
      excerpt: {
        start: candidate.start,
        end: candidate.end,
        totalCharacters: m.content.length,
      },
    };
    if (!best.has(m.id) || best.get(m.id)!.score < score) best.set(m.id, hit);
  }
  return diverseMemories(
    [...best.values()].sort((a, b) => b.score - a.score),
    100,
  );
}

export function memoryEvidence(hit: MemoryHit, maxContent = 1400) {
  const content = hit.snippet.slice(0, maxContent);
  return {
    id: hit.id,
    revision: hit.revision,
    title: hit.title,
    kind: hit.kind,
    layer: memoryLayer(hit),
    content,
    source: hit.source,
    excerpt: { ...hit.excerpt, end: hit.excerpt.start + content.length },
    citation: `dingdong:memory:${hit.id}@${hit.revision}:${hit.excerpt.start}-${hit.excerpt.start + content.length}`,
  };
}

export function assembleMemoryContext(
  core: MemoryHit[],
  recalled: MemoryHit[],
) {
  const memories: ReturnType<typeof memoryEvidence>[] = [],
    seen = new Set<string>(),
    texts = new Set<string>();
  let characters = 2; // JSON array brackets are part of the evidence budget.
  const append = (hit: MemoryHit, budget: number) => {
    const identity = normalizeMemoryText(hit.content)
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(hit.id) || texts.has(identity) || memories.length >= 16)
      return;
    const evidence = memoryEvidence(hit);
    const size = JSON.stringify(evidence).length + (memories.length ? 1 : 0);
    // Count citation and source metadata too; only the memory evidence is budgeted.
    if (characters + size > budget) return;
    characters += size;
    memories.push(evidence);
    seen.add(hit.id);
    texts.add(identity);
  };
  // Bootstrap must not hide a query's matching passage later in the same note.
  const matches = new Map(recalled.map((hit) => [hit.id, hit]));
  for (const hit of diverseMemories(core, 4))
    append(matches.get(hit.id) || hit, 6000);
  for (const hit of recalled) append(hit, 14000);
  return {
    memories,
    retrieval: {
      mode: "sqlite-fts5",
      embeddings: false,
      memoryCharacters: characters,
      maxMemoryCharacters: 14000,
      coreReserveCharacters: 6000,
      episodeHalfLifeDays: 30,
    },
  };
}
