import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockRecorder } from "./helpers/recorderFixture";
import { assertButton } from "./helpers/buttonContract";

for (const width of [1280, 390]) {
  test("round Record/Pause and plain transcript at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockRecorder(page);
    await page.goto("/");
    const record = page.getByRole("button", { name: "Start recording", exact: true });
    await expect(page.locator("button:visible")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(record).toHaveCSS("border-radius", "50%");
    const rect = (await record.boundingBox())!;
    expect(rect.width).toBeCloseTo(rect.height, 1);
    await assertButton(record, "rest");
    await page.screenshot({ path: test.info().outputPath("start.png") });
    await record.click();
    const pause = page.getByRole("button", { name: "Pause recording", exact: true });
    await page.evaluate(() => dispatchEvent(new Event("fixture:transcript")));
    const transcript = page.getByRole("tabpanel", { name: "Transcript", exact: true });
    await expect(transcript).toHaveText("A thought worth keeping.");
    // The transcript fills the page, and the dock stays under it.
    const control = (await pause.boundingBox())!;
    const text = (await transcript.boundingBox())!;
    expect(control.y).toBeGreaterThanOrEqual(text.y + text.height);
    expect(text.height).toBeGreaterThan(450);
    await expect(transcript.locator(".sentence-button")).toHaveCount(1);
    await pause.click();
    await page.getByRole("button", { name: "Resume recording", exact: true }).click();
    await expect(pause).toBeVisible();
    await expect(transcript).toHaveText("A thought worth keeping.");
    await pause.click();
    await page.locator(".transcript-download-menu > summary").click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download text", exact: true }).click();
    expect(await readFile((await (await downloading).path())!, "utf8")).toBe("A thought worth keeping.\n");
    await expect(page.getByRole("tab", { name: "Map", exact: true })).toBeVisible();
    // Pausing ends capture, so a file can be added without any separate Stop.
    await expect(page.getByRole("button", { name: "Upload media", exact: true })).toBeEnabled();
    for (const selector of [".phrase-map", ".activity-progress-panel"]) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
    expect(control.y + control.height).toBeGreaterThanOrEqual(840);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("transcript.png") });
  });
}
