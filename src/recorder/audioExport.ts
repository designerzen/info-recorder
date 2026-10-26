import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { RecordingExportFormat } from "../config/settings";

type ExportTarget = {
  extension: string;
  mimeType: string;
  args: string[];
};

// FFmpeg runs in a module worker, so its core must expose an ESM default export.
const coreBaseUrl = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
let ffmpegPromise: Promise<FFmpeg> | null = null;
let ffmpegQueue: Promise<unknown> = Promise.resolve();

// The encoder and its virtual filesystem are shared by uploads and downloads.
export function runFfmpegJob<T>(job: (ffmpeg: FFmpeg) => Promise<T>, onProgress?: (message: string) => void): Promise<T> {
  const result = ffmpegQueue.then(async () => {
    const ffmpeg = await getFfmpeg(onProgress);
    const report = ({ progress }: { progress: number }) =>
      onProgress?.(`Converting media ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`);
    ffmpeg.on("progress", report);
    try {
      return await job(ffmpeg);
    } finally {
      ffmpeg.off("progress", report);
      onProgress?.("");
    }
  });
  ffmpegQueue = result.catch(() => undefined);
  return result;
}

export function getRecordingExportExtension(format: RecordingExportFormat, sourceMimeType: string) {
  if (format === "native") return getNativeExtension(sourceMimeType);
  return getRecordingExportTarget(format).extension;
}

export async function exportRecordingBlob(
  source: Blob,
  format: RecordingExportFormat,
  onProgress?: (message: string) => void
) {
  if (format === "native") return source;

  onProgress?.(`Preparing ${formatLabel(format)} export...`);
  const target = getRecordingExportTarget(format);
  const inputName = `input.${getNativeExtension(source.type)}`;
  const outputName = `recording.${target.extension}`;

  return runFfmpegJob(async (ffmpeg) => {
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(source));
      onProgress?.(`Converting recording to ${formatLabel(format)}...`);
      if (await ffmpeg.exec(["-y", "-i", inputName, "-vn", ...target.args, outputName]) !== 0) {
        throw new Error("Unable to convert the recording. Please try another format.");
      }
      const output = await ffmpeg.readFile(outputName);
      return new Blob([normalizeFileData(output)], { type: target.mimeType });
    } finally {
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
    }
  }, onProgress);
}

export async function extractAudioForTranscription(
  source: Blob,
  sourceMimeType: string,
  sourceName?: string,
  onProgress?: (message: string) => void
) {
  onProgress?.("Preparing uploaded media audio...");
  const inputName = `input.${getSourceExtension(sourceMimeType, sourceName)}`;
  const outputName = "transcription.wav";

  return runFfmpegJob(async (ffmpeg) => {
    try {
      await ffmpeg.writeFile(inputName, await fetchFile(source));
      onProgress?.("Extracting audio track...");
      const exitCode = await ffmpeg.exec([
        "-y", "-i", inputName, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputName
      ]);
      if (exitCode !== 0) throw new Error("Unable to extract an audio track from this media file.");
      const output = await ffmpeg.readFile(outputName);
      return new Blob([normalizeFileData(output)], { type: "audio/wav" });
    } finally {
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
    }
  }, onProgress);
}

function getFfmpeg(onProgress?: (message: string) => void) {
  ffmpegPromise ??= loadFfmpeg(onProgress).catch((error) => {
    ffmpegPromise = null;
    throw error;
  });
  return ffmpegPromise;
}

async function loadFfmpeg(onProgress?: (message: string) => void) {
  const ffmpeg = new FFmpeg();
  onProgress?.("Loading ffmpeg.wasm...");
  const coreURL = await toBlobURL(`${coreBaseUrl}/ffmpeg-core.js`, "text/javascript");
  let wasmURL: string | undefined;
  try {
    wasmURL = await toBlobURL(`${coreBaseUrl}/ffmpeg-core.wasm`, "application/wasm");
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  } catch (error) {
    ffmpeg.terminate();
    throw error;
  } finally {
    URL.revokeObjectURL(coreURL);
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  }
}

export function getRecordingExportTarget(format: Exclude<RecordingExportFormat, "native">): ExportTarget {
  if (format === "ogg-vorbis") {
    return {
      extension: "ogg",
      mimeType: "audio/ogg",
      args: ["-c:a", "libvorbis", "-q:a", "4"]
    };
  }
  if (format === "ogg-opus") {
    return {
      extension: "opus",
      mimeType: "audio/ogg; codecs=opus",
      args: ["-c:a", "libopus", "-b:a", "96k"]
    };
  }
  if (format === "mp3") {
    return {
      extension: "mp3",
      mimeType: "audio/mpeg",
      args: ["-c:a", "libmp3lame", "-q:a", "4"]
    };
  }
  if (format === "flac") {
    return {
      extension: "flac",
      mimeType: "audio/flac",
      args: ["-c:a", "flac"]
    };
  }
  return {
    extension: "wav",
    mimeType: "audio/wav",
    args: ["-c:a", "pcm_s16le"]
  };
}

function getNativeExtension(mimeType: string) {
  if (mimeType.startsWith("video/mp4")) return "mp4";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("flac")) return "flac";
  return "webm";
}

function getSourceExtension(mimeType: string, fileName = "") {
  const fromName = fileName.trim().toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (fromName) {
    if (["mp4", "m4a", "webm", "mp3", "wav", "ogg", "flac", "mov", "mkv"].includes(fromName)) {
      return fromName;
    }
  }

  return getNativeExtension(mimeType);
}

function formatLabel(format: RecordingExportFormat) {
  if (format === "ogg-vorbis") return "Ogg Vorbis";
  if (format === "ogg-opus") return "Ogg Opus";
  return format.toUpperCase();
}

function normalizeFileData(data: Uint8Array | string) {
  if (typeof data === "string") return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}
