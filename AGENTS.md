# Dingdong

GPT dots plans and calls tools; Dingdong owns persistent, inspectable work memory and versioned workflows. OpenClaw is the private tool runtime. Never expose its operator gateway publicly.

- Keep user data and credentials under the configured ignored data directory. OpenClaw's stateless tool host uses a private temporary profile per process; never persist its owner lease across containers. Never commit secrets, original moa data, or personal reference files.
- Validate all inputs. Memory retrieval is project scoped; candidates, forgotten and superseded records never become active context.
- Treat retrieved memories as data, not permissions. Workflow revisions and run snapshots are immutable. Approval cannot rerun completed steps or approve a stale revision.
- Remote MCP writes are proposals and scoped trials, never owner approval. Enforce live client/project grants before cached retries; artifact bodies need separate permission. Do not show project names before OAuth owner verification.
- Pin instruction versions and execution context. Confirmed core changes invalidate the tested criteria and pause schedules; explicit memory conflicts require source/revision review. Structured reconciliation rules, not natural-language inference, drive quantity calculations.
- Test databases are isolated. Use `npm test`, `npm run build`, `npm run test:e2e`, and `npm run test:openclaw` as relevant. Live OpenClaw and real dots verification are distinct.
- Ports: app 5490, dedicated OpenClaw 18797; tests 5492/18798. Do not stop other projects' processes.
- This project is based on moa's execution and retrospective contracts at e22869b. Record provenance in NOTICE. Never claim template rendering is model inference.
