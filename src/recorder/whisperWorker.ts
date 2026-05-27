import { env, ModelRegistry, pipeline } from "@huggingface/transformers";
import type {
  AllTasks,
  AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import { appSettings } from "../config/settings";
import { clampProgress, ModelDownloadTracker } from "./modelDownloadTracker";
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
const SHORT_AUDIO_DIRECT_SECONDS = 12;
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
let overallProgress = 0;
let downloadTracker: ModelDownloadTracker | null = null;
const defaultFetch = env.fetch;

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
    queue = queue
      .then(() => {
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
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is required. Enable WebGPU or use a supported Chromium browser.");
  }

  if (!loadingPromise) {
    const status = await inspectCacheStatus();
    downloadTracker = await prepareDownloadTracker(status);
    overallProgress = status.cached ? 100 : downloadTracker?.getProgress() ?? 0;
    postCacheStatusMessage(status);
    env.fetch = createWorkerFetch();
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
  const durationSeconds = audio.length / 16000;

  const result = await recognizer(audio, {
    ...getGenerationOptions(),
    ...getChunkingOptions(durationSeconds)
  });

  const output = result as AutomaticSpeechRecognitionOutput | AutomaticSpeechRecognitionOutput[];
  const text = Array.isArray(output) ? output.map((item) => item.text).join(" ") : output.text;
  postMessage({ type: "segment", text, startsNewParagraph: message.startsNewParagraph });
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
      progress: overallProgress
    };
  }

  if (status === "done") {
    return {
      message: "Finalizing Whisper model...",
      progress: overallProgress
    };
  }

  return { message: "Loading Whisper model...", progress: overallProgress };
}

function getGenerationOptions() {
  if (!appSettings.transcription.isMultilingual) return {};

  return {
    language: appSettings.transcription.language,
    task: appSettings.transcription.task
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
    totalFiles: status.files.length,
    files: status.files
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

async function prepareDownloadTracker(status?: Awaited<ReturnType<typeof inspectCacheStatus>>) {
  const cacheStatus = status ?? (await inspectCacheStatus());
  const files = await ModelRegistry.get_pipeline_files(TASK, MODEL_ID, PIPELINE_OPTIONS);
  const metadata = await Promise.all(
    files.map(async (file) => ({
      file,
      metadata: await ModelRegistry.get_file_metadata(MODEL_ID, file, PIPELINE_OPTIONS as never)
    }))
  );
  const cachedFiles = new Set(
    cacheStatus.files.filter((file) => file.cached).map((file) => file.file)
  );

  return new ModelDownloadTracker(
    metadata.map(({ file, metadata: fileMetadata }) => ({
      url: buildRemoteUrl(MODEL_ID, file),
      size: fileMetadata.size ?? 0,
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
    .replaceAll("{model}", MODEL_ID)
    .replaceAll("{revision}", encodeURIComponent("main"));
  return url.startsWith(`${remotePrefix}${expectedModelPath}`);
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
        postMessage({
          type: "progress",
          message: "Downloading Whisper package...",
          progress: overallProgress
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
