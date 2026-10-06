import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { secret } from "../server/auth.ts";
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
    { id: run.id, decision: "approve" },
    "verification",
    "approve",
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.artifacts.length, 1);
  const key = secret();
  app.store.put("oauth_clients", "smoke", {
    client_id: "smoke",
    client_name: "Integration fixture",
    redirect_uris: [],
    token_endpoint_auth_method: "none",
  });
  const token = app.auth.issue("smoke", "dingdong");
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
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/openclaw-verification.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        openclaw: app.runtime.version,
        actualGateway: true,
        mcpThroughGateway: true,
        persistedMemoryRecall: true,
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
