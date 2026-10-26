import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("native JASSUB renders ASS through its WASM worker without React", async ({ page }) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.evaluate(async () => {
    const { createJassubSubtitles } = await import("/src/subtitles/createJassubSubtitles.ts");
    const { appSettings } = await import("/src/config/settings.ts");
    const canvas = document.createElement("canvas");
    canvas.id = "subtitle-test";
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "800px", height: "400px", background: "white", zIndex: "9999" });
    document.body.append(canvas);
    const renderer = createJassubSubtitles("Native subtitles", appSettings.subtitles, error => {
      (window as any).subtitleError = String(error);
    });
    (window as any).subtitleRenderer = renderer;
    renderer.setCanvas(canvas);
  });
  const canvas = page.locator("#subtitle-test");
  await expect.poll(async () => {
    const error = await page.evaluate(() => (window as any).subtitleError);
    if (error || errors.length) throw new Error(JSON.stringify({ error, errors }));
    const stats = await sharp(await canvas.screenshot()).stats();
    return stats.channels.slice(0, 3).some(channel => channel.min < 200 && channel.stdev > 1);
  }, { timeout: 30000 }).toBe(true);
  const firstPhrase = await canvas.screenshot();
  const workerCount = page.workers().length;
  await page.evaluate(async () => {
    const { appSettings } = await import("/src/config/settings.ts");
    (window as any).subtitleRenderer.update("Another phrase in Readex Pro", { ...appSettings.subtitles, fontFamily: "Readex Pro" });
  });
  await expect.poll(async () => !(await canvas.screenshot()).equals(firstPhrase)).toBe(true);
  expect(page.workers().length).toBe(workerCount);
  expect(await page.evaluate(() => (window as any).subtitleError)).toBeUndefined();
  await page.evaluate(() => { (window as any).subtitleRenderer.dispose(); document.getElementById("subtitle-test")?.remove(); });
});
