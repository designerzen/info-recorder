import { env, ModelRegistry, pipeline } from "@huggingface/transformers";
import { ModelManager, WhisperWasmService, getAllModels } from "@timur00kh/whisper.wasm";
import {
  ModelArch,
  Stream as MoonshineStream,
  Transcriber as MoonshineTranscriber,
  TranscribeFlags,
  type Transcript as MoonshineTranscript,
  type TranscriptLine as MoonshineTranscriptLine
} from "@moonshine-ai/moonshine-wasm";
import type {
  AllTasks,
  AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import {
  appSettings,
  getWasmWhisperModelId,
  isMoonshineModelId,
  isWasmTranscriptionModelId,
  type AppSettings,
  type MoonshineModelId,
  type WasmWhisperModelId
} from "../config/settings";
import {
  getTranscriptionModelOption,
  transcriptionModelOptions
} from "../config/settingsOptions";
import { clampProgress, ModelDownloadTracker } from "./modelDownloadTracker";
import { resampleLinear } from "./audioUtils";
import { withTimeout } from "./asyncTimeout";
import type { TranscriptWord } from "../transcript/timedTranscript";
import type { ModelInventoryEntry } from "./modelInventory";
import { createTransformersOpfsCache } from "./transformersOpfsCache";

type AutomaticSpeechRecognitionPipelineType = AllTasks["automatic-speech-recognition"];
type AudioSamples = Float32Array<ArrayBuffer>;
type LoadedModel = AutomaticSpeechRecognitionPipelineType | WhisperWasmService | MoonshineTranscriber;

type InboundMessage =
  | { type: "configure"; transcription: AppSettings["transcription"] }
  | { type: "load" }
  | { type: "cache-status" }
  | { type: "catalog-status" }
  | { type: "warm-cache" }
  | { type: "flush" }
  | {
      type: "transcribe";
      audio: AudioSamples;
      sampleRate: number;
      isFinal: boolean;
      startsNewParagraph: boolean;
      offsetSeconds: number;
    };

const TASK = "automatic-speech-recognition";
const CACHE_NAME = "info-recorder-transformers-cache";
const WHISPER_CONTEXT_SECONDS = 30;
const WHISPER_STRIDE_SECONDS = 5;
const SHORT_AUDIO_DIRECT_SECONDS = 12;
const TRANSCRIPTION_TIMEOUT_MS = 180_000;
const MOONSHINE_CACHE_NAME = "moonshine-models-v1";
const MOONSHINE_STREAMING_FILES = [
  "frontend.ort",
  "encoder.ort",
  "adapter.ort",
  "cross_kv.ort",
  "decoder_kv.ort",
  "streaming_config.json",
  "tokenizer.bin"
] as const;
const PIPELINE_OPTIONS = {
  dtype: {
    encoder_model: "fp32",
    decoder_model_merged: "fp32"
  }
} as const;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = "caches" in globalThis;
env.useWasmCache = true;
env.useCustomCache = "storage" in navigator && "getDirectory" in navigator.storage;
env.customCache = env.useCustomCache ? createTransformersOpfsCache() : null;
env.cacheKey = CACHE_NAME;

let transcriber: AutomaticSpeechRecognitionPipelineType | null = null;
let wasmTranscriber: WhisperWasmService | null = null;
let moonshineTranscriber: MoonshineTranscriber | null = null;
let moonshineStream: MoonshineStream | null = null;
let moonshineStreamBaseOffsetSeconds = 0;
let moonshineStreamEndSeconds = 0;
let moonshineStartsNewParagraph = false;
const emittedMoonshineLineIds = new Set<number>();
let loadingPromise: Promise<LoadedModel> | null = null;
let queue = Promise.resolve();
let overallProgress = 0;
let downloadTracker: ModelDownloadTracker | null = null;
let transcriptionSettings: AppSettings["transcription"] = { ...appSettings.transcription };
const defaultFetch = env.fetch;
let smoothedBytesPerSecond = 0;
let lastTrackedLoadedBytes = 0;
let lastTrackedProgressAt = 0;
const manifestCache = new Map<
  string,
  Promise<{ files: Array<{ file: string; sizeBytes: number }>; totalBytes: number }>
>();

self.onmessage = ({ data }: MessageEvent<InboundMessage>) => {
  if (data.type === "configure") {
    applyTranscriptionSettings(data.transcription);
    return;
  }

  if (data.type === "cache-status") {
    void postCacheStatus();
    return;
  }

  if (data.type === "catalog-status") {
    void postCatalogStatus();
    return;
  }

  if (data.type === "warm-cache") {
    void load().catch(reportError);
    return;
  }

  if (data.type === "load") {
    void load().catch(reportError);
    return;
  }

  if (data.type === "flush") {
    queue = queue
      .then(async () => {
        if (moonshineStream) {
          await finalizeMoonshineStream();
        }
        postMessage({ type: "partial", text: "" });
        postMessage({ type: "idle" });
      })
      .catch(reportError);
    return;
  }

  if (data.type === "transcribe") {
    queue = queue.then(() => transcribe(data)).catch(reportError);
  }
};

async function load() {
  if (isMoonshineModelId(transcriptionSettings.modelId)) {
    return loadMoonshineModel();
  }

  if (isWasmTranscriptionModelId(transcriptionSettings.modelId)) {
    return loadWasmModel();
  }

  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is required. Enable WebGPU or use a supported Chromium browser.");
  }

  if (!loadingPromise) {
    const status = await inspectCacheStatus();
    downloadTracker = await prepareDownloadTracker(status);
    overallProgress = status.cached ? 100 : downloadTracker?.getProgress() ?? 0;
    resetDownloadRateTracking();
    postCacheStatusMessage(status);
    env.fetch = createWorkerFetch();
    loadingPromise = pipeline(TASK, transcriptionSettings.modelId, {
      ...getPipelineOptions(),
      progress_callback: (event: unknown) => {
        postMessage({ type: "progress", ...describeProgress(event) });
      }
    });
  }

  transcriber = (await loadingPromise) as AutomaticSpeechRecognitionPipelineType;
  await postCacheStatus();
  postMessage({ type: "ready" });
  return transcriber;
}

