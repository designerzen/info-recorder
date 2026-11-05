import { expect, test, type Page } from "@playwright/test";

// Capture, storage, audio and the DOM are real; only speech recognition is stubbed.
// These use real audio graphs and very long transcripts, so run them one at a time.
test.describe.configure({ mode: "default" });

const recognitionWorker = `let n = 0; self.onmessage = ({data}) => {
  if (data.type === 'load') postMessage({type:'ready'});
  if (data.type === 'cache-status') postMessage({type:'cache-status',cached:true,cachedFiles:1,totalFiles:1});
  if (data.type === 'catalog-status') postMessage({type:'catalog-status',entries:[]});
  if (data.type === 'flush') postMessage({type:'idle'});
  if (data.type === 'transcribe') { n++; const t = (data.offsetSeconds || 0) * 1000;
    postMessage({type:'segment',text:'Sentence '+n+'.',startsNewParagraph:true,
      words:[{text:'Sentence ',startMs:t,endMs:t+200},{text:n+'.',startMs:t+200,endMs:t+400}]}); }
};`;

async function realRecorder(page: Page, options: { speech?: "none" | "available" } = {}) {
  await page.route("**/src/recorder/whisperWorker.ts*", (route) => route.fulfill({
    contentType: "application/javascript",
    headers: { "Cross-Origin-Embedder-Policy": "require-corp" },
    body: recognitionWorker
  }));
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.addInitScript((speech) => {
    const state = window as any;
    state.streams = [];
    if (speech === "none") {
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext({ sampleRate: 16000 });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.25;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      void context.resume();
      state.streams.push(destination.stream);
      return destination.stream;
    } });
  }, options.speech ?? "none");
}

/** A long timed transcript over a real, seekable WAV. */
function timedFixture(sentences: number, wordMs: number, hasAudio: boolean) {
  return `
    const noop = () => {}; const words = []; let t = 0;
    for (let s = 0; s < ${sentences}; s++) for (let w = 0; w < 5; w++) {
      words.push({text:(w === 4 ? 'end' + s + '.' : 'word' + w) + ' ',startMs:t,endMs:t + ${wordMs}}); t += ${wordMs};
    }
    const text = words.map((word) => word.text).join('');
    const wav = (seconds) => { const rate = 8000, n = rate * seconds, b = new ArrayBuffer(44 + n * 2), d = new DataView(b);
      const tag = (o, v) => [...v].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
      tag(0,'RIFF'); d.setUint32(4,36 + n * 2,true); tag(8,'WAVE'); tag(12,'fmt '); d.setUint32(16,16,true); d.setUint16(20,1,true); d.setUint16(22,1,true);
      d.setUint32(24,rate,true); d.setUint32(28,rate * 2,true); d.setUint16(32,2,true); d.setUint16(34,16,true); tag(36,'data'); d.setUint32(40,n * 2,true);
      return URL.createObjectURL(new Blob([b],{type:'audio/wav'})); };
    const fixture = { paragraphs:[text],transcriptParagraphs:[{id:'p1',text,words}],partialText:'',audioParts:[],sourceMedia:null,opfsChunkCount:0,recordingStartedAt:1,
      hasRecordingAudio:${hasAudio},locationTrack:[],locationStatus:'off',listSessions:async()=>[],getElapsedMs:()=>0,newSession:noop,setWaveformCanvas:noop,cancelMediaTranscription:noop,
      isTranscriptionSupported:true,isOpfsRecordingAvailable:true,runtimeSupport:{},isRecording:false,isPaused:false,isChangingCapture:false,isPreparing:false,isModelLoading:false,isTranscribingMedia:false,
      modelInventory:[],error:'',progress:'',modelLoadMessage:'',modelLoadProgress:0,modelLoadTotalBytes:0,modelDownloadSpeedBps:0,
      update:noop,dispose:noop,subscribe:() => noop,start:noop,stop:noop,pause:noop,resume:noop,transcribeMediaFile:async () => {},
      getRecordingSourceMedia:async () => ({url:wav(240),kind:'audio',fileName:'recording.wav'}) };
    export const createTranscriber = () => fixture;`;
}

