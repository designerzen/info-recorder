import { env, ModelRegistry, pipeline } from "@huggingface/transformers";
import type {
  AllTasks,
  AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import { appSettings } from "../config/settings";
import { resampleLinear } from "./audioUtils";

type AutomaticSpeechRecognitionPipelineType = AllTasks["automatic-speech-recognition"];
type AudioSamples = Float32Array<ArrayBuffer>;

type InboundMessage =
  | { type: "load" }
  | { type: "cache-status" }
  | { type: "warm-cache" }
  | { type: "flush" }
  | {
      type: "transcribe";
      audio: AudioSamples;
      sampleRate: number;
      isFinal: boolean;
      startsNewParagraph: boolean;
    };

const MODEL_ID = appSettings.transcription.modelId;
const TASK = "automatic-speech-recognition";
const CACHE_NAME = "info-recorder-transformers-cache";
const WHISPER_CONTEXT_SECONDS = 30;
const WHISPER_STRIDE_SECONDS = 5;
const PIPELINE_OPTIONS = {
  device: appSettings.transcription.device,
  dtype: {
    encoder_model: "fp32",
    decoder_model_merged: "fp32"
  }
} as const;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = "caches" in globalThis;
env.useWasmCache = true;
env.useCustomCache = false;
env.customCache = null;
env.cacheKey = CACHE_NAME;

let transcriber: AutomaticSpeechRecognitionPipelineType | null = null;
let loadingPromise: Promise<AutomaticSpeechRecognitionPipelineType> | null = null;
let queue = Promise.resolve();
let currentFileLabel = "model files";
let overallProgress = 0;

self.onmessage = ({ data }: MessageEvent<InboundMessage>) => {
  if (data.type === "cache-status") {
    void postCacheStatus();
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
    postMessage({ type: "partial", text: "" });
    return;
  }

  if (data.type === "transcribe") {
    queue = queue.then(() => transcribe(data)).catch(reportError);
  }
};

async function load() {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is required. Enable WebGPU or use a supported Chromium browser.");
  }

  if (!loadingPromise) {
    const status = await inspectCacheStatus();
    overallProgress = status.cached ? 100 : 0;
    currentFileLabel = "model files";
    postCacheStatusMessage(status);
    loadingPromise = pipeline(TASK, MODEL_ID, {
      ...PIPELINE_OPTIONS,
      progress_callback: (event: unknown) => {
        postMessage({ type: "progress", ...describeProgress(event) });
      }
    });
  }

  transcriber = await loadingPromise;
  await postCacheStatus();
  postMessage({ type: "ready" });
  return transcriber;
}

async function transcribe(message: Extract<InboundMessage, { type: "transcribe" }>) {
  const recognizer = transcriber ?? (await load());
  const audio =
    message.sampleRate === 16000 ? message.audio : resampleLinear(message.audio, message.sampleRate, 16000);

  const result = await recognizer(audio, {
    ...getGenerationOptions(),
    chunk_length_s: WHISPER_CONTEXT_SECONDS,
    stride_length_s: WHISPER_STRIDE_SECONDS
  });

  const output = result as AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[];
  const text = Array.isArray(output) ? output.map((item) => item.text).join(" ") : output.text;
  postMessage({ type: "segment", text, startsNewParagraph: message.startsNewParagraph });
}

function describeProgress(event: unknown) {
  if (!event || typeof event !== "object") {
    return { message: "Loading model files", progress: overallProgress };
  }

  const record = event as Record<string, unknown>;
  const file =
    typeof record.file === "string" ? (record.file.split("/").at(-1) ?? "model files") : currentFileLabel;

  if (record.status === "progress_total") {
    overallProgress = Math.max(overallProgress, normalizeProgress(record.progress));
    return {
      message: `Downloading ${currentFileLabel}`,
      progress: overallProgress
    };
  }

  if (record.status === "progress") {
    currentFileLabel = file;
    return {
      message: `Downloading ${currentFileLabel}`,
      progress: overallProgress
    };
  }

  if (record.status === "download") {
    currentFileLabel = file;
    return {
      message: `Starting ${currentFileLabel}`,
      progress: overallProgress
    };
  }

  if (record.status === "done") {
    currentFileLabel = file;
    return {
      message: `Finished ${currentFileLabel}`,
      progress: overallProgress
    };
  }

  if (typeof record.status === "string" && record.status !== "initiate") {
    return {
      message: `Downloading ${currentFileLabel}`,
      progress: overallProgress
    };
  }

  return { message: `Downloading ${currentFileLabel}`, progress: overallProgress };
}

function getGenerationOptions() {
  if (!appSettings.transcription.isMultilingual) return {};

  return {
    language: appSettings.transcription.language,
    task: appSettings.transcription.task
  };
}

function reportError(cause: unknown) {
  const message = formatWorkerError(cause, "Transcription failed.");
  postMessage({ type: "error", message });
}

async function postCacheStatus() {
  try {
    const status = await inspectCacheStatus();
    if (status.cached) {
      overallProgress = 100;
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

function formatWorkerError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  if (message.includes("Unexpected token '<'") || message.includes("<!doctype")) {
    return "Whisper model metadata was served as HTML instead of JSON. Reload the app so the worker uses the remote cached model path, then press Cache Model again.";
  }
  return message;
}

async function inspectCacheStatus() {
  const status = await ModelRegistry.is_pipeline_cached_files(TASK, MODEL_ID, PIPELINE_OPTIONS);
  return {
    cached: status.allCached,
    cachedFiles: status.files.filter((file) => file.cached).length,
    totalFiles: status.files.length
  };
}

function postCacheStatusMessage(status: {
  cached: boolean;
  cachedFiles: number;
  totalFiles: number;
}) {
  postMessage({
    type: "cache-status",
    cached: status.cached,
    cachedFiles: status.cachedFiles,
    totalFiles: status.totalFiles
  });
}

function normalizeProgress(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value <= 1) return Math.min(100, Math.max(0, value * 100));
  return Math.min(100, Math.max(0, value));
}
