# Verification

This file distinguishes actual runtime tests from personal account use. Verification date: 2026-10-06.

| Layer              | Result                      | Evidence                                                                                                                                                         |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core + OAuth + MCP | Passed, 13 tests            | `npm test`: persistence, scoped retrieval, migration, atomic index updates, source citations, context budget, decay, legacy request keys, approval, PKCE, token rotation and CSRF |
| Production build   | Passed                      | TypeScript and Vite, locally and in the deployed Linux container                                                                                                 |
| UI                 | Passed, desktop and mobile  | `npm run test:e2e`: memory layers → workflow → review → feedback loop, dialog focus restoration, no horizontal overflow; screenshots in `artifacts/` |
| Actual OpenClaw    | Passed                      | `artifacts/openclaw-verification.json`: real Gateway, authenticated MCP chain, memory recall, review, blocked shell tools, stop/start without stale owner leases |
| OpenClaw memory benchmark | Executed, scoped comparison | `artifacts/memory-benchmark.json`: actual 2026.9.7 CLI with embeddings disabled; 32 synthetic notes and 12 fixed queries. See [method and limits](openclaw-memory-benchmark.md) |
| Cloud              | Deployed                    | HTTPS owner UI and MCP on Railway, OpenClaw 2026.9.7, Node 24.18.0, one replica and `/data` persistent volume                                                    |
| Personal GPT dots  | Owner authorization pending | ChatGPT recognized the OAuth metadata and DCR endpoint, and reached Dingdong's owner consent screen. No personal dot tool execution is claimed yet.              |

The deployment test found that an OpenClaw state-owner lease could survive replacement of a container. The fixed host uses a private temporary OpenClaw profile per process, while work data and OAuth state stay in SQLite on `/data`. A product-direction memory sourced from the user's request retained the same ID, revision and content hash after the fixed deployment. Subsequent restart evidence is recorded in `artifacts/cloud-verification.json`.

No synthetic test is evidence of an external user account connection. The OpenClaw host is used without a model call in this MVP. Document generation is deterministic template rendering. A successful run is evidence that those supported steps completed, not evidence that an external publication or delivery occurred.

The memory retrieval migration also passed its seven focused tests on Node 24.18.0, the production runtime version. The live Gateway integration now checks `memory_get` through authenticated MCP against the exact citation returned by `context_get`.

Memory release `c408bdc` was deployed as `030db2c3-02e8-4167-8ab0-c570a9e418e4`. Authenticated owner API calls through the real cloud Gateway verified FTS5 recall, legacy core defaults, revisioned source readback and the context budget. All pre-existing project, memory, workflow and run records retained identical content hashes across deployment. Evidence: [cloud memory verification](../artifacts/cloud-memory-verification.json). Implementation [GitHub checks](https://github.com/jamespapapa/dingdong/actions/runs/37411011579) passed. This remains separate from pending personal dots authorization.