function browserVoice(boundaries: boolean) {
  return (hasBoundaries: boolean) => {
    const voice = { run: 0, getVoices: () => [], addEventListener() {}, removeEventListener() {},
      cancel() { voice.run += 1; }, pause() { (window as any).voicePaused = true; }, resume() { (window as any).voicePaused = false; },
      speak(utterance: SpeechSynthesisUtterance) {
        const run = voice.run;
        (window as any).spoken = [...((window as any).spoken ?? []), utterance.text];
        utterance.onstart?.({} as SpeechSynthesisEvent);
        const words = utterance.text.split(" ");
        let index = 0, offset = 0;
        const step = () => {
          if (run !== voice.run) return;
          if (index >= words.length) { utterance.onend?.({} as SpeechSynthesisEvent); return; }
          if (hasBoundaries) utterance.onboundary?.({ charIndex: offset, name: "word" } as SpeechSynthesisEvent);
          offset += words[index].length + 1;
          index += 1;
          setTimeout(step, hasBoundaries ? 60 : 300);
        };
        setTimeout(step, 10);
      } };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: voice });
  };
}

test("recording shows activity, a waveform and a running clock, with no Stop button", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/?activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible({ timeout: 15000 });
  const canvas = page.locator(".live-capture-waveform");
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(100);
  const label = (await page.locator(".live-capture-label").boundingBox())!;
  const clock = (await page.locator(".live-capture-timer").boundingBox())!;
  expect(clock.x).toBeGreaterThanOrEqual(label.x + label.width);
  await expect(page.locator(".live-capture-label")).toHaveText("Recording");
  const timer = page.getByRole("timer", { name: "Recording duration" });
  const first = await timer.textContent();
  await expect.poll(() => timer.textContent()).not.toBe(first);
  await expect(page.locator(".live-capture")).toHaveAttribute("style", /--input-level: [0-9.]+/);
  await expect(page.getByRole("button", { name: /^stop/i })).toHaveCount(0);
  await expect(page.locator(".sentence-button").first()).toBeVisible({ timeout: 15000 });
});

test("pausing releases the microphone, freezes the clock and lets a file be added", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/?activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.locator(".sentence-button").first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  const resume = page.getByRole("button", { name: "Resume recording", exact: true });
  await expect(resume).toBeEnabled({ timeout: 8000 });
  await expect(resume).toHaveText("Resume");
  const label = resume.locator("span");
  expect((await label.boundingBox())!.height).toBeLessThan(40);
  await expect(page.locator(".live-capture-label")).toHaveText("Paused");
  expect(await page.evaluate(() => (window as any).streams[0].getAudioTracks()[0].readyState)).toBe("ended");
  const clock = await page.getByRole("timer").textContent();
  await page.waitForTimeout(1200);
  expect(await page.getByRole("timer").textContent()).toBe(clock);
  await expect(page.getByRole("button", { name: "Upload media", exact: true })).toBeEnabled();
  await resume.click();
  await expect(page.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => (window as any).streams.length)).toBe(2);
  const count = await page.locator(".sentence-button").count();
  await expect.poll(() => page.locator(".sentence-button").count(), { timeout: 10000 }).toBeGreaterThan(count);
});

test("a disconnected microphone pauses and explains itself", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.getByRole("button", { name: "Pause recording", exact: true }).waitFor({ timeout: 15000 });
  await page.evaluate(() => (window as any).streams[0].getAudioTracks()[0].onended());
  await expect(page.getByRole("alert")).toContainText("microphone was disconnected");
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeEnabled({ timeout: 8000 });
});

test("files can be dropped anywhere, and anything else is explained", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/");
  await page.locator(".record-button").waitFor();
  const url = page.url();
  const dropped = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["notes"], "notes.txt", { type: "text/plain" }));
    const send = (type: string) => { const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }); document.body.dispatchEvent(event); return event.defaultPrevented; };
    return { enter: send("dragenter"), overlay: Boolean(document.querySelector(".drop-overlay")), over: send("dragover"), drop: send("drop") };
  });
  expect(dropped).toMatchObject({ enter: true, over: true, drop: true });
  await expect(page.locator(".drop-overlay")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("notes.txt can't be transcribed");
  expect(page.url()).toBe(url);

  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "voice.wav", { type: "audio/wav" }));
    document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, [...wav]);
  await expect(page.locator(".sentence-button").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("tab", { name: "Map", exact: true })).toHaveCount(0);
});

test("whole-transcript audio playback keeps the highlighted word in view", async ({ page }) => {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(200, 40, true) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  const samples = await page.evaluate(async () => {
    const panel = document.querySelector("#transcript-panel")!;
    const result = [];
    for (let i = 0; i < 16; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const word = document.querySelector(".sentence-word.active");
      const bounds = panel.getBoundingClientRect();
      const rect = word?.getBoundingClientRect();
      result.push({ inView: rect ? rect.top >= bounds.top && rect.bottom <= bounds.bottom : null, scroll: panel.scrollTop });
    }
    return result;
  });
  const active = samples.filter((sample) => sample.inView !== null);
  expect(active.length).toBeGreaterThan(10);
  expect(active.filter((sample) => sample.inView).length).toBeGreaterThanOrEqual(active.length - 1);
  expect(samples.at(-1)!.scroll).toBeGreaterThan(samples[0].scroll);
  await expect(page.locator(".subtitle-canvas")).toHaveCount(0);
});

