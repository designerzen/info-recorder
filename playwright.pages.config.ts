import { defineConfig } from "@playwright/test";
import browserConfig from "./playwright.config";

export default defineConfig({
  ...browserConfig,
  testDir: "./tests/pages",
  webServer: undefined,
  fullyParallel: false
});
