import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { mockRecorder } from "./helpers/recorderFixture";

const TEXT = "A thought worth keeping. Call me back at five.";

/** Stands in for the Woof engine: records what it is asked for and returns half a second of silence. */
async function fakeWoof(page: Page) {
  await page.route("**/src/speech/woofTts.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.woofCalls = [];
      export const isWoofSupported = () => true;
      export function encodeWav(samples, rate) {
        const b = new ArrayBuffer(44 + samples.length * 2), d = new DataView(b);
        const tag = (o, v) => [...v].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
        tag(0,'RIFF'); d.setUint32(4,36 + samples.length * 2,true); tag(8,'WAVE'); tag(12,'fmt '); d.setUint32(16,16,true); d.setUint16(20,1,true); d.setUint16(22,1,true);
        d.setUint32(24,rate,true); d.setUint32(28,rate * 2,true); d.setUint16(32,2,true); d.setUint16(34,16,true); tag(36,'data'); d.setUint32(40,samples.length * 2,true);
        return b;
      }
      export async function synthesizeWoofSamples(text, voice, options = {}) {
        window.woofCalls.push({ text, voice });
        options.onStatus?.('Downloading the Woof voice, 50% of 41 MB…');
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { samples: new Float32Array(12000), sampleRate: 24000 };
      }
      export async function synthesizeWoofSpeech(text, voice, options) {
        const { samples, sampleRate } = await synthesizeWoofSamples(text, voice, options);
        return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
      }
      export function prefetchWoofSpeech(text, voice) { window.woofCalls.push({ text, voice, prefetch: true }); }
    `
  }));
}

const groupLabels = (page: Page, select: string) => page.locator(select).evaluate((element) =>
  [...element.querySelectorAll("optgroup")].map((group) => group.label));

test("Underdog Woof is offered above the heavier Supertonic model, with its credit", async ({ page }) => {
  await mockRecorder(page, { text: TEXT });
  await page.goto("/");
  await page.locator(".transcript-download-menu > summary").click();
  const voice = page.getByRole("combobox", { name: "Transcript playback voice" });
  const groups = await groupLabels(page, ".playback-select");
  const woof = groups.findIndex((label) => label.startsWith("Underdog Woof"));
  const supertonic = groups.findIndex((label) => label.startsWith("Supertonic"));
  expect(woof).toBeGreaterThan(-1);
  expect(woof).toBeLessThan(supertonic);
  expect(woof).toBeLessThan(groups.indexOf("Built-in TTS Voices"));
  expect(groups[woof]).toContain("41 MB");
  expect(groups[supertonic]).toContain("398 MB");

  const credit = page.locator(".more-playback .voice-credit");
  await expect(credit).toBeHidden();
  await voice.selectOption("woof:juno");
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText("Voice by Underdog Woof");
  await expect(credit).toHaveAttribute("href", "https://underdog.ai/woof");

  // Audio export lists Woof first and does not need WebGPU for it.
  await page.locator(".more-media > summary").click();
  const sources = await groupLabels(page, ".download-source select");
  expect(sources[0]).toContain("Underdog Woof");
  await page.locator(".download-source select").selectOption("woof:mira");
  await expect(page.locator(".download-credit a")).toHaveText("Voice by Underdog Woof");

  // The settings engine list puts Woof before Supertonic and credits it when chosen.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const engine = page.getByRole("combobox", { name: "Voice engine" });
  const engines = await engine.evaluate((element) => [...(element as HTMLSelectElement).options].map((option) => option.value));
  expect(engines.indexOf("woof")).toBeLessThan(engines.indexOf("supertonic-web"));
  await expect(page.locator(".settings-hint .voice-credit")).toHaveText("Voice by Underdog Woof");
  await expect(page.getByRole("combobox", { name: "Voice", exact: true })).toHaveValue("juno");
});

test("a Woof voice reads a sentence, showing its progress and credit while it plays", async ({ page }) => {
  await mockRecorder(page, { text: TEXT });
  await fakeWoof(page);
  await page.goto("/");
  await page.locator(".transcript-download-menu > summary").click();
  await page.getByRole("combobox", { name: "Transcript playback voice" }).selectOption("woof:mira");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  const status = page.locator(".voice-status");
  await expect(status).toContainText("Downloading the Woof voice");
  await expect(status.locator(".voice-credit")).toHaveAttribute("href", "https://underdog.ai/woof");
  await expect(status).toContainText("Mira (Underdog Woof)", { timeout: 5000 });
  const calls = await page.evaluate(() => (window as any).woofCalls as Array<{ text: string; voice: string; prefetch?: boolean }>);
  expect(calls[0]).toEqual({ text: TEXT, voice: "mira" });
  await page.getByRole("button", { name: "Stop reading the transcript aloud" }).click();
  await expect(status).toHaveCount(0);
});

// The real model, end to end in the browser: set WOOF_FILES to a folder holding woof_int8.npz and respell.tsv.
test("the real Woof model speaks in the browser", async ({ page }) => {
  const files = process.env.WOOF_FILES;
  test.skip(!files, "Set WOOF_FILES to run the Woof model itself.");
  test.setTimeout(120_000);
  await page.route("https://huggingface.co/ConwayResearch/Underdog-Woof/**", (route) => {
    const name = route.request().url().endsWith(".npz") ? "woof_int8.npz" : "respell.tsv";
    return route.fulfill({ body: readFileSync(join(files!, name)), headers: { "access-control-allow-origin": "*" } });
  });
  await mockRecorder(page, { text: "Your order ships on March 3rd." });
  await page.goto("/");
  await page.locator(".transcript-download-menu > summary").click();
  await page.getByRole("combobox", { name: "Transcript playback voice" }).selectOption("woof:juno");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as any).woofAudio = { src: this.src, duration: this.duration };
      this.addEventListener("loadedmetadata", () => { (window as any).woofAudio.duration = this.duration; }, { once: true });
      return play.call(this);
    };
  });
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  await expect(page.locator(".voice-status")).toContainText("Speaking sentence with Juno (Underdog Woof)", { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => (window as any).woofAudio?.duration ?? 0)).toBeGreaterThan(1);
});
