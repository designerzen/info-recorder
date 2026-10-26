import { mockRecorder } from "./helpers/recorderFixture";
import { expect, test } from "@playwright/test";

const text = "A recorded phrase with enough detail to be condensed into a preview on the map. Clicking the bubble reveals this entire passage and plays its matching audio.";
const start = Date.parse("2026-10-22T12:00:00Z");
const words = text.split(" ").map((word, index) => ({ text: word + " ", startMs: 1000 + index * 80, endMs: 1080 + index * 80 }));

test("Map is hidden when a transcript has no locations", async ({ page }) => {
  await mockRecorder(page, { text: "A thought worth keeping." });
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveCount(0);
  await expect(page.locator(".phrase-map-tiles")).toHaveCount(0);
});

for (const viewport of [{ width: 1365, height: 1000 }, { width: 390, height: 844 }]) {
  test(`map selection reveals the full passage and honors playback choice at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `
        const noop = () => {};
        let recordedUrl;
        const fixture = {
          transcriptParagraphs: [{ id: 'p1', text: ${JSON.stringify(text)}, words: ${JSON.stringify(words)} }],
          paragraphs: [${JSON.stringify(text)}], partialText: '', audioParts: [{ name:'part-0', sequence:0,
            startIso:'2026-10-22T12:00:00Z', endIso:'2026-10-22T12:00:08Z', LAT:51.5, LONG:-0.12 }],
          recordingStartedAt:${start}, opfsChunkCount:1, sourceMedia:null,
          isTranscriptionSupported:true, runtimeSupport:{}, modelInventory:[],
          modelLoadMessage:'', modelLoadProgress:0, modelDownloadSpeedBps:0,
          isRecording:false, isPreparing:false, isTranscribingMedia:false, isModelLoading:false,
          getRecordingSourceMedia:async () => {
            recordedUrl ??= URL.createObjectURL(await (await fetch('/map-fixture.wav')).blob());
            return {url:recordedUrl,kind:'audio',fileName:'recording'};
          },
          setWaveformCanvas:noop, start:noop, stop:noop
        };
        fixture.update=noop; fixture.dispose=noop; fixture.subscribe=() => noop; export const createTranscriber = () => fixture;
      `
    }));
    await page.route("https://tile.openstreetmap.org/**", (route) => route.fulfill({
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    }));
    const wav = Buffer.alloc(44 + 16000 * 2 * 8);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
    await page.route("**/map-fixture.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
    await page.addInitScript(() => {
      const state = window as unknown as { played: Array<{ time: number; src: string }>; spoken: string[] };
      state.played = []; state.spoken = [];
      HTMLMediaElement.prototype.play = function () {
        state.played.push({ time: this.currentTime, src: this.src });
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        getVoices: () => [{ voiceURI: "test-voice", name: "Test Voice", lang: "en-GB" }],
        addEventListener() {}, removeEventListener() {}, cancel() {},
        speak(utterance: SpeechSynthesisUtterance) { state.spoken.push(utterance.text); }
      } });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class {
        text: string;
        constructor(value: string) { this.text = value; }
      } });
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "Map", exact: true }).click();
    const bubble = page.getByRole("button", { name: /^Phrase 1:/ });
    await expect(bubble).toBeVisible();
    await page.getByLabel("Transcript playback voice").selectOption("source:original");
    await bubble.click();
    await expect(page.getByRole("region", { name: "Selected phrase" })).toContainText("A recorded phrase");
    await expect.poll(() => page.evaluate(() => (window as unknown as { played: unknown[] }).played.length)).toBe(1);
    const plays = await page.evaluate(() => (window as unknown as { played: Array<{ time: number; src: string }> }).played);
    expect(plays).toEqual([{ time: 1, src: expect.stringMatching(/^blob:/) }]);
    await page.getByRole("button", { name: "Stop playback", exact: true }).last().click();
    await page.getByLabel("Transcript playback voice").selectOption("source:normalized");
    await bubble.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { played: unknown[] }).played.length)).toBe(2);
    await page.getByRole("button", { name: "Stop playback", exact: true }).last().click();
    await page.getByLabel("Transcript playback voice").selectOption("web:test-voice");
    await bubble.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken.length)).toBe(1);
    const spoken = await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken[0]);
    expect(spoken).toContain("A recorded phrase");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/map-${viewport.width}.png`, fullPage: true });
  });
}