async function loadMoonshineModel() {
  if (typeof WebAssembly !== "object") {
    throw new Error("WebAssembly is required. Update your browser or enable WebAssembly.");
  }
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer !== "function") {
    throw new Error("Moonshine requires cross-origin isolation. Serve the app with COOP and COEP headers enabled.");
  }

  const modelId = transcriptionSettings.modelId;
  if (!isMoonshineModelId(modelId)) {
    throw new Error("The selected model is not a Moonshine model.");
  }

  if (!loadingPromise) {
    const status = await inspectMoonshineCacheStatus(modelId);
    overallProgress = status.cached ? 100 : 0;
    resetDownloadRateTracking();
    postCacheStatusMessage(status);
    const fileProgress = new Map<string, { loaded: number; total: number }>();

    loadingPromise = MoonshineTranscriber.load({
      language: "en",
      modelArch: getMoonshineArch(modelId),
      onProgress: (loaded, total, file) => {
        fileProgress.set(file, { loaded, total: total ?? loaded });
        const completedFiles = [...fileProgress.values()].filter(
          (entry) => entry.total > 0 && entry.loaded >= entry.total
        ).length;
        const current = fileProgress.get(file);
        const currentFraction = current && current.total > 0 ? Math.min(1, current.loaded / current.total) : 0;
        overallProgress = clampProgress(
          ((Math.max(0, completedFiles - (currentFraction >= 1 ? 1 : 0)) + currentFraction) /
            MOONSHINE_STREAMING_FILES.length) *
            100
        );
        const loadedBytes = [...fileProgress.values()].reduce((sum, entry) => sum + entry.loaded, 0);
        const totalBytes = [...fileProgress.values()].reduce((sum, entry) => sum + entry.total, 0);
        updateMoonshineDownloadRate(loadedBytes);
        postMessage({
          type: "progress",
          message: `Downloading Moonshine model (${file})...`,
          progress: overallProgress,
          loadedBytes,
          totalBytes,
          bytesPerSecond: smoothedBytesPerSecond
        });
      }
    });
  }

  moonshineTranscriber = (await loadingPromise) as MoonshineTranscriber;
  overallProgress = 100;
  await postCacheStatus();
  postMessage({ type: "ready" });
  return moonshineTranscriber;
}

