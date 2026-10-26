import { mockRecorder } from "./helpers/recorderFixture";
import { expect, test } from "@playwright/test";
import { typefaceOptions } from "../../src/config/typefaces";
import { auditButtons } from "./helpers/buttonContract";

for (const width of [1280, 390]) {
  test(`every bundled typeface loads, applies and preserves accessible controls at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    const fontFailures: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      // A cached font can return 304 on reload; only HTTP errors are failures.
      if (/\.(ttf|woff2)(\?|$)/.test(response.url()) && response.status() >= 400) fontFailures.push(response.url());
    });
    await mockRecorder(page, { text: "A thought worth keeping." });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    const picker = page.getByLabel("Typeface", { exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator("optgroup")).toHaveCount(4);
    await expect(picker.locator("option")).toHaveCount(typefaceOptions.length);
    for (const font of typefaceOptions) {
      await picker.selectOption(font.value);
      // FontFaceSet.load returns actual loaded faces; check() alone can pass on fallback fonts.
      const faces = await page.evaluate(async (family) => {
        const normal = await document.fonts.load(`400 16px '${family}'`);
        const bold = await document.fonts.load(`700 16px '${family}'`);
        return [...normal, ...bold].map((face) => ({ family: face.family.replaceAll(/['"]/g, ""), status: face.status }));
      }, font.assFamily);
      expect(faces.length, font.label).toBeGreaterThanOrEqual(2);
      expect(faces.every((face) => face.family === font.assFamily && face.status === "loaded"), font.label).toBe(true);
      await expect(page.locator(".appearance-preview > p")).toHaveCSS("font-family", new RegExp(font.label));
      await expect(page.locator(".app-shell")).toHaveCSS("font-family", new RegExp(font.label));
      const descriptionId = await picker.getAttribute("aria-describedby");
      await expect(page.locator(`[id="${descriptionId}"]`)).toContainText(font.description);
      await auditButtons(page, page.getByRole("dialog", { name: "User settings" }), false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), font.label).toBe(true);
    }
    // The selected font is URL-persisted and survives a reload.
    await picker.selectOption("'Readex Pro', sans-serif");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await expect(page.getByLabel("Typeface", { exact: true })).toHaveValue("'Readex Pro', sans-serif");
    expect(fontFailures).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("typeface-picker.png") });
  });
}
