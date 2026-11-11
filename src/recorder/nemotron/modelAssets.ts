import jointUrl from "./joint-argmax.onnx?url&no-inline";
import { createTransformersOpfsCache } from "../transformersOpfsCache";

export const MODEL_ROOT = "https://huggingface.co/onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4/resolve/8364d9e2dd9da23789b480bdbba9e423717e42ee";
export const NEMOTRON_DOWNLOAD_BYTES = 791032783;
const FILES = ["tokenizer.json", "encoder.onnx", "encoder.onnx.data", "decoder.onnx", "decoder.onnx.data", "joint.onnx.data"];
const opfs = createTransformersOpfsCache();
const CACHE_NAME = "info-recorder-nemotron-v1";

async function cache() {
  if ("storage" in navigator && "getDirectory" in navigator.storage) return opfs;
  if ("caches" in globalThis) return caches.open(CACHE_NAME);
  return null;
}

export function assetUrl(name: "encoder" | "decoder" | "joint") {
  return name === "joint" ? new URL(jointUrl, import.meta.url).href : `${MODEL_ROOT}/${name}.onnx`;
}

export async function cachedAsset(url: string, onStatus: (message: string) => void): Promise<ArrayBuffer> {
  const store = await cache();
  const existing = await store?.match(url).catch(() => undefined);
  if (existing) return existing.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Nemotron download failed (${response.status}): ${url}`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastProgressAt = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (performance.now() - lastProgressAt >= 150 || loaded === total) {
        lastProgressAt = performance.now();
        onStatus(`Downloading Nemotron ${url.split("/").pop()}: ${Math.round(loaded / 1048576)} MB${total ? ` / ${Math.round(total / 1048576)} MB` : ""}`);
      }
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes);
    loaded = bytes.length;
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const stored = new Response(bytes, { headers: { "content-length": String(loaded) } });
  await store?.put(url, stored).catch(() => onStatus("Unable to cache this Nemotron file; it will need downloading next time."));
  return bytes.buffer;
}

export async function inspectNemotronCache() {
  const store = await cache();
  const urls = [...FILES.map((file) => `${MODEL_ROOT}/${file}`), assetUrl("joint")];
  const responses = await Promise.all(urls.map((url) => store?.match(url).catch(() => undefined)));
  const cachedFiles = responses.filter(Boolean).length;
  const cachedBytes = responses.reduce((sum, response) => sum + Number(response?.headers.get("content-length") || 0), 0);
  return { cached: cachedFiles === urls.length, cachedFiles, totalFiles: urls.length, cachedBytes, sizeBytes: NEMOTRON_DOWNLOAD_BYTES };
}
