import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Store } from "./store.ts";
import { AppError } from "./core.ts";

export const secret = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const cookie = (req: Request, name: string) =>
  (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
type Client = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
};
type Grant = {
  clientId: string;
  scope: string;
  resource: string;
  expires: number;
  redirectUri: string;
  challenge: string;
};
type Token = {
  clientId: string;
  scope: string;
  resource: string;
  expires: number;
  type: "access" | "refresh";
};
export class Auth {
  resource: string;
  profileId: string;
  limits = new Map<string, { count: number; until: number }>();
  constructor(
    public store: Store,
    public base: string,
    private ownerKey: string,
  ) {
    this.resource = `${base}/mcp`;
    this.profileId =
      store.get<string>("settings", "profileId") ||
      store.put("settings", "profileId", randomUUID());
  }
  limit(req: Request, category: string, max = 30) {
    const key = `${category}:${req.ip}`;
    const now = Date.now();
    if (this.limits.size > 5000)
      for (const [k, v] of this.limits)
        if (v.until < now) this.limits.delete(k);
    const v = this.limits.get(key);
    if (!v || v.until < now)
      this.limits.set(key, { count: 1, until: now + 60000 });
    else if (++v.count > max)
      throw new AppError(429, "요청이 많습니다. 잠시 뒤 다시 시도해주세요.");
  }
  owner(req: Request) {
    if (equal(req.get("authorization") || "", `Bearer ${this.ownerKey}`))
      return true;
    const session = cookie(req, "dd_session");
    const value = session
      ? this.store.get<{ expires: number }>("sessions", digest(session))
      : undefined;
    return !!value && value.expires > Date.now();
  }
  ownerMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    if (!this.owner(req))
      return next(new AppError(401, "소유자 키로 연결해주세요."));
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !req.get("authorization") &&
      req.get("origin") !== this.base
    )
      return next(new AppError(403, "다른 사이트에서 보낸 변경 요청입니다."));
    next();
  };
  token(req: Request): Token | undefined {
    const value = req.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    const t = value
      ? this.store.get<Token>("tokens", digest(value))
      : undefined;
    return t &&
      t.type === "access" &&
      t.expires > Date.now() &&
      t.resource === this.resource &&
      t.scope.split(" ").includes("dingdong")
      ? t
      : undefined;
  }
  challenge() {
    return `Bearer resource_metadata="${this.base}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Connect your Dingdong account"`;
  }
  issue(clientId: string, scope: string) {
    const access = secret(),
      refresh = secret();
    this.store.put<Token>("tokens", digest(access), {
      clientId,
      scope,
      resource: this.resource,
      expires: Date.now() + 3600000,
      type: "access",
    });
    this.store.put<Token>("tokens", digest(refresh), {
      clientId,
      scope,
      resource: this.resource,
      expires: Date.now() + 30 * 86400000,
      type: "refresh",
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    };
  }
  mount(app: Express) {
    app.get(
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ],
      (_req, res) =>
        res.json({
          resource: this.resource,
          authorization_servers: [this.base],
          scopes_supported: ["dingdong"],
          bearer_methods_supported: ["header"],
          resource_name: "Dingdong",
        }),
    );
    app.get("/.well-known/oauth-authorization-server", (_req, res) =>
      res.json({
        issuer: this.base,
        authorization_endpoint: `${this.base}/oauth/authorize`,
        token_endpoint: `${this.base}/oauth/token`,
        registration_endpoint: `${this.base}/oauth/register`,
        revocation_endpoint: `${this.base}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["dingdong"],
        authorization_response_iss_parameter_supported: true,
      }),
    );
    app.post("/oauth/register", (req, res) => {
      this.limit(req, "register", 15);
      const input = z
        .object({
          redirect_uris: z.array(z.string().url().max(2000)).min(1).max(10),
          client_name: z.string().max(160).default("MCP client"),
          token_endpoint_auth_method: z.literal("none").default("none"),
        })
        .passthrough()
        .parse(req.body);
      for (const uri of input.redirect_uris) {
        const u = new URL(uri);
        if (
          u.hash ||
          u.username ||
          u.password ||
          !(
            u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
          )
        )
          throw new AppError(400, "HTTPS 또는 로컬 콜백만 지원합니다.");
      }
      const client: Client = {
        client_id: randomUUID(),
        client_name: input.client_name,
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: "none",
      };
      this.store.put("oauth_clients", client.client_id, client);
      res
        .status(201)
        .json({
          ...client,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_id_issued_at: Math.floor(Date.now() / 1000),
        });
    });
    app.get("/oauth/authorize", (req, res) => {
      this.limit(req, "authorize");
      const q = z
        .object({
          client_id: z.string(),
          redirect_uri: z.string().url(),
          response_type: z.literal("code"),
          code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code_challenge_method: z.literal("S256"),
          state: z.string().max(2000).default(""),
          scope: z.string().default("dingdong"),
          resource: z.string().default(this.resource),
        })
        .parse(req.query);
      const client = this.store.get<Client>("oauth_clients", q.client_id);
      if (!client || !client.redirect_uris.includes(q.redirect_uri))
        throw new AppError(
          400,
          "등록되지 않은 OAuth 클라이언트 또는 콜백입니다.",
        );
      if (
        q.resource !== this.resource ||
        q.scope
          .split(" ")
          .some((s) => !["dingdong", "offline_access"].includes(s))
      )
        throw new AppError(400, "지원하지 않는 리소스 또는 권한입니다.");
      const pending = secret(),
        csrf = secret();
      this.store.put("oauth_pending", digest(pending), {
        q,
        csrf: digest(csrf),
        expires: Date.now() + 600000,
      });
      res.cookie("dd_oauth", csrf, {
        httpOnly: true,
        secure: this.base.startsWith("https:"),
        sameSite: "lax",
        path: "/oauth",
        maxAge: 600000,
      });
      res
        .type("html")
        .send(
          `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dingdong 연결</title><style>body{background:#f4f2ec;color:#232722;font:17px system-ui;margin:0;padding:8vh 24px}main{max-width:480px;margin:auto;background:white;border:1px solid #dddcd4;padding:36px;border-radius:20px}h1{font-size:30px}label,input,button{display:block;width:100%;box-sizing:border-box}input{padding:14px;border:1px solid #bbb;margin:12px 0 24px;border-radius:8px}button{padding:15px;background:#263e32;color:white;border:0;border-radius:8px;font:inherit}small{display:block;overflow-wrap:anywhere;color:#666}</style><main><b>dingdong.</b><h1>기억과 업무를 연결합니다.</h1><p><strong>${escape(client.client_name)}</strong>가 이 개인 워크스페이스의 기억과 자동화 도구를 사용합니다.</p><small>연결 대상: ${escape(new URL(q.redirect_uri).origin)}</small><p>기억 조회·저장, 자동화 설계·실행·검토 권한을 제공합니다. 외부 계정의 권한은 포함하지 않습니다.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="pending" value="${pending}"><label for="key">Dingdong 소유자 키</label><input id="key" type="password" name="key" required autocomplete="current-password"><button>내 dots에 연결 허용</button></form></main></html>`,
        );
    });
    app.post("/oauth/authorize", (req, res) => {
      this.limit(req, "consent", 10);
      const { pending, key } = z
        .object({ pending: z.string().max(100), key: z.string().max(500) })
        .parse(req.body);
      const p = this.store.get<{ q: any; csrf: string; expires: number }>(
        "oauth_pending",
        digest(pending),
      );
      if (
        !p ||
        p.expires < Date.now() ||
        !equal(p.csrf, digest(cookie(req, "dd_oauth") || ""))
      )
        throw new AppError(400, "연결 요청이 만료됐습니다. 다시 연결해주세요.");
      if (!equal(key, this.ownerKey))
        throw new AppError(
          401,
          "소유자 키를 확인해주세요. 뒤로 가서 다시 입력할 수 있습니다.",
        );
      const code = secret();
      this.store.transaction(() => {
        this.store.remove("oauth_pending", digest(pending));
        this.store.put<Grant>("oauth_codes", digest(code), {
          clientId: p.q.client_id,
          scope: "dingdong",
          resource: this.resource,
          expires: Date.now() + 120000,
          redirectUri: p.q.redirect_uri,
          challenge: p.q.code_challenge,
        });
      });
      const redirect = new URL(p.q.redirect_uri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", p.q.state);
      redirect.searchParams.set("iss", this.base);
      res.set("Cache-Control", "no-store").redirect(redirect.href);
    });
    app.post("/oauth/token", (req, res) => {
      this.limit(req, "token", 60);
      res.set("Cache-Control", "no-store");
      const p = z
        .object({
          grant_type: z.enum(["authorization_code", "refresh_token"]),
          client_id: z.string(),
          code: z.string().optional(),
          code_verifier: z.string().optional(),
          redirect_uri: z.string().optional(),
          refresh_token: z.string().optional(),
          resource: z.string().optional(),
        })
        .passthrough()
        .parse(req.body);
      if (p.resource && p.resource !== this.resource)
        return res.status(400).json({ error: "invalid_target" });
      if (!this.store.get("oauth_clients", p.client_id))
        return res.status(400).json({ error: "invalid_client" });
      const response = this.store.transaction(() => {
        if (p.grant_type === "authorization_code") {
          const codeHash = digest(p.code || "");
          const grant = this.store.get<Grant>("oauth_codes", codeHash);
          if (
            !grant ||
            grant.expires < Date.now() ||
            grant.clientId !== p.client_id ||
            grant.redirectUri !== p.redirect_uri ||
            !p.code_verifier ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier) ||
            !equal(digest(p.code_verifier), grant.challenge)
          )
            return null;
          this.store.remove("oauth_codes", codeHash);
          return this.issue(grant.clientId, grant.scope);
        }
        const hash = digest(p.refresh_token || "");
        const token = this.store.get<Token>("tokens", hash);
        if (
          !token ||
          token.type !== "refresh" ||
          token.clientId !== p.client_id ||
          token.expires < Date.now() ||
          token.resource !== this.resource
        )
          return null;
        this.store.remove("tokens", hash);
        return this.issue(token.clientId, token.scope);
      });
      return response
        ? res.json(response)
        : res.status(400).json({ error: "invalid_grant" });
    });
    app.post("/oauth/revoke", (req, res) => {
      this.limit(req, "revoke");
      const p = z.object({ token: z.string().max(500) }).parse(req.body);
      this.store.remove("tokens", digest(p.token));
      res.status(200).end();
    });
    app.post("/api/login", (req, res) => {
      this.limit(req, "login", 10);
      const { key } = z.object({ key: z.string().max(500) }).parse(req.body);
      if (!equal(key, this.ownerKey))
        throw new AppError(401, "소유자 키를 확인해주세요.");
      const value = secret();
      this.store.put("sessions", digest(value), {
        expires: Date.now() + 7 * 86400000,
      });
      res.cookie("dd_session", value, {
        httpOnly: true,
        secure: this.base.startsWith("https:"),
        sameSite: "strict",
        maxAge: 7 * 86400000,
        path: "/",
      });
      res.json({ ok: true });
    });
    app.post("/api/logout", this.ownerMiddleware, (req, res) => {
      this.store.remove("sessions", digest(cookie(req, "dd_session") || ""));
      res.clearCookie("dd_session");
      res.json({ ok: true });
    });
  }
}
