import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";

// Keep CI on Playwright's browser. Local Windows installs can use Chrome when
// browser downloads are unavailable; never require a temporary test config.
const chromeInstalled = process.platform === "win32" && [
  process.env.PROGRAMFILES,
  process.env["PROGRAMFILES(X86)"],
  process.env.LOCALAPPDATA
].some((root) => root && existsSync(join(root, "Google", "Chrome", "Application", "chrome.exe")));
const managedChromiumInstalled = existsSync(chromium.executablePath());
const browserChannel = managedChromiumInstalled
  ? "chromium"
  : !process.env.CI && chromeInstalled ? "chrome" : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "node_modules\\.bin\\vite.cmd --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: browserChannel === "chrome" ? "chrome" : "chromium",
      use: { ...devices["Desktop Chrome"], channel: browserChannel }
    }
  ]
});
