import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.ts";
import { digest, secret } from "../server/auth.ts";

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
    const authorize = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", code_challenge: digest(verifier), code_challenge_method: "S256", state: "state-123" })}`,
    );
    const csrfCookie = authorize.headers.get("set-cookie")!.split(";")[0];
    const html = await authorize.text();
    const pending = html.match(/name="pending" value="([^"]+)"/)![1];
    assert.equal(
      (await post("/oauth/authorize", { pending, key })).status,
      400,
    );
    const consent = await post(
      "/oauth/authorize",
      { pending, key },
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
    assert.equal(tools.result.tools.length, 15);
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
