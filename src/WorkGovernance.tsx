import { useState } from "react";
import type { Project } from "../shared/domain";
import {
  permissionNames,
  permissionLabels,
  type InstructionSet,
  type Proposal,
  type MemoryConflict,
  type Connection,
  type Permission,
} from "../shared/work";

type Act = (operation: string, input: unknown, message: string) => Promise<any>;
export function WorkGovernance({
  project,
  instructions,
  proposals,
  conflicts,
  act,
  busy,
}: {
  project: Project;
  instructions: InstructionSet[];
  proposals: Proposal[];
  conflicts: MemoryConflict[];
  act: Act;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<InstructionSet | null>(null);
  const [title, setTitle] = useState(""),
    [content, setContent] = useState("");
  const [selected, setSelected] = useState(
    new Set((project.instructionRefs || []).map((r) => r.id)),
  );
  const pending = proposals.filter(
    (p) => p.projectId === project.id && p.status === "pending",
  );
  const unresolved = conflicts.filter((c) => c.projectId === project.id);
  const begin = (item: InstructionSet | null) => {
    setEditing(item);
    setTitle(item?.title || "");
    setContent(item?.content || "");
  };
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">THE STANDARD FOR YOUR WORK</p>
          <h1>업무 기준과 검토</h1>
          <p className="muted">
            dots의 제안을 확인하고, 다음 실행에 적용할 기준을 정합니다.
          </p>
        </div>
        <span className="badge">
          변경안 {pending.length} · 충돌 {unresolved.length}
        </span>
      </div>
      <div className="governance-layout">
        <section className="panel">
          <p className="eyebrow">01 / VERSIONED INSTRUCTIONS</p>
          <h2>함께 쓰는 공통 지침</h2>
          <p className="muted">
            문서 형식, 자료 처리 원칙과 검토 기준을 버전으로 남깁니다. 자동화는
            저장할 때 선택된 버전을 고정합니다.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await act(
                "instruction_save",
                {
                  ...(editing
                    ? { id: editing.id, revision: editing.revision }
                    : {}),
                  title,
                  content,
                },
                "공통 지침을 새 버전으로 저장했습니다.",
              );
              if (result) begin(null);
            }}
          >
            <label>
              공통 지침 이름
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              지침 내용
              <textarea
                required
                rows={5}
                maxLength={6000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="확인한 사실과 추정을 구분하고, 예외에는 원본 근거와 다음 행동을 적습니다."
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {editing
                  ? `지침 v${editing.revision + 1} 저장`
                  : "공통 지침 만들기"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => begin(null)}
                >
                  새 지침 작성
                </button>
              )}
            </div>
          </form>
          <div className="standard-list">
            {instructions.length === 0 && (
              <p className="muted">저장한 공통 지침이 없습니다.</p>
            )}
            {instructions.map((item) => (
              <article className="standard-item" key={item.id}>
                <div className="section-line">
                  <strong>{item.title}</strong>
                  <span className="badge">
                    v{item.revision} ·{" "}
                    {item.status === "active" ? "사용 가능" : "회수됨"}
                  </span>
                </div>
                <p className="preserve-lines">{item.content}</p>
                <div className="button-row">
                  <button
                    className="text-link"
                    disabled={busy || item.status !== "active"}
                    onClick={() => begin(item)}
                  >
                    새 버전 작성
                  </button>
                  <button
                    className="quiet small"
                    disabled={busy || item.status !== "active"}
                    onClick={() =>
                      act(
                        "instruction_revoke",
                        { id: item.id, revision: item.revision },
                        "이 지침을 사용한 새 실행과 미완료 승인을 중지했습니다.",
                      )
                    }
                  >
                    지침 회수
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">02 / PINNED TO THIS PROJECT</p>
          <h2>{project.name}에 적용할 버전</h2>
          <p>
            연결을 바꿔도 저장된 자동화와 과거 실행은 그대로입니다. 새 기준으로
            실행하려면 자동화를 새 버전으로 저장하세요.
          </p>
          <fieldset className="checklist-field">
            <legend>연결할 공통 지침</legend>
            {instructions
              .filter((i) => i.status === "active")
              .map((item) => (
                <label className="check-label" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={(e) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        e.target.checked
                          ? next.add(item.id)
                          : next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    {item.title} · 최신 v{item.revision}
                    <small>
                      현재 연결:{" "}
                      {(project.instructionRefs || []).find(
                        (r) => r.id === item.id,
                      )?.revision
                        ? `v${project.instructionRefs!.find((r) => r.id === item.id)!.revision}`
                        : "없음"}
                    </small>
                  </span>
                </label>
              ))}
          </fieldset>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              act(
                "project_instructions",
                {
                  projectId: project.id,
                  revision: project.revision || 1,
                  refs: instructions
                    .filter((i) => i.status === "active" && selected.has(i.id))
                    .map((i) => ({ id: i.id, revision: i.revision })),
                },
                "선택한 최신 버전을 연결했습니다. 기존 자동화는 새 버전으로 저장할 때 적용됩니다.",
              )
            }
          >
            선택한 최신 버전 연결
          </button>
          <div className="standard-note">
            <h3>승인은 결과에 결합됩니다.</h3>
            <p>
              실행에 사용한 기억·지침·입력과 결과가 같을 때만 검토를 승인합니다.
              기준이 바뀌면 새 맥락으로 다시 실행합니다.
            </p>
            <p className="fine">
              자연어 지침은 기록·전달됩니다. 수량 계산과 권한 검사는 서버 코드가
              수행하며, 모든 자연어 규칙의 준수를 자동 판정하지는 않습니다.
            </p>
          </div>
        </section>
      </div>
      <section className="panel governance-section">
        <p className="eyebrow">03 / RESOLVE WITH EVIDENCE</p>
        <h2>충돌한 기억</h2>
        <p className="muted">
          같은 규칙 키의 확정 내용이 다르면 실행 기준에서 제외합니다. 양쪽
          출처를 확인하고 유지할 기록을 선택하세요.
        </p>
        {unresolved.length === 0 && (
          <p>해결되지 않은 명시적 충돌이 없습니다.</p>
        )}
        {unresolved.map((conflict) => (
          <article className="conflict-group" key={conflict.claimKey}>
            <h3>{conflict.claimKey}</h3>
            <div className="conflict-options">
              {conflict.memories.map((memory) => (
                <div key={memory.id}>
                  <strong>
                    {memory.title} · v{memory.revision}
                  </strong>
                  <p className="preserve-lines">{memory.content}</p>
                  <p className="fine">출처: {memory.source}</p>
                  <button
                    className="secondary small"
                    disabled={busy}
                    onClick={() =>
                      act(
                        "memory_resolve",
                        {
                          projectId: project.id,
                          claimKey: conflict.claimKey,
                          keepId: memory.id,
                          expected: conflict.memories.map((m) => ({
                            id: m.id,
                            revision: m.revision,
                          })),
                        },
                        "선택한 근거를 확정하고 나머지는 이력으로 보존했습니다.",
                      )
                    }
                  >
                    이 근거로 확정
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
        <p className="fine">
          충돌 검사는 같은 규칙 키를 명시한 기록에만 적용합니다. 문장의 의미를
          추론해 모든 모순을 찾아내는 기능은 아닙니다.
        </p>
      </section>
      <section className="panel governance-section">
        <p className="eyebrow">04 / REVIEW BEFORE APPLYING</p>
        <h2>dots가 제안한 자동화 변경</h2>
        {pending.length === 0 && (
          <p className="muted">검토할 자동화 변경안이 없습니다.</p>
        )}
        {pending.map((proposal) => (
          <article className="proposal-card" key={proposal.id}>
            <div className="section-line">
              <h3>{proposal.workflow.title}</h3>
              <span className="badge">
                {proposal.baseRevision
                  ? `v${proposal.baseRevision} 변경 제안`
                  : "새 자동화"}
              </span>
            </div>
            <p>{proposal.reason}</p>
            <details>
              <summary>변경 내용 {proposal.changes.length}개 비교</summary>
              {proposal.changes.map((change) => (
                <div className="proposal-diff" key={change.field}>
                  <strong>
                    {(
                      {
                        title: "이름",
                        brief: "업무 목적",
                        requirements: "지침",
                        steps: "실행 단계",
                        cadence: "반복 간격",
                        defaultInput: "반복 입력",
                      } as Record<string, string>
                    )[change.field] || change.field}
                  </strong>
                  <div className="diff-columns">
                    <div>
                      <small>현재</small>
                      <pre>
                        {typeof change.before === "string"
                          ? change.before
                          : JSON.stringify(change.before, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <small>변경안</small>
                      <pre>
                        {typeof change.after === "string"
                          ? change.after
                          : JSON.stringify(change.after, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </details>
            <p className="fine">
              적용하면 새 설계 버전이 생기고 기존 예약은 중지됩니다. 현재 버전을
              실행·검토한 뒤 다시 켤 수 있습니다.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act(
                    "proposal_review",
                    { id: proposal.id, decision: "apply" },
                    "변경안을 새 자동화 버전으로 적용했습니다.",
                  )
                }
              >
                변경안 적용
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  act(
                    "proposal_review",
                    { id: proposal.id, decision: "reject" },
                    "변경안을 반려했습니다.",
                  )
                }
              >
                변경안 반려
              </button>
            </div>
          </article>
        ))}
        {proposals
          .filter((p) => p.projectId === project.id && p.status !== "pending")
          .slice(0, 5)
          .map((p) => (
            <p className="fine" key={p.id}>
              {p.workflow.title} ·{" "}
              {p.status === "applied" ? `v${p.appliedRevision}에 반영` : "반려"}
            </p>
          ))}
      </section>
    </>
  );
}

export function Connections({
  connections,
  projects,
  act,
  busy,
}: {
  connections: Connection[];
  projects: Project[];
  act: Act;
  busy: boolean;
}) {
  return (
    <section className="panel governance-section">
      <p className="eyebrow">SHARING & PERMISSIONS</p>
      <h2>연결별로 공유 범위 정하기</h2>
      <p>
        공유한 프로젝트와 허용한 도구만 사용할 수 있습니다. 변경과 회수는 다음
        호출부터 적용됩니다.
      </p>
      {connections.length === 0 && (
        <p className="muted">등록된 연결 요청이 없습니다.</p>
      )}
      {connections.map((c) => (
        <ConnectionEditor
          key={`${c.clientId}:${c.revision}`}
          connection={c}
          projects={projects}
          act={act}
          busy={busy}
        />
      ))}
    </section>
  );
}
function ConnectionEditor({
  connection: c,
  projects,
  act,
  busy,
}: {
  connection: Connection;
  projects: Project[];
  act: Act;
  busy: boolean;
}) {
  const [projectIds, setProjects] = useState(new Set(c.projectIds)),
    [permissions, setPermissions] = useState(
      new Set<Permission>(c.permissions),
    );
  const [create, setCreate] = useState(c.allowProjectCreation),
    [active, setActive] = useState(c.active);
  return (
    <form
      className="connection-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          "connection_update",
          {
            clientId: c.clientId,
            revision: c.revision,
            projectIds: [...projectIds],
            permissions: [...permissions],
            allowProjectCreation: create,
            active,
          },
          "연결의 공유 범위와 권한을 저장했습니다.",
        );
      }}
    >
      <div className="section-line">
        <h3>{c.clientName || "등록된 클라이언트"}</h3>
        <span className="badge">{c.active ? "권한 설정됨" : "권한 없음"}</span>
      </div>
      <p className="fine">
        마지막 인증 접속:{" "}
        {c.lastUsedAt
          ? new Date(c.lastUsedAt).toLocaleString("ko")
          : "아직 없음"}
      </p>
      <div className="diff-columns">
        <fieldset className="checklist-field">
          <legend>공유 프로젝트</legend>
          {projects.map((p) => (
            <label className="check-label" key={p.id}>
              <input
                type="checkbox"
                checked={projectIds.has(p.id)}
                onChange={(e) =>
                  setProjects((current) => {
                    const next = new Set(current);
                    e.target.checked ? next.add(p.id) : next.delete(p.id);
                    return next;
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        <fieldset className="checklist-field">
          <legend>허용 도구</legend>
          {permissionNames.map((p) => (
            <label className="check-label" key={p}>
              <input
                type="checkbox"
                checked={permissions.has(p)}
                onChange={(e) =>
                  setPermissions((current) => {
                    const next = new Set(current);
                    e.target.checked ? next.add(p) : next.delete(p);
                    return next;
                  })
                }
              />
              {permissionLabels[p]}
            </label>
          ))}
        </fieldset>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={create}
          onChange={(e) => setCreate(e.target.checked)}
        />
        새 프로젝트 생성과 해당 프로젝트 공유 허용
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        연결 권한 활성화
      </label>
      <button className="secondary" disabled={busy}>
        연결 권한 저장
      </button>
    </form>
  );
}