async function loadWasmModel() {
  if (typeof WebAssembly !== "object") {
    throw new Error("WebAssembly is required. Update your browser or enable WebAssembly.");
  }

  if (!loadingPromise) {
    const modelId = getSelectedWasmModelId();
    const status = await inspectWasmCacheStatus(modelId);
    overallProgress = status.cached ? 100 : 0;
    postCacheStatusMessage(status);

    const service = new WhisperWasmService({ logLevel: 0 });
    const manager = new ModelManager();
    loadingPromise = manager
      .loadModel(modelId, true, (progress) => {
        overallProgress = clampProgress(progress);
        postMessage({
          type: "progress",
          message: "Downloading Whisper WASM model...",
          progress: overallProgress,
          loadedBytes: Math.round((status.sizeBytes ?? 0) * (overallProgress / 100)),
          totalBytes: status.sizeBytes,
          bytesPerSecond: smoothedBytesPerSecond
        });
      })
      .then(async (modelData) => {
        postMessage({
          type: "progress",
          message: "Initializing Whisper WASM model...",
          progress: overallProgress
        });
        await service.initModel(modelData);
        return service;
      });
  }

  wasmTranscriber = (await loadingPromise) as WhisperWasmService;
  await postCacheStatus();
  postMessage({ type: "ready" });
  return wasmTranscriber;
}

async function transcribe(message: Extract<InboundMessage, { type: "transcribe" }>) {
  if (isMoonshineModelId(transcriptionSettings.modelId)) {
    await transcribeWithMoonshine(message);
    return;
  }

  if (isWasmTranscriptionModelId(transcriptionSettings.modelId)) {
    await transcribeWithWasm(message);
    return;
  }

  const recognizer = (transcriber ?? (await load())) as AutomaticSpeechRecognitionPipelineType;
  const audio =
    message.sampleRate === 16000 ? message.audio : resampleLinear(message.audio, message.sampleRate, 16000);
  const durationSeconds = audio.length / 16000;

  const result = await withTimeout(
    recognizer(audio, {
      ...getGenerationOptions(),
      ...getChunkingOptions(durationSeconds),
      return_timestamps: "word"
    }),
    TRANSCRIPTION_TIMEOUT_MS,
    `Whisper did not finish a ${durationSeconds.toFixed(1)}s audio chunk within ${Math.round(
      TRANSCRIPTION_TIMEOUT_MS / 1000
    )} seconds. Try a smaller Whisper model or a shorter media file.`
  );

  const output = result as AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[];
  const segments = Array.isArray(output) ? output : [output];
  const text = segments.map((item) => item.text).join(" ").trim();
  const words = segments.flatMap((item) => toTranscriptWords(item, message.offsetSeconds));
  postMessage({ type: "segment", text, startsNewParagraph: message.startsNewParagraph, words });
}

async function transcribeWithMoonshine(message: Extract<InboundMessage, { type: "transcribe" }>) {
  const recognizer = (moonshineTranscriber ?? (await load())) as MoonshineTranscriber;
  const audio = message.sampleRate === 16000
    ? message.audio
    : resampleLinear(message.audio, message.sampleRate, 16000);

  if (!moonshineStream) {
    moonshineStream = recognizer.createStream();
    moonshineStream.addListener({
      onLineCompleted: ({ line }) => emitMoonshineLine(line)
    });
    moonshineStream.start();
    moonshineStreamBaseOffsetSeconds = message.offsetSeconds;
    moonshineStreamEndSeconds = message.offsetSeconds;
    emittedMoonshineLineIds.clear();
  }

  moonshineStartsNewParagraph ||= message.startsNewParagraph;
  if (message.offsetSeconds > moonshineStreamEndSeconds) {
    const gapSamples = Math.round((message.offsetSeconds - moonshineStreamEndSeconds) * 16000);
    if (gapSamples > 0) moonshineStream.addAudio(new Float32Array(gapSamples), 16000);
  }
  const overlapSamples = Math.max(
    0,
    Math.min(audio.length, Math.round((moonshineStreamEndSeconds - message.offsetSeconds) * 16000))
  );
  const freshAudio = overlapSamples > 0 ? audio.subarray(overlapSamples) : audio;
  if (freshAudio.length > 0) moonshineStream.addAudio(freshAudio, 16000);
  moonshineStreamEndSeconds = Math.max(
    moonshineStreamEndSeconds,
    message.offsetSeconds + audio.length / 16000
  );

  const transcript = moonshineStream.transcribe(
    message.isFinal ? TranscribeFlags.ForceUpdate : TranscribeFlags.None
  );
  emitMoonshineTranscript(transcript);
  if (message.isFinal) await finalizeMoonshineStream();
}

