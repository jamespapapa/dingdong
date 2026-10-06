import type { Memory } from "../shared/domain.ts";
import type { MemoryConflict } from "../shared/work.ts";
import type { Store } from "./store.ts";
import { normalizeMemoryText } from "./memory-text.ts";

export function memoryConflicts(
  store: Store,
  projectId: string,
  at = new Date().toISOString(),
): MemoryConflict[] {
  const groups = new Map<string, Memory[]>();
  for (const memory of store.list<Memory>("memories")) {
    if (
      memory.projectId !== projectId ||
      memory.status !== "confirmed" ||
      !memory.claimKey ||
      (memory.validUntil && Date.parse(memory.validUntil) <= Date.parse(at))
    )
      continue;
    const key = normalizeMemoryText(memory.claimKey).trim();
    groups.set(key, [...(groups.get(key) || []), memory]);
  }
  return [...groups]
    .filter(
      ([, memories]) =>
        new Set(memories.map((m) => normalizeMemoryText(m.content).trim()))
          .size > 1,
    )
    .map(([claimKey, memories]) => ({ projectId, claimKey, memories }));
}
