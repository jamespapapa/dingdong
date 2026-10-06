import { configFromEnv } from "../server/config.ts";
const config = configFromEnv();
console.log(
  `Dingdong ready. Owner credentials: ${config.dataDir}/credentials.json\nInstall OpenClaw 2026.9.7, then run npm run build && npm start.\nDashboard: ${config.base}\nMCP: ${config.base}/mcp\nCredentials remain local and are never printed.`,
);
