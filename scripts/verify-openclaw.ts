import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { secret } from "../server/auth.ts";
import { reconciliationExample } from "../shared/reconciliation.ts";
import { textHash } from "../server/work-utils.ts";
const dir = mkdtempSync(path.join(os.tmpdir(), "dingdong-openclaw-"));
const config = {
  port: 5492,
  base: "http://127.0.0.1:5492",
  dataDir: dir,
  adminKey: secret(),
  internalKey: secret(),
  gatewayToken: secret(),
  gatewayPort: 18798,
  coreOnly: false,
};
const app = createApp(config);
const server = app.app.listen(config.port, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
app.runtime.start();
try {
  let connected = false;
  for (let i = 0; i < 50; i++) {
    try {
      await app.runtime.invoke("project_list", {}, "verification");
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  assert.ok(connected, "Actual OpenClaw gateway must answer");
  const project = await app.runtime.invoke(
    "project_create",
    { name: "Isolated integration test" },
    "verification",
    "create-project",
  );
  await app.runtime.invoke(
    "memory_write",
    {
      projectId: project.id,
      kind: "decision",
      title: "Verification rule",
      content: "Always include a next action.",
      source: "Synthetic integration fixture",
      status: "confirmed",
    },
    "verification",
    "memory",
  );
  const w = await app.runtime.invoke(
    "workflow_save",
    {
      workflow: {
        projectId: project.id,
        title: "Integration brief",
        brief: "Test work setup",
        steps: [
          { id: "recall", kind: "recall", title: "Recall" },
          {
            id: "document",
            kind: "document",
            title: "Brief",
            content: "{{input}}\n{{context}}",
          },
          { id: "review", kind: "review", title: "Review" },
        ],
      },
    },
    "verification",
    "workflow",
  );
  const run = await app.runtime.invoke(
    "run_start",
    { workflowId: w.id, revision: 1, input: "Isolated sample" },
    "verification",
    "run",
  );
  assert.equal(run.status, "needs_review");
  assert.match(run.artifacts[0].content, /Always include a next action/);
  const completed = await app.runtime.invoke(
    "run_review",
    { id: run.id, decision: "approve", reviewId: run.review.id },
    "verification",
    "approve",
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.artifacts.length, 1);
  app.store.put("oauth_clients", "smoke", {
    client_id: "smoke",
    client_name: "Integration fixture",
    redirect_uris: [],
    token_endpoint_auth_method: "none",
  });
  app.core.dispatch(
    "connection_update",
    {
      clientId: "smoke",
      revision: 0,
      projectIds: [project.id],
      permissions: [
        "context:read",
        "workflow:propose",
        "runs:trial",
        "artifacts:read",
      ],
      allowProjectCreation: false,
      active: true,
    },
    "owner",
    "grant-smoke",
  );
  const token = app.auth.issue("smoke", "dingdong");
  let requestId = 10;
  async function callTool(name: string, input: Record<string, unknown>) {
    const response = await fetch(`${config.base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method: "tools/call",
        params: { name, arguments: input },
      }),
    });
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.result?.isError, undefined, JSON.stringify(body));
    return body.result.structuredContent;
  }
  const mcp = await fetch(`${config.base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "context_get", arguments: { projectId: project.id } },
    }),
  });
  const result: any = await mcp.json();
  assert.equal(result.result.structuredContent.memories.length, 1);
  const evidence = result.result.structuredContent.memories[0];
  assert.match(evidence.citation, /^dingdong:memory:/);
  const sourceResponse = await fetch(`${config.base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "memory_get",
        arguments: {
          projectId: project.id,
          id: evidence.id,
          revision: evidence.revision,
          start: evidence.excerpt.start,
          length: evidence.excerpt.end - evidence.excerpt.start,
        },
      },
    }),
  });
  const sourceResult: any = await sourceResponse.json();
  assert.equal(sourceResult.result.structuredContent.content, evidence.content);
  assert.equal(
    sourceResult.result.structuredContent.citation,
    evidence.citation,
  );
  const proposal = await callTool("workflow_propose", {
    reason: "Synthetic order comparison requested for integration verification",
    workflow: {
      projectId: project.id,
      title: "Order reconciliation",
      brief: "Report differences with original row references",
      steps: [
        {
          id: "compare",
          kind: "reconcile",
          title: "Quantity differences",
          content: '{"excludeHeld":true,"toleranceUnits":0}',
        },
        { id: "review", kind: "review", title: "Owner review" },
      ],
    },
    idempotencyKey: "comparison-proposal",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(app.store.list("workflows").length, 1);
  const applied = await app.runtime.invoke(
    "proposal_review",
    { id: proposal.id, decision: "apply" },
    "verification",
    "apply-proposal",
  );
  const workContext = await callTool("work_context_get", {
    projectId: project.id,
    workflowId: applied.appliedWorkflowId,
    input: reconciliationExample,
  });
  assert.equal(workContext.ready, true);
  assert.equal(workContext.inputContract.format, "json");
  const trial = await callTool("run_start", {
    workflowId: applied.appliedWorkflowId,
    revision: 1,
    input: reconciliationExample,
    contextId: workContext.id,
    inputSource: "Synthetic test JSON",
    idempotencyKey: "comparison-trial",
  });
  assert.equal(trial.status, "needs_review");
  assert.equal(trial.artifacts[0].content, undefined);
  assert.equal(trial.input, undefined);
  const artifact = await callTool("artifact_get", {
    runId: trial.id,
    artifactId: trial.artifacts[0].id,
  });
  assert.match(artifact.content, /BOOK-A \| 10 \| 8 \| -2 \| 부족/);
  assert.equal(artifact.sha256, textHash(artifact.content));
  await assert.rejects(
    () =>
      app.runtime.invoke(
        "run_review",
        { id: trial.id, decision: "approve" },
        "mcp:smoke",
        "agent-approval",
      ),
    /소유자/,
  );
  const actualTrial = await app.runtime.invoke(
    "run_get",
    { id: trial.id },
    "verification",
  );
  await app.runtime.invoke(
    "run_review",
    { id: trial.id, decision: "approve", reviewId: actualTrial.review.id },
    "verification",
    "owner-comparison-approval",
  );
  const denied = await fetch(
    `http://127.0.0.1:${config.gatewayPort}/tools/invoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tool: "exec",
        args: { command: "echo should-not-execute" },
      }),
    },
  );
  assert.equal(denied.status, 404);
  const stopped = new Promise<void>((resolve) =>
    app.runtime.child!.once("exit", () => resolve()),
  );
  app.runtime.stop();
  await stopped;
  app.runtime.start();
  let recalledAfterRestart = false;
  for (let i = 0; i < 50; i++) {
    try {
      const context = await app.runtime.invoke(
        "context_get",
        { projectId: project.id },
        "verification",
      );
      assert.equal(context.memories.length, 1);
      recalledAfterRestart = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  assert.ok(
    recalledAfterRestart,
    "A restarted gateway must recall the same persistent work memory without an owner-lease conflict",
  );
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/openclaw-verification.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        openclaw: app.runtime.version,
        actualGateway: true,
        gatewayRestart: true,
        mcpThroughGateway: true,
        persistedMemoryRecall: true,
        memoryCitationReadback: true,
        workflowProposalOwnerReview: true,
        contextReceiptBoundTrial: true,
        deterministicReconciliation: true,
        artifactHashReadback: true,
        remoteApprovalDenied: true,
        workflowReviewAndArtifacts: true,
        unrestrictedShellDenied: true,
        personalDotsAccount: false,
        fixtures: "isolated synthetic data in temporary directory",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: actual OpenClaw → Dingdong, authenticated MCP → OpenClaw → Dingdong, memory, workflow, review, blocked shell. This is not personal dots verification.",
  );
} finally {
  app.runtime.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  app.store.close();
}
