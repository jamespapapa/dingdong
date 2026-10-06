# dingdong.

**Persistent work memory and automation tools for GPT dots.**

dots와 업무를 설정하고, 반복할 수 있는 절차로 만들고, 실제 실행에서 배운 것을 다음 작업에 남깁니다. 사용자가 소유하는 단일 워크스페이스를 위한 오픈소스 MVP입니다.

Owner instance: [Dingdong](https://dingdong-production-6648.up.railway.app) · MCP: `https://dingdong-production-6648.up.railway.app/mcp` (OAuth required).

## What works

- 프로젝트별 영속 기억: 출처, 확정/후보 상태, 유효 기간, 대체 이력, 잊기, JSON 내보내기.
- OpenClaw 기억 설계 벤치마크 반영: 장기 기준/작업 기록, 재생성 가능한 FTS5 인덱스, 한글 정규화, 관련 구간 검색, 중복 억제, 작업 기록의 시간 감쇠, 원문 근거 재조회.
- 공통 지침의 버전 고정, 명시적 규칙 키가 충돌한 기억의 근거 대조, 장기 기준 변경 시 반복 실행 중지.
- dots가 기억·설계를 제안하고 소유자가 변경 전후를 검토하는 자동화 빌더.
- 발주·입고 JSON의 수량 차이, 보류 제외, 미등록 발주를 계산하고 원본 행 위치를 남기는 결정적 대조 도구.
- 실행 전 업무 맥락 조회 → 같은 입력·버전·권한의 시험 실행 → 결과 본문 조회 → 소유자 검토. 입력과 결과의 SHA-256을 보존합니다.
- 수정 시 새 버전, 실행 시 불변 스냅샷, 검토 대상·만료 검사, 승인 후 완료 단계 건너뛰기, 요청 키로 중복 실행 방지.
- 완료한 실행의 피드백 → 개선 후보 → 검토 후 다음 설계 버전과 기억에 반영.
- 성공한 현재 버전의 24시간/7일 반복. 검토 대기 중에는 다음 실행을 만들지 않습니다.
- 소유자 관리 화면, OAuth + PKCE, 원격 Streamable HTTP MCP. 연결마다 프로젝트와 조회·제안·시험·결과 본문 권한을 선택하고 회수합니다.
- **실제 OpenClaw 2026.9.7**: 모든 관리 화면/MCP 업무 명령이 전용 Gateway의 `dingdong_tool`을 거칩니다. Gateway는 loopback에만 열고 외부에는 Dingdong MCP만 제공합니다.

GPT dots는 설계와 내용 작성을 담당합니다. 문서/체크리스트는 템플릿 렌더링이고, 발주·입고 대조는 명시한 규칙의 정수 계산입니다. 자연어 지침의 준수를 서버가 자동 판정하지는 않습니다. 별도 모델 호출, 임의 코드 실행, 외부 앱 게시 기능은 포함하지 않습니다. dots의 내부 메모리를 읽거나 수정하는 제품이 아닙니다.

설계의 차이와 실제 구현 계약: [업무 맥락과 검토 설계](docs/work-context-design.md).

## Architecture

```text
GPT dots ── OAuth + MCP ─┐
                        ├─ Dingdong API ── private OpenClaw Gateway
Owner UI ── session ────┘                         │ dingdong_tool
                        ┌────────────────────────┘
                        └─ authenticated internal callback
                                 │
                         Core + SQLite (persistent volume)
```

OpenClaw is the policy-controlled tool host. Dingdong owns domain validation and storage. A separate model/agent runtime is unnecessary because dots is already the planning agent; Pi is not an additional dependency in this MVP.

## Run locally

Requires Node **24.16+** (tested on 24.18.0 and 26.8.1) and OpenClaw **2026.9.7**.

```bash
git clone https://github.com/jamespapapa/dingdong.git
cd dingdong
npm ci
npm install -g openclaw@2026.9.7
npm run setup
npm run build
npm start
```

Open <http://127.0.0.1:5490>. Sign in using `DINGDONG_ADMIN_KEY` from the generated `.data/credentials.json`. This file is ignored by Git and created with owner-only permissions. Keep it private. The app starts an isolated, temporary OpenClaw profile on **18797**, without touching existing profiles, messaging channels, keys or ports. Business records and OAuth state remain in the persistent Dingdong database; the tool host's runtime lease is recreated each start.

`npm start` serves the last built UI. Run `npm run build` after UI edits. `DINGDONG_CORE_ONLY=1` bypasses OpenClaw **only for isolated tests** and is explicitly labeled in the UI.

## Connect your GPT dots

1. Deploy at a stable HTTPS origin with a persistent volume.
2. In ChatGPT **Plugins → Add custom MCP server**, enter `https://YOUR_HOST/mcp` and choose **OAuth**. Use dynamic client registration; no client secret is needed.
3. On the Dingdong consent screen, enter that instance's owner key. Select the projects and tool permissions to share. Enable project creation only if you want dots to set up new projects.
4. Install/enable the resulting personal plugin for your dots account.
5. Send this request to your dot, invoking the Dingdong plugin:

> Dingdong에서 공유된 프로젝트를 찾아 업무 맥락을 읽어줘. 발주·입고 대조 자동화를 제안하고 보류 주문은 제외한다는 기억 후보에 내 요청을 출처로 남겨줘. 내가 Dingdong에서 기준과 변경안을 확정하면, 합의한 입력으로 work_context_get을 조회하고 같은 입력과 contextId로 시험해줘. run_get과 권한이 있는 artifact_get으로 실제 차이와 근거를 확인한 뒤 검토 화면 링크를 알려줘. 새 대화에서도 Dingdong의 확인된 기준을 먼저 조회해줘.

For that scenario, share `context:read`, `memory:propose`, `workflow:propose`, `runs:trial`, and `artifacts:read` for the selected project. All are independent owner choices. Remote tools cannot confirm memories, apply designs, approve runs or activate schedules.

**Upgrading from 0.1:** refresh the plugin tool list and reconnect or configure its grant in the owner dashboard. Existing clients without an explicit project grant cannot use their old broad access. Business records and OAuth registrations are preserved; old tokens never automatically gain the new permissions.

Inspect the actual tool calls and the resulting dashboard records. Plugin creation, synthetic MCP tests and personal dots account verification are separate milestones. See [verification](docs/verification.md).

## Cloud deployment

The Dockerfile installs the pinned OpenClaw host and starts the service. Attach one persistent volume at `/data`. Use **one replica** with this SQLite MVP. Set:

| Variable                 | Value                                             |
| ------------------------ | ------------------------------------------------- |
| `PUBLIC_URL`             | Stable HTTPS origin, without trailing path        |
| `DINGDONG_DATA_DIR`      | `/data`                                           |
| `PORT`                   | `5490`                                            |
| `OPENCLAW_PORT`          | `18797` (private loopback)                        |
| `DINGDONG_ADMIN_KEY`     | Independent random secret, at least 32 characters |
| `DINGDONG_INTERNAL_KEY`  | Independent random secret, at least 32 characters |
| `OPENCLAW_GATEWAY_TOKEN` | Independent random secret, at least 32 characters |
| `NODE_ENV`               | `production`                                      |

Railway configuration is included. Use the platform's secret input for keys. Never commit a `.env` file or publish the OpenClaw port. The application only needs its own volume and internal runtime; it does not need access to unrelated user files or API keys.

SQLite WAL, OAuth registrations, rotating refresh tokens and the stable profile ID survive restarts on that volume. Keep a backup of the entire volume while the service is stopped, or use SQLite's online backup API. JSON export is a portable work-data export, not a credentials backup. Schedules use persisted next-run timestamps and idempotent slots; after downtime at most one overdue run is created per active workflow.

## Tools

The 14 remote tools are `get_profile`, `project_create`, `project_list`, `context_get`, `work_context_get`, `memory_write`, `memory_search`, `memory_get`, `workflow_propose`, `workflow_list`, `run_start`, `run_get`, `artifact_get`, and `feedback_record`.

| Permission | Tools |
| --- | --- |
| `context:read` | Shared project list, contexts, memories, workflows and run summaries |
| `memory:propose` | Memory candidates and feedback |
| `workflow:propose` | New or revised design proposals |
| `runs:trial` | Trial of a saved revision with a fresh context receipt |
| `artifacts:read` | Bounded result body readback with content hash |
| Separate opt-in | Create a project, then share only that new project with the creating client |

Mutating calls require `idempotencyKey`. Reuse the same key and exact input after an uncertain response. Updates require the current revision. Confirmed memories are scoped to their project; candidate, forgotten, superseded and expired memories are excluded from normal context.

`work_context_get` returns pinned instruction versions, sourced memory, blockers, the input contract and a 15-minute context receipt. Pass the exact same input, workflow revision and `contextId` to `run_start`. The server checks current sharing and tool grants again, including before returning a cached retry. A receipt is not authorization. Run summaries omit original inputs and artifact bodies; `artifact_get` requires its own permission.

Memory facts are data, not permissions. A retrieved instruction cannot grant external authority. Owner review checks the live workflow revision, current criteria, exact results and a 24-hour review identifier. A stale review can be cancelled and rerun. Internal failures never become successful model prose.

Use `layer: core` for durable criteria and `layer: episode` for dated work observations. Use a stable `claimKey`, such as `order.exclude-held`, for the same business fact. Different confirmed values under that key are excluded from active context and block execution until the owner resolves the sources. This is explicit-key conflict detection, not semantic contradiction inference. Candidate replacements preserve the current fact until approval.

Search returns relevant excerpts with revisioned citations; use `memory_get` with the same revision and excerpt offsets to inspect the original source. Existing records default to core. The derived search index rebuilds without rewriting work records or OAuth state. See [OpenClaw memory benchmark and contracts](docs/openclaw-memory-benchmark.md).

## Checks

```bash
npm test                 # persistence, revisions, idempotency, OAuth, MCP, CSRF
npm run build            # TypeScript + UI production build
npm run test:e2e         # installed Chrome, desktop/mobile, isolated test data
npm run test:openclaw    # real isolated OpenClaw gateway + authenticated MCP chain
npm run benchmark:memory -- --openclaw # fixed synthetic corpus, actual OpenClaw FTS-only comparison
```

Tests use temporary databases, ports 5492/18798, and synthetic records. No test connects to `.data/dingdong.sqlite`. Screenshots and machine-readable proof are in `artifacts/`; logs and credentials are excluded.

## Scope and provenance

This is a personal, self-hosted MVP. Search uses deterministic SQLite FTS5, a Korean substring fallback, diversity reranking and dated-memory decay with bounded context; embeddings and automatic memory consolidation are not enabled. Feedback changes explicit instructions and memory; it does not train a model. No multi-user account isolation, general-purpose durable job engine, automatic unrestricted agent execution, or external business connectors are claimed.

MCP Events and autonomous dot notifications are not implemented. The pinned MCP SDK supports protocol `2025-11-25`; current OpenAI Events require MCP 2.0 `2026-07-28` and a separate webhook/subscription contract. Dingdong alone owns its 24-hour/7-day schedules. Personal dots authorization remains a separate verification milestone.

Adapted from [moa](https://github.com/jamespapapa/moa) at `e22869b`; original data and reference materials are excluded. OpenClaw and MCP SDK are separately licensed dependencies. See [NOTICE](NOTICE) and [MIT license](LICENSE).

References: [OpenClaw tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api), [ChatGPT MCP authentication](https://developers.openai.com/plugins/build/auth), [dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