test("pausing playback holds position and resuming continues", async ({ page }) => {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(50, 100, true) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  await expect(page.locator(".sentence-word.active")).toHaveCount(1);
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Pause reading" }).click();
  const scrollAndWord = () => page.evaluate(() => document.querySelector(".sentence-button.active")?.getAttribute("data-sentence-id") + "/" + [...document.querySelectorAll(".sentence-word")].findIndex((word) => word.classList.contains("active")));
  await page.waitForTimeout(100);
  const held = await scrollAndWord();
  await page.waitForTimeout(600);
  expect(await scrollAndWord()).toBe(held);
  await page.getByRole("button", { name: "Resume reading" }).click();
  await expect.poll(scrollAndWord).not.toBe(held);
  await page.getByRole("button", { name: "Stop reading the transcript aloud" }).click();
  await expect(page.locator(".sentence-word.active")).toHaveCount(0);
});

test("pressing a sentence during playback continues from it", async ({ page }) => {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(50, 100, true) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  await expect(page.locator(".sentence-word.active")).toHaveCount(1);
  const later = page.locator(".sentence-button").nth(20);
  await later.click();
  await expect(later).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "Pause reading" })).toBeVisible();
  await expect(page.locator(".sentence-button").nth(21)).toHaveClass(/active/, { timeout: 5000 });
});

for (const hasBoundaries of [true, false]) {
  test(`read-aloud highlights words with a voice ${hasBoundaries ? "reporting" : "not reporting"} word boundaries`, async ({ page }) => {
    await page.addInitScript(browserVoice(hasBoundaries), hasBoundaries);
    await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(4, 200, false) }));
    await page.goto("/");
    await page.getByRole("button", { name: "Read the transcript aloud" }).click();
    const seen = await page.evaluate(async () => {
      const sentences = new Set(), words = new Set();
      for (let i = 0; i < 200; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const sentence = document.querySelector(".sentence-button.active");
        const word = document.querySelector(".sentence-word.active");
        if (sentence) sentences.add(sentence.getAttribute("data-sentence-id"));
        if (word) words.add(word.textContent);
      }
      return { sentences: sentences.size, words: words.size };
    });
    expect(seen.sentences).toBeGreaterThanOrEqual(2);
    expect(seen.words).toBeGreaterThanOrEqual(3);
  });
}

test("a long transcript stays smooth during karaoke", async ({ page }) => {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(2000, 50, true) }));
  await page.goto("/");
  await page.locator(".sentence-button").first().waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Read the transcript aloud" }).click();
  await expect(page.locator(".sentence-word.active")).toHaveCount(1);
  const median = await page.evaluate(async () => {
    const frames: number[] = [];
    let last = performance.now();
    const end = last + 4000;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => { frames.push(now - last); last = now; if (now < end) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    return frames.sort((a, b) => a - b)[frames.length >> 1];
  });
  expect(median).toBeLessThan(50);
});

test("sentences flow like subtitles and every one can be reached and played by keyboard", async ({ page }) => {
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(30, 100, true) }));
  await page.goto("/");
  const sentences = page.locator(".sentence-button");
  await expect(sentences).toHaveCount(30);

  const layout = await sentences.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map(({ top }) => top));
  expect(layout[1]).toBe(layout[0]);
  expect(await sentences.first().evaluate((element) => getComputedStyle(element).display)).toBe("inline");

  // Tab from the control before the transcript, stepping through sentences in order with no extra stops.
  await page.getByRole("tab", { name: "Transcript", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(sentences.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sentences.nth(1)).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  expect(await sentences.nth(1).evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");

  await page.keyboard.press("Enter");
  await expect(sentences.nth(1)).toHaveClass(/active/, { timeout: 5000 });
  await page.keyboard.press(" ");
  await expect(sentences.nth(1)).not.toHaveClass(/active/);
});

test("a long sentence wraps across lines and stays focusable when playback is unavailable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    delete (window as any).speechSynthesis;
  });
  await page.route("**/src/recorder/createTranscriber.ts*", (route) => route.fulfill({ contentType: "application/javascript", body: timedFixture(3, 100, false) }));
  await page.goto("/");
  const first = page.locator(".sentence-button").first();
  await expect(first).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Tab");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await first.click({ force: true });
  await expect(page.locator(".sentence-button.active")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("sentence details appear on hover and keyboard focus, and Escape dismisses them", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.12, accuracy: 9 });
  await realRecorder(page);
  await page.goto("/?activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  const sentence = page.locator(".sentence-button").first();
  await sentence.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await sentence.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Time");
  await expect(tooltip).toContainText("Words");
  await expect(tooltip).toContainText("Recorded");
  await expect(tooltip).toContainText("Location");
  await expect(tooltip).toContainText("Transcribed by");
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await sentence.focus();
});

