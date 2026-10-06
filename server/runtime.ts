import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Operation } from "./core.ts";
import { AppError, Core } from "./core.ts";

export type Config = {
  port: number;
  base: string;
  dataDir: string;
  adminKey: string;
  internalKey: string;
  gatewayToken: string;
  gatewayPort: number;
  coreOnly: boolean;
};
export class Runtime {
  child?: ChildProcess;
  ready = false;
  version = "2026.9.7";
  lastError: string | null = null;
  onUnexpectedExit?: () => void;
  private stopping = false;
  constructor(
    public config: Config,
    private core: Core,
  ) {}
  async invoke(
    operation: Operation,
    input: unknown,
    actor: string,
    idempotencyKey?: string,
  ) {
    if (this.config.coreOnly)
      return this.core.dispatch(operation, input, actor, idempotencyKey);
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.config.gatewayPort}/tools/invoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.gatewayToken}`,
          },
          body: JSON.stringify({
            tool: "dingdong_tool",
            args: {
              operation,
              input,
              actor,
              ...(idempotencyKey ? { idempotencyKey } : {}),
            },
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const body: any = await response.json();
      if (!response.ok || !body.ok)
        throw new AppError(503, `OpenClaw 도구 호출 실패 (${response.status})`);
      const result =
        body.result?.details ||
        JSON.parse(
          body.result?.content?.find((c: any) => c.type === "text")?.text ||
            "{}",
        );
      if (result.error) throw new AppError(result.status || 400, result.error);
      if (!Object.hasOwn(result, "data"))
        throw new AppError(503, "OpenClaw 응답의 결과를 확인할 수 없습니다.");
      this.ready = true;
      return result.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        "OpenClaw에 연결하지 못했습니다. 실행 여부를 확인한 후 같은 요청 키로 다시 조회해주세요.",
      );
    }
  }
  start() {
    if (this.config.coreOnly) return;
    const stateDir = path.join(this.config.dataDir, "openclaw");
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const configPath = path.join(stateDir, "openclaw.json");
    const settings = {
      gateway: {
        mode: "local",
        port: this.config.gatewayPort,
        bind: "loopback",
        auth: { mode: "token" },
        controlUi: { enabled: false },
      },
      agents: {
        defaults: {
          workspace: path.join(stateDir, "workspace"),
          skipBootstrap: true,
          heartbeat: { every: "0m" },
        },
      },
      plugins: {
        allow: ["dingdong"],
        load: { paths: [path.resolve("plugins/openclaw")] },
        slots: { memory: "none" },
        entries: { dingdong: { enabled: true } },
      },
      tools: { allow: ["dingdong_tool"] },
      discovery: { mdns: { mode: "off" } },
    };
    writeFileSync(configPath, JSON.stringify(settings, null, 2), {
      mode: 0o600,
    });
    const env = {
      ...process.env,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_GATEWAY_TOKEN: this.config.gatewayToken,
      DINGDONG_INTERNAL_KEY: this.config.internalKey,
      DINGDONG_INTERNAL_URL: `http://127.0.0.1:${this.config.port}`,
      OPENCLAW_SKIP_CHANNELS: "1",
    };
    // Do not inherit unrelated messaging connections or model credentials into this dedicated host.
    for (const key of Object.keys(env))
      if (
        /^(TELEGRAM_|DISCORD_|SLACK_|WHATSAPP_|ANTHROPIC_|OPENAI_API_KEY|OPENROUTER_API_KEY)/.test(
          key,
        )
      )
        delete (env as any)[key];
    this.child = spawn(
      process.env.OPENCLAW_BIN || "openclaw",
      [
        "gateway",
        "run",
        "--port",
        String(this.config.gatewayPort),
        "--bind",
        "loopback",
        "--auth",
        "token",
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child.stdout?.on("data", (b) =>
      process.stdout.write(`[openclaw] ${b}`),
    );
    this.child.stderr?.on("data", (b) =>
      process.stderr.write(`[openclaw] ${b}`),
    );
    this.child.on("error", () => {
      this.ready = false;
      this.lastError =
        "OpenClaw를 실행할 수 없습니다. 2026.9.7 설치를 확인해주세요.";
    });
    this.child.on("exit", () => {
      this.ready = false;
      this.lastError = "OpenClaw 프로세스가 종료되었습니다.";
      if (!this.stopping) this.onUnexpectedExit?.();
    });
  }
  stop() {
    this.stopping = true;
    this.child?.kill("SIGTERM");
  }
  status() {
    return {
      mode: this.config.coreOnly ? "core-only-test" : "openclaw",
      ready: this.ready,
      version: this.version,
      error: this.lastError,
    };
  }
}