function emitMoonshineTranscript(transcript: MoonshineTranscript) {
  for (const line of transcript.lines) {
    if (line.isComplete) emitMoonshineLine(line);
  }
  const partial = [...transcript.lines].reverse().find((line) => !line.isComplete)?.text.trim() ?? "";
  postMessage({ type: "partial", text: partial });
}

function emitMoonshineLine(line: MoonshineTranscriptLine) {
  if (emittedMoonshineLineIds.has(line.id)) return;
  emittedMoonshineLineIds.add(line.id);
  const text = line.text.trim();
  if (!text) return;
  postMessage({
    type: "segment",
    text,
    startsNewParagraph: moonshineStartsNewParagraph,
    words: toMoonshineTranscriptWords({ lines: [line] })
  });
  moonshineStartsNewParagraph = false;
}

async function finalizeMoonshineStream() {
  const stream = moonshineStream;
  if (!stream) return;
  stream.stop();
  stream.close();
  moonshineStream = null;
  moonshineStreamBaseOffsetSeconds = 0;
  moonshineStreamEndSeconds = 0;
  moonshineStartsNewParagraph = false;
  emittedMoonshineLineIds.clear();
}

function toMoonshineTranscriptWords(transcript: MoonshineTranscript): TranscriptWord[] {
  return transcript.lines.flatMap((line) => {
    if (line.words.length > 0) {
      return line.words.map((word) => ({
        text: word.text,
        startMs: Math.max(0, Math.round((moonshineStreamBaseOffsetSeconds + word.start) * 1000)),
        endMs: Math.max(0, Math.round((moonshineStreamBaseOffsetSeconds + word.end) * 1000))
      }));
    }
    const startMs = Math.max(0, Math.round((moonshineStreamBaseOffsetSeconds + line.startTime) * 1000));
    return [{
      text: line.text,
      startMs,
      endMs: Math.max(startMs, Math.round((moonshineStreamBaseOffsetSeconds + line.startTime + line.duration) * 1000))
    }];
  });
}

async function transcribeWithWasm(message: Extract<InboundMessage, { type: "transcribe" }>) {
  const recognizer = (wasmTranscriber ?? (await load())) as WhisperWasmService;
  const audio =
    message.sampleRate === 16000 ? message.audio : resampleLinear(message.audio, message.sampleRate, 16000);
  const durationSeconds = audio.length / 16000;
  const segments = await withTimeout(
    collectWasmSegments(recognizer, audio, message.offsetSeconds),
    TRANSCRIPTION_TIMEOUT_MS,
    `Whisper WASM did not finish a ${durationSeconds.toFixed(1)}s audio chunk within ${Math.round(
      TRANSCRIPTION_TIMEOUT_MS / 1000
    )} seconds. Try a smaller or quantized WASM model.`
  );
  const text = segments.map((segment) => segment.text).join(" ").trim();
  const words = segments.map((segment) => ({
    text: segment.text,
    startMs: segment.startMs,
    endMs: segment.endMs
  }));
  postMessage({ type: "segment", text, startsNewParagraph: message.startsNewParagraph, words });
}

async function collectWasmSegments(
  recognizer: WhisperWasmService,
  audio: Float32Array,
  offsetSeconds: number
): Promise<TranscriptWord[]> {
  const session = recognizer.createSession();
  const segments: TranscriptWord[] = [];
  for await (const segment of session.streaming(audio, {
    language: getSelectedWasmModelId().includes(".en") ? "en" : "auto",
    threads: Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)),
    translate: false
  })) {
    const startMs = Math.max(0, Math.round(offsetSeconds * 1000 + segment.timeStart));
    const endMs = Math.max(startMs, Math.round(offsetSeconds * 1000 + segment.timeEnd));
    const text = segment.text.trim();
    if (text) {
      segments.push({ text, startMs, endMs });
    }
  }
  return segments;
}

