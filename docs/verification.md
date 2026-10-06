# Verification

This file distinguishes actual runtime tests from personal account use. Verification date: 2026-10-06.

| Layer              | Result                      | Evidence                                                                                                                                                         |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core + OAuth + MCP | Passed, 6 tests             | `npm test`: database reopen, project isolation, revisions, idempotency, approval, PKCE, token rotation, CSRF and authenticated MCP                               |
| Production build   | Passed                      | TypeScript and Vite, locally and in the deployed Linux container                                                                                                 |
| UI                 | Passed, desktop and mobile  | `npm run test:e2e`: memory → workflow → review → feedback loop, keyboard focus, no horizontal overflow; screenshots in `artifacts/`                              |
| Actual OpenClaw    | Passed                      | `artifacts/openclaw-verification.json`: real Gateway, authenticated MCP chain, memory recall, review, blocked shell tools, stop/start without stale owner leases |
| Cloud              | Deployed                    | HTTPS owner UI and MCP on Railway, OpenClaw 2026.9.7, Node 24.18.0, one replica and `/data` persistent volume                                                    |
| Personal GPT dots  | Owner authorization pending | ChatGPT recognized the OAuth metadata and DCR endpoint, and reached Dingdong's owner consent screen. No personal dot tool execution is claimed yet.              |

The deployment test found that an OpenClaw state-owner lease could survive replacement of a container. The fixed host uses a private temporary OpenClaw profile per process, while work data and OAuth state stay in SQLite on `/data`. A product-direction memory sourced from the user's request retained the same ID, revision and content hash after the fixed deployment. Subsequent restart evidence is recorded in `artifacts/cloud-verification.json`.

No synthetic test is evidence of an external user account connection. The OpenClaw host is used without a model call in this MVP. Document generation is deterministic template rendering. A successful run is evidence that those supported steps completed, not evidence that an external publication or delivery occurred.
