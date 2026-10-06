import { randomUUID } from "node:crypto";
import type { Core, Operation } from "./core.ts";
import { AppError } from "./errors.ts";
import { hash, textHash } from "./work-utils.ts";
import { memoryConflicts } from "./memory-conflicts.ts";
import { parseRules } from "./reconciliation.ts";
import { reconciliationContract } from "../shared/reconciliation.ts";
import { normalizeMemoryText } from "./memory-text.ts";
import type { Project, Workflow, Memory, Run } from "../shared/domain.ts";
import type {
  InstructionSet,
  InstructionRef,
  WorkContext,
  Proposal,
  Connection,
} from "../shared/work.ts";
import { remotePermissions } from "./access.ts";

export class Work {
  constructor(
    private core: Core,
    private base: string,
    private execute: (operation: Operation, input: any, actor: string) => any,
  ) {}
  get store() {
    return this.core.store;
  }
  criteriaHash(projectId: string) {
    return hash(
      this.store
        .list<Memory>("memories")
        .filter(
          (m) =>
            m.projectId === projectId &&
            (m.layer || "core") === "core" &&
            m.status === "confirmed" &&
            (!m.validUntil || Date.parse(m.validUntil) > Date.now()),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
  instructions(refs: InstructionRef[]) {
    return refs.map((ref) => {
      const current = this.core.require<InstructionSet>("instructions", ref.id);
      if (current.status === "revoked")
        throw new AppError(409, `회수된 공통 지침입니다: ${current.title}`);
      return current.revision === ref.revision
        ? current
        : this.core.require<InstructionSet>(
            "instruction_history",
            `${ref.id}:${ref.revision}`,
          );
    });
  }
  state(projectId: string, workflow?: Workflow) {
    const project = this.core.require<Project>("projects", projectId);
    const refs = workflow?.instructionRefs || project.instructionRefs || [];
    return hash({
      project,
      workflow: workflow
        ? {
            id: workflow.id,
            revision: workflow.revision,
            fields: this.core.workflowFields(workflow),
            instructionRefs: workflow.instructionRefs,
          }
        : null,
      instructions: refs.map((ref) => ({
        ref,
        currentStatus: this.store.get<InstructionSet>("instructions", ref.id)
          ?.status,
        pinned:
          this.store.get<InstructionSet>("instructions", ref.id)?.revision ===
          ref.revision
            ? this.store.get("instructions", ref.id)
            : this.store.get(
                "instruction_history",
                `${ref.id}:${ref.revision}`,
              ),
      })),
      memories: this.store
        .list<Memory>("memories")
        .filter(
          (m) =>
            m.projectId === projectId &&
            m.status === "confirmed" &&
            (!m.validUntil || Date.parse(m.validUntil) > Date.now()),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
  context(
    p: { projectId: string; workflowId?: string; query: string; input: string },
    actor: string,
  ): WorkContext {
    const project = this.core.require<Project>("projects", p.projectId);
    const workflow = p.workflowId
      ? this.core.require<Workflow>("workflows", p.workflowId)
      : undefined;
    if (workflow && workflow.projectId !== project.id)
      throw new AppError(404, "해당 프로젝트의 자동화가 아닙니다.");
    const recalled = this.core.context(project.id, p.query || p.input);
    const blockers = memoryConflicts(this.store, project.id).map(
      (c) => `확정 기억 충돌: ${c.claimKey}`,
    );
    if (
      workflow?.criteriaHash &&
      workflow.criteriaHash !== this.criteriaHash(project.id)
    )
      blockers.push(
        "확정된 장기 기준이 변경됐습니다. 자동화를 새 버전으로 저장하고 다시 시험해주세요.",
      );
    let instructions: InstructionSet[] = [];
    try {
      instructions = this.instructions(
        workflow?.instructionRefs || project.instructionRefs || [],
      );
    } catch (e) {
      blockers.push(e instanceof Error ? e.message : "지침을 확인해주세요.");
    }
    if (
      workflow &&
      this.store
        .list<Run>("runs")
        .some(
          (r) =>
            r.workflowId === workflow.id &&
            ["running", "needs_review"].includes(r.status),
        )
    )
      blockers.push("이 자동화의 진행 중인 실행 또는 검토가 남아 있습니다.");
    const createdAt = new Date().toISOString();
    const link = (view: string, extra = "") =>
      `${this.base}/?project=${project.id}&view=${view}${extra}`;
    const context: WorkContext = {
      id: randomUUID(),
      projectId: project.id,
      projectRevision: project.revision || 1,
      ...(workflow
        ? { workflowId: workflow.id, workflowRevision: workflow.revision }
        : {}),
      actor,
      connectionRevision: this.core.access.connection(actor)?.revision,
      createdAt,
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      stateHash: this.state(project.id, workflow),
      inputHash: textHash(p.input),
      inputContract: workflow?.steps.some((s) => s.kind === "reconcile")
        ? reconciliationContract
        : {
            format: "text",
            description:
              "Submit the exact text to process, up to 20,000 characters. This input is hashed and frozen with the execution.",
          },
      purpose: workflow?.brief || project.description || project.name,
      requirements: workflow?.requirements || "",
      memories: recalled.memories,
      instructions,
      blockers,
      ready: !!workflow && blockers.length === 0,
      pendingQuestions: [
        ...blockers,
        ...(recalled.pending
          ? [
              `기억 후보 ${recalled.pending}건은 아직 업무 기준으로 확정되지 않았습니다.`,
            ]
          : []),
        ...(!workflow ? ["실행할 자동화와 입력 자료를 정해주세요."] : []),
      ],
      nextActions: blockers.length
        ? ["소유자 화면에서 충돌·검토·회수된 지침을 해결한 뒤 다시 조회"]
        : workflow
          ? [
              "동일한 입력과 contextId로 시험 실행",
              "실제 실행 상태와 결과 근거 확인",
              "소유자 화면에서 검토",
            ]
          : [
              "workflow_propose로 설계 변경안 제출",
              "소유자 검토 후 저장된 버전 조회",
            ],
      allowedActions: Object.keys(remotePermissions).filter((op) =>
        this.core.access.can(actor, remotePermissions[op], project.id),
      ),
      steps: (workflow?.steps || []).map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        executor: "dingdong",
      })),
      completionCriteria: [
        "지원하는 모든 단계가 실제 완료됨",
        "결과 파일의 내용과 SHA-256 근거 확인",
        ...(workflow?.steps.some((s) => s.kind === "review")
          ? ["동일 실행·기준·결과에 대해 소유자가 검토 승인함"]
          : []),
      ],
      links: {
        project: link("governance"),
        ...(workflow
          ? { workflow: link("workflows", `&workflow=${workflow.id}`) }
          : {}),
      },
    };
    // Receipts are bounded caches; immutable copies remain attached to runs.
    for (const old of this.store.list<WorkContext>("work_contexts"))
      if (Date.parse(old.createdAt) < Date.now() - 7 * 86400000)
        this.store.remove("work_contexts", old.id);
    this.store.put("work_contexts", context.id, context);
    return context;
  }
  validateContext(
    context: WorkContext,
    workflow: Workflow,
    input: string,
    actor: string,
    start = true,
  ) {
    if (
      context.projectId !== workflow.projectId ||
      context.workflowId !== workflow.id ||
      context.workflowRevision !== workflow.revision ||
      context.inputHash !== textHash(input)
    )
      throw new AppError(
        409,
        "조회한 맥락과 실행할 버전 또는 입력이 다릅니다. 업무 맥락을 다시 조회해주세요.",
      );
    if (
      start &&
      (context.actor !== actor ||
        context.connectionRevision !==
          this.core.access.connection(actor)?.revision ||
        Date.parse(context.expiresAt) <= Date.now())
    )
      throw new AppError(
        409,
        "업무 맥락의 조회자·권한·유효시간을 다시 확인해주세요.",
      );
    if (
      !context.ready ||
      context.stateHash !== this.state(workflow.projectId, workflow)
    )
      throw new AppError(
        409,
        "기억·지침·설계 기준이 바뀌었거나 충돌이 있습니다. 새 맥락으로 다시 실행해주세요.",
      );
  }
  validateWorkflow(
    workflow: Workflow | { steps: { kind: string; content: string }[] },
  ) {
    for (const step of workflow.steps)
      if (step.kind === "reconcile") parseRules(step.content);
  }
  handle(operation: string, p: any, actor: string): any {
    switch (operation) {
      case "work_context_get":
        return this.context(p, actor);
      case "instruction_save": {
        const previous = p.id
          ? this.core.require<InstructionSet>("instructions", p.id)
          : undefined;
        if (previous) {
          this.core.revision(previous, p.revision);
          if (previous.status === "revoked")
            throw new AppError(409, "회수한 지침은 새 지침으로 작성해주세요.");
          this.store.put(
            "instruction_history",
            `${previous.id}:${previous.revision}`,
            previous,
          );
        }
        const item: InstructionSet = {
          id: previous?.id || randomUUID(),
          revision: (previous?.revision || 0) + 1,
          title: p.title,
          content: p.content,
          status: "active",
          actor,
          createdAt: previous?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.store.put("instructions", item.id, item);
        this.core.event(
          operation,
          item.id,
          actor,
          `${item.title} · v${item.revision}`,
        );
        return item;
      }
      case "instruction_revoke": {
        const previous = this.core.require<InstructionSet>(
          "instructions",
          p.id,
        );
        this.core.revision(previous, p.revision);
        this.store.put(
          "instruction_history",
          `${previous.id}:${previous.revision}`,
          previous,
        );
        const item = {
          ...previous,
          revision: previous.revision + 1,
          status: "revoked",
          updatedAt: new Date().toISOString(),
        };
        this.store.put("instructions", item.id, item);
        this.core.event(operation, item.id, actor, item.title);
        for (const project of this.store.list<Project>("projects"))
          this.core.pauseChangedSchedules(project.id, actor);
        return item;
      }
      case "project_instructions": {
        const project = this.core.require<Project>("projects", p.projectId);
        this.core.revision({ revision: project.revision || 1 }, p.revision);
        if (
          new Set(p.refs.map((r: InstructionRef) => r.id)).size !==
          p.refs.length
        )
          throw new AppError(400, "같은 지침을 중복 연결할 수 없습니다.");
        if (
          this.instructions(p.refs).reduce((n, r) => n + r.content.length, 0) >
          12000
        )
          throw new AppError(
            400,
            "공통 지침의 합계는 12,000자 이내로 정리해주세요.",
          );
        const item = {
          ...project,
          revision: (project.revision || 1) + 1,
          instructionRefs: p.refs,
        };
        this.store.put("projects", project.id, item);
        this.core.event(
          operation,
          project.id,
          actor,
          "공통 지침 버전 연결 변경 · 기존 자동화의 기준은 유지",
        );
        return item;
      }
      case "workflow_propose": {
        this.core.require("projects", p.workflow.projectId);
        this.validateWorkflow(p.workflow);
        const before = p.id
          ? this.core.require<Workflow>("workflows", p.id)
          : null;
        if (before) {
          this.core.revision(before, p.revision);
          if (before.projectId !== p.workflow.projectId)
            throw new AppError(400, "프로젝트를 옮길 수 없습니다.");
        }
        const fields = before ? this.core.workflowFields(before) : {};
        const proposal: Proposal = {
          id: randomUUID(),
          projectId: p.workflow.projectId,
          kind: "workflow",
          reason: p.reason,
          workflow: p.workflow,
          workflowId: before?.id,
          baseRevision: before?.revision,
          before,
          changes: Object.keys(p.workflow)
            .filter(
              (field) =>
                hash((fields as any)[field]) !== hash(p.workflow[field]),
            )
            .map((field) => ({
              field,
              before: (fields as any)[field] ?? null,
              after: p.workflow[field],
            })),
          status: "pending",
          actor,
          createdAt: new Date().toISOString(),
        };
        this.store.put("proposals", proposal.id, proposal);
        this.core.event(operation, proposal.id, actor, p.reason);
        return proposal;
      }
      case "proposal_review": {
        const proposal = this.core.require<Proposal>("proposals", p.id);
        if (proposal.status !== "pending")
          throw new AppError(409, "이미 처리한 변경안입니다.");
        if (p.decision === "reject") {
          const next = { ...proposal, status: "rejected" };
          this.store.put("proposals", proposal.id, next);
          this.core.event(operation, proposal.id, actor, "변경안 반려");
          return next;
        }
        const workflow = this.execute(
          "workflow_save",
          {
            id: proposal.workflowId,
            revision: proposal.baseRevision,
            workflow: proposal.workflow,
          },
          actor,
        );
        const next = {
          ...proposal,
          status: "applied",
          appliedWorkflowId: workflow.id,
          appliedRevision: workflow.revision,
        };
        this.store.put("proposals", proposal.id, next);
        this.core.event(
          operation,
          proposal.id,
          actor,
          `변경안 적용 · v${workflow.revision}`,
        );
        return next;
      }
      case "memory_resolve": {
        const conflict = memoryConflicts(this.store, p.projectId).find(
          (c) => c.claimKey === normalizeMemoryText(p.claimKey).trim(),
        );
        const versions = (items: { id: string; revision: number }[]) =>
          items
            .map((m) => ({ id: m.id, revision: m.revision }))
            .sort((a, b) => a.id.localeCompare(b.id));
        if (
          !conflict ||
          hash(versions(conflict.memories)) !== hash(versions(p.expected)) ||
          !conflict.memories.some((m) => m.id === p.keepId)
        )
          throw new AppError(
            409,
            "충돌한 기억의 목록 또는 버전이 바뀌었습니다. 다시 확인해주세요.",
          );
        for (const m of conflict.memories) {
          this.store.put("memory_history", `${m.id}:${m.revision}`, m);
          this.store.put("memories", m.id, {
            ...m,
            status: m.id === p.keepId ? "confirmed" : "forgotten",
            revision: m.revision + 1,
            updatedAt: new Date().toISOString(),
            ...(m.id === p.keepId
              ? { confirmedBy: actor, confirmedAt: new Date().toISOString() }
              : {}),
          });
        }
        this.core.event(
          operation,
          p.keepId,
          actor,
          `${conflict.claimKey}: 선택한 근거를 확정하고 나머지는 조회에서 제외`,
        );
        this.core.pauseChangedSchedules(p.projectId, actor);
        return this.store.get("memories", p.keepId);
      }
      case "artifact_get": {
        const run = this.core.require<Run>("runs", p.runId),
          artifact = run.artifacts.find((a) => a.id === p.artifactId);
        if (!artifact) throw new AppError(404, "결과 파일을 찾을 수 없습니다.");
        return {
          runId: run.id,
          id: artifact.id,
          name: artifact.name,
          sha256: artifact.sha256 || textHash(artifact.content),
          content: artifact.content.slice(p.start, p.start + p.length),
          excerpt: {
            start: Math.min(p.start, artifact.content.length),
            end: Math.min(p.start + p.length, artifact.content.length),
            totalCharacters: artifact.content.length,
          },
          executor: "dingdong",
        };
      }
      case "connection_update": {
        this.core.require("oauth_clients", p.clientId);
        const previous = this.store.get<Connection>("connections", p.clientId);
        this.core.revision({ revision: previous?.revision || 0 }, p.revision);
        for (const projectId of p.projectIds)
          this.core.require("projects", projectId);
        const next: Connection = {
          ...p,
          projectIds: [...new Set<string>(p.projectIds)],
          permissions: [
            ...new Set<Connection["permissions"][number]>(p.permissions),
          ],
          revision: (previous?.revision || 0) + 1,
          createdAt: previous?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastUsedAt: previous?.lastUsedAt,
        };
        this.store.put("connections", p.clientId, next);
        this.core.event(
          operation,
          p.clientId,
          actor,
          next.active ? "프로젝트 공유 범위·도구 권한 변경" : "연결 권한 회수",
        );
        return next;
      }
      default:
        throw new AppError(400, "지원하지 않는 업무 계약입니다.");
    }
  }
}