function describeProgress(event: unknown) {
  if (!event || typeof event !== "object") {
    return { message: "Loading Whisper model...", progress: overallProgress };
  }

  const record = event as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : "";

  if (status === "download" || status === "progress" || status === "progress_total") {
    return {
      message: "Downloading Whisper package...",
      progress: overallProgress,
      loadedBytes: downloadTracker?.getLoadedBytes(),
      totalBytes: downloadTracker?.getTotalBytes(),
      bytesPerSecond: smoothedBytesPerSecond
    };
  }

  if (status === "done") {
    return {
      message: "Finalizing Whisper model...",
      progress: overallProgress,
      loadedBytes: downloadTracker?.getLoadedBytes(),
      totalBytes: downloadTracker?.getTotalBytes(),
      bytesPerSecond: smoothedBytesPerSecond
    };
  }

  return { message: "Loading Whisper model...", progress: overallProgress };
}

function getGenerationOptions() {
  if (!transcriptionSettings.isMultilingual) return {};

  return {
    language: transcriptionSettings.language,
    task: transcriptionSettings.task
  };
}

function getChunkingOptions(durationSeconds: number) {
  if (durationSeconds <= SHORT_AUDIO_DIRECT_SECONDS) {
    return {};
  }

  const chunkLengthSeconds = Math.min(
    WHISPER_CONTEXT_SECONDS,
    Math.max(SHORT_AUDIO_DIRECT_SECONDS, Math.ceil(durationSeconds))
  );

  return {
    chunk_length_s: chunkLengthSeconds,
    stride_length_s: Math.min(
      WHISPER_STRIDE_SECONDS,
      Math.max(1, Math.floor(chunkLengthSeconds / 6))
    )
  };
}

function reportError(cause: unknown) {
  const message = formatWorkerError(cause, "Transcription failed.");
  postMessage({ type: "error", message });
}

async function postCacheStatus() {
  try {
    const modelId = transcriptionSettings.modelId;
    if (isMoonshineModelId(modelId)) {
      const status = await inspectMoonshineCacheStatus(modelId);
      overallProgress = status.cached ? 100 : 0;
      postCacheStatusMessage(status);
      return;
    }
    if (isWasmTranscriptionModelId(modelId)) {
      const status = await inspectWasmCacheStatus(getSelectedWasmModelId());
      overallProgress = status.cached ? 100 : 0;
      postCacheStatusMessage(status);
      return;
    }
    const status = await inspectCacheStatus();
    if (status.cached) {
      overallProgress = 100;
    } else {
      downloadTracker = await prepareDownloadTracker(status);
      overallProgress = downloadTracker?.getProgress() ?? 0;
    }
    postCacheStatusMessage(status);
  } catch (cause) {
    const message = formatWorkerError(cause, "Unable to inspect model cache.");
    postMessage({
      type: "cache-status",
      cached: false,
      cachedFiles: 0,
      totalFiles: 0,
      message
    });
  }
}

async function inspectMoonshineCacheStatus(modelId: MoonshineModelId) {
  const totalFiles = MOONSHINE_STREAMING_FILES.length;
  if (!("caches" in globalThis)) {
    return { cached: false, cachedFiles: 0, totalFiles, files: [], cachedBytes: 0 };
  }
  const cache = await caches.open(MOONSHINE_CACHE_NAME);
  const requests = await cache.keys();
  const slug = modelId.slice("moonshine:".length);
  const cachedFiles = MOONSHINE_STREAMING_FILES.filter((file) =>
    requests.some((request) => request.url.includes(`/${slug}/`) && new URL(request.url).pathname.endsWith(`/${file}`))
  ).length;
  return {
    cached: cachedFiles === totalFiles,
    cachedFiles,
    totalFiles,
    files: [],
    cachedBytes: 0
  };
}

function getMoonshineArch(modelId: MoonshineModelId) {
  if (modelId === "moonshine:tiny-streaming-en") return ModelArch.TinyStreaming;
  if (modelId === "moonshine:medium-streaming-en") return ModelArch.MediumStreaming;
  return ModelArch.SmallStreaming;
}

function formatWorkerError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  if (message.includes("Unexpected token '<'") || message.includes("<!doctype")) {
    return "Whisper model metadata was served as HTML instead of JSON. Reload the app so the worker uses the remote cached model path, then press Cache Model again.";
  }
  return message;
}

async function postCatalogStatus() {
  try {
    const entries = await Promise.all(
      transcriptionModelOptions.map((option) => inspectModelInventory(option.value))
    );
    postMessage({
      type: "catalog-status",
      entries,
      message: formatCatalogStatusMessage(entries)
    });
  } catch (cause) {
    postMessage({
      type: "catalog-status",
      entries: [] satisfies ModelInventoryEntry[],
      message: formatWorkerError(cause, "Unable to inspect model catalog.")
    });
  }
}

