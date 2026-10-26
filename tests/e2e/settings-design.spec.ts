import { mockRecorder } from "./helpers/recorderFixture";
import { expect, test } from "@playwright/test";

test("settings keep actions visible and support keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockRecorder(page, { text: "A thought worth keeping." });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Settings", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "User settings" });
  const close = page.getByRole("button", { name: "Close settings" });
  const done = page.getByRole("button", { name: "Done", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(done).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.getByRole("tab", { name: "App", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tabpanel", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Appearance" })).toBeFocused();
  await expect(done).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("appearance-desktop.png") });
  await page.getByRole("tab", { name: "App", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("settings-desktop.png") });
  await dialog.getByRole("tabpanel").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(done).toBeInViewport();
  await expect(close).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const width of [320, 390]) {
  test(`settings fit a ${width}px screen in both tabs`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockRecorder(page, { text: "A thought worth keeping." });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of ["App", "Appearance"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "User settings" });
      await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
      const dimensions = await dialog.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        overflow: element.scrollWidth - element.clientWidth,
        bodyOverflow: element.querySelector(".settings-body")!.scrollWidth - element.querySelector(".settings-body")!.clientWidth
      }));
      expect(dimensions.width).toBeLessThanOrEqual(width);
      expect(dimensions.overflow).toBeLessThanOrEqual(1);
      expect(dimensions.bodyOverflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`${name.toLowerCase()}-${width}.png`) });
    }
  });
}
