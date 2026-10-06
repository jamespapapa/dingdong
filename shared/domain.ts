import { z } from "zod";

export const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const memoryKinds = [
  "preference",
  "fact",
  "decision",
  "procedure",
  "lesson",
] as const;
export const memoryInput = z
  .object({
    projectId: id,
    kind: z.enum(memoryKinds),
    layer: z
      .enum(["core", "episode"])
      .optional()
      .describe(
        "core: durable principles; episode: a dated work observation. Old records default to core.",
      ),
    observedAt: z.string().datetime().optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(10000),
    source: z.string().trim().min(1).max(1000),
    status: z.enum(["candidate", "confirmed"]).default("candidate"),
    validUntil: z.string().datetime().nullable().default(null),
    replacesId: id.optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export type Memory = Omit<z.infer<typeof memoryInput>, "status"> & {
  id: string;
  revision: number;
  status: "candidate" | "confirmed" | "superseded" | "forgotten";
  createdAt: string;
  updatedAt: string;
  actor: string;
};
export const stepInput = z
  .object({
    id,
    kind: z.enum(["recall", "checklist", "document", "review", "remember"]),
    title: z.string().trim().min(1).max(120),
    content: z.string().max(14000).default(""),
  })
  .strict();
export const workflowInput = z
  .object({
    projectId: id,
    title: z.string().trim().min(1).max(160),
    brief: z.string().trim().min(1).max(10000),
    requirements: z.string().max(10000).default(""),
    steps: z.array(stepInput).min(2).max(12),
    cadence: z.enum(["manual", "daily", "weekly"]).default("manual"),
    defaultInput: z.string().max(20000).default(""),
  })
  .strict()
  .superRefine((w, ctx) => {
    if (new Set(w.steps.map((s) => s.id)).size !== w.steps.length)
      ctx.addIssue({
        code: "custom",
        message: "단계 ID가 중복됩니다.",
        path: ["steps"],
      });
    if (!w.steps.some((s) => s.kind === "document" || s.kind === "checklist"))
      ctx.addIssue({
        code: "custom",
        message: "문서 또는 체크리스트 단계를 추가해주세요.",
        path: ["steps"],
      });
    const review = w.steps.findIndex((s) => s.kind === "review");
    if (
      w.steps.some(
        (s, i) => s.kind === "remember" && (review === -1 || review > i),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "기억 저장 단계 앞에 검토가 필요합니다.",
        path: ["steps"],
      });
  });
export type Step = z.infer<typeof stepInput>;
export type Workflow = z.infer<typeof workflowInput> & {
  id: string;
  revision: number;
  active: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};
export type Run = {
  id: string;
  projectId: string;
  workflowId: string;
  revision: number;
  snapshot: Workflow;
  input: string;
  status:
    | "running"
    | "needs_review"
    | "completed"
    | "cancelled"
    | "failed"
    | "rejected";
  steps: {
    id: string;
    status: "pending" | "completed" | "needs_review";
    output: string;
  }[];
  context: {
    id: string;
    revision: number;
    title: string;
    content: string;
    source: string;
    citation?: string;
  }[];
  artifacts: { id: string; name: string; content: string; stepId: string }[];
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  actor: string;
};
export type Feedback = {
  id: string;
  runId: string;
  projectId: string;
  observation: string;
  change: string;
  verification: string;
  memoryId: string;
  appliedRevision: number | null;
  createdAt: string;
};
export type Event = {
  id: string;
  type: string;
  actor: string;
  entityId: string;
  detail: string;
  createdAt: string;
};
export const labels = {
  memory: {
    preference: "선호",
    fact: "사실",
    decision: "결정",
    procedure: "절차",
    lesson: "개선",
  },
  step: {
    recall: "기억 불러오기",
    checklist: "체크리스트",
    document: "문서 만들기",
    review: "사람의 검토",
    remember: "경험 저장",
  },
  run: {
    running: "실행 중",
    needs_review: "검토 대기",
    completed: "완료",
    cancelled: "취소",
    failed: "실패",
    rejected: "반려",
  },
};
