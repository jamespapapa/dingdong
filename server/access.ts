import { Store } from "./store.ts";
import { AppError } from "./errors.ts";
import type { Connection, Permission } from "../shared/work.ts";
import type {
  Project,
  Workflow,
  Run,
  Memory,
  Feedback,
} from "../shared/domain.ts";

export const remotePermissions: Record<string, Permission> = {
  project_list: "context:read",
  context_get: "context:read",
  work_context_get: "context:read",
  memory_search: "context:read",
  memory_get: "context:read",
  workflow_list: "context:read",
  run_get: "context:read",
  memory_write: "memory:propose",
  workflow_propose: "workflow:propose",
  run_start: "runs:trial",
  feedback_record: "memory:propose",
  artifact_get: "artifacts:read",
};
export const remoteTool = (operation: string) =>
  operation === "project_create" || !!remotePermissions[operation];
export class Access {
  constructor(private store: Store) {}
  clientId(actor: string) {
    return actor.startsWith("mcp:") ? actor.slice(4) : null;
  }
  connection(actor: string): Connection | null {
    const clientId = this.clientId(actor);
    if (clientId === null) return null;
    const grant = this.store.get<Connection>("connections", clientId);
    if (!grant?.active)
      throw new AppError(
        403,
        "연결 권한이 없거나 회수됐습니다. 소유자 화면에서 연결 범위를 확인해주세요.",
      );
    return grant;
  }
  can(actor: string, permission: Permission, projectId?: string) {
    const grant = this.connection(actor);
    return (
      !grant ||
      (grant.permissions.includes(permission) &&
        (!projectId || grant.projectIds.includes(projectId)))
    );
  }
  projectId(operation: string, p: any): string | undefined {
    if (p.workflow?.projectId) return p.workflow.projectId;
    if (p.projectId) return p.projectId;
    if (operation === "run_start")
      return this.store.get<Workflow>("workflows", p.workflowId)?.projectId;
    if (
      ["run_get", "run_review", "artifact_get", "feedback_record"].includes(
        operation,
      )
    )
      return this.store.get<Run>("runs", p.runId || p.id)?.projectId;
    if (operation === "memory_state")
      return this.store.get<Memory>("memories", p.id)?.projectId;
    if (operation === "feedback_apply")
      return this.store.get<Feedback>("feedback", p.id)?.projectId;
    if (["workflow_save", "workflow_schedule"].includes(operation))
      return this.store.get<Workflow>("workflows", p.id)?.projectId;
    return undefined;
  }
  authorize(operation: string, p: any, actor: string) {
    const grant = this.connection(actor);
    if (!grant) return;
    if (operation === "project_create") {
      if (!grant.allowProjectCreation)
        throw new AppError(403, "새 프로젝트 생성 권한이 없습니다.");
      return;
    }
    const permission = remotePermissions[operation];
    if (!permission || !grant.permissions.includes(permission))
      throw new AppError(
        403,
        "이 작업은 연결 권한에 포함되지 않습니다. 승인과 운영 기준 변경은 소유자 화면에서 처리해주세요.",
      );
    const projectId = this.projectId(operation, p);
    if (
      operation !== "project_list" &&
      (!projectId || !grant.projectIds.includes(projectId))
    )
      throw new AppError(403, "공유된 프로젝트가 아닙니다.");
    if (operation === "memory_write" && p.status === "confirmed")
      throw new AppError(
        403,
        "원격 도구는 기억 후보만 제안할 수 있습니다. 확정은 소유자 화면에서 검토해주세요.",
      );
    if (operation === "run_start" && !p.contextId)
      throw new AppError(
        409,
        "먼저 같은 입력으로 work_context_get을 호출하고 contextId를 전달해주세요.",
      );
  }
  projects(actor: string, projects: Project[]) {
    const grant = this.connection(actor);
    return grant
      ? projects.filter((p) => grant.projectIds.includes(p.id))
      : projects;
  }
  grantCreatedProject(actor: string, projectId: string) {
    const grant = this.connection(actor);
    if (grant)
      this.store.put("connections", grant.clientId, {
        ...grant,
        projectIds: [...grant.projectIds, projectId],
        revision: grant.revision + 1,
        updatedAt: new Date().toISOString(),
      });
  }
  result(operation: string, value: any, actor: string): any {
    if (!this.clientId(actor)) return value;
    if (["run_get", "run_start"].includes(operation)) {
      const r = value as Run;
      return {
        id: r.id,
        projectId: r.projectId,
        workflowId: r.workflowId,
        revision: r.revision,
        status: r.status,
        executor: "dingdong",
        contextId: r.workContext?.id || null,
        steps: r.steps.map((s) => ({ id: s.id, status: s.status })),
        artifacts: r.artifacts.map((a) => ({
          id: a.id,
          name: a.name,
          characters: a.content.length,
          sha256: a.sha256,
        })),
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        reviewRequired: r.status === "needs_review",
        reviewPath: `/?project=${r.projectId}&view=runs&run=${r.id}`,
        message:
          r.status === "needs_review"
            ? "소유자 검토 화면에서 결과를 대조하고 승인해주세요."
            : "본문은 artifact_get으로 별도 조회합니다.",
      };
    }
    if (operation === "workflow_list")
      return {
        workflows: value.workflows.map((w: Workflow) => {
          const { defaultInput: _privateInput, ...visible } = w;
          return { ...visible, hasDefaultInput: !!w.defaultInput };
        }),
      };
    if (operation === "workflow_propose")
      return {
        ...value,
        before: value.before
          ? { ...value.before, defaultInput: undefined }
          : null,
        changes: value.changes.map((change: any) =>
          change.field === "defaultInput"
            ? { ...change, before: "기존 입력 본문은 공유되지 않습니다." }
            : change,
        ),
      };
    return value;
  }
  list() {
    return this.store
      .list<{ client_id: string; client_name: string }>("oauth_clients")
      .map((client) => ({
        clientId: client.client_id,
        clientName: client.client_name,
        revision: 0,
        projectIds: [],
        permissions: [],
        allowProjectCreation: false,
        active: false,
        ...this.store.get<Connection>("connections", client.client_id),
      }));
  }
}
