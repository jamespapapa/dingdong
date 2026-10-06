import express from "express";
import path from "node:path";
import { z } from "zod";
import { Auth, equal } from "./auth.ts";
import { AppError, Core, operations, type Operation } from "./core.ts";
import { Store } from "./store.ts";
import { Runtime, type Config } from "./runtime.ts";
import { mountMcp } from "./mcp.ts";

export function createApp(config: Config) {
  const store = new Store(path.join(config.dataDir, "dingdong.sqlite"));
  const core = new Core(store),
    auth = new Auth(store, config.base, config.adminKey),
    runtime = new Runtime(config, core);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.get("/health", (_req, res) => {
    const ok = config.coreOnly || runtime.ready;
    res
      .status(ok ? 200 : 503)
      .json({
        ok,
        service: "dingdong",
        version: "0.1.0",
        runtime: runtime.status(),
      });
  });
  auth.mount(app);
  app.post("/internal/tool", (req, res) => {
    if (!equal(req.get("authorization") || "", `Bearer ${config.internalKey}`))
      throw new AppError(401, "Unauthorized");
    const p = z
      .object({
        operation: z.string(),
        input: z.unknown(),
        actor: z.string().max(200),
        idempotencyKey: z.string().max(160).optional(),
      })
      .strict()
      .parse(req.body);
    res.json({
      data: core.dispatch(
        p.operation as Operation,
        p.input,
        p.actor,
        p.idempotencyKey,
      ),
    });
  });
  mountMcp(app, auth, runtime, core);
  app.use("/api", auth.ownerMiddleware);
  app.get("/api/snapshot", (_req, res) =>
    res
      .set("Cache-Control", "no-store")
      .json({
        ...core.snapshot(),
        runtime: runtime.status(),
        base: config.base,
      }),
  );
  app.post("/api/tools/:operation", async (req, res) => {
    const operation = req.params.operation as Operation;
    if (!Object.hasOwn(operations, operation))
      throw new AppError(400, "지원하지 않는 도구입니다.");
    const input = operations[operation].parse(req.body.input);
    const data = await runtime.invoke(
      operation,
      input,
      "owner",
      req.body.idempotencyKey,
    );
    res.json(data);
  });
  app.get("/api/export", (_req, res) =>
    res
      .set({
        "Content-Disposition": 'attachment; filename="dingdong-export.json"',
        "Cache-Control": "no-store",
      })
      .json({
        format: "dingdong-v1",
        exportedAt: new Date().toISOString(),
        ...core.snapshot(),
        runs: store.list("runs"),
        events: store.list("events"),
        memoryHistory: store.list("memory_history"),
        workflowHistory: store.list("workflow_history"),
      }),
  );
  app.get("/api/runs/:runId/artifacts/:artifactId", (req, res) => {
    const run = core.require<import("../shared/domain.ts").Run>(
      "runs",
      String(req.params.runId),
    );
    const artifact = run.artifacts.find((a) => a.id === req.params.artifactId);
    if (!artifact) throw new AppError(404, "파일이 없습니다.");
    res
      .set({
        "Content-Disposition": `attachment; filename="result.md"; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        "Cache-Control": "no-store",
      })
      .type("text/markdown")
      .send(artifact.content);
  });
  app.use(express.static(path.resolve("dist"), { index: false }));
  app.get("/{*path}", (req, res) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/.well-known/") ||
      req.path.startsWith("/oauth/")
    )
      return res.status(404).json({ error: "Not found" });
    return res.sendFile(path.resolve("dist/index.html"));
  });
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      const status =
        error instanceof AppError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : error.status === 413
              ? 413
              : 500;
      const message =
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : status < 500
            ? error.message
            : "서버에서 처리하지 못했습니다.";
      if (status === 500)
        console.error(error instanceof Error ? error.stack : "Internal error");
      res.status(status).json({ error: message, status });
    },
  );
  return { app, store, core, auth, runtime };
}
