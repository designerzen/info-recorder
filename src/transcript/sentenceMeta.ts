import type { TranscriptSentence } from "./timedTranscript";

export type SentenceMetaContext = {
  location?: { LAT: number; LONG: number; accuracy?: number };
  recordingStartedAt?: number | null;
  engineLabel?: string;
  sourceName?: string;
};

export function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(totalSeconds / 3600), Math.floor(totalSeconds / 60) % 60, totalSeconds % 60];
  return parts.slice(totalSeconds >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");
}

/** The labelled facts shown when a sentence is hovered, focused or long-pressed. */
export function describeSentence(sentence: TranscriptSentence, context: SentenceMetaContext = {}) {
  const lines: Array<[label: string, value: string]> = [];
  const wordCount = sentence.words.length || (sentence.text.match(/\S+/g) ?? []).length;
  if (sentence.endMs > sentence.startMs) {
    const seconds = ((sentence.endMs - sentence.startMs) / 1000).toFixed(1);
    lines.push(["Time", `${formatClock(sentence.startMs)} \u2013 ${formatClock(sentence.endMs)} (${seconds} s)`]);
  }
  lines.push(["Words", String(wordCount)]);
  if (context.sourceName) {
    lines.push(["Source", context.sourceName]);
  }
  else if (context.recordingStartedAt) {
    lines.push(["Recorded", new Date(context.recordingStartedAt + sentence.startMs).toLocaleString()]);
  }
  if (context.location) {
    const { LAT, LONG, accuracy } = context.location;
    const margin = typeof accuracy === "number" ? ` \u00B1${Math.round(accuracy)} m` : "";
    lines.push(["Location", `${LAT.toFixed(5)}, ${LONG.toFixed(5)}${margin}`]);
  }
  if (context.engineLabel) {
    lines.push(["Transcribed by", context.engineLabel]);
  }
  return lines;
}
