import { act, mountService } from "../dom";
import { describe, expect, it, vi } from "vitest";
import type { TranscriptSentence } from "../../src/transcript/timedTranscript";
import { getActiveTranscriptPosition, createSubtitleSpeech } from "../../src/speech/createSubtitleSpeech";
import { cloneRuntimeSettings, defaultRuntimeSettings } from "../../src/config/settingsOptions";

const transcriptSentences: TranscriptSentence[] = [
  {
    id: "s-1",
    paragraphId: "p-1",
    text: "Hello there.",
    startMs: 0,
    endMs: 900,
    words: [
      { text: "Hello ", startMs: 0, endMs: 450 },
      { text: "there.", startMs: 450, endMs: 900 }
    ]
  },
  {
    id: "s-2",
    paragraphId: "p-1",
    text: "General Kenobi!",
    startMs: 900,
    endMs: 1800,
    words: [
      { text: "General ", startMs: 900, endMs: 1300 },
      { text: "Kenobi!", startMs: 1300, endMs: 1800 }
    ]
  }
];

describe("playback volume", () => {
  it.each([0, 0.25, 1])("applies volume %s to full source and sentence playback", async (volume) => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.tts.volume = volume;
    const { result, unmount } = mountService(createSubtitleSpeech("", transcriptSentences, settings.tts, vi.fn()));
    try {
      await act(async () => {
        await result.current.playSourceMedia({ url: "test.wav", kind: "audio" });
      });
      expect(play.mock.instances[0]?.volume).toBe(volume);
      act(() => {
        result.current.playSentence(transcriptSentences[0], { url: "test.wav", kind: "audio" }, "source-audio");
      });
      unmount();
      expect(pause.mock.instances.at(-1)?.volume).toBe(volume);
    } finally {
      unmount();
      play.mockRestore();
      pause.mockRestore();
    }
  });
});

describe("getActiveTranscriptPosition", () => {
  it("returns the active sentence and word during source playback", () => {
    expect(getActiveTranscriptPosition(transcriptSentences, 250)).toEqual({
      sentenceId: "s-1",
      sentenceText: "Hello there.",
      wordIndex: 0
    });
    expect(getActiveTranscriptPosition(transcriptSentences, 1450)).toEqual({
      sentenceId: "s-2",
      sentenceText: "General Kenobi!",
      wordIndex: 1
    });
  });

  it("falls back to the last word when the clock passes a word boundary inside a sentence", () => {
    expect(getActiveTranscriptPosition(transcriptSentences, 899)).toEqual({
      sentenceId: "s-1",
      sentenceText: "Hello there.",
      wordIndex: 1
    });
  });

  it("returns null when playback is outside known transcript timing", () => {
    expect(getActiveTranscriptPosition(transcriptSentences, 2200)).toBeNull();
  });
});

describe("map passage audio", () => {
  it("plays timestamped passages even when word-level timestamps are absent", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const createElement = vi.spyOn(document, "createElement");
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    const passage = { ...transcriptSentences[1], words: [] };
    const { result, unmount } = mountService(createSubtitleSpeech("", [passage], settings.tts, vi.fn()));
    act(() => result.current.playSentence(passage, { url: "recording.webm", kind: "audio" }, "source-audio"));
    const media = createElement.mock.results.find((entry) => entry.value instanceof HTMLMediaElement)?.value as HTMLMediaElement;
    await act(async () => media.dispatchEvent(new Event("loadedmetadata")));
    expect(media.currentTime).toBe(passage.startMs / 1000);
    expect(play).toHaveBeenCalledOnce();
    unmount();
  });
});
