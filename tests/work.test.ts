import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Core, type Operation } from "../server/core.ts";
import { Store } from "../server/store.ts";
import {
  permissionNames,
  type Connection,
  type WorkContext,
} from "../shared/work.ts";
import type { Run, Memory, Workflow } from "../shared/domain.ts";
import { reconcile } from "../server/reconciliation.ts";
import { reconciliationExample } from "../shared/reconciliation.ts";
import { textHash } from "../server/work-utils.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(path.join(tmpdir(), "dingdong-work-test-"));
  const store = new Store(path.join(directory, "db.sqlite")),
    core = new Core(store);
  let n = 0;
  const call = (
    operation: Operation,
    input: unknown,
    actor = "owner",
    key = `key-${++n}`,
  ) => core.dispatch(operation, input, actor, key);
  const project = call("project_create", { name: "Shared synthetic work" });
  store.put("oauth_clients", "client", {
    client_id: "client",
    client_name: "Synthetic dots",
  });
  const grant = (fields: Partial<Connection> = {}) =>
    call("connection_update", {
      clientId: "client",
      revision: store.get<Connection>("connections", "client")?.revision || 0,
      projectIds: [project.id],
      permissions: [...permissionNames],
      allowProjectCreation: false,
      active: true,
      ...fields,
    });
  grant();
  const memory = (fields: Record<string, unknown> = {}, actor = "owner") =>
    call(
      "memory_write",
      {
        projectId: project.id,
        title: "Sourced rule",
        content: "Include source evidence",
        source: "Synthetic owner instruction",
        kind: "decision",
        status: "confirmed",
        ...fields,
      },
      actor,
    ) as Memory;
  const workflow = (fields: Record<string, unknown> = {}) =>
    call("workflow_save", {
      workflow: {
        projectId: project.id,
        title: "Sourced work",
        brief: "Compare verified inputs",
        requirements: "Include evidence",
        cadence: "daily",
        defaultInput: "OWNER-ONLY-SOURCE",
        steps: [
          { id: "recall", kind: "recall", title: "Recall" },
          {
            id: "document",
            kind: "document",
            title: "Result",
            content: "{{input}}\n{{requirements}}\n{{context}}",
          },
          { id: "review", kind: "review", title: "Review" },
        ],
        ...fields,
      },
    }) as Workflow;
  const context = (w: Workflow, input = "source", actor = "owner") =>
    call(
      "work_context_get",
      { projectId: project.id, workflowId: w.id, input },
      actor,
    ) as WorkContext;
  const approve = (r: Run) =>
    call("run_review", {
      id: r.id,
      decision: "approve",
      reviewId: r.review?.id,
    }) as Run;
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    core,
    call,
    project,
    grant,
    memory,
    workflow,
    context,
    approve,
  };
}

test("instruction versions remain pinned until a new workflow revision, and past run evidence is immutable", (t) => {
  const f = fixture(t);
  const first = f.call("instruction_save", {
    title: "Report policy",
    content: "VERSION ONE: cite the source.",
  });
  f.call("project_instructions", {
    projectId: f.project.id,
    revision: 1,
    refs: [{ id: first.id, revision: 1 }],
  });
  const w = f.workflow(),
    context = f.context(w);
  f.call("instruction_save", {
    id: first.id,
    revision: 1,
    title: "Report policy",
    content: "VERSION TWO: name the reviewer.",
  });
  const r = f.call("run_start", {
    workflowId: w.id,
    revision: 1,
    contextId: context.id,
    input: "source",
  }) as Run;
  assert.match(r.artifacts[0].content, /VERSION ONE/);
  assert.doesNotMatch(r.artifacts[0].content, /VERSION TWO/);
  f.approve(r);
  f.call("project_instructions", {
    projectId: f.project.id,
    revision: 2,
    refs: [{ id: first.id, revision: 2 }],
  });
  assert.equal(
    f.store.get<Workflow>("workflows", w.id)!.instructionRefs![0].revision,
    1,
  );
  const next = f.call("workflow_save", {
    id: w.id,
    revision: 1,
    workflow: f.core.workflowFields(w),
  });
  assert.equal(next.instructionRefs[0].revision, 2);
  const old = f.call("run_get", { id: r.id });
  assert.equal(old.workContext.instructions[0].revision, 1);
  assert.equal(old.inputEvidence.sha256, textHash("source"));
  assert.equal(old.artifacts[0].sha256, textHash(old.artifacts[0].content));
});