function formatCatalogStatusMessage(entries: ModelInventoryEntry[]) {
  const availableOffline = entries.filter((entry) => entry.cached).length;
  const storageLabel = env.useCustomCache ? "persistent offline storage" : "browser cache storage";
  if (availableOffline === 0) {
    return `No models are available offline yet. Downloads will be saved to ${storageLabel}.`;
  }
  if (availableOffline === 1) {
    return `1 model is available offline in ${storageLabel}.`;
  }
  return `${availableOffline} models are available offline in ${storageLabel}.`;
}

function toTranscriptWords(output: AutomaticSpeechRecognitionOutput, offsetSeconds: number): TranscriptWord[] {
  return (output.chunks ?? [])
    .map((chunk) => {
      const [startSeconds, endSeconds] = chunk.timestamp;
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) return null;
      return {
        text: chunk.text,
        startMs: Math.max(0, Math.round((offsetSeconds + startSeconds) * 1000)),
        endMs: Math.max(0, Math.round((offsetSeconds + endSeconds) * 1000))
      } satisfies TranscriptWord;
    })
    .filter((word): word is TranscriptWord => word !== null);
}

async function inspectCacheStatus() {
  const status = await inspectOnnxModelInventory(transcriptionSettings.modelId);
  return {
    cached: status.cached,
    cachedFiles: status.cachedFiles,
    totalFiles: status.totalFiles,
    files: status.files,
    sizeBytes: status.sizeBytes,
    cachedBytes: status.cachedBytes
  };
}

async function inspectWasmCacheStatus(modelId: WasmWhisperModelId) {
  try {
    const manager = new ModelManager();
    const models = await manager.getAvailableModels();
    const model = models.find((item) => item.id === modelId);
    const staticModel = getTranscriptionModelOption(`wasm:${modelId}`);
    const sizeBytes = staticModel?.downloadSizeBytes ?? 0;
    return {
      cached: Boolean(model?.cached),
      cachedFiles: model?.cached ? 1 : 0,
      totalFiles: 1,
      files: [],
      sizeBytes,
      cachedBytes: model?.cached ? sizeBytes : 0
    };
  } catch {
    const staticModel = getTranscriptionModelOption(`wasm:${modelId}`);
    const sizeBytes = staticModel?.downloadSizeBytes ?? 0;
    return {
      cached: false,
      cachedFiles: 0,
      totalFiles: 1,
      files: [],
      sizeBytes,
      cachedBytes: 0
    };
  }
}

function postCacheStatusMessage(status: {
  cached: boolean;
  cachedFiles: number;
  totalFiles: number;
  sizeBytes?: number;
  cachedBytes?: number;
}) {
  postMessage({
    type: "cache-status",
    cached: status.cached,
    cachedFiles: status.cachedFiles,
    totalFiles: status.totalFiles,
    sizeBytes: status.sizeBytes,
    cachedBytes: status.cachedBytes
  });
}

async function prepareDownloadTracker(status?: Awaited<ReturnType<typeof inspectCacheStatus>>) {
  const cacheStatus = status ?? (await inspectCacheStatus());
  const manifest = await getOnnxModelManifest(transcriptionSettings.modelId);
  const cachedFiles = new Set(
    cacheStatus.files.filter((file) => file.cached).map((file) => file.file)
  );

  return new ModelDownloadTracker(
    manifest.files.map(({ file, sizeBytes }) => ({
      url: buildRemoteUrl(transcriptionSettings.modelId, file),
      size: sizeBytes,
      cached: cachedFiles.has(file)
    }))
  );
}

function createWorkerFetch() {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (!shouldTrackRequest(request)) {
      return defaultFetch(request.url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal
      });
    }

    return fetchWithXhr(request);
  };
}

function shouldTrackRequest(request: Request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("Range")) return false;

  const url = request.url;
  return downloadTracker !== null && isTrackedRemoteModelUrl(url);
}

function isTrackedRemoteModelUrl(url: string) {
  const remotePrefix = `${env.remoteHost.replace(/\/+$/, "")}/`;
  const expectedModelPath = env.remotePathTemplate
    .replaceAll("{model}", transcriptionSettings.modelId)
    .replaceAll("{revision}", encodeURIComponent("main"));
  return url.startsWith(`${remotePrefix}${expectedModelPath}`);
}

