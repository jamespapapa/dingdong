import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  labels,
  type Memory,
  type Project,
  type Workflow,
  type Run,
  type Feedback,
  type Event,
  type Step,
} from "../shared/domain";
import "./style.css";
import { WorkGovernance, Connections } from "./WorkGovernance";
import type {
  InstructionSet,
  Proposal,
  MemoryConflict,
  Connection,
} from "../shared/work";
import { reconciliationExample } from "../shared/reconciliation";

type View =
  | "home"
  | "memories"
  | "governance"
  | "workflows"
  | "runs"
  | "connection";
const navigation = new URLSearchParams(window.location.search);
const initialView = [
  "home",
  "memories",
  "governance",
  "workflows",
  "runs",
  "connection",
].includes(navigation.get("view") || "")
  ? (navigation.get("view") as View)
  : "home";
type Snapshot = {
  projects: Project[];
  memories: Memory[];
  workflows: Workflow[];
  runs: Run[];
  feedback: Feedback[];
  events: Event[];
  instructions: InstructionSet[];
  proposals: Proposal[];
  conflicts: MemoryConflict[];
  connections: Connection[];
  runtime: {
    mode: string;
    ready: boolean;
    version: string;
    error: string | null;
  };
  base: string;
};
type Draft = Pick<
  Workflow,
  "title" | "brief" | "requirements" | "steps" | "cadence" | "defaultInput"
>;
const uid = () => crypto.randomUUID();
const date = (s: string) =>
  new Intl.DateTimeFormat("ko", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s));
