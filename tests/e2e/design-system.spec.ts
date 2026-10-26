import { mockRecorder } from "./helpers/recorderFixture";
import { expect, test, type Page } from "@playwright/test";
import { defaultPageStyle, encodePageStyle, pageStylePresets } from "../../src/config/pageStyle";
import { auditButtons, assertButton, readButton } from "./helpers/buttonContract";

const themes = pageStylePresets.map((preset) => ({ name: preset.label, settings: preset.settings }));
themes.push({ name: "Adversarial custom colours", settings: {
  ...defaultPageStyle, preset: "custom", backgroundColor: "#777777", surfaceColor: "#777777",
  textColor: "#777777", buttonColor: "#777777", buttonTextColor: "#777777",
  accentColor: "#ffff00", borderColor: "#777777", focusColor: "#777777", focusWidth: "1px"
} });

async function openTheme(page: Page, settings = defaultPageStyle) {
  await page.goto(`/?pageStyle=${encodePageStyle(settings)}`);
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1280, 390]) {
  for (const { name, settings } of themes) {
    test(`${name}: every home, settings and appearance button at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 1000 });
      // Motion is tested separately. Real hover, pointer-down and keyboard focus
      // still occur; this keeps the full theme/state matrix deterministic.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mockRecorder(page, { text: "A thought worth keeping." });
      await openTheme(page, settings);
      if (["Light Mode", "Dark Mode"].includes(name)) {
        await page.screenshot({ path: test.info().outputPath("studio.png"), fullPage: true });
      }
      await auditButtons(page, page.locator(".app-shell"));
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "User settings" });
      await auditButtons(page, dialog);
      await page.getByRole("tab", { name: "Appearance", exact: true }).click();
      await dialog.locator(".appearance-preset-tools > summary").click();
      await auditButtons(page, dialog);
      if (["Light Mode", "Dark Mode"].includes(name)) {
        await page.screenshot({ path: test.info().outputPath("appearance.png") });
      }
      // Preset selection must not alter the requested seed silently.
      expect(await page.locator("style[data-page-style]").textContent()).toContain("--ds-brand-source: oklch(");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

async function transcriptFixture(page: Page, recording = false) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [{ voiceURI: "design-test", name: "Design test voice", lang: "en-GB" }],
      addEventListener() {}, removeEventListener() {}, cancel() {}, speak() {}
    } });
  });
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `const noop = () => {};
      export const createTranscriber = () => ({ update:noop, dispose:noop, subscribe:() => noop,
        transcriptParagraphs: [{id:'p1', text:'A thought worth keeping.', words:[
          {text:'A ',startMs:1000,endMs:1200},{text:'thought ',startMs:1200,endMs:1400},
          {text:'worth ',startMs:1400,endMs:1600},{text:'keeping.',startMs:1600,endMs:1800}
        ]}],
        paragraphs:['A thought worth keeping.'], partialText:'',
        audioParts:[{name:'part-0',sequence:0,startIso:'2026-10-22T12:00:00Z',endIso:'2026-10-22T12:00:08Z',LAT:51.5,LONG:-0.12}],
        recordingStartedAt:${Date.parse("2026-10-22T12:00:00Z")}, opfsChunkCount:0,sourceMedia:null,
        isTranscriptionSupported:true,runtimeSupport:{},modelInventory:[],
        modelLoadMessage:'',modelLoadProgress:0,modelDownloadSpeedBps:0,
        isRecording:${recording},isPreparing:false,isTranscribingMedia:false,isModelLoading:false,
        sourceActivityRms:0.01,setWaveformCanvas:noop,start:noop,stop:noop
      });`
  }));
  await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
    contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" },
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  }));
}

for (const width of [1280, 390]) {
  for (const name of ["light-mode", "dark-mode", "neon-nights"]) {
    test(`transcript, playback and map buttons: ${name} at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await transcriptFixture(page);
      await openTheme(page, pageStylePresets.find((preset) => preset.value === name)!.settings);
      await expect(page.locator(".sentence-button")).toBeVisible();
      await auditButtons(page, page.locator(".app-shell"));
      await page.getByLabel("Transcript playback voice").selectOption("web:design-test");
      await page.getByRole("tab", { name: "Map", exact: true }).click();
      await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toBeVisible();
      await auditButtons(page, page.locator(".app-shell"));
      // Open the actual phrase detail to expose the close/play controls too.
      await page.getByRole("button", { name: /^Phrase 1:/ }).click();
      await auditButtons(page, page.getByRole("region", { name: "Selected phrase" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test("recording and disabled controls preserve the button contract", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await transcriptFixture(page, true);
  await openTheme(page);
  await expect(page.getByRole("button", { name: "Upload media", exact: true })).toHaveCount(0);
  await auditButtons(page, page.locator(".app-shell"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await auditButtons(page, page.getByRole("dialog"));
});

test("reduced motion and Windows forced colours retain usable buttons", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTheme(page);
  for (const button of await page.locator("button:visible").all()) {
    expect(await button.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
    await assertButton(button, "rest");
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const record = page.getByRole("button", { name: "Start recording", exact: true });
  await page.keyboard.press("Tab");
  await record.focus();
  expect(await record.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe("auto");
  expect(await record.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  expect(await record.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(3);
});

test("buttons reflow at 200% text size and a 320 CSS pixel viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRecorder(page, { text: "A thought worth keeping." });
  await openTheme(page);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await auditButtons(page, page.locator(".app-shell"), false);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await auditButtons(page, page.getByRole("dialog"), false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("measured primary ink remains AAA without native CSS contrast functions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const value of ["light-mode", "dark-mode", "neon-nights"]) {
    await openTheme(page, pageStylePresets.find((preset) => preset.value === value)!.settings);
    const record = page.getByRole("button", { name: "Start recording", exact: true });
    const native = await readButton(record);
    await page.addStyleTag({ content: ":root:root .app-shell .record-button { color: var(--ds-button-ink) !important; }" });
    await assertButton(record, "fallback");
    expect((await readButton(record)).iconContrast).toBeCloseTo(native.iconContrast, 2);
    await record.hover();
    await assertButton(record, "fallback hover");
    await page.mouse.down();
    await assertButton(record, "fallback pressed");
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
});