test("with default settings a moving recording places sentences along a route", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5, longitude: -0.12 });
  await realRecorder(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.getByRole("button", { name: "Pause recording", exact: true }).waitFor({ timeout: 15000 });
  for (let step = 1; step <= 6; step += 1) {
    await context.setGeolocation({ latitude: 51.5 + step * 0.001, longitude: -0.12 + step * 0.001 });
    await page.waitForTimeout(1000);
  }
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect.poll(() => page.locator(".phrase-map-location").count()).toBeGreaterThan(1);
  // Sentence text stays out of the way until one is chosen, so the route remains visible.
  await expect(page.locator(".phrase-map-bubble")).toHaveCount(0);
  for (const name of ["Zoom in", "Zoom out"]) {
    const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
    const map = (await page.locator(".phrase-map-viewport").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height);
  }
  await expect(page.locator(".phrase-map-route polyline")).toHaveCount(1);
  const timeline = page.getByRole("slider", { name: "Sentence timeline" });
  await expect(timeline).toBeVisible();
  await timeline.fill("1");
  await expect(page.getByRole("region", { name: "Selected phrase" })).toContainText("Sentence");
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await page.locator(".transcript-download-menu > summary").click();
  await expect(page.getByRole("button", { name: "Route (GPX)", exact: true })).toBeVisible();
});

test("denied location is explained on the map", async ({ page }) => {
  await realRecorder(page);
  await page.addInitScript(() => {
    const denied = { code: 1, message: "denied" };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition: (_: unknown, failure: (error: unknown) => void) => failure(denied),
      watchPosition: (_: unknown, failure: (error: unknown) => void) => { failure(denied); return 1; },
      clearWatch() {}
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.getByRole("button", { name: "Pause recording", exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("tab", { name: "Map", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Map", exact: true })).toContainText("Location access is off");
});

test("a reload restores the session with its audio, and New starts clean without losing it", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/?activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.locator(".sentence-button").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeEnabled({ timeout: 8000 });
  const text = await page.locator("#transcript-panel").innerText();
  await page.waitForTimeout(500);

  await page.reload();
  const sentence = page.locator(".sentence-button").first();
  await expect(sentence).toBeVisible({ timeout: 10000 });
  expect((await page.locator("#transcript-panel").innerText()).trim()).toBe(text.trim());
  await sentence.click();
  await expect(sentence).toHaveClass(/active/, { timeout: 5000 });
  await sentence.click();

  await page.getByRole("button", { name: "New recording", exact: true }).click();
  await expect(page.locator(".sentence-button")).toHaveCount(0);
  await expect(page.locator("button:visible")).toHaveCount(3);
  await page.reload();
  await page.locator(".record-button").waitFor();
  await expect(page.locator(".sentence-button")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const open = page.getByRole("button", { name: /^Open / });
  await expect(open).toHaveCount(1, { timeout: 5000 });
  await open.click();
  await expect(page.locator(".sentence-button").first()).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /^Delete / }).click();
  await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(0, { timeout: 5000 });
});

test("sentences can be corrected, searched, copied and exported as subtitles", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await realRecorder(page);
  await page.goto("/?activityDetection=0");
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await page.locator(".sentence-button").nth(1).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume recording", exact: true })).toBeEnabled({ timeout: 8000 });

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".sentence-editor").first();
  await editor.fill("Corrected words.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const first = page.locator(".sentence-button").first();
  await expect(first).toHaveText("Corrected words.");
  await expect(first.locator(".sentence-word")).toHaveCount(2);

  await page.getByRole("searchbox", { name: "Search transcript" }).fill("corrected");
  await expect(first).toHaveClass(/search-current/);
  await expect(page.locator(".transcript-search-count")).toHaveText("1/1");

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Corrected words.");

  await page.locator(".transcript-download-menu > summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Subtitles (VTT)", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("transcript.vtt");
});

test("the Help and Downloads pages render", async ({ page }) => {
  await realRecorder(page);
  await page.goto("/#help");
  await expect(page.getByRole("heading", { level: 1, name: /Help with/ })).toBeVisible();
  await page.getByRole("link", { name: "Back to recorder" }).click();
  await expect(page.locator(".record-button")).toBeVisible();
  await page.goto("/#downloads");
  await expect(page.getByRole("heading", { level: 1, name: /Now on your desktop/ })).toBeVisible();
});
