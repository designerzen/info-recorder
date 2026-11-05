import { describe, expect, it } from "vitest";
import { estimateWordTimings, joinTranscriptWords, replaceSentenceText, splitParagraphIntoSentences, type TranscriptParagraph } from "../../src/transcript/timedTranscript";
import { describeSentence, formatClock } from "../../src/transcript/sentenceMeta";
import { captionsToVtt, locatedTranscriptToGeoJson, locatedTranscriptToGpx } from "../../src/transcript/transcriptExport";
import { RecordedAudio } from "../../src/recorder/recordedAudio";

function paragraphOf(text: string, gapAfter: Record<number, number> = {}): TranscriptParagraph {
  let clock = 0;
  const words = (text.match(/\S+\s*/g) ?? []).map((word, index) => {
    const timed = { text: word, startMs: clock, endMs: clock + 100 };
    clock += 100 + (gapAfter[index] ?? 0);
    return timed;
  });
  return { id: "p", text, words };
}
const split = (text: string, gapAfter?: Record<number, number>) => splitParagraphIntoSentences(paragraphOf(text, gapAfter)).map((sentence) => sentence.text);

describe("sentence splitting", () => {
  it("does not break after titles or inside initialisms", () => {
    expect(split("Dr. Smith met Mr. Jones at 3 p.m. in the U.S. today.")).toEqual(["Dr. Smith met Mr. Jones at 3 p.m. in the U.S. today."]);
  });

  it("ends a sentence on an initialism when a capitalised word follows", () => {
    expect(split("We left at 3 p.m. Then it rained.")).toEqual(["We left at 3 p.m.", "Then it rained."]);
  });

  it("recognises full-width sentence punctuation", () => {
    expect(split("\u4ECA\u5929 \u5F88\u597D\u3002 \u6211\u4EEC \u51FA\u53BB\uFF01")).toHaveLength(2);
  });

  it("uses long pauses and a length limit when speech has no punctuation", () => {
    expect(split("so we walked to the river and then turned", { 5: 1500 })).toEqual(["so we walked to the river", "and then turned"]);
    expect(split(Array.from({ length: 40 }, () => "word").join(" "))).toHaveLength(2);
  });
});

describe("estimated word timings", () => {
  it("spreads words by length across the window", () => {
    expect(estimateWordTimings("Go home ", 1000, 1600)).toEqual([
      { text: "Go ", startMs: 1000, endMs: 1200 },
      { text: "home ", startMs: 1200, endMs: 1600 }
    ]);
    expect(estimateWordTimings("", 0, 100)).toEqual([]);
  });

  it("gives results arriving together a playable duration", () => {
    expect(estimateWordTimings("One two.", 500, 500).at(-1)!.endMs).toBeGreaterThan(500);
  });
});

describe("sentence editing", () => {
  it("replaces one sentence and keeps the others and its place on the timeline", () => {
    const paragraph = paragraphOf("First one. Second one. Third one.");
    const [, second] = splitParagraphIntoSentences(paragraph);
    const edited = replaceSentenceText(paragraph, second, "Corrected words here.");
    expect(edited.text).toBe("First one. Corrected words here. Third one.");
    expect(joinTranscriptWords(edited.words)).toBe(edited.text);
    const [, updated, third] = splitParagraphIntoSentences(edited);
    expect(updated.startMs).toBeCloseTo(second.startMs);
    expect(updated.endMs).toBeCloseTo(second.endMs);
    expect(third.text).toBe("Third one.");
  });

  it("removes a sentence when its text is cleared", () => {
    const paragraph = paragraphOf("Only sentence.");
    const [only] = splitParagraphIntoSentences(paragraph);
    expect(replaceSentenceText(paragraph, only, "  ").text).toBe("");
  });
});

describe("sentence details", () => {
  const sentence = { id: "s", paragraphId: "p", text: "Two words.", startMs: 65000, endMs: 67500, words: [] };

  it("formats clocks with hours only when needed", () => {
    expect(formatClock(65000)).toBe("01:05");
    expect(formatClock(3725000)).toBe("01:02:05");
  });

  it("lists time, words, location with accuracy and engine", () => {
    const details = Object.fromEntries(describeSentence(sentence, { location: { LAT: 51.5, LONG: -0.12, accuracy: 12.4 }, engineLabel: "Moonshine" }));
    expect(details).toMatchObject({ Time: "01:05 \u2013 01:07 (2.5 s)", Words: "2", Location: "51.50000, -0.12000 \u00B112 m", "Transcribed by": "Moonshine" });
  });

  it("names the source file for uploads and leaves out what is unknown", () => {
    const details = Object.fromEntries(describeSentence({ ...sentence, endMs: 0, startMs: 0 }, { sourceName: "talk.mp3" }));
    expect(details).toEqual({ Words: "2", Source: "talk.mp3" });
  });
});

describe("subtitle and route exports", () => {
  const located = [{ id: "s", paragraphId: "p", sequence: 0, text: "Tom & <Jerry>", startMs: 1000, endMs: 2000, words: [], LAT: 51.5, LONG: -0.12 }];
  const track = [{ atMs: 0, LAT: 51.5, LONG: -0.12 }, { atMs: 1000, LAT: 51.6, LONG: -0.13 }];

  it("writes WebVTT with dotted times and no cue-breaking text", () => {
    expect(captionsToVtt([{ text: "a --> b", startMs: 1000, endMs: 2500 }])).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\na \u2192 b\n");
  });

  it("writes GeoJSON longitude first, with the route and sentences", () => {
    const geo = JSON.parse(locatedTranscriptToGeoJson(located, track, 0));
    expect(geo.features[0].geometry).toEqual({ type: "LineString", coordinates: [[-0.12, 51.5], [-0.13, 51.6]] });
    expect(geo.features[1]).toMatchObject({ geometry: { type: "Point", coordinates: [-0.12, 51.5] }, properties: { text: "Tom & <Jerry>", time: "1970-01-01T00:00:01.000Z" } });
  });

  it("escapes spoken text in GPX", () => {
    const gpx = locatedTranscriptToGpx(located, track, null);
    expect(gpx).toContain('<wpt lat="51.5" lon="-0.12">');
    expect(gpx).toContain("Tom &#38; &#60;Jerry&#62;");
    expect(gpx).toContain("<trkpt");
  });
});

describe("saving recorded audio", () => {
  it("hands over only unsaved audio and restores saved audio without re-saving it", () => {
    const audio = new RecordedAudio();
    audio.append(new Float32Array(4), 16000);
    expect(audio.takeUnsaved()?.size).toBe(8);
    expect(audio.takeUnsaved()).toBeNull();
    audio.append(new Float32Array(2), 16000);
    expect(audio.takeUnsaved()?.size).toBe(4);
    const restored = new RecordedAudio();
    restored.restore([new Blob([new Uint8Array(12)])], 8000);
    expect(restored.hasAudio).toBe(true);
    expect(restored.sampleRateHz).toBe(8000);
    expect(restored.takeUnsaved()).toBeNull();
  });
});
