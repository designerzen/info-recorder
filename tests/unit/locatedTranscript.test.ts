import { describe, expect, it } from "vitest";
import { locateTranscriptSentences } from "../../src/transcript/locatedTranscript";
import type { StoredAudioPart } from "../../src/recorder/audioStorage";
import type { TranscriptSentence } from "../../src/transcript/timedTranscript";

const startedAt = Date.parse("2026-10-22T12:00:00Z");
const sentence = (id: string, startMs: number, endMs: number): TranscriptSentence => ({
  id, paragraphId: "p1", text: id, startMs, endMs, words: []
});
const part = (sequence: number, start: number, end: number, LAT: number | null = 51): StoredAudioPart => ({
  name: `part-${sequence}`, sequence, startIso: new Date(startedAt + start).toISOString(),
  endIso: new Date(startedAt + end).toISOString(), durationMs: end - start,
  LAT, LONG: 0, chunks: []
});

describe("located transcript", () => {
  it("matches multiple sentences in one phrase by time instead of sequence", () => {
    const sentences = [sentence("one", 100, 800), sentence("two", 900, 1800), sentence("three", 4000, 5000)];
    const result = locateTranscriptSentences(sentences, [part(8, 0, 2000), part(9, 3500, 6000, 52)], startedAt);
    expect(result.map(({ id, LAT, LONG }) => ({ id, LAT, LONG }))).toEqual([
      { id: "one", LAT: 51, LONG: 0 }, { id: "two", LAT: 51, LONG: 0 }, { id: "three", LAT: 52, LONG: 0 }
    ]);
  });

  it("does not borrow coordinates from an unrelated or unlocated phrase", () => {
    expect(locateTranscriptSentences([sentence("no location", 3000, 4000)], [part(0, 0, 2000), part(1, 3000, 5000, null)], startedAt)).toEqual([]);
    expect(locateTranscriptSentences([sentence("invalid", 0, 1000)], [part(0, 0, 2000, 91)], startedAt)).toEqual([]);
    expect(locateTranscriptSentences([sentence("uploaded", 0, 1000)], [part(0, 0, 2000)], null)).toEqual([]);
  });

  it("uses the phrase with the greatest overlap for a boundary-spanning sentence", () => {
    expect(locateTranscriptSentences([sentence("boundary", 800, 1800)], [part(0, 0, 1000), part(1, 1000, 2000, 52)], startedAt)[0].LAT).toBe(52);
  });
});