test("conflicting confirmed claims block retrieval and execution until all source revisions are resolved", (t) => {
  const f = fixture(t);
  const first = f.memory({
    claimKey: "order.hold",
    content: "Exclude held orders",
  });
  const second = f.memory({
    claimKey: "order.hold",
    content: "Include held orders",
    source: "Conflicting owner instruction",
  });
  const w = f.workflow();
  assert.equal(f.core.context(f.project.id, "held").memories.length, 0);
  assert.equal(f.context(w).ready, false);
  assert.throws(
    () => f.call("run_start", { workflowId: w.id, revision: 1 }),
    /충돌/,
  );
  assert.equal(f.store.list("runs").length, 0);
  const expected = [first, second].map((m) => ({
    id: m.id,
    revision: m.revision,
  }));
  assert.throws(
    () =>
      f.call("memory_resolve", {
        projectId: f.project.id,
        claimKey: "order.hold",
        keepId: first.id,
        expected: [{ ...expected[0], revision: 2 }, expected[1]],
      }),
    /버전/,
  );
  f.call("memory_resolve", {
    projectId: f.project.id,
    claimKey: "order.hold",
    keepId: first.id,
    expected,
  });
  assert.equal(f.store.get<Memory>("memories", second.id)!.status, "forgotten");
  assert.equal(
    f.store.get<Memory>("memory_history", `${second.id}:1`)!.content,
    second.content,
  );
  assert.equal(f.core.context(f.project.id, "held").memories[0].id, first.id);
  assert.equal(
    f.context(w).ready,
    false,
    "changed criteria require a new workflow revision",
  );
  const next = f.call("workflow_save", {
    id: w.id,
    revision: 1,
    workflow: f.core.workflowFields(w),
  });
  assert.equal(f.context(next).ready, true);
});

test("remote replacement proposals preserve confirmed facts and competing approval loses the revision race", (t) => {
  const f = fixture(t),
    old = f.memory();
  const proposal = f.memory(
    {
      status: "candidate",
      content: "New verified rule",
      replacesId: old.id,
      expectedRevision: 1,
    },
    "mcp:client",
  );
  const competing = f.memory(
    {
      status: "candidate",
      content: "Different proposal",
      replacesId: old.id,
      expectedRevision: 1,
    },
    "mcp:client",
  );
  assert.equal(f.core.context(f.project.id, "").memories[0].id, old.id);
  assert.throws(() => f.memory({}, "mcp:client"), /후보/);
  assert.throws(
    () =>
      f.call(
        "memory_state",
        { id: proposal.id, revision: 1, status: "confirmed" },
        "mcp:client",
      ),
    /소유자/,
  );
  f.call("memory_state", { id: proposal.id, revision: 1, status: "confirmed" });
  assert.equal(f.core.context(f.project.id, "").memories[0].id, proposal.id);
  assert.throws(
    () =>
      f.call("memory_state", {
        id: competing.id,
        revision: 1,
        status: "confirmed",
      }),
    /버전/,
  );
  assert.equal(
    f.store.get<Memory>("memories", competing.id)!.status,
    "candidate",
  );
});