function getPipelineOptions() {
  return {
    ...PIPELINE_OPTIONS,
    device: transcriptionSettings.device
  } as const;
}

function applyTranscriptionSettings(nextSettings: AppSettings["transcription"]) {
  if (areTranscriptionSettingsEqual(transcriptionSettings, nextSettings)) {
    return;
  }

  transcriptionSettings = { ...nextSettings };
  transcriber = null;
  wasmTranscriber = null;
  moonshineStream?.close();
  moonshineStream = null;
  moonshineTranscriber?.close();
  moonshineTranscriber = null;
  loadingPromise = null;
  downloadTracker = null;
  overallProgress = 0;
  resetDownloadRateTracking();
}

function getSelectedWasmModelId() {
  if (!isWasmTranscriptionModelId(transcriptionSettings.modelId)) {
    throw new Error("The selected model is not a Whisper WASM model.");
  }
  const modelId = getWasmWhisperModelId(transcriptionSettings.modelId);
  if (!getAllModels().some((model) => model.id === modelId)) {
    throw new Error(`Unknown Whisper WASM model: ${modelId}`);
  }
  return modelId;
}

function areTranscriptionSettingsEqual(
  left: AppSettings["transcription"],
  right: AppSettings["transcription"]
) {
  return (
    left.modelId === right.modelId &&
    left.device === right.device &&
    left.isMultilingual === right.isMultilingual &&
    left.language === right.language &&
    left.task === right.task &&
    left.cacheModelOnFirstUse === right.cacheModelOnFirstUse
  );
}

function fetchWithXhr(request: Request) {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(request.method, request.url, true);
    xhr.responseType = "arraybuffer";

    request.headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    const abort = () => xhr.abort();
    request.signal.addEventListener("abort", abort, { once: true });

    xhr.onprogress = (event) => {
      const nextProgress = downloadTracker?.trackProgress(
        request.url,
        event.loaded,
        event.lengthComputable ? event.total : undefined
      );
      if (typeof nextProgress === "number") {
        overallProgress = clampProgress(nextProgress);
        updateDownloadRateTracking();
        postMessage({
          type: "progress",
          message: "Downloading Whisper package...",
          progress: overallProgress,
          loadedBytes: downloadTracker?.getLoadedBytes(),
          totalBytes: downloadTracker?.getTotalBytes(),
          bytesPerSecond: smoothedBytesPerSecond
        });
      }
    };

    xhr.onload = () => {
      request.signal.removeEventListener("abort", abort);
      const headers = new Headers();
      for (const rawHeadersLine of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        if (!rawHeadersLine) continue;
        const separatorIndex = rawHeadersLine.indexOf(":");
        if (separatorIndex === -1) continue;
        const key = rawHeadersLine.slice(0, separatorIndex).trim();
        const value = rawHeadersLine.slice(separatorIndex + 1).trim();
        headers.append(key, value);
      }

      const nextProgress = downloadTracker?.markDone(request.url);
      if (typeof nextProgress === "number") {
        overallProgress = clampProgress(nextProgress);
        updateDownloadRateTracking();
      }

      resolve(
        new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers
        })
      );
    };

    xhr.onerror = () => {
      request.signal.removeEventListener("abort", abort);
      reject(new Error(`Unable to download ${request.url}.`));
    };

    xhr.onabort = () => {
      request.signal.removeEventListener("abort", abort);
      reject(new DOMException("The request was aborted.", "AbortError"));
    };

    xhr.send();
  });
}

async function inspectModelInventory(modelId: AppSettings["transcription"]["modelId"]): Promise<ModelInventoryEntry> {
  if (isMoonshineModelId(modelId)) {
    const status = await inspectMoonshineCacheStatus(modelId);
    return {
      modelId,
      cached: status.cached,
      cachedFiles: status.cachedFiles,
      totalFiles: status.totalFiles,
      sizeBytes: 0,
      cachedBytes: status.cachedBytes
    };
  }

  if (isWasmTranscriptionModelId(modelId)) {
    const status = await inspectWasmCacheStatus(getWasmWhisperModelId(modelId));
    return {
      modelId,
      cached: status.cached,
      cachedFiles: status.cachedFiles,
      totalFiles: status.totalFiles,
      sizeBytes: status.sizeBytes,
      cachedBytes: status.cachedBytes
    };
  }

  const status = await inspectOnnxModelInventory(modelId);
  return {
    modelId,
    cached: status.cached,
    cachedFiles: status.cachedFiles,
    totalFiles: status.totalFiles,
    sizeBytes: status.sizeBytes,
    cachedBytes: status.cachedBytes
  };
}

