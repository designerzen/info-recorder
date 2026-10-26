import type { RecordingExportFormat, SupertonicVoiceId } from "../config/settings";
import { getRecordingExportTarget, runFfmpegJob } from "../recorder/audioExport";
import { splitSpeechPhrases } from "../speech/subtitlePhrases";
import type { TranscriptSentence } from "./timedTranscript";

export type CaptionCue = { text: string; startMs: number; endMs: number };
export type DownloadAudioFormat = Exclude<RecordingExportFormat, "native">;
export type ExportAudioOptions = { speed: number; pitch: number };

export function buildOriginalCaptions(sentences: TranscriptSentence[]): CaptionCue[] {
  return sentences.flatMap((sentence) => {
    if (!sentence.words.length) return validCue(sentence) ? [sentence] : [];
    const cues: CaptionCue[] = [];
    let words: typeof sentence.words = [];
    const flush = () => {
      if (!words.length) return;
      const cue = {
        text: words.map((word) => word.text).join("").trim(),
        startMs: words[0].startMs,
        endMs: words.at(-1)!.endMs
      };
      if (validCue(cue)) cues.push(cue);
      words = [];
    };
    for (const word of sentence.words) {
      if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.endMs <= word.startMs) continue;
      if (words.length && (words.map((item) => item.text).join("").length + word.text.length > 84 || word.endMs - words[0].startMs > 6000)) flush();
      words.push(word);
    }
    flush();
    return cues;
  });
}

function validCue(cue: CaptionCue) {
  return cue.text.trim() && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > Math.max(0, cue.startMs);
}

export function captionsToSrt(cues: CaptionCue[], speed = 1, durationMs = Infinity) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("Caption speed must be positive.");
  let previousEnd = 0;
  return [...cues].sort((a, b) => a.startMs - b.startMs).flatMap((cue) => {
    if (!validCue(cue)) return [];
    const startMs = Math.max(previousEnd, 0, Math.round(cue.startMs / speed));
    const endMs = Math.min(Math.round(cue.endMs / speed), Math.floor(durationMs));
    if (endMs <= startMs) return [];
    previousEnd = endMs;
    // Treat recognized text as literal caption content, never SRT/HTML markup.
    const text = cue.text.replace(/<[^>]*>/g, "").replace(/\r?\n/g, " ").trim();
    return text ? [{ text, startMs, endMs }] : [];
  }).map((cue, index) => `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join("\n");
}

function srtTime(ms: number) {
  const value = Math.max(0, Math.round(ms));
  return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")},${String(value % 1000).padStart(3, "0")}`;
}

// Pitch is measured in semitones. Compensating tempo keeps it independent of speed.
export function buildExportAudioFilter({ speed, pitch }: ExportAudioOptions) {
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2 || !Number.isFinite(pitch) || pitch < -12 || pitch > 12) {
    throw new Error("Choose a speed from 0.5–2× and a pitch from −12 to +12 semitones.");
  }
  const factor = 2 ** (pitch / 12);
  const filters = ["aresample=48000", `asetrate=${48000 * factor}`, "aresample=48000"];
  let tempo = speed / factor;
  while (tempo < 0.5) { filters.push("atempo=0.5"); tempo /= 0.5; }
  while (tempo > 2) { filters.push("atempo=2"); tempo /= 2; }
  filters.push(`atempo=${tempo}`);
  return filters.join(",");
}

export function getWavDurationMs(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("The encoder did not produce WAV audio.");
  let byteRate = 0;
  let dataSize = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt " && size >= 16 && at + 24 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (tag(at) === "data") dataSize += Math.min(size, bytes.length - at - 8);
    at += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error("No audio samples were found in this export.");
  return dataSize / byteRate * 1000;
}

export function splitExportPhrases(text: string) {
  return splitSpeechPhrases(text).flatMap((phrase) => {
    const chunks: string[] = [];
    let current = "";
    for (const word of phrase.text.trim().split(/\s+/)) {
      if (current && current.length + word.length + 1 > 84) { chunks.push(current); current = ""; }
      current += (current ? " " : "") + word;
    }
    if (current) chunks.push(current);
    return chunks;
  });
}

