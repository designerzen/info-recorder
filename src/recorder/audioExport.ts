import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { RecordingExportFormat } from "../config/settings";

type ExportTarget = {
  extension: string;
  mimeType: string;
  args: string[];
};

const coreBaseUrl = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
let ffmpegPromise: Promise<FFmpeg> | null = null;

export function getRecordingExportExtension(format: RecordingExportFormat, sourceMimeType: string) {
  if (format === "native") return getNativeExtension(sourceMimeType);
  return getExportTarget(format).extension;
}

export async function exportRecordingBlob(
  source: Blob,
  format: RecordingExportFormat,
  onProgress?: (message: string) => void
) {
  if (format === "native") return source;

  onProgress?.(`Preparing ${formatLabel(format)} export...`);
  const ffmpeg = await getFfmpeg(onProgress);
  const target = getExportTarget(format);
  const inputName = `input.${getNativeExtension(source.type)}`;
  const outputName = `recording.${target.extension}`;

  await ffmpeg.writeFile(inputName, await fetchFile(source));
  onProgress?.(`Converting recording to ${formatLabel(format)}...`);
  await ffmpeg.exec(["-i", inputName, "-vn", ...target.args, outputName]);
  const output = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  onProgress?.("");

  return new Blob([normalizeFileData(output)], { type: target.mimeType });
}

export async function extractAudioForTranscription(
  source: Blob,
  sourceMimeType: string,
  sourceName?: string,
  onProgress?: (message: string) => void
) {
  onProgress?.("Preparing uploaded media audio...");
  const ffmpeg = await getFfmpeg(onProgress);
  const inputName = `input.${getSourceExtension(sourceMimeType, sourceName)}`;
  const outputName = "transcription.wav";

  await ffmpeg.writeFile(inputName, await fetchFile(source));
  onProgress?.("Extracting audio track...");
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputName
  ]);
  const output = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  onProgress?.("");

  return new Blob([normalizeFileData(output)], { type: "audio/wav" });
}

function getFfmpeg(onProgress?: (message: string) => void) {
  ffmpegPromise ??= loadFfmpeg(onProgress);
  return ffmpegPromise;
}

async function loadFfmpeg(onProgress?: (message: string) => void) {
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (message) onProgress?.(message);
  });
  ffmpeg.on("progress", ({ progress }) => {
    onProgress?.(`Converting recording ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`);
  });

  onProgress?.("Loading ffmpeg.wasm...");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.wasm`, "application/wasm")
  });
  return ffmpeg;
}

function getExportTarget(format: Exclude<RecordingExportFormat, "native">): ExportTarget {
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
