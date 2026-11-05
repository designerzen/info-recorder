import { describe, expect, it } from "vitest";
import { locateTranscriptSentences, type LocationFix } from "../../src/transcript/locatedTranscript";
import type { TranscriptSentence } from "../../src/transcript/timedTranscript";

const sentence = (id: string, startMs: number, endMs: number): TranscriptSentence => ({
  id, paragraphId: "p1", text: id, startMs, endMs, words: []
});
const fix = (atMs: number, LAT: number, LONG = 0, accuracy?: number): LocationFix => ({ atMs, LAT, LONG, accuracy });

describe("located transcript", () => {
  it("places each sentence where it began, between the surrounding fixes", () => {
    const result = locateTranscriptSentences([sentence("start", 0, 500), sentence("middle", 1000, 1500), sentence("end", 5000, 5500)],
      [fix(0, 50, 0, 8), fix(2000, 52, 2)]);
    expect(result.map(({ id, LAT, LONG }) => ({ id, LAT, LONG }))).toEqual([
      { id: "start", LAT: 50, LONG: 0 }, { id: "middle", LAT: 51, LONG: 1 }, { id: "end", LAT: 52, LONG: 2 }
    ]);
    expect(result[0].accuracy).toBe(8);
  });

  it("uses the first fix for speech before the first location arrives", () => {
    expect(locateTranscriptSentences([sentence("early", 100, 200)], [fix(4000, 51)])[0].LAT).toBe(51);
  });

  it("leaves sentences unplaced without a usable track or timing", () => {
    expect(locateTranscriptSentences([sentence("none", 0, 100)], [])).toEqual([]);
    expect(locateTranscriptSentences([sentence("invalid", 0, 100)], [fix(0, 91)])).toEqual([]);
    expect(locateTranscriptSentences([sentence("untimed", 0, 0)], [fix(0, 51)])).toEqual([]);
  });

  it("numbers sentences by transcript order even when some cannot be placed", () => {
    const result = locateTranscriptSentences([sentence("untimed", 0, 0), sentence("timed", 0, 100)], [fix(0, 51)]);
    expect(result.map(({ id, sequence }) => [id, sequence])).toEqual([["timed", 1]]);
  });
});
