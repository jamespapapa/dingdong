import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { Store } from "../server/store.ts";
import { searchMemories } from "../server/memory-search.ts";
import {
  benchmarkMemories,
  benchmarkQueries,
} from "../tests/fixtures/memory-benchmark.ts";
import type { Memory } from "../shared/domain.ts";
const run = promisify(execFile),
  at = "2026-10-06T00:00:00.000Z";
const directory = mkdtempSync(
  path.join(tmpdir(), "dingdong-memory-benchmark-"),
);
const store = new Store(path.join(directory, "dingdong.sqlite"));
const records: Memory[] = benchmarkMemories.map((m) => ({
  ...m,
  projectId: "benchmark",
  kind: "fact",
  layer: "core",
  source: "Synthetic fixed benchmark fixture",
  status: "confirmed",
  validUntil: null,
  id: m.id,
  revision: 1,
  createdAt: at,
  updatedAt: at,
  actor: "benchmark",
}));
for (const m of records) store.put("memories", m.id, m);
// Frozen substring ranking from Dingdong 0a1103d, including the former leading
// 2,000-character context excerpt. This is a baseline algorithm, not OpenClaw.
const legacy = (query: string) => {
  const terms = query
    .toLocaleLowerCase()
    .split(/[\s,.;!?]+/)
    .filter(Boolean)
    .slice(0, 30);
  const score = (m: Memory) =>
    terms.reduce(
      (n, t) =>
        n +
        (m.title.toLocaleLowerCase().includes(t) ? 3 : 0) +
        (m.content.toLocaleLowerCase().includes(t) ? 1 : 0),
      0,
    );
  return records
    .filter((m) => !terms.length || score(m) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 3)
    .map((m) => ({ id: m.id, snippet: m.content.slice(0, 2000) }));
};
const withOpenClaw = process.argv.includes("--openclaw");
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: path.join(directory, "state"),
  OPENCLAW_CONFIG_PATH: path.join(directory, "openclaw.json"),
  OPENCLAW_SKIP_CHANNELS: "1",
};
for (const key of Object.keys(env))
  if (
    /^(TELEGRAM_|DISCORD_|SLACK_|WHATSAPP_|ANTHROPIC_|OPENAI_API_KEY|OPENROUTER_API_KEY)/.test(
      key,
    )
  )
    delete (env as any)[key];
const binary = process.env.OPENCLAW_BIN || "openclaw";
let version: string | null = null;
if (withOpenClaw) {
  version = (await run(binary, ["--version"], { env })).stdout.trim();
  if (!version.includes("2026.9.7"))
    throw new Error(
      "This benchmark pins OpenClaw 2026.9.7; change the documented reference before using another version.",
    );
  const workspace = path.join(directory, "workspace");
  mkdirSync(path.join(workspace, "memory"), { recursive: true });
  writeFileSync(
    env.OPENCLAW_CONFIG_PATH,
    JSON.stringify({
      agents: { defaults: { workspace, skipBootstrap: true } },
      memory: {
        search: { provider: "none", rememberAcrossConversations: false },
      },
      plugins: {
        allow: ["memory-core"],
        slots: { memory: "memory-core" },
        entries: {
          "memory-core": {
            enabled: true,
            config: { dreaming: { enabled: false } },
          },
        },
      },
    }),
  );
  for (const m of records)
    writeFileSync(
      path.join(workspace, "memory", `${m.id}.md`),
      `# ${m.title}\n\n${m.content}\n`,
    );
  await run(binary, ["memory", "index", "--agent", "main", "--force"], {
    env,
    timeout: 120000,
    maxBuffer: 2_000_000,
  });
}
const rows: any[] = [];
for (const q of benchmarkQueries) {
  const start = performance.now();
  const updated = searchMemories(store, "benchmark", q.query, false, at)
    .slice(0, 3)
    .map((m) => ({ id: m.id, snippet: m.snippet }));
  const localMs = performance.now() - start;
  const results: Record<string, { id: string; snippet: string }[]> = {
    legacy: legacy(q.query),
    dingdong: updated,
  };
  if (withOpenClaw) {
    const output = await run(
      binary,
      [
        "memory",
        "search",
        "--agent",
        "main",
        "--query",
        q.query,
        "--max-results",
        "12",
        "--min-score",
        "0",
        "--json",
      ],
      { env, timeout: 60000, maxBuffer: 2_000_000 },
    );
    const response = JSON.parse(output.stdout);
    if (response.disabled || response.stale || response.error)
      throw new Error(
        "OpenClaw benchmark did not produce a current available index",
      );
    const unique = new Map<string, { id: string; snippet: string }>();
    for (const hit of response.results || []) {
      const id = path.basename(hit.path, ".md");
      if (!unique.has(id)) unique.set(id, { id, snippet: hit.snippet });
    }
    results.openclawFtsOnly = [...unique.values()].slice(0, 3);
  }
  rows.push({
    query: q.query,
    relevant: q.relevant,
    localMs,
    engines: Object.fromEntries(
      Object.entries(results).map(([name, hits]) => [
        name,
        {
          ids: hits.map((h) => h.id),
          hitAt3: hits.some((h) => q.relevant.includes(h.id)),
          evidenceAt3: hits.some(
            (h) => q.relevant.includes(h.id) && h.snippet.includes(q.evidence),
          ),
        },
      ]),
    ),
  });
  console.log(`Checked query ${rows.length}/${benchmarkQueries.length}`);
}
const names = Object.keys(rows[0].engines);
const report = {
  at: new Date().toISOString(),
  corpus: { memories: records.length, queries: rows.length, synthetic: true },
  openclaw: {
    version,
    sourceCommit: "c074824a27c96d3983043f9eeb33823cd1772d8c",
    provider: withOpenClaw ? "none" : null,
    actualCli: withOpenClaw,
  },
  scope:
    "Fixed small lexical regression corpus, top 3 unique notes. OpenClaw uses its actual CLI with provider:none; no vector/hybrid/dreaming or model-quality comparison. CLI process startup time is not compared to in-process retrieval latency.",
  summary: Object.fromEntries(
    names.map((name) => [
      name,
      {
        hitAt3: rows.filter((r) => r.engines[name].hitAt3).length,
        total: rows.length,
        evidenceAt3: rows.filter((r) => r.engines[name].evidenceAt3).length,
      },
    ]),
  ),
  queries: rows,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  `artifacts/memory-benchmark${withOpenClaw ? "" : "-local"}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
store.close();
console.log(JSON.stringify(report.summary, null, 2));
