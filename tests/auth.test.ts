import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.ts";
import { digest, secret } from "../server/auth.ts";
import { permissionNames } from "../shared/work.ts";

test("OAuth PKCE + discovery + MCP auth + refresh rotation + owner CSRF protection", async () => {
  const key = secret();
  const app = createApp({
    port: 0,
    base: "http://127.0.0.1",
    dataDir: mkdtempSync(path.join(os.tmpdir(), "dingdong-auth-")),
    adminKey: key,
    gatewayToken: secret(),
    internalKey: secret(),
    gatewayPort: 0,
    coreOnly: true,
  });
  const server = app.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (url: string, body: any, headers: Record<string, string> = {}) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  try {
    assert.equal((await fetch(base + "/api/snapshot")).status, 401);
    const denied = await post("/mcp", {});
    assert.equal(denied.status, 401);
    assert.equal(
      (await post("/mcp", {}, { Authorization: `Bearer ${key}` })).status,
      401,
      "The owner key must never substitute for an OAuth MCP access token",
    );
    assert.match(denied.headers.get("www-authenticate")!, /resource_metadata/);
    const meta = await (
      await fetch(base + "/.well-known/oauth-authorization-server")
    ).json();
    assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    assert.equal(
      (
        await post("/oauth/register", {
          redirect_uris: ["http://evil.example/callback"],
        })
      ).status,
      400,
    );
    const redirect = "https://chatgpt.com/connector_platform/oauth/callback";
    const client = await (
      await post("/oauth/register", {
        redirect_uris: [redirect],
        client_name: "Synthetic MCP client",
      })
    ).json();
    const verifier = secret();
    const privateProject = app.core.dispatch(
      "project_create",
      { name: "Private project name" },
      "owner",
      "private-project",
    );
    const authorize = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: digest(verifier), code_challenge_method: "S256", state: "state-123" })}`,
    );
    const csrfCookie = authorize.headers.get("set-cookie")!.split(";")[0];
    const html = await authorize.text();
    assert.ok(!html.includes(privateProject.name));
    assert.ok(!html.includes(privateProject.id));
    const pending = html.match(/name="pending" value="([^"]+)"/)![1];
    assert.equal(
      (await post("/oauth/authorize", { pending, key })).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/oauth/authorize",
          {
            pending,
            projectIds: [privateProject.id],
            permissions: ["context:read"],
          },
          { Cookie: csrfCookie },
        )
      ).status,
      401,
    );
    const verified = await post(
      "/oauth/authorize",
      { pending, key },
      { Cookie: csrfCookie },
    );
    assert.equal(verified.status, 200);
    assert.match(
      verified.headers.get("content-security-policy")!,
      /form-action 'self' https:\/\/chatgpt.com/,
    );
    const choices = await verified.text();
    assert.ok(choices.includes(privateProject.name));
    assert.ok(!choices.includes(key));
    assert.equal(app.store.list("connections").length, 0);
    assert.equal((await post("/oauth/authorize", { pending })).status, 400);
    const consent = await post(
      "/oauth/authorize",
      {
        pending,
        projectIds: [privateProject.id],
        permissions: ["context:read"],
      },
      { Cookie: csrfCookie },
    );
    assert.equal(consent.status, 302);
    const callback = new URL(consent.headers.get("location")!);
    assert.equal(callback.searchParams.get("state"), "state-123");
    assert.equal(callback.searchParams.get("iss"), "http://127.0.0.1");
    const grant = {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: callback.searchParams.get("code"),
      redirect_uri: redirect,
      code_verifier: verifier,
    };
    assert.equal(
      (await post("/oauth/token", { ...grant, code_verifier: secret() }))
        .status,
      400,
    );
    const token = await (await post("/oauth/token", grant)).json();
    assert.ok(token.access_token);
    assert.ok(token.refresh_token);
    assert.equal((await post("/oauth/token", grant)).status, 400);
    const mcpHeaders = {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json, text/event-stream",
    };
    const init = await post(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "integration-test", version: "1" },
        },
      },
      mcpHeaders,
    );
    assert.equal(init.status, 200);
    const tools = await (
      await post(
        "/mcp",
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        mcpHeaders,
      )
    ).json();
    assert.equal(tools.result.tools.length, 14);
    assert.ok(
      !tools.result.tools.some((t: any) =>
        [
          "run_review",
          "memory_state",
          "workflow_save",
          "connection_update",
        ].includes(t.name),
      ),
    );
    const profile = await (
      await post(
        "/mcp",
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_profile", arguments: {} },
        },
        mcpHeaders,
      )
    ).json();
    assert.equal(profile.result.structuredContent.id, app.auth.profileId);
    const refreshBody = {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token,
    };
    const refreshed = await (await post("/oauth/token", refreshBody)).json();
    assert.ok(refreshed.access_token);
    assert.notEqual(refreshed.refresh_token, token.refresh_token);
    assert.equal((await post("/oauth/token", refreshBody)).status, 400);
    const login = await post("/api/login", { key });
    const sessionCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await post(
          "/api/tools/project_create",
          { input: { name: "CSRF" }, idempotencyKey: "csrf" },
          { Cookie: sessionCookie, Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal((await post("/internal/tool", {})).status, 401);
    const exportResponse = await fetch(base + "/api/export", {
      headers: { Authorization: `Bearer ${key}` },
    });
    assert.equal(exportResponse.status, 200);
    assert.ok(!(await exportResponse.text()).includes(token.access_token));
    await post("/oauth/revoke", { token: token.access_token });
    assert.equal((await post("/mcp", {}, mcpHeaders)).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.store.close();
  }
});

test("authenticated MCP enforces project grants, proposal-only writes, separate artifact reads and immediate revocation", async () => {
  const key = secret();
  const app = createApp({
    port: 0,
    base: "http://127.0.0.1",
    dataDir: mkdtempSync(path.join(os.tmpdir(), "dingdong-scoped-mcp-")),
    adminKey: key,
    gatewayToken: secret(),
    internalKey: secret(),
    gatewayPort: 0,
    coreOnly: true,
  });
  const server = app.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let n = 0;
  const owner = (op: any, input: any) =>
    app.core.dispatch(op, input, "owner", `owner-${++n}`);
  const project = owner("project_create", { name: "Shared" }),
    other = owner("project_create", { name: "Private" });
  app.store.put("oauth_clients", "scoped", {
    client_id: "scoped",
    client_name: "Isolated scoped MCP client",
  });
  const grant = owner("connection_update", {
    clientId: "scoped",
    revision: 0,
    projectIds: [project.id],
    permissions: [
      "context:read",
      "memory:propose",
      "workflow:propose",
      "runs:trial",
    ],
    active: true,
    allowProjectCreation: false,
  });
  const token = app.auth.issue("scoped", "dingdong");
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const mcp = async (name: string, input: any) => {
    const response = await fetch(base + "/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++n,
        method: "tools/call",
        params: {
          name,
          arguments: {
            ...input,
            ...([
              "project_list",
              "context_get",
              "work_context_get",
              "run_get",
              "artifact_get",
            ].includes(name)
              ? {}
              : { idempotencyKey: `mcp-${n}` }),
          },
        },
      }),
    });
    return response.json();
  };
  try {
    assert.equal(
      (await fetch(base + "/api/snapshot", { headers })).status,
      401,
    );
    assert.deepEqual(
      (await mcp("project_list", {})).result.structuredContent.projects.map(
        (p: any) => p.id,
      ),
      [project.id],
    );
    assert.equal(
      (await mcp("context_get", { projectId: other.id })).result.isError,
      true,
    );
    const memory = {
      projectId: project.id,
      kind: "fact",
      title: "Proposal",
      content: "Source-backed idea",
      source: "Synthetic evidence",
    };
    assert.equal(
      (await mcp("memory_write", { ...memory, status: "confirmed" })).result
        .isError,
      true,
    );
    const candidate = (await mcp("memory_write", memory)).result
      .structuredContent;
    assert.equal(candidate.status, "candidate");
    owner("memory_state", {
      id: candidate.id,
      revision: 1,
      status: "confirmed",
    });
    const proposed = (
      await mcp("workflow_propose", {
        reason: "Create a reviewed trial",
        workflow: {
          projectId: project.id,
          title: "Trial",
          brief: "Generate an artifact from an exact input",
          steps: [
            {
              id: "doc",
              kind: "document",
              title: "Result",
              content: "{{input}}",
            },
            { id: "review", kind: "review", title: "Review" },
          ],
        },
      })
    ).result.structuredContent;
    assert.equal(app.store.list("workflows").length, 0);
    const applied = owner("proposal_review", {
      id: proposed.id,
      decision: "apply",
    });
    const context = (
      await mcp("work_context_get", {
        projectId: project.id,
        workflowId: applied.appliedWorkflowId,
        input: "PRIVATE ARTIFACT BODY",
      })
    ).result.structuredContent;
    const run = (
      await mcp("run_start", {
        workflowId: applied.appliedWorkflowId,
        revision: 1,
        input: "PRIVATE ARTIFACT BODY",
        contextId: context.id,
      })
    ).result.structuredContent;
    assert.equal(run.status, "needs_review");
    assert.ok(!JSON.stringify(run).includes("PRIVATE ARTIFACT BODY"));
    assert.equal(
      (
        await mcp("artifact_get", {
          runId: run.id,
          artifactId: run.artifacts[0].id,
        })
      ).result.isError,
      true,
    );
    assert.equal(
      (await mcp("run_review", { id: run.id, decision: "approve" })).result
        .isError,
      true,
    );
    const expanded = owner("connection_update", {
      clientId: "scoped",
      revision: grant.revision,
      projectIds: [project.id],
      permissions: [...permissionNames],
      active: true,
      allowProjectCreation: false,
    });
    assert.equal(
      (
        await mcp("artifact_get", {
          runId: run.id,
          artifactId: run.artifacts[0].id,
        })
      ).result.structuredContent.content,
      "PRIVATE ARTIFACT BODY",
    );
    owner("connection_update", {
      clientId: "scoped",
      revision: expanded.revision,
      projectIds: [project.id],
      permissions: [...permissionNames],
      active: false,
      allowProjectCreation: false,
    });
    assert.equal(
      (
        await fetch(base + "/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 999,
            method: "tools/list",
          }),
        })
      ).status,
      401,
    );
    const refresh = await fetch(base + "/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: "scoped",
        refresh_token: token.refresh_token,
      }),
    });
    assert.equal(refresh.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.store.close();
  }
});
