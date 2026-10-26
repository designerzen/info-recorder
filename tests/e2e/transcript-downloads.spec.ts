import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const text = "First phrase. Second phrase.";
const words = [
  { text: "First ", startMs: 500, endMs: 1000 }, { text: "phrase.", startMs: 1000, endMs: 1500 },
  { text: "Second ", startMs: 2000, endMs: 2300 }, { text: "phrase.", startMs: 2300, endMs: 2800 }
];

async function fixture(page: Page) {
  await page.route("**/src/recorder/useTranscriber.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `const noop = () => {}; export const useTranscriber = () => ({
      transcriptParagraphs:[{id:'p1',text:${JSON.stringify(text)},words:${JSON.stringify(words)}}],
      paragraphs:[${JSON.stringify(text)}], partialText:'',audioParts:[],sourceMedia:{url:'/export-fixture.wav',kind:'audio',fileName:'example.wav'},
      opfsChunkCount:0,isRecording:false,isPreparing:false,isTranscribingMedia:false,isModelLoading:false,
      isTranscriptionSupported:true,runtimeSupport:{},modelInventory:[],setWaveformCanvas:noop,start:noop,stop:noop
    });`
  }));
  // Exercise real phrase concatenation/caption timing without downloading a voice model.
  await page.route("**/src/speech/supertonicTts.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `export async function synthesizeSupertonicSamples(text) {
      const sampleRate = 16000, length = text.startsWith('First') ? sampleRate : sampleRate * 2;
      return {sampleRate,samples:Array.from({length},(_,i)=>0.2*Math.sin(2*Math.PI*440*i/sampleRate))};
    }`
  }));
  const wav = Buffer.alloc(44 + 16000 * 2 * 3);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 16000 * 3; i++) wav.writeInt16LE(Math.round(5000 * Math.sin(2 * Math.PI * 440 * i / 16000)), 44 + i * 2);
  await page.route("**/export-fixture.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { configurable: true, value: {} }));
}

for (const width of [1365, 390]) {
  test(`downloads transcript text and presents audio options at ${width}px`, async ({ page }, testInfo) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Transcript downloads" });
    await expect(panel).toBeVisible();
    const downloading = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download text" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("transcript.txt");
    expect(await readFile((await download.path())!, "utf8")).toBe(text + "\n");
    await expect(panel.getByLabel("Audio source")).toHaveValue("original");
    await expect(panel.getByRole("button", { name: "Download audio", exact: true })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Download captioned video" })).toBeEnabled();
    await panel.getByLabel("Audio source").selectOption("F1");
    await panel.getByLabel("Audio format").selectOption("wav");
    await panel.getByLabel("Download speed").fill("1.5");
    await panel.getByLabel("Download pitch").fill("3");
    await expect(panel).toContainText("Speed · 1.5×");
    await expect(panel).toContainText("Pitch · +3 semitones");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`downloads-${width}.png`), fullPage: true });
  });
}

test("encodes original and TTS audio with timed MP4 captions", async ({ page }, testInfo) => {
  test.skip(!process.env.TEST_MEDIA_EXPORT, "Opt in to downloading and running the ffmpeg.wasm encoder with TEST_MEDIA_EXPORT=1.");
  test.setTimeout(180000);
  await fixture(page);
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Transcript downloads" });
  const failure = panel.getByRole("alert").waitFor({ state: "visible", timeout: 150000 }).then(async () => {
    throw new Error(await panel.getByRole("alert").innerText());
  });
  await panel.getByLabel("Download speed").fill("1.5");
  await panel.getByLabel("Download pitch").fill("12");
  await panel.getByLabel("Audio format").selectOption("wav");
  for (const source of ["original", "F1"]) {
    await panel.getByLabel("Audio source").selectOption(source);
    const audioReady = page.waitForEvent("download", { timeout: 120000 });
    await panel.getByRole("button", { name: "Download audio", exact: true }).click();
    const audio = await Promise.race([audioReady, failure]);
    await audio.saveAs(testInfo.outputPath(`${source}.wav`));
    const wav = await readFile((await audio.path())!);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    let dataAt = 0, dataSize = 0, sampleRate = 0;
    for (let at = 12; at + 8 <= wav.length;) {
      const size = wav.readUInt32LE(at + 4);
      if (wav.toString("ascii", at, at + 4) === "fmt ") sampleRate = wav.readUInt32LE(at + 12);
      if (wav.toString("ascii", at, at + 4) === "data") { dataAt = at + 8; dataSize = size; }
      at += size + 8 + size % 2;
    }
    expect(dataSize / 2 / sampleRate).toBeGreaterThan(1.9);
    expect(dataSize / 2 / sampleRate).toBeLessThan(2.1);
    // A 440 Hz fixture shifted by +12 semitones stays near 880 Hz at 1.5× speed.
    let crossings = 0;
    for (let i = Math.floor(sampleRate * 0.5); i < Math.floor(sampleRate * 1.5); i++) {
      if (wav.readInt16LE(dataAt + i * 2) <= 0 && wav.readInt16LE(dataAt + (i + 1) * 2) > 0) crossings++;
    }
    expect(crossings).toBeGreaterThan(870);
    expect(crossings).toBeLessThan(890);
    const videoReady = page.waitForEvent("download", { timeout: 120000 });
    await panel.getByRole("button", { name: "Download captioned video" }).click();
    const video = await Promise.race([videoReady, failure]);
    await video.saveAs(testInfo.outputPath(`${source}.mp4`));
    const bytes = await readFile((await video.path())!);
    // Inspect the actual exported subtitle track in the browser encoder.
    const inspected = await page.evaluate(async (input) => {
      // @ts-expect-error Vite serves browser modules at these URLs.
      const { runFfmpegJob } = await import("/src/recorder/audioExport.ts");
      // @ts-expect-error Vite serves browser modules at these URLs.
      const { getWavDurationMs } = await import("/src/transcript/transcriptExport.ts");
      return runFfmpegJob(async (ffmpeg: any) => {
        try {
          await ffmpeg.writeFile("verify.mp4", new Uint8Array(input));
          if (await ffmpeg.exec(["-y", "-i", "verify.mp4", "-map", "0:s:0", "verify.srt"]) !== 0) throw new Error("Missing subtitle track");
          if (await ffmpeg.exec(["-y", "-i", "verify.mp4", "-map", "0:a:0", "-c:a", "pcm_s16le", "verify.wav"]) !== 0) throw new Error("Missing audio track");
          return { captions: new TextDecoder().decode(await ffmpeg.readFile("verify.srt")), duration: getWavDurationMs(await ffmpeg.readFile("verify.wav")) };
        } finally {
          for (const name of ["verify.mp4", "verify.srt", "verify.wav"]) await ffmpeg.deleteFile(name).catch(() => {});
        }
      });
    }, [...bytes]);
    expect(inspected.duration).toBeGreaterThan(1900);
    expect(inspected.duration).toBeLessThan(2100);
    expect(inspected.captions).toContain("First phrase.");
    expect(inspected.captions).toContain("Second phrase.");
    expect(inspected.captions).toContain(source === "original" ? "00:00:00,333" : "00:00:00,000");
    expect(inspected.captions).toContain(source === "original" ? "00:00:01,333" : "00:00:00,667");
    await expect(panel.getByRole("alert")).toHaveCount(0);
  }
  const formats = await page.evaluate(async () => {
    // @ts-expect-error Vite serves browser modules at these URLs.
    const { exportTranscriptMedia } = await import("/src/transcript/transcriptExport.ts");
    const source = await (await fetch("/export-fixture.wav")).blob();
    const results = [];
    for (const format of ["mp3", "flac", "ogg-opus", "ogg-vorbis"]) {
      const result = await exportTranscriptMedia(source, { format, speed: 1, pitch: 0, captions: [] });
      const head = new TextDecoder().decode((await result.blob.arrayBuffer()).slice(0, 4));
      results.push({ format, head, size: result.blob.size });
    }
    return results;
  });
  expect(formats.every((result) => result.size > 100)).toBe(true);
  expect(formats.find((result) => result.format === "flac")?.head).toBe("fLaC");
  expect(formats.filter((result) => result.format.startsWith("ogg")).every((result) => result.head === "OggS")).toBe(true);
});
