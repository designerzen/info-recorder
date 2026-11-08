/// <reference lib="webworker" />
/** Runs the Underdog Woof voice off the main thread. The weights and lexicon are downloaded once from a pinned
 * Hugging Face revision and kept in the Cache API, so the voice works offline afterwards. */
import { Woof, SAMPLE_RATE, type WoofVoice } from "./woof";

export type WoofRequest = { type: "synthesize"; id: number; text: string; voice: WoofVoice; weightsUrl: string; lexiconUrl: string; cacheName: string };
export type WoofResponse =
  | { type: "download"; loaded: number; total: number }
  | { type: "done"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id: number; message: string };

const post = (message: WoofResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
let woof: Promise<Woof> | null = null;

async function cachedResponse(url: string, cacheName: string) {
  const cache = "caches" in self ? await caches.open(cacheName).catch(() => null) : null;
  const cached = await cache?.match(url);
  if (cached) return { response: cached, cache: null };
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Woof voice could not be downloaded (${response.status}).`);
  return { response, cache };
}

/** Reads a download to the end, reporting progress for the large file. */
async function download(url: string, cacheName: string, onProgress?: (loaded: number, total: number) => void) {
  const { response, cache } = await cachedResponse(url, cacheName);
  const total = Number(response.headers.get("content-length")) || 0;
  let bytes: Uint8Array;
  if (!response.body || !onProgress) bytes = new Uint8Array(await response.arrayBuffer());
  else {
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let loaded = 0;
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      parts.push(next.value);
      loaded += next.value.length;
      onProgress(loaded, total);
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
  }
  if (cache) await cache.put(url, new Response(bytes.slice(), { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

function load(request: WoofRequest) {
  woof ??= (async () => {
    const [weights, lexicon] = await Promise.all([
      download(request.weightsUrl, request.cacheName, (loaded, total) => post({ type: "download", loaded, total })),
      download(request.lexiconUrl, request.cacheName)
    ]);
    return Woof.fromBuffers(weights.buffer as ArrayBuffer, new TextDecoder().decode(lexicon));
  })().catch((error) => {
    woof = null;
    throw error;
  });
  return woof;
}

self.addEventListener("message", async (event: MessageEvent<WoofRequest>) => {
  const request = event.data;
  if (request.type !== "synthesize") return;
  try {
    const model = await load(request);
    const samples = model.synthesize(request.text, request.voice);
    post({ type: "done", id: request.id, samples, sampleRate: SAMPLE_RATE }, [samples.buffer]);
  } catch (error) {
    post({ type: "error", id: request.id, message: error instanceof Error ? error.message : "The Woof voice failed." });
  }
});