async function request(path: string, body?: unknown) {
  const res = await fetch(path, {
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data.error || "연결을 확인해주세요."), {
      status: res.status,
    });
  return data;
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="quiet" aria-label="닫기" onClick={close}>
          닫기
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        ···
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [login, setLogin] = useState(false),
    [ownerKey, setOwnerKey] = useState("");
  const [view, setView] = useState<View>(initialView),
    [projectId, setProjectId] = useState(navigation.get("project") || ""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"project" | "memory" | "feedback" | null>(
      null,
    ),
    [projectName, setProjectName] = useState("");
  const [brief, setBrief] = useState(""),
    [query, setQuery] = useState(""),
    [memoryFilter, setMemoryFilter] = useState("active");
  const [memoryForm, setMemoryForm] = useState({
      title: "",
      content: "",
      source: "사용자 직접 입력",
      kind: "fact" as Memory["kind"],
      layer: "core" as "core" | "episode",
      claimKey: "",
    }),
    [replacement, setReplacement] = useState<Memory | null>(null);
  const [workflowId, setWorkflowId] = useState(
      navigation.get("workflow") || "",
    ),
    [draft, setDraft] = useState<Draft | null>(null),
    [draftRevision, setDraftRevision] = useState<number | undefined>(),
    [runInput, setRunInput] = useState(""),
    [runId, setRunId] = useState(navigation.get("run") || "");
  const [feedback, setFeedback] = useState({
    observation: "",
    change: "",
    verification: "",
  });
  const pendingRequests = useRef(new Map<string, string>());
  const reload = useCallback(async () => {
    try {
      const v = await request("/api/snapshot");
      setData(v);
      setLogin(false);
      setProjectId((p) =>
        v.projects.some((x: Project) => x.id === p)
          ? p
          : v.projects[0]?.id || "",
      );
    } catch (e: any) {
      if (e.status === 401) setLogin(true);
      else setError(e.message);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams({ view });
    if (projectId) params.set("project", projectId);
    if (view === "runs" && runId) params.set("run", runId);
    if (view === "workflows" && workflowId) params.set("workflow", workflowId);
    window.history.replaceState(null, "", `/?${params}`);
  }, [data, view, projectId, runId, workflowId]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function act(op: string, input: unknown, message = "저장했습니다.") {
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ op, input });
    if (!pendingRequests.current.has(signature))
      pendingRequests.current.set(signature, uid());
    try {
      const value = await request(`/api/tools/${op}`, {
        input,
        idempotencyKey: pendingRequests.current.get(signature),
      });
      pendingRequests.current.delete(signature);
      await reload();
      setNotice(message);
      return value;
    } catch (e: any) {
      setError(e.message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("복사했습니다.");
    } catch {
      setError("복사하지 못했습니다. 표시된 내용을 직접 선택해 복사해주세요.");
    }
  }
  const projects = data?.projects || [],
    project = projects.find((p) => p.id === projectId);
  const memories =
      data?.memories.filter((m) => m.projectId === projectId) || [],
    workflows = data?.workflows.filter((w) => w.projectId === projectId) || [],
    runs = data?.runs.filter((r) => r.projectId === projectId) || [];
  const activeMemories = memories.filter(
    (m) =>
      m.status === "confirmed" &&
      !data?.conflicts.some((c) => c.memories.some((x) => x.id === m.id)) &&
      (!m.validUntil || m.validUntil > new Date().toISOString()),
  );
  const candidates = memories.filter((m) => m.status === "candidate");
  const selectedWorkflow = workflows.find((w) => w.id === workflowId),
    selectedRun = runs.find((r) => r.id === runId) || runs[0];
  const isRuntimeReady =
    data?.runtime.ready || data?.runtime.mode === "core-only-test";
  useEffect(() => {
    if (view === "workflows" && selectedWorkflow && !draft)
      edit(selectedWorkflow);
  }, [view, selectedWorkflow, draft]);
  function edit(w: Workflow) {
    setWorkflowId(w.id);
    setDraftRevision(w.revision);
    setDraft({
      title: w.title,
      brief: w.brief,
      requirements: w.requirements,
      steps: w.steps.map((s) => ({ ...s })),
      cadence: w.cadence,
      defaultInput: w.defaultInput,
    });
    setRunInput(w.defaultInput);
    setView("workflows");
  }
  function createDraft() {
    setWorkflowId("");
    setDraftRevision(undefined);
    setDraft({
      title: brief.split("\n")[0]?.slice(0, 100) || "새 업무 세팅",
      brief: brief || "업무의 목적과 완료 기준을 입력해주세요.",
      requirements: "",
      cadence: "manual",
      defaultInput: "",
      steps: [
        { id: "recall", kind: "recall", title: "관련 기억 확인", content: "" },
        {
          id: "checklist",
          kind: "checklist",
          title: "업무 준비 목록",
          content:
            "필요한 원자료 확인\n기존 결정과 변경 사항 대조\n미확정 조건 확인\n산출물 검토",
        },
        {
          id: "document",
          kind: "document",
          title: "업무 브리프",
          content:
            "# 업무 자료\n\n{{input}}\n\n## 적용할 기준\n\n{{requirements}}\n\n## 확인된 기억\n\n{{context}}",
        },
        {
          id: "review",
          kind: "review",
          title: "결과 검토",
          content: "원자료와 결과를 대조하고 확인해주세요.",
        },
      ],
    });
    setView("workflows");
  }
  function createReconciliationDraft() {
    setWorkflowId("");
    setDraftRevision(undefined);
    setRunInput("");
    setDraft({
      title: "발주·입고 대조",
      brief:
        "지난번 확정한 기준과 현재 발주·입고 자료를 대조하고 차이와 예외를 검토한다.",
      requirements: "차이가 나는 행에는 원본 위치와 다음 확인 사항을 명시한다.",
      cadence: "manual",
      defaultInput: "",
      steps: [
        {
          id: "recall",
          kind: "recall",
          title: "확정 기준 확인",
          content: "발주 입고 보류",
        },
        {
          id: "compare",
          kind: "reconcile",
          title: "수량 대조",
          content: '{"excludeHeld":true,"toleranceUnits":0}',
        },
        {
          id: "review",
          kind: "review",
          title: "차이와 예외 검토",
          content: "원본 위치와 차이를 대조하고 확인한다.",
        },
      ],
    });
    setView("workflows");
  }
  function addMemory(m?: Memory) {
    setReplacement(m || null);
    setMemoryForm(
      m
        ? {
            title: m.title,
            content: m.content,
            source: m.source,
            kind: m.kind,
            layer: m.layer || "core",
            claimKey: m.claimKey || "",
          }
        : {
            title: "",
            content: "",
            source: "사용자 직접 입력",
            kind: "fact",
            layer: "core",
            claimKey: "",
          },
    );
    setModal("memory");
  }
  const connectionPrompt = `Dingdong 플러그인으로 업무를 설정해줘. 먼저 project_list로 공유된 프로젝트를 확인하고 ${project ? `프로젝트 ${project.name} (${project.id})의 context_get을 호출해줘.` : "허용된 프로젝트를 선택해줘."}\n${brief || "업무의 목적, 자료, 절차와 검토 기준을 정리하자."}\n기억은 출처와 규칙 키를 갖춘 후보로 제안하고, workflow_propose로 설계 변경안을 제출해줘. 소유자 검토 화면을 안내해줘. 적용된 자동화는 같은 입력으로 work_context_get을 조회한 뒤 contextId와 함께 시험 실행해줘. run_get으로 상태를 확인하고, 허용되면 artifact_get으로 근거를 읽어줘. 승인·예약·기억 확정은 소유자 화면에서 처리해.`;
  const messages = (
    <>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="오류 닫기">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </>
  );

  if (login)
    return (
      <main className="login-page">
        <div className="login-story">
          <span className="wordmark">
            dingdong<span>.</span>
          </span>
          <div>
            <p className="eyebrow">A PLACE FOR WORK TO REMEMBER</p>
            <h1>
              일이 끝나도,
              <br />
              경험은 남도록.
            </h1>
            <p>
              dots와 함께 만든 업무와 기억.
              <br />
              당신의 서버에 차곡차곡 쌓입니다.
            </p>
          </div>
          <span className="login-foot">
            OPEN SOURCE · PERSISTENT MEMORY · OPENCLAW
          </span>
        </div>
        <section className="login-panel">
          <Badge tone="green">개인 워크스페이스</Badge>
          <h2>내 작업실에 들어가기</h2>
          <p className="muted">
            설치할 때 만든 소유자 키로 연결하세요.
            <br />
            키는 이 Dingdong 서버에만 전달됩니다.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await request("/api/login", { key: ownerKey });
                setOwnerKey("");
                await reload();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              소유자 키
              <input
                type="password"
                autoComplete="current-password"
                value={ownerKey}
                onChange={(e) => setOwnerKey(e.target.value)}
                required
                placeholder="소유자 키를 입력하세요"
              />
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? "연결 중…" : "워크스페이스 열기 →"}
            </button>
          </form>
          <p className="fine">
            설치 경로의 <code>.data/credentials.json</code>에서
            <br />
            <code>DINGDONG_ADMIN_KEY</code>를 확인할 수 있습니다.
          </p>
          {messages}
        </section>
      </main>
    );
  if (!data)
    return (
      <main className="loading">
        <span className="wordmark">dingdong.</span>
        <p>워크스페이스를 불러오고 있습니다.</p>
        {messages}
      </main>
    );

  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        본문으로 이동
      </a>
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("home");
          }}
        >
          dingdong<span>.</span>
        </a>
        <div className="workspace-picker">
          <label htmlFor="project-picker">WORKSPACE</label>
          <select
            id="project-picker"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setDraft(null);
              setWorkflowId("");
              setRunId("");
            }}
          >
            {!projects.length && (
              <option value="">프로젝트를 만들어주세요</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="quiet small" onClick={() => setModal("project")}>
            + 새 프로젝트
          </button>
        </div>
        <nav aria-label="주 메뉴">
          {(
            [
              ["home", "워크스페이스", "01"],
              ["memories", "기억 보관함", "02"],
              ["governance", "업무 기준과 검토", "03"],
              ["workflows", "자동화 빌더", "04"],
              ["runs", "실행과 개선", "05"],
              ["connection", "dots 연결", "06"],
            ] as const
          ).map(([v, label, number]) => (
            <button
              key={v}
              aria-current={view === v ? "page" : undefined}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              <span>{number}</span>
              {label}
              {v === "memories" && candidates.length > 0 && (
                <b className="nav-count">{candidates.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-line">
            <i className={data.runtime.ready ? "live-dot" : "waiting-dot"} />
            <div>
              <strong>
                {data.runtime.mode === "core-only-test"
                  ? "격리 테스트 모드"
                  : "OpenClaw runtime"}
              </strong>
              <small>
                {data.runtime.ready
                  ? "연결됨 · 도구 실행 준비"
                  : "연결 확인 중"}
              </small>
            </div>
          </div>
          <button
            className="quiet small"
            onClick={async () => {
              await request("/api/logout", {});
              setData(null);
              setLogin(true);
            }}
          >
            로그아웃
          </button>
          <span className="fine">DINGDONG / 0.2.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>{project?.name || "나의 첫 워크스페이스"}</span>
          <div>
            <span className="privacy-note">내 서버에 남는 기억</span>
            <button
              className="quiet small"
              onClick={() => setView("connection")}
            >
              dots와 연결 ↗
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {messages}
          {view === "home" && (
            <>
              <div className="page-intro">
                <div>
                  <p className="eyebrow">YOUR WORK, WITH CONTINUITY</p>
                  <h1>
                    다음 일은,
                    <br className="mobile-break" /> 더 잘할 수 있도록.
                  </h1>
                  <p className="muted">
                    업무를 만들고, 결과를 확인하고, 배운 것을 기억합니다.
                  </p>
                </div>
                <div className="continuity" aria-hidden="true">
                  <span>기억</span>
                  <i>→</i>
                  <span>실행</span>
                  <i>→</i>
                  <span>개선</span>
                  <b>↺</b>
                </div>
              </div>
              <section className="composer">
                <div className="section-line">
                  <h2>무슨 일을 맡기고 싶으세요?</h2>
                  <Badge>WORK SETUP</Badge>
                </div>
                <label className="sr-only" htmlFor="brief">
                  설정할 업무
                </label>
                <textarea
                  id="brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="예: 매주 프로젝트 진행 상황을 정리하고, 지난주 피드백을 반영한 업무 브리프를 만들고 싶어."
                  rows={3}
                />
                <div className="composer-actions">
                  <span>초안을 만든 뒤 dots와 구체화하세요.</span>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => {
                        void copy(connectionPrompt);
                      }}
                    >
                      dots 요청 복사
                    </button>
                    <button
                      className="primary"
                      disabled={!projectId}
                      onClick={createDraft}
                    >
                      자동화 초안 만들기 ↗
                    </button>
                  </div>
                </div>
                {!projectId && (
                  <button
                    className="text-link"
                    onClick={() => setModal("project")}
                  >
                    먼저 프로젝트 만들기 →
                  </button>
                )}
              </section>
              <div className="stats">
                <div>
                  <span>사용할 수 있는 기억</span>
                  <strong>
                    {activeMemories.length}
                    <small>개</small>
                  </strong>
                  <button onClick={() => setView("memories")}>
                    기억 살펴보기 ↗
                  </button>
                </div>
                <div>
                  <span>만들어 둔 자동화</span>
                  <strong>
                    {workflows.length}
                    <small>개</small>
                  </strong>
                  <button onClick={() => setView("workflows")}>
                    작업 흐름 보기 ↗
                  </button>
                </div>
                <div>
                  <span>검토를 기다리는 일</span>
                  <strong>
                    {runs.filter((r) => r.status === "needs_review").length}
                    <small>건</small>
                  </strong>
                  <button onClick={() => setView("runs")}>
                    결과 확인하기 ↗
                  </button>
                </div>
              </div>
              <div className="home-grid">
                <section className="panel">
                  <div className="section-line">
                    <h2>최근 작업</h2>
                    <button
                      className="quiet small"
                      onClick={() => setView("runs")}
                    >
                      모두 보기 →
                    </button>
                  </div>
                  {runs.length ? (
                    runs.slice(0, 4).map((r) => (
                      <button
                        className="list-row"
                        key={r.id}
                        onClick={() => {
                          setRunId(r.id);
                          setView("runs");
                        }}
                      >
                        <div>
                          <strong>{r.snapshot.title}</strong>
                          <small>
                            v{r.revision} · {date(r.createdAt)}
                          </small>
                        </div>
                        <Badge
                          tone={r.status === "completed" ? "green" : "amber"}
                        >
                          {labels.run[r.status]}
                        </Badge>
                      </button>
                    ))
                  ) : (
                    <Empty title="첫 실행을 기다리고 있어요">
                      자동화 초안을 저장하고 실행하면 결과와 검토 기록이 여기에
                      남습니다.
                    </Empty>
                  )}
                </section>
                <section className="memory-note">
                  <p className="eyebrow">REMEMBER, THEN IMPROVE</p>
                  <h2>
                    {candidates.length
                      ? `${candidates.length}개의 배움이\n확인을 기다립니다.`
                      : "좋은 기준을\n기억해두세요."}
                  </h2>
                  <p>
                    내가 정한 원칙, 함께 내린 결정,
                    <br />
                    다음에는 바꾸고 싶은 점까지.
                  </p>
                  <button
                    className="secondary"
                    disabled={!projectId}
                    onClick={() => {
                      if (candidates.length) {
                        setMemoryFilter("candidate");
                        setView("memories");
                      } else addMemory();
                    }}
                  >
                    {candidates.length
                      ? "기억 후보 검토 →"
                      : "첫 기억 남기기 →"}
                  </button>
                </section>
              </div>
            </>
          )}
          {view === "memories" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">MEMORY, WITH A SOURCE</p>
                  <h1>기억 보관함</h1>
                  <p className="muted">
                    확정한 기억을 다음 업무에 전달합니다. 출처와 이력은 함께
                    남습니다.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={!projectId}
                  onClick={() => addMemory()}
                >
                  + 기억 남기기
                </button>
              </div>
              {data.conflicts.some((c) => c.projectId === projectId) && (
                <div className="message error" role="alert">
                  충돌한 확정 기억은 사용 중 목록과 실행 기준에서 제외했습니다.{" "}
                  <button
                    className="text-link"
                    onClick={() => setView("governance")}
                  >
                    근거를 비교하고 해결하기
                  </button>
                </div>
              )}
              <div className="filterbar">
                <div className="segmented" aria-label="기억 상태">
                  {[
                    ["active", "사용 중"],
                    ["candidate", "검토 후보"],
                    ["all", "전체 이력"],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      aria-pressed={v === memoryFilter}
                      onClick={() => setMemoryFilter(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  className="search"
                  aria-label="기억 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="기억에서 찾기…"
                />
              </div>
              <div className="memory-grid">
                {memories
                  .filter(
                    (m) =>
                      memoryFilter === "all" ||
                      (memoryFilter === "candidate"
                        ? m.status === "candidate"
                        : activeMemories.includes(m)),
                  )
                  .filter((m) =>
                    `${m.title} ${m.content} ${m.source}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((m) => (
                    <article className="memory-card" key={m.id}>
                      <div className="section-line">
                        <Badge>
                          {labels.memory[m.kind]} ·{" "}
                          {m.layer === "episode" ? "작업 기록" : "장기 기준"}
                        </Badge>
                        <span className="fine">
                          {m.status === "confirmed"
                            ? m.validUntil &&
                              m.validUntil < new Date().toISOString()
                              ? "기간 만료"
                              : "확정"
                            : {
                                candidate: "검토 후보",
                                forgotten: "잊은 기억",
                                superseded: "대체됨",
                              }[m.status]}{" "}
                          · v{m.revision}
                        </span>
                      </div>
                      <h2>{m.title}</h2>
                      <p className="memory-content">{m.content}</p>
                      <div className="memory-source">
                        <span>출처</span>
                        {m.source}
                      </div>
                      <div className="card-bottom">
                        <span className="fine">{date(m.createdAt)}</span>
                        <div>
                          {m.status === "candidate" && (
                            <button
                              className="text-link"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  "memory_state",
                                  {
                                    id: m.id,
                                    revision: m.revision,
                                    status: "confirmed",
                                  },
                                  "기억을 확정했습니다.",
                                )
                              }
                            >
                              확정
                            </button>
                          )}
                          {["candidate", "confirmed"].includes(m.status) && (
                            <>
                              <button
                                className="text-link"
                                onClick={() => addMemory(m)}
                              >
                                수정
                              </button>
                              <button
                                className="text-link muted"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    "memory_state",
                                    {
                                      id: m.id,
                                      revision: m.revision,
                                      status: "forgotten",
                                    },
                                    "앞으로의 기억 조회에서 제외했습니다.",
                                  )
                                }
                              >
                                잊기
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
              {!memories.length && (
                <Empty title="아직 남겨둔 기억이 없습니다">
                  직접 기억을 남기거나 dots에게 확인된 업무 기준을 저장해달라고
                  요청하세요.
                </Empty>
              )}
            </>
          )}
          {view === "governance" &&
            (project ? (
              <WorkGovernance
                key={project.id}
                project={project}
                instructions={data.instructions}
                proposals={data.proposals}
                conflicts={data.conflicts}
                act={act}
                busy={busy}
              />
            ) : (
              <Empty title="프로젝트를 먼저 만들어주세요">
                업무별 지침과 제안을 같은 곳에서 검토합니다.
              </Empty>
            ))}
          {view === "workflows" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">MAKE WORK REPEATABLE</p>
                  <h1>자동화 빌더</h1>
                  <p className="muted">
                    dots가 설계한 업무를 검토 가능한 단계로 만듭니다.
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={!projectId}
                    onClick={createReconciliationDraft}
                  >
                    발주·입고 대조 만들기
                  </button>
                  <button
                    className="primary"
                    disabled={!projectId}
                    onClick={createDraft}
                  >
                    + 새 자동화
                  </button>
                </div>
              </div>
              <div className={`builder-layout ${draft ? "has-editor" : ""}`}>
                <section className="workflow-list">
                  {workflows.map((w) => (
                    <button
                      key={w.id}
                      className={`workflow-tile ${workflowId === w.id ? "selected" : ""}`}
                      onClick={() => edit(w)}
                    >
                      <div className="section-line">
                        <Badge tone={w.active ? "green" : ""}>
                          {w.active ? "반복 운영" : "직접 실행"}
                        </Badge>
                        <span className="fine">v{w.revision}</span>
                      </div>
                      <h2>{w.title}</h2>
                      <p>{w.brief}</p>
                      <div className="mini-flow">
                        {w.steps.map((s, i) => (
                          <React.Fragment key={s.id}>
                            {i > 0 && <i>—</i>}
                            <span title={labels.step[s.kind]}>
                              {String(i + 1).padStart(2, "0")}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                      <small>
                        {w.steps.length}개 단계 · {date(w.updatedAt)}
                      </small>
                    </button>
                  ))}
                  {!workflows.length && !draft && (
                    <Empty title="반복할 일을 하나 만들어보세요">
                      기억 확인, 체크리스트, 문서, 검토 단계를 연결할 수
                      있습니다.
                    </Empty>
                  )}
                </section>
                {draft && (
                  <section className="editor panel">
                    <div className="section-line">
                      <h2>
                        {selectedWorkflow
                          ? `설계 편집 · v${draftRevision}`
                          : "새 자동화 초안"}
                      </h2>
                      <button
                        className="quiet"
                        onClick={() => {
                          setDraft(null);
                          setWorkflowId("");
                        }}
                      >
                        접기
                      </button>
                    </div>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const w = await act(
                          "workflow_save",
                          {
                            ...(selectedWorkflow
                              ? {
                                  id: selectedWorkflow.id,
                                  revision: draftRevision,
                                }
                              : {}),
                            workflow: { ...draft, projectId },
                          },
                          "설계를 새 버전으로 저장했습니다.",
                        );
                        if (w) edit(w);
                      }}
                    >
                      {selectedWorkflow &&
                        draftRevision !== selectedWorkflow.revision && (
                          <p className="message error" role="alert">
                            다른 곳에서 설계가 변경됐습니다. 목록에서 현재
                            버전을 다시 열어 비교해주세요.
                          </p>
                        )}
                      <p className="fine">
                        저장할 때 이 프로젝트에 연결한 공통 지침 버전을
                        고정합니다. 실행 중인 기준을 바꾸려면 새 버전으로
                        저장하세요.
                      </p>
                      <label>
                        업무 이름
                        <input
                          value={draft.title}
                          maxLength={160}
                          required
                          onChange={(e) =>
                            setDraft({ ...draft, title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        업무 목적
                        <textarea
                          rows={2}
                          value={draft.brief}
                          required
                          onChange={(e) =>
                            setDraft({ ...draft, brief: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        적용할 지침
                        <textarea
                          rows={3}
                          value={draft.requirements}
                          onChange={(e) =>
                            setDraft({ ...draft, requirements: e.target.value })
                          }
                          placeholder="검토 기준, 예외, 이전 피드백…"
                        />
                      </label>
                      <div className="flow-editor">
                        <p className="eyebrow">WORKFLOW / 실행 순서</p>
                        {draft.steps.map((s, i) => (
                          <div className="step-editor" key={s.id}>
                            <span className="step-number">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <div className="step-heading">
                                <select
                                  aria-label={`${i + 1}단계 종류`}
                                  value={s.kind}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      steps: draft.steps.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              kind: e.target
                                                .value as Step["kind"],
                                              content:
                                                e.target.value === "reconcile"
                                                  ? '{"excludeHeld":true,"toleranceUnits":0}'
                                                  : x.content,
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                >
                                  {Object.entries(labels.step).map(
                                    ([v, label]) => (
                                      <option key={v} value={v}>
                                        {label}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <button
                                  type="button"
                                  className="quiet small"
                                  aria-label={`${i + 1}단계 위로`}
                                  disabled={i === 0}
                                  onClick={() => {
                                    const steps = [...draft.steps];
                                    [steps[i - 1], steps[i]] = [
                                      steps[i],
                                      steps[i - 1],
                                    ];
                                    setDraft({ ...draft, steps });
                                  }}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="quiet small"
                                  aria-label={`${i + 1}단계 삭제`}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      steps: draft.steps.filter(
                                        (_, j) => j !== i,
                                      ),
                                    })
                                  }
                                >
                                  삭제
                                </button>
                              </div>
                              <input
                                aria-label={`${i + 1}단계 이름`}
                                value={s.title}
                                required
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    steps: draft.steps.map((x, j) =>
                                      j === i
                                        ? { ...x, title: e.target.value }
                                        : x,
                                    ),
                                  })
                                }
                              />
                              <textarea
                                aria-label={`${i + 1}단계 내용`}
                                rows={s.kind === "document" ? 5 : 2}
                                value={s.content}
                                placeholder={
                                  s.kind === "recall"
                                    ? "찾을 주제 (비워두면 실행 자료로 검색)"
                                    : s.kind === "reconcile"
                                      ? '{"excludeHeld":true,"toleranceUnits":0}'
                                      : "내용 또는 검토 기준"
                                }
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    steps: draft.steps.map((x, j) =>
                                      j === i
                                        ? { ...x, content: e.target.value }
                                        : x,
                                    ),
                                  })
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={draft.steps.length >= 12}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            steps: [
                              ...draft.steps,
                              {
                                id: uid(),
                                kind: "document",
                                title: "새 문서",
                                content: "{{input}}",
                              },
                            ],
                          })
                        }
                      >
                        + 단계 추가
                      </button>
                      <p className="fine">
                        문서에 {"{{input}}"} 자료, {"{{context}}"} 기억,{" "}
                        {"{{requirements}}"} 지침, {"{{previous}}"} 앞선 결과를
                        넣을 수 있습니다. 입력한 틀에 값을 채우며, 내용의 판단과
                        작성은 dots가 담당합니다.
                      </p>
                      <div className="form-grid">
                        <label>
                          반복 주기
                          <select
                            value={draft.cadence}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                cadence: e.target.value as Draft["cadence"],
                              })
                            }
                          >
                            <option value="manual">직접 실행</option>
                            <option value="daily">24시간마다</option>
                            <option value="weekly">7일마다</option>
                          </select>
                        </label>
                        <label>
                          반복할 때 사용할 자료
                          <input
                            value={draft.defaultInput}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                defaultInput: e.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                      <button
                        className="primary full"
                        disabled={busy || !isRuntimeReady}
                      >
                        설계 저장
                      </button>
                    </form>
                    {selectedWorkflow && (
                      <div className="run-box">
                        <h3>저장한 v{selectedWorkflow.revision} 실행</h3>
                        <label>
                          이번 실행 자료
                          <textarea
                            rows={3}
                            value={runInput}
                            onChange={(e) => setRunInput(e.target.value)}
                            placeholder="정리할 원자료를 입력하세요"
                          />
                        </label>
                        {selectedWorkflow.steps.some(
                          (s) => s.kind === "reconcile",
                        ) && (
                          <details className="input-example">
                            <summary>발주·입고 JSON 형식 보기</summary>
                            <p className="fine">
                              발주 행의 lineId는 고유해야 합니다. 같은 입고 행은
                              수량을 합산합니다. 보류 제외·허용 차이는 단계의
                              규칙 JSON으로 지정합니다.
                            </p>
                            <pre>{reconciliationExample}</pre>
                          </details>
                        )}
                        <div className="button-row">
                          <button
                            className="primary"
                            disabled={busy || !isRuntimeReady}
                            onClick={async () => {
                              const r = await act(
                                "run_start",
                                {
                                  workflowId: selectedWorkflow.id,
                                  revision: selectedWorkflow.revision,
                                  input: runInput,
                                },
                                "실행 결과를 준비했습니다.",
                              );
                              if (r) {
                                setRunId(r.id);
                                setView("runs");
                              }
                            }}
                          >
                            실행하기 →
                          </button>
                          {selectedWorkflow.cadence !== "manual" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  "workflow_schedule",
                                  {
                                    id: selectedWorkflow.id,
                                    revision: selectedWorkflow.revision,
                                    active: !selectedWorkflow.active,
                                  },
                                  selectedWorkflow.active
                                    ? "반복을 중지했습니다."
                                    : "반복 운영을 시작했습니다.",
                                )
                              }
                            >
                              {selectedWorkflow.active
                                ? "반복 중지"
                                : "반복 켜기"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
          {view === "runs" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">EVIDENCE BEFORE CONFIDENCE</p>
                  <h1>실행과 개선</h1>
                  <p className="muted">
                    실제 결과를 확인하고, 다음 실행에 적용할 배움을 남깁니다.
                  </p>
                </div>
              </div>
              {!runs.length ? (
                <Empty title="아직 실행 기록이 없습니다">
                  자동화를 실행하면 사용한 기억, 결과 파일, 검토 과정이 함께
                  기록됩니다.
                </Empty>
              ) : (
                <div className="runs-layout">
                  <section className="run-list">
                    {runs.map((r) => (
                      <button
                        className={`run-tile ${selectedRun?.id === r.id ? "selected" : ""}`}
                        key={r.id}
                        onClick={() => setRunId(r.id)}
                      >
                        <Badge
                          tone={r.status === "completed" ? "green" : "amber"}
                        >
                          {labels.run[r.status]}
                        </Badge>
                        <h3>{r.snapshot.title}</h3>
                        <small>
                          v{r.revision} · {date(r.createdAt)}
                        </small>
                      </button>
                    ))}
                  </section>
                  {selectedRun && (
                    <section className="panel run-detail">
                      <div className="section-line">
                        <h2>{selectedRun.snapshot.title}</h2>
                        <Badge
                          tone={
                            selectedRun.status === "completed"
                              ? "green"
                              : "amber"
                          }
                        >
                          {labels.run[selectedRun.status]}
                        </Badge>
                      </div>
                      <p className="fine">
                        설계 v{selectedRun.revision} · 기억{" "}
                        {selectedRun.context.length}개 · 결과물{" "}
                        {selectedRun.artifacts.length}개
                      </p>
                      {selectedRun.workContext && (
                        <details className="execution-evidence">
                          <summary>실행 기준과 입력 근거</summary>
                          <p className="fine">
                            맥락 ID: {selectedRun.workContext.id}
                            <br />
                            조회 시각: {date(selectedRun.workContext.createdAt)}
                            <br />
                            입력 SHA-256: {selectedRun.inputEvidence?.sha256}
                            <br />
                            입력 출처: {selectedRun.inputEvidence?.source}
                          </p>
                          {selectedRun.workContext.instructions.map((i) => (
                            <div key={i.id}>
                              <strong>
                                {i.title} · v{i.revision}
                              </strong>
                              <p className="preserve-lines">{i.content}</p>
                            </div>
                          ))}
                          {selectedRun.workContext.memories.map((m) => (
                            <p key={m.id}>
                              <strong>
                                {m.title} · v{m.revision}
                              </strong>
                              <br />
                              {m.content}
                              <br />
                              <small>출처: {m.source}</small>
                            </p>
                          ))}
                        </details>
                      )}
                      <ol className="run-steps">
                        {selectedRun.steps.map((s, i) => (
                          <li key={s.id}>
                            <span
                              className={s.status === "completed" ? "done" : ""}
                            >
                              {s.status === "completed" ? "✓" : i + 1}
                            </span>
                            <div>
                              <strong>
                                {selectedRun.snapshot.steps[i].title}
                              </strong>
                              <small>
                                {s.output ||
                                  (s.status === "needs_review"
                                    ? "검토를 기다리고 있습니다."
                                    : "앞선 단계 이후 실행")}
                              </small>
                            </div>
                          </li>
                        ))}
                      </ol>
                      {selectedRun.artifacts.map((a) => (
                        <article className="artifact" key={a.id}>
                          <div className="section-line">
                            <h3>{a.name}</h3>
                            <a
                              className="text-link"
                              href={`/api/runs/${selectedRun.id}/artifacts/${a.id}`}
                            >
                              다운로드 ↓
                            </a>
                          </div>
                          <pre>{a.content}</pre>
                          {a.sha256 && (
                            <p className="fine">결과 SHA-256: {a.sha256}</p>
                          )}
                        </article>
                      ))}
                      {selectedRun.status === "needs_review" && (
                        <div className="review-box">
                          <h3>결과가 업무 기준에 맞나요?</h3>
                          <p>
                            위 결과와 적용한 지침을 확인한 뒤 다음 단계를
                            진행하세요.
                          </p>
                          <div className="button-row">
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  "run_review",
                                  {
                                    id: selectedRun.id,
                                    decision: "approve",
                                    reviewId: selectedRun.review?.id,
                                  },
                                  "검토를 승인하고 다음 단계를 진행했습니다.",
                                )
                              }
                            >
                              검토 승인
                            </button>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  "run_review",
                                  { id: selectedRun.id, decision: "reject" },
                                  "반려했습니다.",
                                )
                              }
                            >
                              반려
                            </button>
                            <button
                              className="quiet"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  "run_review",
                                  { id: selectedRun.id, decision: "cancel" },
                                  "취소했습니다.",
                                )
                              }
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                      {!["running", "needs_review"].includes(
                        selectedRun.status,
                      ) && (
                        <div className="review-box">
                          <h3>다음에는 무엇을 바꾸면 좋을까요?</h3>
                          <p>
                            관찰한 문제와 개선 기준을 기록하고, 새 설계 버전에
                            적용합니다.
                          </p>
                          <button
                            className="secondary"
                            onClick={() => {
                              setFeedback({
                                observation: "",
                                change: "",
                                verification: "",
                              });
                              setModal("feedback");
                            }}
                          >
                            개선 기록 남기기 →
                          </button>
                        </div>
                      )}
                      {data.feedback
                        .filter((f) => f.runId === selectedRun.id)
                        .map((f) => (
                          <article className="feedback-card" key={f.id}>
                            <Badge tone={f.appliedRevision ? "green" : "amber"}>
                              {f.appliedRevision
                                ? `v${f.appliedRevision}에 반영`
                                : "개선 후보"}
                            </Badge>
                            <h3>{f.observation}</h3>
                            <p>{f.change}</p>
                            <p className="fine">검증 기준: {f.verification}</p>
                            {!f.appliedRevision && (
                              <button
                                className="text-link"
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    "feedback_apply",
                                    {
                                      id: f.id,
                                      revision: workflows.find(
                                        (w) => w.id === selectedRun.workflowId,
                                      )?.revision,
                                    },
                                    "새 설계 버전에 개선을 반영했습니다. 다시 시험해주세요.",
                                  )
                                }
                              >
                                검토하고 다음 버전에 반영 →
                              </button>
                            )}
                          </article>
                        ))}
                    </section>
                  )}
                </div>
              )}
            </>
          )}
          {view === "connection" && (
            <>
              <div className="page-title">
                <div>
                  <p className="eyebrow">ONE CONNECTION, LASTING CONTEXT</p>
                  <h1>dots의 기억을 연결하세요.</h1>
                  <p className="muted">
                    대화가 바뀌어도 업무 기준과 실행 경험을 이어갑니다.
                  </p>
                </div>
                <Badge tone="green">OAuth로 보호됨</Badge>
              </div>
              <div className="connection-grid">
                <section className="panel">
                  <h2>1. Dingdong 도구 연결</h2>
                  <p>
                    ChatGPT 플러그인에서 커스텀 MCP 서버를 추가하고 아래 주소를
                    입력하세요. 인증은 OAuth를 선택합니다.
                  </p>
                  <div className="copy-field">
                    <code>{data.base}/mcp</code>
                    <button
                      className="secondary small"
                      onClick={() => copy(`${data.base}/mcp`)}
                    >
                      복사
                    </button>
                  </div>
                  <a
                    className="text-link"
                    target="_blank"
                    rel="noreferrer"
                    href="https://chatgpt.com/plugins"
                  >
                    ChatGPT 플러그인 열기 ↗
                  </a>
                  <h2>2. 내 워크스페이스 허용</h2>
                  <p>
                    Dingdong 인증 화면에서 소유자 키로 연결을 허용합니다. 이후
                    dots가 기억과 업무 도구를 호출할 수 있습니다.
                  </p>
                  <h2>3. dots와 업무 시작</h2>
                  <pre className="prompt-preview">{connectionPrompt}</pre>
                  <button
                    className="primary"
                    onClick={() => copy(connectionPrompt)}
                  >
                    dots에게 보낼 요청 복사
                  </button>
                </section>
                <div>
                  <section className="status-card">
                    <p className="eyebrow">CONNECTION STATUS</p>
                    <div className="status-item">
                      <span>OpenClaw</span>
                      <Badge tone={data.runtime.ready ? "green" : "amber"}>
                        {data.runtime.ready
                          ? "실행 준비"
                          : data.runtime.mode === "core-only-test"
                            ? "격리 테스트"
                            : "연결 대기"}
                      </Badge>
                    </div>
                    <div className="status-item">
                      <span>영속 저장소</span>
                      <strong>SQLite · 볼륨 저장</strong>
                    </div>
                    <div className="status-item">
                      <span>최근 인증된 MCP 호출</span>
                      <strong>
                        {
                          data.events.filter((e) => e.type === "mcp_call")
                            .length
                        }
                        건
                      </strong>
                    </div>
                    <p className="fine">
                      호출 기록은 실제 원격 도구 사용 후 표시됩니다. 연결
                      설정만으로 dots 검증을 완료했다고 표시하지 않습니다.
                    </p>
                    {data.runtime.error && (
                      <p role="alert">{data.runtime.error}</p>
                    )}
                  </section>
                  <section className="panel export-card">
                    <h2>내 기억은 내 소유로.</h2>
                    <p>
                      프로젝트, 기억, 자동화, 실행 결과와 변경 이력을 JSON으로
                      내보낼 수 있습니다.
                    </p>
                    <a className="secondary" href="/api/export">
                      전체 기록 내보내기 ↓
                    </a>
                  </section>
                </div>
              </div>
              <Connections
                connections={data.connections}
                projects={projects}
                act={act}
                busy={busy}
              />
              <section className="panel activity">
                <h2>최근 연결 활동</h2>
                {data.events
                  .filter((e) => e.type === "mcp_call")
                  .slice(0, 8)
                  .map((e) => (
                    <div className="activity-row" key={e.id}>
                      <code>{e.entityId}</code>
                      <span>{e.detail}</span>
                      <small>{date(e.createdAt)}</small>
                    </div>
                  ))}
                {!data.events.some((e) => e.type === "mcp_call") && (
                  <p className="muted">아직 인증된 원격 호출이 없습니다.</p>
                )}
              </section>
            </>
          )}
        </main>
        <footer>
          BUILT FOR DOTS. OWNED BY YOU.
          <a
            href="https://github.com/jamespapapa/dingdong"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </footer>
      </div>
      {modal === "project" && (
        <Modal title="새 프로젝트" close={() => setModal(null)}>
          <p className="muted">기억과 업무는 프로젝트별로 보관됩니다.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const p = await act("project_create", { name: projectName });
              if (p) {
                setProjectId(p.id);
                setProjectName("");
                setModal(null);
                setDraft(null);
              }
            }}
          >
            <label>
              프로젝트 이름
              <input
                autoFocus
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                maxLength={120}
                required
                placeholder="예: 나의 업무 운영"
              />
            </label>
            <button className="primary full" disabled={busy || !isRuntimeReady}>
              프로젝트 만들기
            </button>
          </form>
        </Modal>
      )}
      {modal === "memory" && (
        <Modal
          title={replacement ? "기억 수정" : "기억 남기기"}
          close={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const m = await act(
                "memory_write",
                {
                  ...memoryForm,
                  claimKey: memoryForm.claimKey.trim() || undefined,
                  projectId,
                  status: "confirmed",
                  ...(replacement
                    ? {
                        replacesId: replacement.id,
                        expectedRevision: replacement.revision,
                      }
                    : {}),
                },
                "확인한 기억을 저장했습니다.",
              );
              if (m) setModal(null);
            }}
          >
            <label>
              기억 종류
              <select
                value={memoryForm.kind}
                onChange={(e) =>
                  setMemoryForm({
                    ...memoryForm,
                    kind: e.target.value as Memory["kind"],
                  })
                }
              >
                {Object.entries(labels.memory).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              기억의 역할
              <select
                value={memoryForm.layer}
                onChange={(e) =>
                  setMemoryForm({
                    ...memoryForm,
                    layer: e.target.value as "core" | "episode",
                  })
                }
              >
                <option value="core">장기 기준</option>
                <option value="episode">작업 기록</option>
              </select>
            </label>
            <p className="fine">
              장기 기준은 다음 작업에도 참고합니다. 작업 기록은 관련 업무를 찾을
              때 불러오며, 시간이 지나면 검색 우선순위가 낮아집니다.
            </p>
            <label>
              제목
              <input
                autoFocus
                value={memoryForm.title}
                onChange={(e) =>
                  setMemoryForm({ ...memoryForm, title: e.target.value })
                }
                maxLength={160}
                required
              />
            </label>
            <label>
              기억할 내용
              <textarea
                value={memoryForm.content}
                onChange={(e) =>
                  setMemoryForm({ ...memoryForm, content: e.target.value })
                }
                rows={5}
                maxLength={10000}
                required
              />
            </label>
            <label>
              출처 또는 확인 근거
              <input
                value={memoryForm.source}
                onChange={(e) =>
                  setMemoryForm({ ...memoryForm, source: e.target.value })
                }
                maxLength={1000}
                required
              />
            </label>
            <label>
              규칙 키 (선택)
              <input
                value={memoryForm.claimKey}
                onChange={(e) =>
                  setMemoryForm({ ...memoryForm, claimKey: e.target.value })
                }
                maxLength={120}
                placeholder="예: purchasing.hold_policy"
              />
            </label>
            <p className="fine">
              같은 규칙 키에 서로 다른 확정 내용이 있으면 충돌 검토를
              요청합니다.
            </p>
            <p className="fine">
              직접 확인한 기억으로 저장합니다.
              {replacement && " 이전 내용은 대체된 기억으로 보존됩니다."}
            </p>
            <button className="primary full" disabled={busy}>
              확정하고 저장
            </button>
          </form>
        </Modal>
      )}
      {modal === "feedback" && selectedRun && (
        <Modal title="실행에서 배운 점" close={() => setModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = await act(
                "feedback_record",
                { runId: selectedRun.id, ...feedback },
                "개선 후보를 기록했습니다.",
              );
              if (f) setModal(null);
            }}
          >
            <label>
              관찰한 문제
              <textarea
                autoFocus
                required
                rows={2}
                value={feedback.observation}
                onChange={(e) =>
                  setFeedback({ ...feedback, observation: e.target.value })
                }
              />
            </label>
            <label>
              다음에는 바꿀 점
              <textarea
                required
                rows={3}
                value={feedback.change}
                onChange={(e) =>
                  setFeedback({ ...feedback, change: e.target.value })
                }
              />
            </label>
            <label>
              개선 여부를 확인할 기준
              <textarea
                required
                rows={2}
                value={feedback.verification}
                onChange={(e) =>
                  setFeedback({ ...feedback, verification: e.target.value })
                }
              />
            </label>
            <button className="primary full" disabled={busy}>
              개선 후보로 저장
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
