import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:18766",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        ".venv/bin/python -m uvicorn fixture_server:app --app-dir tests --host 127.0.0.1 --port 18765",
      cwd: "..",
      url: "http://127.0.0.1:18765/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: ".venv/bin/labtasker-webui --host 127.0.0.1 --port 18766 --no-profile",
      cwd: "..",
      url: "http://127.0.0.1:18766/api/webui/status",
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
