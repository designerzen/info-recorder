import { describe, expect, it } from "vitest";
import {
  splitSpeechPhrases,
  splitSpeechPhrasesFromBlocks
} from "../../src/speech/subtitlePhrases";

describe("subtitlePhrases", () => {
  it("splits text into phrases while preserving punctuation", () => {
    expect(splitSpeechPhrases("Hello there. General Kenobi!")).toEqual([
      { text: "Hello there. " },
      { text: "General Kenobi!" }
    ]);
  });

  it("treats line breaks as phrase boundaries", () => {
    expect(splitSpeechPhrases("One line\nTwo line")).toEqual([
      { text: "One line\n" },
      { text: "Two line" }
    ]);
  });

  it("keeps matched spacing but still drops fully empty input", () => {
    expect(splitSpeechPhrases("   lone phrase   ")).toEqual([{ text: "   lone phrase   " }]);
    expect(splitSpeechPhrases("   ")).toEqual([]);
  });

  it("splits every transcript block independently", () => {
    expect(splitSpeechPhrasesFromBlocks(["Alpha. Beta?", "Gamma"])).toEqual([
      {
        text: "Alpha. Beta?",
        phrases: [{ text: "Alpha. " }, { text: "Beta?" }]
      },
      {
        text: "Gamma",
        phrases: [{ text: "Gamma" }]
      }
    ]);
  });
});
