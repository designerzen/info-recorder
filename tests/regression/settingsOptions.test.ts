import { describe, expect, it, vi } from "vitest";
import { defaultPageStyle } from "../../src/config/pageStyle";
import {
  cloneRuntimeSettings,
  defaultRuntimeSettings,
  encodeSettingsInUrl,
  getRealtimeSilenceRms,
  readSettingsFromUrl,
  settingsOptions
} from "../../src/config/settingsOptions";

describe("settingsOptions regressions", () => {
  it("deep-clones nested settings objects", () => {
    const clone = cloneRuntimeSettings(defaultRuntimeSettings);
    clone.vad.ml.speechLabels.push("narration");
    clone.tts.supertonic.voices[0].name = "Changed";
    clone.pageStyle.textColor = "#123456";

    expect(defaultRuntimeSettings.vad.ml.speechLabels).not.toContain("narration");
    expect(defaultRuntimeSettings.tts.supertonic.voices[0]?.name).not.toBe("Changed");
    expect(defaultRuntimeSettings.pageStyle.textColor).not.toBe("#123456");
  });

  it("reads URL settings, clamps numbers, and ignores invalid options", () => {
    const settings = readSettingsFromUrl(
      `?transcriptScrollSpeed=99&vad=fixed-rms&recordingFormat=mp3&transcriptionModel=onnx-community%2Fwhisper-base.en&voice=VoiceA&mic=mic-1&pageStyle=${encodeURIComponent(
        JSON.stringify({ ...defaultPageStyle, textColor: "#abcdef" })
      )}&voiceEngine=not-real`
    );

    expect(settings.transcript.autoScrollSpeed).toBe(10);
    expect(settings.vad.mode).toBe("fixed-rms");
    expect(settings.audio.recordingExportFormat).toBe("mp3");
    expect(settings.transcription.modelId).toBe("onnx-community/whisper-base.en");
    expect(settings.tts.selectedVoiceId).toBe("VoiceA");
    expect(settings.microphone.deviceId).toBe("mic-1");
    expect(settings.pageStyle.textColor).toBe("#abcdef");
    expect(settings.tts.provider).toBe(defaultRuntimeSettings.tts.provider);
  });

  it("writes current settings back into the URL", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.transcription.modelId = "onnx-community/whisper-tiny.en";
    settings.tts.selectedVoiceId = "VoiceB";
    settings.microphone.deviceId = "mic-2";
    settings.pageStyle.textColor = "#654321";
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    encodeSettingsInUrl(settings);

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const nextUrl = replaceStateSpy.mock.calls[0]?.[2];
    expect(String(nextUrl)).toContain("transcriptionModel=onnx-community%2Fwhisper-tiny.en");
    expect(String(nextUrl)).toContain("voice=VoiceB");
    expect(String(nextUrl)).toContain("mic=mic-2");
    expect(String(nextUrl)).toContain("pageStyle=");
  });

  it("defaults to whisper small english and exposes the browser-safe model list", () => {
    expect(defaultRuntimeSettings.transcription.modelId).toBe("onnx-community/whisper-small.en");

    const modelOption = settingsOptions.find((option) => option.key === "transcriptionModel");
    expect(modelOption?.kind).toBe("select");
    if (!modelOption || modelOption.kind !== "select") {
      throw new Error("Missing transcription model option.");
    }

    expect(modelOption.options.map((item) => item.value)).toEqual([
      "onnx-community/whisper-tiny.en",
      "onnx-community/whisper-base.en",
      "onnx-community/whisper-small.en",
      "onnx-community/whisper-tiny",
      "onnx-community/whisper-base",
      "onnx-community/whisper-small"
    ]);
  });

  it("selects the realtime silence threshold based on VAD mode and fallback", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);

    settings.vad.mode = "fixed-rms";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.fixedRms.threshold);

    settings.vad.mode = "rms-zcr";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.rmsZcr.minRms);

    settings.vad.mode = "transformers-audio-classification";
    settings.vad.ml.fallbackMode = "rms-zcr";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.rmsZcr.minRms);
  });
});
