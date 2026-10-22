import type { StoredAudioPart } from "../recorder/audioStorage";
import type { TranscriptSentence } from "./timedTranscript";

export type LocatedTranscriptSentence = TranscriptSentence & {
  sequence: number;
  LAT: number;
  LONG: number;
};

export function locateTranscriptSentences(
  sentences: TranscriptSentence[],
  parts: StoredAudioPart[],
  recordingStartedAt: number | null
): LocatedTranscriptSentence[] {
  if (recordingStartedAt === null) return [];

  return sentences.flatMap((sentence, sequence) => {
    let bestPart: StoredAudioPart | undefined;
    let bestOverlap = 0;
    for (const part of parts) {
      const overlap = Math.min(sentence.endMs, Date.parse(part.endIso) - recordingStartedAt) -
        Math.max(sentence.startMs, Date.parse(part.startIso) - recordingStartedAt);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestPart = part;
      }
    }
    const latitude = bestPart?.LAT;
    const longitude = bestPart?.LONG;
    if (typeof latitude !== "number" || typeof longitude !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];

    return [{ ...sentence, sequence, LAT: latitude, LONG: longitude }];
  });
}
