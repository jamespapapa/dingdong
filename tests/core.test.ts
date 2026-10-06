import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Core } from "../server/core.ts";
import { Store } from "../server/store.ts";
import type { Workflow, Run } from "../shared/domain.ts";

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dingdong-test-")),
    file = path.join(dir, "db.sqlite");
  const store = new Store(file),
    core = new Core(store);
  let n = 0;
  const call = (name: any, input: any, key = `request-${++n}`) =>
    core.dispatch(name, input, "test-owner", key);
  const project = call("project_create", { name: "Synthetic workspace" });
  const workflow = () =>
    call("workflow_save", {
      workflow: {
        projectId: project.id,
        title: "Weekly brief",
        brief: "Prepare a sourced brief",
        cadence: "daily",
        defaultInput: "Synthetic source",
        requirements: "Cite each source",
        steps: [
          { id: "recall", kind: "recall", title: "Recall" },
          {
            id: "document",
            kind: "document",
            title: "Brief",
            content: "{{input}}\n{{context}}\n{{requirements}}",
          },
          { id: "review", kind: "review", title: "Review" },
          {
            id: "remember",
            kind: "remember",
            title: "Procedure",
            content: "Sourced brief reviewed.",
          },
        ],
      },
    });
  return { file, store, core, call, project, workflow };
}
test("memory survives reopen and isolates projects, candidates, expiry and replacement history", () => {
  const f = fixture();
  const base = {
    projectId: f.project.id,
    title: "Shipping rule",
    content: "배송비는 3000원",
    kind: "decision",
    source: "Synthetic user instruction",
    status: "confirmed",
  };
  const m = f.call("memory_write", base);
  f.call("memory_write", {
    ...base,
    status: "candidate",
    title: "Unverified",
    content: "never return candidate",
  });
  f.call("memory_write", {
    ...base,
    validUntil: "2020-01-01T00:00:00.000Z",
    title: "Expired",
  });
  const other = f.call("project_create", { name: "Other tenant work" });
  f.call("memory_write", {
    ...base,
    projectId: other.id,
    title: "Private other project",
    content: "never cross projects",
  });
  assert.deepEqual(
    f.core.context(f.project.id, "").memories.map((m) => m.id),
    [m.id],
  );
  assert.equal(
    f.call("memory_search", { projectId: f.project.id, query: "배송" }).memories
      .length,
    1,
  );
  const replacement = f.call("memory_write", {
    ...base,
    content: "배송비는 3500원",
    replacesId: m.id,
    expectedRevision: 1,
  });
  assert.equal(f.store.get<any>("memories", m.id).status, "superseded");
  assert.equal(f.core.context(f.project.id, "").memories[0].id, replacement.id);
  f.store.close();
  const reopened = new Store(f.file);
  const c = new Core(reopened);
  assert.equal(
    c.context(f.project.id, "").memories[0].content,
    "배송비는 3500원",
  );
  assert.equal(
    reopened.get<any>("memory_history", `${m.id}:1`).content,
    "배송비는 3000원",
  );
  c.dispatch(
    "memory_state",
    { id: replacement.id, revision: 1, status: "forgotten" },
    "owner",
    "forget",
  );
  assert.equal(c.context(f.project.id, "").memories.length, 0);
  reopened.close();
});
test("idempotency prevents duplicate mutations and refuses changed inputs", () => {
  const f = fixture();
  const p = { name: "One project" };
  const a = f.call("project_create", p, "same");
  const b = f.call("project_create", p, "same");
  assert.equal(a.id, b.id);
  assert.throws(
    () => f.call("project_create", { name: "Changed" }, "same"),
    /다른 입력/,
  );
  assert.throws(
    () => f.core.dispatch("project_create", p, "test-owner"),
    /idempotencyKey/,
  );
  assert.equal(f.store.list("projects").length, 2);
  f.store.close();
});
test("review resumes exact snapshot, never recreates completed artifacts, feedback makes a new revision", () => {
  const f = fixture();
  const w: Workflow = f.workflow();
  const r: Run = f.call("run_start", {
    workflowId: w.id,
    revision: 1,
    input: "Original input",
  });
  assert.equal(r.status, "needs_review");
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.snapshot.revision, 1);
  const done: Run = f.call(
    "run_review",
    { id: r.id, decision: "approve", reviewId: r.review?.id },
    "approve",
  );
  assert.equal(done.status, "completed");
  assert.equal(done.artifacts[0].id, r.artifacts[0].id);
  f.call(
    "run_review",
    { id: r.id, decision: "approve", reviewId: r.review?.id },
    "approve",
  );
  assert.equal(f.store.list("memories").length, 1);
  const feedback = f.call("feedback_record", {
    runId: r.id,
    observation: "Missing next action",
    change: "Include next action",
    verification: "Each brief names one next action",
  });
  assert.equal(f.core.context(f.project.id, "").memories.length, 0);
  const next = f.call("feedback_apply", { id: feedback.id, revision: 1 });
  assert.equal(next.revision, 2);
  assert.equal(next.active, false);
  assert.match(next.requirements, /Include next action/);
  assert.equal(f.call("run_get", { id: r.id }).snapshot.revision, 1);
  assert.equal(f.core.context(f.project.id, "").memories.length, 1);
  assert.throws(
    () => f.call("feedback_apply", { id: feedback.id, revision: 2 }),
    /이미 적용/,
  );
  f.store.close();
});
test("stale approval is rejected, old run can be cancelled and schedule needs completed current revision", () => {
  const f = fixture();
  const w = f.workflow();
  assert.throws(
    () => f.call("workflow_schedule", { id: w.id, revision: 1, active: true }),
    /완료/,
  );
  const r = f.call("run_start", { workflowId: w.id, revision: 1 });
  const updated = f.call("workflow_save", {
    id: w.id,
    revision: 1,
    workflow: { ...f.core.workflowFields(w), title: "Edited" },
  });
  assert.throws(
    () => f.call("run_review", { id: r.id, decision: "approve" }),
    /버전/,
  );
  assert.equal(
    f.call("run_review", { id: r.id, decision: "cancel" }).status,
    "cancelled",
  );
  const fresh = f.call("run_start", {
    workflowId: w.id,
    revision: updated.revision,
  });
  f.call("run_review", {
    id: fresh.id,
    decision: "approve",
    reviewId: fresh.review?.id,
  });
  const active = f.call("workflow_schedule", {
    id: w.id,
    revision: 2,
    active: true,
  });
  assert.equal(active.active, true);
  assert.ok(active.nextRunAt);
  f.store.close();
});
test("workflow rejects arbitrary tools, duplicate IDs and unreviewed memory writes", () => {
  const f = fixture();
  const base = { projectId: f.project.id, title: "Invalid", brief: "Invalid" };
  assert.throws(() =>
    f.call("workflow_save", {
      workflow: {
        ...base,
        steps: [
          { id: "a", kind: "exec", title: "Shell" },
          { id: "b", kind: "document", title: "Doc" },
        ],
      },
    }),
  );
  assert.throws(() =>
    f.call("workflow_save", {
      workflow: {
        ...base,
        steps: [
          { id: "a", kind: "document", title: "Doc" },
          { id: "a", kind: "review", title: "Review" },
        ],
      },
    }),
  );
  assert.throws(() =>
    f.call("workflow_save", {
      workflow: {
        ...base,
        steps: [
          { id: "a", kind: "document", title: "Doc" },
          { id: "b", kind: "remember", title: "Unsafe" },
        ],
      },
    }),
  );
  assert.throws(() => f.call("__proto__", {}), /지원하지/);
  f.store.close();
});