test("context receipts bind actor, input, permission revision, expiry and execution criteria", (t) => {
  const f = fixture(t),
    w = f.workflow();
  let context = f.context(w, "source", "mcp:client");
  const run = {
    workflowId: w.id,
    revision: 1,
    input: "source",
    contextId: context.id,
  };
  assert.throws(
    () => f.call("run_start", { ...run, input: "changed" }, "mcp:client"),
    /입력/,
  );
  assert.throws(() => f.call("run_start", run), /조회자/);
  f.store.put("work_contexts", context.id, {
    ...context,
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  assert.throws(() => f.call("run_start", run, "mcp:client"), /유효시간/);
  context = f.context(w, "source", "mcp:client");
  f.grant();
  assert.throws(
    () => f.call("run_start", { ...run, contextId: context.id }, "mcp:client"),
    /권한/,
  );
  context = f.context(w, "source", "mcp:client");
  f.memory({ content: "A newly confirmed criterion" });
  assert.throws(
    () => f.call("run_start", { ...run, contextId: context.id }, "mcp:client"),
    /기준/,
  );
  assert.equal(f.store.list("runs").length, 0);
});

test("run approvals bind the exact reviewed artifacts and cannot be performed by the remote agent", (t) => {
  const f = fixture(t),
    w = f.workflow();
  const r = f.call("run_start", {
    workflowId: w.id,
    revision: 1,
    input: "source",
  }) as Run;
  assert.throws(
    () => f.call("run_review", { id: r.id, decision: "approve" }),
    /검토 대상/,
  );
  assert.throws(
    () =>
      f.call(
        "run_review",
        { id: r.id, decision: "approve", reviewId: r.review!.id },
        "mcp:client",
      ),
    /소유자/,
  );
  f.store.put("runs", r.id, {
    ...r,
    artifacts: r.artifacts.map((a) => ({ ...a, content: "tampered result" })),
  });
  assert.throws(() => f.approve(r), /검토 대상/);
  f.store.put("runs", r.id, {
    ...r,
    review: { ...r.review!, expiresAt: "2000-01-01T00:00:00.000Z" },
  });
  assert.throws(() => f.approve(r), /유효시간/);
  f.store.put("runs", r.id, r);
  f.memory({ layer: "episode", content: "Changed work evidence" });
  assert.throws(() => f.approve(r), /기준/);
  assert.equal(
    f.call("run_review", { id: r.id, decision: "cancel" }).status,
    "cancelled",
  );
});

test("scoped access protects original inputs and artifact bodies, including cached retries after revocation", (t) => {
  const f = fixture(t),
    w = f.workflow();
  const other = f.call("project_create", { name: "Not shared" });
  const privateMemory = f.call("memory_write", {
    projectId: other.id,
    kind: "fact",
    title: "Private",
    content: "PRIVATE",
    source: "Fixture",
    status: "confirmed",
  });
  assert.deepEqual(
    f.call("project_list", {}, "mcp:client").projects.map((p: any) => p.id),
    [f.project.id],
  );
  assert.throws(
    () =>
      f.call(
        "memory_get",
        { projectId: other.id, id: privateMemory.id },
        "mcp:client",
      ),
    /공유/,
  );
  assert.throws(
    () =>
      f.call(
        "memory_get",
        { projectId: f.project.id, id: privateMemory.id },
        "mcp:client",
      ),
    /프로젝트/,
  );
  assert.ok(
    !JSON.stringify(
      f.call("workflow_list", { projectId: f.project.id }, "mcp:client"),
    ).includes("OWNER-ONLY-SOURCE"),
  );
  f.grant({ permissions: ["context:read", "runs:trial"] });
  const context = f.context(w, "BODY-SECRET", "mcp:client");
  const input = {
    workflowId: w.id,
    revision: 1,
    contextId: context.id,
    input: "BODY-SECRET",
  };
  const r = f.call("run_start", input, "mcp:client", "trial");
  assert.ok(!JSON.stringify(r).includes("BODY-SECRET"));
  assert.equal(r.status, "needs_review");
  assert.throws(
    () =>
      f.call(
        "artifact_get",
        { runId: r.id, artifactId: r.artifacts[0].id },
        "mcp:client",
      ),
    /권한/,
  );
  f.grant({ active: false });
  assert.throws(
    () => f.call("run_start", input, "mcp:client", "trial"),
    /회수/,
  );
  assert.equal(f.store.list("runs").length, 1);
  f.grant();
  const artifact = f.call(
    "artifact_get",
    { runId: r.id, artifactId: r.artifacts[0].id },
    "mcp:client",
  );
  assert.match(artifact.content, /BODY-SECRET/);
  assert.equal(artifact.sha256, textHash(artifact.content));
});

test("workflow proposals expose a diff but do not mutate operations; stale proposals cannot overwrite revisions", (t) => {
  const f = fixture(t),
    w = f.workflow();
  const payload = {
    ...f.core.workflowFields(w),
    title: "Proposed revision",
    defaultInput: "New client-supplied input",
  };
  const proposal = f.call(
    "workflow_propose",
    {
      id: w.id,
      revision: 1,
      reason: "Observed a missing criterion",
      workflow: payload,
    },
    "mcp:client",
  );
  assert.ok(!JSON.stringify(proposal).includes("OWNER-ONLY-SOURCE"));
  assert.equal(f.store.get<Workflow>("workflows", w.id)!.revision, 1);
  assert.ok(proposal.changes.some((c: any) => c.field === "title"));
  assert.throws(
    () =>
      f.call(
        "workflow_save",
        { id: w.id, revision: 1, workflow: payload },
        "mcp:client",
      ),
    /소유자/,
  );
  f.call("workflow_save", {
    id: w.id,
    revision: 1,
    workflow: { ...payload, title: "New owner revision" },
  });
  assert.throws(
    () => f.call("proposal_review", { id: proposal.id, decision: "apply" }),
    /버전/,
  );
  assert.equal(f.store.get<any>("proposals", proposal.id).status, "pending");
  const fresh = f.call(
    "workflow_propose",
    {
      id: w.id,
      revision: 2,
      reason: "Rebased on current owner revision",
      workflow: payload,
    },
    "mcp:client",
  );
  const applied = f.call("proposal_review", {
    id: fresh.id,
    decision: "apply",
  });
  assert.equal(applied.appliedRevision, 3);
  assert.equal(f.store.get<Workflow>("workflows", w.id)!.active, false);
});

test("criterion changes pause schedules and require a new tested revision; instruction revocation blocks approval", (t) => {
  const f = fixture(t),
    w = f.workflow();
  const r = f.call("run_start", { workflowId: w.id, revision: 1 });
  f.approve(r);
  f.call("workflow_schedule", { id: w.id, revision: 1, active: true });
  f.memory({ content: "New operational criterion" });
  assert.equal(f.store.get<Workflow>("workflows", w.id)!.active, false);
  assert.throws(
    () => f.call("workflow_schedule", { id: w.id, revision: 1, active: true }),
    /업무 기준/,
  );
  const instruction = f.call("instruction_save", {
    title: "Owner review",
    content: "Use the original source",
  });
  f.call("project_instructions", {
    projectId: f.project.id,
    revision: 1,
    refs: [{ id: instruction.id, revision: 1 }],
  });
  const next = f.call("workflow_save", {
    id: w.id,
    revision: 1,
    workflow: f.core.workflowFields(w),
  });
  const pending = f.call("run_start", {
    workflowId: w.id,
    revision: next.revision,
  });
  f.call("instruction_revoke", { id: instruction.id, revision: 1 });
  assert.throws(() => f.approve(pending), /기준/);
  assert.equal(f.context(next).ready, false);
});

test("reconciliation computes exceptions deterministically, validates identities and pins rules with evidence", (t) => {
  const f = fixture(t);
  const report = reconcile(
    reconciliationExample,
    '{"excludeHeld":true,"toleranceUnits":0}',
  );
  assert.match(report, /일치 0행 · 차이\/예외 1행 · 보류 제외 1행/);
  assert.match(report, /BOOK-A \| 10 \| 8 \| -2 \| 부족/);
  assert.match(report, /orders\[0\]; receipts\[0\]/);
  const input = JSON.parse(reconciliationExample);
  assert.throws(
    () =>
      reconcile(
        JSON.stringify({
          ...input,
          orders: [...input.orders, input.orders[0]],
        }),
        "",
      ),
    /중복/,
  );
  assert.throws(
    () =>
      reconcile(
        JSON.stringify({
          ...input,
          receipts: [{ ...input.receipts[0], sku: "WRONG" }],
        }),
        "",
      ),
    /상품 코드/,
  );
  assert.throws(() =>
    reconcile(
      JSON.stringify({
        ...input,
        receipts: [{ ...input.receipts[0], quantity: 1.5 }],
      }),
      "",
    ),
  );
  const w = f.workflow({
    steps: [
      {
        id: "compare",
        kind: "reconcile",
        title: "Compare",
        content: '{"excludeHeld":true,"toleranceUnits":0}',
      },
      { id: "review", kind: "review", title: "Review" },
    ],
  });
  const context = f.context(w, reconciliationExample, "mcp:client");
  const summary = f.call(
    "run_start",
    {
      workflowId: w.id,
      revision: 1,
      contextId: context.id,
      input: reconciliationExample,
      inputSource: "Synthetic order and receipt JSON",
    },
    "mcp:client",
  );
  const artifact = f.call(
    "artifact_get",
    { runId: summary.id, artifactId: summary.artifacts[0].id },
    "mcp:client",
  );
  assert.equal(artifact.content, report);
  const actual = f.call("run_get", { id: summary.id }) as Run;
  assert.equal(
    actual.snapshot.steps[0].content,
    '{"excludeHeld":true,"toleranceUnits":0}',
  );
  assert.equal(f.approve(actual).status, "completed");
});

test("instruction versions, client grants and context receipts survive closing and reopening the database", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dingdong-work-restart-"));
  const database = path.join(directory, "db.sqlite");
  let store = new Store(database),
    core = new Core(store),
    sequence = 0;
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = (operation: Operation, input: unknown, actor = "owner") =>
    core.dispatch(operation, input, actor, `restart-${++sequence}`);
  const project = call("project_create", { name: "Restart fixture" });
  const instruction = call("instruction_save", {
    title: "Source rule",
    content: "Preserve the original source.",
  });
  call("project_instructions", {
    projectId: project.id,
    revision: 1,
    refs: [{ id: instruction.id, revision: 1 }],
  });
  const workflow = call("workflow_save", {
    workflow: {
      projectId: project.id,
      title: "Persisted work",
      brief: "Check persisted criteria",
      steps: [
        { id: "recall", kind: "recall", title: "Recall" },
        {
          id: "document",
          kind: "document",
          title: "Output",
          content: "{{requirements}}",
        },
      ],
    },
  });
  store.put("oauth_clients", "restart-client", {
    client_id: "restart-client",
    client_name: "Isolated fixture",
  });
  call("connection_update", {
    clientId: "restart-client",
    revision: 0,
    projectIds: [project.id],
    permissions: ["context:read", "runs:trial"],
    allowProjectCreation: false,
    active: true,
  });
  const context = call(
    "work_context_get",
    { projectId: project.id, workflowId: workflow.id, input: "input" },
    "mcp:restart-client",
  );
  call("instruction_save", {
    id: instruction.id,
    revision: 1,
    title: "Source rule",
    content: "New criteria for future versions.",
  });
  store.close();
  store = new Store(database);
  core = new Core(store);
  const summary = call(
    "run_start",
    {
      workflowId: workflow.id,
      revision: 1,
      contextId: context.id,
      input: "input",
    },
    "mcp:restart-client",
  );
  assert.equal(summary.status, "completed");
  const actual = call("run_get", { id: summary.id });
  assert.equal(actual.workContext.instructions[0].revision, 1);
  assert.equal(
    actual.artifacts[0].content,
    "Source rule · v1\nPreserve the original source.",
  );
  assert.equal(
    store.get<Connection>("connections", "restart-client")!.revision,
    1,
  );
});
