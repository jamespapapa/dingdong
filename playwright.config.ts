import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:5492",
    trace: "retain-on-failure",
    launchOptions: { channel: "chrome" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:5492/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "5492",
      PUBLIC_URL: "http://127.0.0.1:5492",
      DINGDONG_DATA_DIR: `test-results/data-${Date.now()}`,
      DINGDONG_ADMIN_KEY: "synthetic-e2e-owner-key-at-least-32-characters",
      DINGDONG_INTERNAL_KEY:
        "synthetic-e2e-internal-key-at-least-32-characters",
      OPENCLAW_GATEWAY_TOKEN:
        "synthetic-e2e-gateway-key-at-least-32-characters",
      DINGDONG_CORE_ONLY: "1",
    },
  },
});
