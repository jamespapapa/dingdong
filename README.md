# dingdong.

**Persistent work memory and automation tools for GPT dots.**

dots와 업무를 설정하고, 반복할 수 있는 절차로 만들고, 실제 실행에서 배운 것을 다음 작업에 남깁니다. 사용자가 소유하는 단일 워크스페이스를 위한 오픈소스 MVP입니다.

Owner instance: [Dingdong](https://dingdong-production-6648.up.railway.app) · MCP: `https://dingdong-production-6648.up.railway.app/mcp` (OAuth required).

## What works

- 프로젝트별 영속 기억: 출처, 확정/후보 상태, 유효 기간, 대체 이력, 잊기, JSON 내보내기.
- OpenClaw 기억 설계 벤치마크 반영: 장기 기준/작업 기록, 재생성 가능한 FTS5 인덱스, 한글 정규화, 관련 구간 검색, 중복 억제, 작업 기록의 시간 감쇠, 원문 근거 재조회.
- dots가 MCP 도구로 설계하는 자동화: 기억 조회 → 체크리스트/문서 → 검토 → 기억 후보 저장.
- 수정 시 새 버전, 실행 시 불변 스냅샷, 승인 후 완료 단계 건너뛰기, 요청 키로 중복 실행 방지.
- 완료한 실행의 피드백 → 개선 후보 → 검토 후 다음 설계 버전과 기억에 반영.
- 성공한 현재 버전의 24시간/7일 반복. 검토 대기 중에는 다음 실행을 만들지 않습니다.
- 소유자 관리 화면, OAuth 2.1 + PKCE, 원격 Streamable HTTP MCP.
- **실제 OpenClaw 2026.9.7**: 모든 관리 화면/MCP 업무 명령이 전용 Gateway의 `dingdong_tool`을 거칩니다. Gateway는 loopback에만 열고 외부에는 Dingdong MCP만 제공합니다.

GPT dots는 설계와 내용 작성을 담당합니다. 이 버전의 문서/체크리스트 실행은 입력과 기억을 지정한 틀에 채우는 결정적 코드입니다. 별도 모델 호출, 임의 코드 실행, 외부 앱 게시 기능은 포함하지 않습니다. dots의 내부 메모리를 읽거나 수정하는 제품이 아닙니다.

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

Requires Node **24.16+** (tested on 26.8.1) and OpenClaw **2026.9.7**.

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
3. On the Dingdong consent screen, enter that instance's owner key and authorize your workspace.
4. Install/enable the resulting personal plugin for your dots account.
5. Send this request to your dot, invoking the Dingdong plugin:

> Dingdong으로 내 주간 업무 보고 프로젝트를 만들어줘. 보고서는 한국어로 작성하고 다음 행동을 명시한다는 기준을 사용자 요청 출처의 확정 기억으로 저장해줘. 기억 조회, 보고서 문서, 검토 단계의 자동화를 만들고 간단한 자료로 실행해줘. run_get으로 결과를 확인하고 검토 대기 상태에서 알려줘. 새 대화에서도 이 프로젝트의 context_get을 사용해줘.

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

`project_create`, `project_list`, `context_get`, `memory_write`, `memory_search`, `memory_get`, `memory_state`, `workflow_save`, `workflow_list`, `workflow_schedule`, `run_start`, `run_get`, `run_review`, `feedback_record`, `feedback_apply`, `get_profile`.

Mutating calls require `idempotencyKey`. Reuse the same key and exact input after an uncertain response. Updates require the current revision. Confirmed memories are scoped to their project; candidate, forgotten, superseded and expired memories are excluded from normal context.

Memory facts are data, not permissions. A retrieved instruction cannot grant external authority. Review approval follows the user's actual authorization and checks the live workflow revision. Internal failures never become successful model prose.

Use `layer: core` for durable criteria and `layer: episode` for dated work observations. Search returns relevant excerpts with revisioned citations; use `memory_get` with the same revision and excerpt offsets to inspect the original source. Existing records default to core. The derived search index rebuilds without rewriting work records or OAuth state. See [OpenClaw memory benchmark and contracts](docs/openclaw-memory-benchmark.md).

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

Adapted from [moa](https://github.com/jamespapapa/moa) at `e22869b`; original data and reference materials are excluded. OpenClaw and MCP SDK are separately licensed dependencies. See [NOTICE](NOTICE) and [MIT license](LICENSE).

References: [OpenClaw tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api), [ChatGPT MCP authentication](https://developers.openai.com/plugins/build/auth), [dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
