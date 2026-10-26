import { describe, expect, it, vi } from "vitest";
import { buildExportAudioFilter, buildOriginalCaptions, captionsToSrt, getWavDurationMs, splitExportPhrases, synthesizeTranscriptAudio } from "../../src/transcript/transcriptExport";
import type { TranscriptSentence } from "../../src/transcript/timedTranscript";

vi.mock("../../src/speech/supertonicTts", () => ({
  synthesizeSupertonicSamples: vi.fn(async (text: string) => ({ samples: new Array(text.startsWith("First") ? 1000 : 2000).fill(0), sampleRate: 1000 }))
}));

const sentence = (text: string, startMs: number, endMs: number): TranscriptSentence => ({
  id: text, paragraphId: "p1", text, startMs, endMs, words: []
});

describe("transcript export timing", () => {
  it("preserves original silence, scales caption times with speed, and clips to the audio", () => {
    const captions = buildOriginalCaptions([sentence("First.", 1000, 3000), sentence("Second.", 5000, 8000)]);
    expect(captionsToSrt(captions, 2, 3500)).toBe("1\n00:00:00,500 --> 00:00:01,500\nFirst.\n\n2\n00:00:02,500 --> 00:00:03,500\nSecond.\n");
  });

  it("drops invalid timings and resolves overlaps without negative or empty cues", () => {
    expect(buildOriginalCaptions([sentence("Untimed", 0, 0), sentence("Invalid", NaN, Infinity)])).toEqual([]);
    const srt = captionsToSrt([sentence("<b>Second</b>\nline", 900, 2000), sentence("First", -10, 1000)]);
    expect(srt).toContain("00:00:00,000 --> 00:00:01,000");
    expect(srt).toContain("00:00:01,000 --> 00:00:02,000\nSecond line");
    expect(srt).not.toContain("<b>");
  });

  it("splits long original captions on timed words", () => {
    const words = Array.from({ length: 24 }, (_, i) => ({ text: `word${i} `, startMs: i * 500, endMs: (i + 1) * 500 }));
    const captions = buildOriginalCaptions([{ ...sentence("long", 0, 12000), words }]);
    expect(captions.length).toBeGreaterThan(1);
    expect(captions.every((cue) => cue.text.length <= 84 && cue.endMs - cue.startMs <= 6000)).toBe(true);
    expect(captions.map((cue) => cue.text).join(" ")).toBe(words.map((word) => word.text).join("").trim());
  });

  it("keeps pitch independent of tempo even at range extremes", () => {
    const low = buildExportAudioFilter({ speed: 0.5, pitch: 12 });
    expect(low).toContain("asetrate=96000");
    expect(low).toContain("atempo=0.5,atempo=0.5");
    const high = buildExportAudioFilter({ speed: 2, pitch: -12 });
    expect(high).toContain("asetrate=24000");
    expect(high).toContain("atempo=2,atempo=2");
    expect(() => buildExportAudioFilter({ speed: NaN, pitch: 0 })).toThrow();
    expect(() => buildExportAudioFilter({ speed: 1, pitch: 13 })).toThrow();
  });

  it("uses synthesized sample lengths instead of original recognition times", async () => {
    const result = await synthesizeTranscriptAudio("First phrase. Second phrase.", "F1", vi.fn());
    expect(result.captions).toEqual([
      { text: "First phrase.", startMs: 0, endMs: 1000 },
      { text: "Second phrase.", startMs: 1000, endMs: 3000 }
    ]);
    expect(result.blob.type).toBe("audio/wav");
    expect(result.blob.size).toBe(6044);
  });

  it("bounds TTS phrases without losing words", () => {
    const text = "word ".repeat(100).trim();
    const phrases = splitExportPhrases(text);
    expect(phrases.every((phrase) => phrase.length <= 84)).toBe(true);
    expect(phrases.join(" ")).toBe(text);
  });

  it("reads WAV durations through optional RIFF metadata chunks", () => {
    const bytes = new Uint8Array(58 + 4000);
    const view = new DataView(bytes.buffer);
    const tag = (at: number, text: string) => [...text].forEach((char, i) => { bytes[at + i] = char.charCodeAt(0); });
    tag(0, "RIFF"); tag(8, "WAVE"); tag(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint32(28, 2000, true); tag(36, "JUNK"); view.setUint32(40, 5, true);
    tag(50, "data"); view.setUint32(54, 4000, true);
    expect(getWavDurationMs(bytes)).toBe(2000);
    expect(() => getWavDurationMs(new Uint8Array(44))).toThrow();
  });
});
