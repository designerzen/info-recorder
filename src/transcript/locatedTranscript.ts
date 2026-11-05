import type { TranscriptSentence } from "./timedTranscript";

/** One position on the recording timeline. */
export type LocationFix = {
  atMs: number;
  LAT: number;
  LONG: number;
  accuracy?: number;
};

export type LocatedTranscriptSentence = TranscriptSentence & {
  sequence: number;
  LAT: number;
  LONG: number;
  accuracy?: number;
};

export function locateTranscriptSentences(
  sentences: TranscriptSentence[],
  track: LocationFix[]
): LocatedTranscriptSentence[] {
  const fixes = track.filter(isValidFix);
  if (fixes.length === 0) return [];

  return sentences.flatMap((sentence, sequence) => {
    if (sentence.endMs <= sentence.startMs) return [];
    return [{ ...sentence, sequence, ...positionAt(fixes, sentence.startMs) }];
  });
}

/** Interpolate between neighbouring fixes; before the first or after the last, use the nearest. */
export function positionAt(fixes: LocationFix[], atMs: number) {
  const nextIndex = fixes.findIndex((fix) => fix.atMs > atMs);
  if (nextIndex === 0) return pick(fixes[0]);
  if (nextIndex === -1) return pick(fixes[fixes.length - 1]);
  const previous = fixes[nextIndex - 1];
  const next = fixes[nextIndex];
  const progress = (atMs - previous.atMs) / (next.atMs - previous.atMs);
  return {
    LAT: previous.LAT + (next.LAT - previous.LAT) * progress,
    LONG: previous.LONG + (next.LONG - previous.LONG) * progress,
    accuracy: previous.accuracy
  };
}

function pick({ LAT, LONG, accuracy }: LocationFix) {
  return { LAT, LONG, accuracy };
}

function isValidFix({ LAT, LONG }: LocationFix) {
  return Number.isFinite(LAT) && Number.isFinite(LONG) && Math.abs(LAT) <= 90 && Math.abs(LONG) <= 180;
}
