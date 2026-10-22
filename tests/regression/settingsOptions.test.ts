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
  it("persists translation languages and ignores invalid language codes", () => {
    const settings = readSettingsFromUrl("?translationSource=es&translationTarget=de");
    expect(settings.translation).toEqual({ sourceLanguage: "es", targetLanguage: "de" });
    const clone = cloneRuntimeSettings(settings);
    clone.translation.targetLanguage = "fr";
    expect(settings.translation.targetLanguage).toBe("de");
    encodeSettingsInUrl(settings);
    expect(window.location.search).toContain("translationSource=es");
    expect(window.location.search).toContain("translationTarget=de");
    expect(readSettingsFromUrl("?translationSource=invalid").translation.sourceLanguage).toBe("en");
  });

  it("deep-clones nested settings objects", () => {
    const clone = cloneRuntimeSettings(defaultRuntimeSettings);
    clone.vad.ml.speechLabels.push("narration");
    clone.vad.silero.threshold = 0.2;
    clone.tts.supertonic.voices[0].name = "Changed";
    clone.pageStyle.textColor = "#123456";

    expect(defaultRuntimeSettings.vad.ml.speechLabels).not.toContain("narration");
    expect(defaultRuntimeSettings.vad.silero.threshold).not.toBe(0.2);
    expect(defaultRuntimeSettings.tts.supertonic.voices[0]?.name).not.toBe("Changed");
    expect(defaultRuntimeSettings.pageStyle.textColor).not.toBe("#123456");
  });

  it("reads URL settings, clamps numbers, and ignores invalid options", () => {
    const settings = readSettingsFromUrl(
      `?transcriptScrollSpeed=99&activityDetection=1&vad=fixed-rms&recordingFormat=mp3&transcriptionModel=onnx-community%2Fwhisper-base.en&voice=VoiceA&mic=mic-1&pageStyle=${encodeURIComponent(
        JSON.stringify({ ...defaultPageStyle, textColor: "#abcdef" })
      )}&voiceEngine=not-real&sentencePlaybackMode=source-audio`
    );

    expect(settings.transcript.autoScrollSpeed).toBe(10);
    expect(settings.vad.enabled).toBe(true);
    expect(settings.vad.mode).toBe("fixed-rms");
    expect(settings.audio.recordingExportFormat).toBe("mp3");
    expect(settings.transcription.modelId).toBe(defaultRuntimeSettings.transcription.modelId);
    expect(settings.tts.selectedVoiceId).toBe("VoiceA");
    expect(settings.microphone.deviceId).toBe("mic-1");
    expect(settings.pageStyle.textColor).toBe("#abcdef");
    expect(settings.tts.provider).toBe(defaultRuntimeSettings.tts.provider);
    expect(settings.tts.sentencePlaybackMode).toBe("source-audio");
  });

  it("writes current settings back into the URL", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.transcription.modelId = "onnx-community/whisper-tiny.en_timestamped";
    settings.tts.selectedVoiceId = "VoiceB";
    settings.microphone.deviceId = "mic-2";
    settings.pageStyle.textColor = "#654321";
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    encodeSettingsInUrl(settings);

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    const nextUrl = replaceStateSpy.mock.calls[0]?.[2];
    expect(String(nextUrl)).toContain("transcriptionModel=onnx-community%2Fwhisper-tiny.en_timestamped");
    expect(String(nextUrl)).toContain("voice=VoiceB");
    expect(String(nextUrl)).toContain("mic=mic-2");
    expect(String(nextUrl)).toContain("pageStyle=");
  });

  it("round-trips the Silero VAD mode through URL settings", () => {
    const settings = readSettingsFromUrl("?activityDetection=1&vad=silero-vad&sileroSpeechThreshold=0.65");

    expect(settings.vad.enabled).toBe(true);
    expect(settings.vad.mode).toBe("silero-vad");
    expect(settings.vad.silero.threshold).toBe(0.65);
  });

  it("defaults to Moonshine Small Streaming and keeps timestamp-capable Whisper choices", () => {
    expect(defaultRuntimeSettings.transcription.modelId).toBe("moonshine:small-streaming-en");
    expect(defaultRuntimeSettings.vad.enabled).toBe(false);

    const modelOption = settingsOptions.find((option) => option.key === "transcriptionModel");
    expect(modelOption?.kind).toBe("select");
    if (!modelOption || modelOption.kind !== "select") {
      throw new Error("Missing transcription model option.");
    }

    expect(modelOption.options.map((item) => item.value)).toEqual([
      "moonshine:tiny-streaming-en",
      "moonshine:small-streaming-en",
      "moonshine:medium-streaming-en",
      "onnx-community/whisper-tiny.en_timestamped",
      "onnx-community/whisper-base.en_timestamped",
      "onnx-community/whisper-small.en_timestamped",
      "onnx-community/whisper-medium.en_timestamped",
      "onnx-community/whisper-tiny_timestamped",
      "onnx-community/whisper-base_timestamped",
      "onnx-community/whisper-small_timestamped",
      "onnx-community/whisper-medium_timestamped",
      "onnx-community/whisper-large-v3-turbo_timestamped",
      "wasm:tiny.en",
      "wasm:tiny",
      "wasm:base.en",
      "wasm:base",
      "wasm:small.en",
      "wasm:small",
      "wasm:tiny.en-q5_1",
      "wasm:tiny-q5_1",
      "wasm:base.en-q5_1",
      "wasm:base-q5_1",
      "wasm:small.en-q5_1",
      "wasm:small-q5_1",
      "wasm:medium.en-q5_0",
      "wasm:medium-q5_0",
      "wasm:large-q5_0"
    ]);
    const moonshineModel = modelOption.options.find((item) => item.value === "moonshine:small-streaming-en");
    expect(moonshineModel?.label).toContain("Moonshine WASM");
    expect(moonshineModel?.label).toContain("Word timestamps");
    const wasmModel = modelOption.options.find((item) => item.value === "wasm:base.en-q5_1");
    expect(wasmModel?.label).toContain("WASM GGML");
    expect(wasmModel?.label).toContain("Segment timestamps");
  });

  it("selects the realtime silence threshold based on VAD mode and fallback", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);

    settings.vad.mode = "fixed-rms";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.fixedRms.threshold);

    settings.vad.mode = "rms-zcr";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.rmsZcr.minRms);

    settings.vad.mode = "silero-vad";
    settings.vad.silero.fallbackMode = "fixed-rms";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.fixedRms.threshold);

    settings.vad.mode = "transformers-audio-classification";
    settings.vad.ml.fallbackMode = "rms-zcr";
    expect(getRealtimeSilenceRms(settings)).toBe(settings.vad.rmsZcr.minRms);
  });
});
