import { z } from "zod";
import { id, workflowInput, type Workflow, type Memory } from "./domain.ts";

export const permissionNames = [
  "context:read",
  "memory:propose",
  "workflow:propose",
  "runs:trial",
  "artifacts:read",
] as const;
export type Permission = (typeof permissionNames)[number];
export const permissionLabels: Record<Permission, string> = {
  "context:read": "업무 기준과 상태 읽기",
  "memory:propose": "기억 후보 제안",
  "workflow:propose": "자동화 변경 제안",
  "runs:trial": "저장된 버전 시험 실행",
  "artifacts:read": "결과 본문 읽기",
};
export type InstructionRef = { id: string; revision: number };
export type InstructionSet = InstructionRef & {
  title: string;
  content: string;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  actor: string;
};
export type Connection = {
  clientId: string;
  revision: number;
  projectIds: string[];
  permissions: Permission[];
  allowProjectCreation: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  clientName?: string;
};
export type MemoryConflict = {
  projectId: string;
  claimKey: string;
  memories: Memory[];
};
export type Proposal = {
  id: string;
  projectId: string;
  kind: "workflow";
  reason: string;
  workflow: z.infer<typeof workflowInput>;
  workflowId?: string;
  baseRevision?: number;
  before: Workflow | null;
  changes: { field: string; before: unknown; after: unknown }[];
  status: "pending" | "applied" | "rejected";
  actor: string;
  createdAt: string;
  appliedWorkflowId?: string;
  appliedRevision?: number;
};
export type WorkContext = {
  id: string;
  projectId: string;
  projectRevision: number;
  workflowId?: string;
  workflowRevision?: number;
  createdAt: string;
  expiresAt: string;
  actor: string;
  connectionRevision?: number;
  stateHash: string;
  inputHash: string;
  inputContract: { format: "text" | "json"; description: string };
  purpose: string;
  requirements: string;
  memories: {
    id: string;
    revision: number;
    title: string;
    content: string;
    source: string;
    citation?: string;
  }[];
  instructions: InstructionSet[];
  blockers: string[];
  ready: boolean;
  pendingQuestions: string[];
  nextActions: string[];
  allowedActions: string[];
  steps: { id: string; kind: string; title: string; executor: "dingdong" }[];
  completionCriteria: string[];
  links: { project: string; workflow?: string };
};

const revision = z.number().int().positive();
export const instructionRefInput = z.object({ id, revision }).strict();
export const workOperations = {
  instruction_save: z
    .object({
      id: id.optional(),
      revision: revision.optional(),
      title: z.string().trim().min(1).max(160),
      content: z.string().trim().min(1).max(6000),
    })
    .strict(),
  instruction_revoke: z.object({ id, revision }).strict(),
  project_instructions: z
    .object({
      projectId: id,
      revision,
      refs: z.array(instructionRefInput).max(6),
    })
    .strict(),
  work_context_get: z
    .object({
      projectId: id,
      workflowId: id.optional(),
      query: z.string().max(2000).default(""),
      input: z.string().max(20000).default(""),
    })
    .strict(),
  workflow_propose: z
    .object({
      id: id.optional(),
      revision: revision.optional(),
      reason: z.string().trim().min(1).max(2000),
      workflow: workflowInput,
    })
    .strict(),
  proposal_review: z
    .object({ id, decision: z.enum(["apply", "reject"]) })
    .strict(),
  memory_resolve: z
    .object({
      projectId: id,
      claimKey: z.string().trim().min(1).max(120),
      keepId: id,
      expected: z.array(instructionRefInput).min(2).max(30),
    })
    .strict(),
  artifact_get: z
    .object({
      runId: id,
      artifactId: id,
      start: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(12000).default(4000),
    })
    .strict(),
  connection_update: z
    .object({
      clientId: id,
      revision: z.number().int().min(0),
      projectIds: z.array(id).max(100),
      permissions: z.array(z.enum(permissionNames)).max(5),
      allowProjectCreation: z.boolean(),
      active: z.boolean(),
    })
    .strict(),
} as const;