async function inspectOnnxModelInventory(modelId: string) {
  const pipelineOptions = {
    ...PIPELINE_OPTIONS,
    device: transcriptionSettings.device
  } as const;
  const [status, manifest] = await Promise.all([
    ModelRegistry.is_pipeline_cached_files(TASK, modelId, pipelineOptions),
    getOnnxModelManifest(modelId)
  ]);
  const sizeByFile = new Map(manifest.files.map((file) => [file.file, file.sizeBytes]));
  const cachedBytes = status.files.reduce(
    (total, file) => total + (file.cached ? sizeByFile.get(file.file) ?? 0 : 0),
    0
  );
  return {
    cached: status.allCached,
    cachedFiles: status.files.filter((file) => file.cached).length,
    totalFiles: status.files.length,
    files: status.files,
    sizeBytes: manifest.totalBytes,
    cachedBytes
  };
}

function getOnnxModelManifest(modelId: string) {
  const cacheKey = `${modelId}:${transcriptionSettings.device}`;
  const existing = manifestCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const pipelineOptions = {
      ...PIPELINE_OPTIONS,
      device: transcriptionSettings.device
    } as const;
    const files = await ModelRegistry.get_pipeline_files(TASK, modelId, pipelineOptions);
    const fileMetadata = await Promise.all(
      files.map(async (file) => {
        const metadata = await ModelRegistry.get_file_metadata(modelId, file, pipelineOptions as never);
        return {
          file,
          sizeBytes: metadata.size ?? 0
        };
      })
    );
    return {
      files: fileMetadata,
      totalBytes: fileMetadata.reduce((total, file) => total + file.sizeBytes, 0)
    };
  })();

  manifestCache.set(cacheKey, promise);
  return promise;
}

function resetDownloadRateTracking() {
  smoothedBytesPerSecond = 0;
  lastTrackedLoadedBytes = 0;
  lastTrackedProgressAt = 0;
}

function updateDownloadRateTracking() {
  if (!downloadTracker) return;

  const now = performance.now();
  const loadedBytes = downloadTracker.getLoadedBytes();

  if (lastTrackedProgressAt > 0 && now > lastTrackedProgressAt && loadedBytes >= lastTrackedLoadedBytes) {
    const elapsedSeconds = (now - lastTrackedProgressAt) / 1000;
    const deltaBytes = loadedBytes - lastTrackedLoadedBytes;
    if (elapsedSeconds > 0 && deltaBytes > 0) {
      const instantBytesPerSecond = deltaBytes / elapsedSeconds;
      smoothedBytesPerSecond =
        smoothedBytesPerSecond > 0
          ? smoothedBytesPerSecond * 0.7 + instantBytesPerSecond * 0.3
          : instantBytesPerSecond;
    }
  }

  lastTrackedLoadedBytes = loadedBytes;
  lastTrackedProgressAt = now;
}

function updateMoonshineDownloadRate(loadedBytes: number) {
  const now = performance.now();
  if (lastTrackedProgressAt > 0 && now > lastTrackedProgressAt && loadedBytes >= lastTrackedLoadedBytes) {
    const elapsedSeconds = (now - lastTrackedProgressAt) / 1000;
    const deltaBytes = loadedBytes - lastTrackedLoadedBytes;
    if (elapsedSeconds > 0 && deltaBytes > 0) {
      const instantBytesPerSecond = deltaBytes / elapsedSeconds;
      smoothedBytesPerSecond = smoothedBytesPerSecond > 0
        ? smoothedBytesPerSecond * 0.7 + instantBytesPerSecond * 0.3
        : instantBytesPerSecond;
    }
  }
  lastTrackedLoadedBytes = loadedBytes;
  lastTrackedProgressAt = now;
}

function buildRemoteUrl(modelId: string, file: string) {
  const remoteHost = env.remoteHost.replace(/\/+$/, "");
  const remotePath = env.remotePathTemplate
    .replaceAll("{model}", modelId)
    .replaceAll("{revision}", encodeURIComponent("main"))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const normalizedFile = file.replace(/^\/+/, "");
  return `${remoteHost}/${remotePath}/${normalizedFile}`;
}
