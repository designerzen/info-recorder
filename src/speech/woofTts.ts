import { appSettings, type WoofVoiceId } from "../config/settings";
import type { WoofRequest, WoofResponse } from "./woof/woofWorker";

type Job = { text: string; voice: WoofVoiceId; signal?: AbortSignal; resolve: (value: Samples) => void; reject: (error: unknown) => void };
type Samples = { samples: Float32Array; sampleRate: number };

let worker: Worker | null = null;
let nextId = 1;
let running: { id: number; job: Job } | null = null;
const queue: Job[] = [];
const statusListeners = new Set<(message: string) => void>();
// The next sentence is made while the current one plays, so it is ready when asked for.
const prefetched = new Map<string, Promise<Samples>>();

export const isWoofSupported = () => typeof Worker !== "undefined" && typeof WebAssembly === "object";

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./woof/woofWorker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<WoofResponse>) => {
    const message = event.data;
    if (message.type === "download") {
      const percent = message.total ? Math.round((message.loaded / message.total) * 100) : 0;
      const status = message.total ? `Downloading the Woof voice, ${percent}% of ${Math.round(message.total / 1e6)} MB…` : "Downloading the Woof voice…";
      for (const listener of statusListeners) listener(status);
      return;
    }
    if (!running || message.id !== running.id) return;
    const { job } = running;
    running = null;
    if (message.type === "done") job.resolve({ samples: message.samples, sampleRate: message.sampleRate });
    else job.reject(new Error(message.message));
    runNext();
  });
  worker.addEventListener("error", (event) => {
    const job = running?.job;
    running = null;
    worker?.terminate();
    worker = null;
    job?.reject(new Error(event.message || "The Woof voice could not start in this browser."));
    runNext();
  });
  return worker;
}

/** One request at a time, so a cancelled request that has not started yet costs nothing. */
function runNext() {
  if (running) return;
  let job = queue.shift();
  while (job?.signal?.aborted) {
    job.reject(new DOMException("Speech was cancelled.", "AbortError"));
    job = queue.shift();
  }
  if (!job) return;
  const id = nextId++;
  running = { id, job };
  const { woof } = appSettings.tts;
  const request: WoofRequest = { type: "synthesize", id, text: job.text, voice: job.voice, weightsUrl: woof.weightsUrl, lexiconUrl: woof.lexiconUrl, cacheName: woof.cacheName };
  getWorker().postMessage(request);
}

function request(text: string, voice: WoofVoiceId, signal?: AbortSignal) {
  return new Promise<Samples>((resolve, reject) => {
    queue.push({ text, voice, signal, resolve, reject });
    runNext();
  });
}

/** 24 kHz mono samples for `text`. `onStatus` hears download progress the first time the voice is used. */
export async function synthesizeWoofSamples(text: string, voice: WoofVoiceId, options: { signal?: AbortSignal; onStatus?: (message: string) => void } = {}) {
  const value = text.trim();
  if (!value) throw new Error("No text was provided for the Woof voice.");
  const key = `${voice}\u0000${value}`;
  const ready = prefetched.get(key);
  if (ready) {
    prefetched.delete(key);
    return ready;
  }
  if (options.onStatus) statusListeners.add(options.onStatus);
  try {
    return await request(value, voice, options.signal);
  } finally {
    if (options.onStatus) statusListeners.delete(options.onStatus);
  }
}

export async function synthesizeWoofSpeech(text: string, voice: WoofVoiceId, options: { signal?: AbortSignal; onStatus?: (message: string) => void } = {}) {
  const { samples, sampleRate } = await synthesizeWoofSamples(text, voice, options);
  return new Blob([encodeWav(samples, sampleRate)], { type: "audio/wav" });
}

/** Starts making `text` now so a later request for it returns at once. */
export function prefetchWoofSpeech(text: string, voice: WoofVoiceId, signal?: AbortSignal) {
  const value = text.trim();
  const key = `${voice}\u0000${value}`;
  if (!value || prefetched.has(key)) return;
  const promise = request(value, voice, signal);
  promise.catch(() => prefetched.delete(key));
  prefetched.set(key, promise);
  while (prefetched.size > 4) prefetched.delete(prefetched.keys().next().value!);
}

/** 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const tag = (offset: number, value: string) => [...value].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return view.buffer;
}