export async function synthesizeTranscriptAudio(text: string, voiceId: SupertonicVoiceId, onProgress: (message: string) => void) {
  const { synthesizeSupertonicSamples } = await import("../speech/supertonicTts");
  const { writeWavFile } = await import("../vendor/supertonic/helper.js");
  const phrases = splitExportPhrases(text);
  if (!phrases.length) throw new Error("There is no transcript to read aloud.");
  const samples: number[][] = [];
  const captions: CaptionCue[] = [];
  let sampleRate = 0;
  let sampleCount = 0;
  for (const [index, phrase] of phrases.entries()) {
    onProgress(`Generating voice: phrase ${index + 1} of ${phrases.length}…`);
    const audio = await synthesizeSupertonicSamples(phrase, voiceId);
    if (!audio.samples.length || !audio.sampleRate || (sampleRate && sampleRate !== audio.sampleRate)) {
      throw new Error("The voice model returned incompatible or empty audio. Please try again.");
    }
    sampleRate = audio.sampleRate;
    captions.push({ text: phrase, startMs: sampleCount / sampleRate * 1000, endMs: (sampleCount + audio.samples.length) / sampleRate * 1000 });
    sampleCount += audio.samples.length;
    samples.push(audio.samples);
  }
  const combined = new Float32Array(sampleCount);
  let offset = 0;
  for (const part of samples) { combined.set(part, offset); offset += part.length; }
  return { blob: new Blob([writeWavFile(combined, sampleRate)], { type: "audio/wav" }), captions };
}

export async function exportTranscriptMedia(
  source: Blob,
  options: ExportAudioOptions & { format: DownloadAudioFormat | "mp4"; captions: CaptionCue[] },
  onProgress?: (message: string) => void
) {
  const filter = buildExportAudioFilter(options);
  if (options.format === "mp4" && !options.captions.length) throw new Error("Timed captions are unavailable for this recording. Choose a TTS voice to generate synchronized captions.");
  onProgress?.("Preparing download…");
  return runFfmpegJob(async (ffmpeg) => {
    const input = "transcript-source";
    const wav = "transcript-processed.wav";
    const srt = "transcript-captions.srt";
    const extension = options.format === "ogg-vorbis" ? "ogg" : options.format === "ogg-opus" ? "opus" : options.format;
    const output = `transcript-download.${extension}`;
    try {
      await ffmpeg.writeFile(input, new Uint8Array(await source.arrayBuffer()));
      onProgress?.("Applying speed and pitch…");
      const check = (code: number) => { if (code !== 0) throw new Error("Media export failed. Please try another format or a shorter passage."); };
      check(await ffmpeg.exec(["-y", "-i", input, "-map", "0:a:0", "-vn", "-af", filter, "-c:a", "pcm_s16le", wav]));
      const pcm = await ffmpeg.readFile(wav);
      if (typeof pcm === "string") throw new Error("Unable to read the exported audio.");
      const durationMs = getWavDurationMs(pcm);
      if (options.format === "wav") return { blob: new Blob([new Uint8Array(pcm)], { type: "audio/wav" }), extension };
      let mimeType: string;
      if (options.format === "mp4") {
        const captions = captionsToSrt(options.captions, options.speed, durationMs);
        if (!captions) throw new Error("No captions fall within this audio. Try a TTS voice to generate new timings.");
        await ffmpeg.writeFile(srt, captions);
        onProgress?.("Creating captioned MP4…");
        check(await ffmpeg.exec([
          "-y", "-f", "lavfi", "-i", "color=c=0x182523:s=1280x720:r=10",
          "-i", wav, "-i", srt, "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
          "-t", String(durationMs / 1000), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-c:s", "mov_text", "-metadata:s:s:0", "title=Transcript",
          "-disposition:s:0", "default", "-movflags", "+faststart", output
        ]));
        mimeType = "video/mp4";
      } else {
        const target = getRecordingExportTarget(options.format);
        check(await ffmpeg.exec(["-y", "-i", wav, ...target.args, output]));
        mimeType = target.mimeType;
      }
      const data = await ffmpeg.readFile(output);
      if (typeof data === "string") throw new Error("Unable to read the exported media.");
      return { blob: new Blob([new Uint8Array(data)], { type: mimeType }), extension };
    } finally {
      await Promise.allSettled([input, wav, srt, output].map((file) => ffmpeg.deleteFile(file)));
    }
  }, onProgress);
}

export function downloadTranscriptBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
