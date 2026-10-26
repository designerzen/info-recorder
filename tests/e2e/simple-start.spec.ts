import { expect, test } from "@playwright/test";
import { mockRecorder } from "./helpers/recorderFixture";

test("settings remain reachable before recording and return keyboard focus", async ({ page }) => {
  await mockRecorder(page);
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await expect(page.getByRole("dialog", { name: "User settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await expect(page.locator("button:visible")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("an empty screen has no transcript tools or promotional copy", async ({ page }) => {
  await mockRecorder(page);
  await page.goto("/");
  await expect(page.locator("a:visible, .workspace-tabs, .playback-gadget, .transcript-download-menu, .activity-progress-panel")).toHaveCount(0);
  await expect(page.locator("h1:not(.sr-only):visible, h2:not(.sr-only):visible, .hero-copy, .hero-kicker, .empty-state")).toHaveCount(0);
});
