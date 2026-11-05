import { expect, test } from "@playwright/test";
import { mockRecorder } from "./helpers/recorderFixture";

for (const width of [1280, 390]) {
  test(`views remain available throughout recording at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockRecorder(page);
    await page.goto("/");
    const upload = page.getByRole("button", { name: "Upload media", exact: true });
    const record = page.getByRole("button", { name: "Start recording", exact: true });
    expect((await upload.boundingBox())!.height).toBeLessThan((await record.boundingBox())!.height);
    await record.click();
    const map = page.getByRole("tab", { name: "Map", exact: true });
    const transcript = page.getByRole("tab", { name: "Transcript", exact: true });
    await map.click();
    await expect(page.getByRole("tabpanel", { name: "Map", exact: true })).toBeVisible();
    await expect(page.getByText("No recorded locations yet.")).toBeVisible();
    await map.press("Home");
    await expect(transcript).toBeFocused();
    await page.evaluate(() => dispatchEvent(new Event("fixture:transcript")));
    const panel = page.getByRole("tabpanel", { name: "Transcript", exact: true });
    await expect(panel.getByRole("button", { name: "A thought worth keeping." })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Download text", exact: true })).toBeVisible();
    await map.click();
    await transcript.click();
    await expect(panel).toContainText("A thought worth keeping.");
    await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("the small upload button opens the media picker and transcribes the selected file", async ({ page }) => {
  await mockRecorder(page);
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload media", exact: true }).click();
  await (await chooser).setFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: Buffer.from("fixture") });
  await expect(page.getByRole("tabpanel", { name: "Transcript", exact: true })).toContainText("Imported audio.");
  // Uploads have no location, so there is no map to offer.
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveCount(0);
});

test("clicking a live sentence plays seekable captured audio without OPFS or TTS", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Only recognition is stubbed. Capture, worklet, WAV snapshot, seeking and
  // media playback all use the browser's real implementations.
  await page.route("**/src/recorder/whisperWorker.ts*", route => route.fulfill({
    contentType: "application/javascript",
    headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
    body: `let chunks = 0; self.onmessage = ({data}) => {
      if (data.type === 'load') postMessage({type:'ready'});
      if (data.type === 'cache-status') postMessage({type:'cache-status',cached:true,cachedFiles:1,totalFiles:1});
      if (data.type === 'catalog-status') postMessage({type:'catalog-status',entries:[]});
      if (data.type === 'flush') postMessage({type:'idle'});
      if (data.type === 'transcribe' && ++chunks === 4) postMessage({type:'segment',text:'Recorded sentence.',startsNewParagraph:true,
        words:[{text:'Recorded ',startMs:250,endMs:750},{text:'sentence.',startMs:750,endMs:1250}]});
    };`
  }));
  await page.addInitScript(() => {
    const state = window as any;
    state.recordedPlays = [];
    // No processLocally support here, so Moonshine is the default engine.
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () {
      await play.call(this);
      state.recordedPlays.push({ src: this.src, time: this.currentTime, duration: this.duration });
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext({ sampleRate: 16000 });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.25;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      void context.resume();
      return destination.stream;
    } });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {},
      speak() { throw new Error("Sentence playback must use the recording."); }
    } });
  });
  await page.goto("/?recordOpfs=0&activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  const sentence = page.getByRole("button", { name: "Recorded sentence.", exact: true });
  await expect(sentence).toBeEnabled({ timeout: 10000 });
  await sentence.click();
  await expect.poll(() => page.evaluate(() => (window as any).recordedPlays.length)).toBe(1);
  const audio = await page.evaluate(async () => {
    const played = (window as any).recordedPlays[0];
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await (await fetch(played.src)).arrayBuffer());
    const amplitude = Math.max(...buffer.getChannelData(0).subarray(0, 16000));
    await context.close();
    return { ...played, amplitude };
  });
  expect(audio.src).toMatch(/^blob:/);
  expect(audio.time).toBeGreaterThanOrEqual(0.25);
  expect(Number.isFinite(audio.duration)).toBe(true);
  expect(audio.duration).toBeGreaterThanOrEqual(1.25);
  expect(audio.amplitude).toBeGreaterThan(0.2);
  await sentence.click();
  await expect(sentence).not.toHaveClass(/active/);
  expect(await page.evaluate(() => (window as any).recordedPlays.length)).toBe(1);
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [status, engine] of [["available", "Speech"], ["downloadable", "Speech"], ["unavailable", "Moonshine"]] as const) {
  test(`processLocally reporting ${status} makes ${engine} the live engine`, async ({ page }) => {
    await page.route("**/src/recorder/whisperWorker.ts*", route => route.fulfill({
      contentType: "application/javascript",
      headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
      body: `let sent = false; self.onmessage = ({data}) => {
        if (data.type === 'load') postMessage({type:'ready'});
        if (data.type === 'cache-status') postMessage({type:'cache-status',cached:true,cachedFiles:1,totalFiles:1});
        if (data.type === 'catalog-status') postMessage({type:'catalog-status',entries:[]});
        if (data.type === 'flush') postMessage({type:'idle'});
        if (data.type === 'transcribe' && !sent) { sent = true; postMessage({type:'segment',text:'From Moonshine.',startsNewParagraph:true,
          words:[{text:'From ',startMs:0,endMs:200},{text:'Moonshine.',startMs:200,endMs:400}]}); }
      };`
    }));
    await page.addInitScript((availability) => {
      const state = window as any;
      state.availableOptions = [];
      state.installOptions = [];
      let current = availability;
      class Recognition {
        processLocally = false; lang = ""; continuous = false; interimResults = false;
        onstart: any; onend: any; onresult: any; onerror: any;
        static async available(options: unknown) { state.availableOptions.push(options); return current; }
        static async install(options: unknown) { state.installOptions.push(options); current = "available"; return true; }
        start() {
          state.recognition = this;
          setTimeout(() => {
            this.onstart?.();
            setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "From" } }] }), 1000);
            setTimeout(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "From speech. Second one." } }] }), 2500);
          });
        }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      }
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
      state.recordedPlays = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { state.recordedPlays += 1; return play.call(this); };
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
        const context = new AudioContext({ sampleRate: 16000 });
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        void context.resume();
        return destination.stream;
      } });
    }, status);
    await page.goto("/?recordOpfs=0&activityDetection=0");
    await page.getByRole("button", { name: "Start recording", exact: true }).click();
    if (engine === "Moonshine") {
      await expect(page.getByRole("button", { name: "From Moonshine.", exact: true })).toBeVisible({ timeout: 10000 });
      expect(await page.evaluate(() => (window as any).recognition)).toBeUndefined();
      return;
    }
    const first = page.getByRole("button", { name: "From speech.", exact: true });
    await expect(first).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Second one.", exact: true })).toBeVisible();
    await expect(first.locator(".sentence-word")).toHaveCount(2);
    const state = await page.evaluate(() => { const { availableOptions, installOptions, recognition } = window as any; return { available: availableOptions[0], installs: installOptions.length, processLocally: recognition.processLocally }; });
    expect(state).toEqual({ available: { langs: ["en-US"], processLocally: true }, installs: status === "downloadable" ? 1 : 0, processLocally: true });
    await first.click();
    await expect.poll(() => page.evaluate(() => (window as any).recordedPlays)).toBe(1);
  });
}

test("a browser with SpeechRecognition but no processLocally uses Moonshine and never starts recognition", async ({ page }) => {
  await page.route("**/src/recorder/whisperWorker.ts*", route => route.fulfill({
    contentType: "application/javascript",
    headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
    body: `let sent = false; self.onmessage = ({data}) => {
      if (data.type === 'load') postMessage({type:'ready'});
      if (data.type === 'cache-status') postMessage({type:'cache-status',cached:true,cachedFiles:1,totalFiles:1});
      if (data.type === 'catalog-status') postMessage({type:'catalog-status',entries:[]});
      if (data.type === 'flush') postMessage({type:'idle'});
      if (data.type === 'transcribe' && !sent) { sent = true; postMessage({type:'segment',text:'From Moonshine.',startsNewParagraph:true,
        words:[{text:'From ',startMs:0,endMs:200},{text:'Moonshine.',startMs:200,endMs:400}]}); }
    };`
  }));
  await page.addInitScript(() => {
    const state = window as any;
    state.remoteStarts = 0;
    // The API exists, as in browsers that only offer remote recognition.
    class Remote { start() { state.remoteStarts += 1; } stop() {} abort() {} }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Remote });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: Remote });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext({ sampleRate: 16000 });
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      void context.resume();
      return destination.stream;
    } });
  });
  await page.goto("/?recordOpfs=0&activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "From Moonshine.", exact: true })).toBeVisible({ timeout: 10000 });
  expect(await page.evaluate(() => (window as any).remoteStarts)).toBe(0);
});
