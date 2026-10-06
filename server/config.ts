import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secret } from "./auth.ts";
import type { Config } from "./runtime.ts";

export function configFromEnv(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const dataDir = path.resolve(process.env.DINGDONG_DATA_DIR || ".data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "credentials.json");
  let credentials: Record<string, string> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const keys = [
    "DINGDONG_ADMIN_KEY",
    "DINGDONG_INTERNAL_KEY",
    "OPENCLAW_GATEWAY_TOKEN",
  ];
  for (const key of keys) {
    credentials[key] = process.env[key] || credentials[key] || "";
    if (!credentials[key]) {
      if (process.env.NODE_ENV === "production")
        throw new Error(`Set ${key} before deployment.`);
      credentials[key] = secret();
    }
    if (credentials[key].length < 32)
      throw new Error(`${key} must be at least 32 characters.`);
  }
  if (process.env.NODE_ENV !== "production")
    writeFileSync(file, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  const port = Number(process.env.PORT || 5490);
  const base = (process.env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(
    /\/$/,
    "",
  );
  const u = new URL(base);
  if (u.pathname !== "/" || u.search || u.hash)
    throw new Error("PUBLIC_URL must be an origin.");
  if (process.env.NODE_ENV === "production" && u.protocol !== "https:")
    throw new Error("Production requires an HTTPS PUBLIC_URL.");
  return {
    port,
    base,
    dataDir,
    adminKey: credentials.DINGDONG_ADMIN_KEY,
    internalKey: credentials.DINGDONG_INTERNAL_KEY,
    gatewayToken: credentials.OPENCLAW_GATEWAY_TOKEN,
    gatewayPort: Number(process.env.OPENCLAW_PORT || 18797),
    coreOnly: process.env.DINGDONG_CORE_ONLY === "1",
  };
}
