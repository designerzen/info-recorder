export type VadMode =
  | "adaptive-rms"
  | "fixed-rms"
  | "rms-zcr"
  | "silero-vad"
  | "transformers-audio-classification";

export type TtsProvider = "web-speech" | "supertonic-web";
export type RecordingExportFormat = "native" | "ogg-vorbis" | "ogg-opus" | "mp3" | "flac" | "wav";
export type SentencePlaybackMode = "tts" | "source-audio";
import { defaultTypeface } from "./typefaces";
export type OnnxTranscriptionModelId =
  | "onnx-community/whisper-tiny.en_timestamped"
  | "onnx-community/whisper-base.en_timestamped"
  | "onnx-community/whisper-small.en_timestamped"
  | "onnx-community/whisper-medium.en_timestamped"
  | "onnx-community/whisper-tiny_timestamped"
  | "onnx-community/whisper-base_timestamped"
  | "onnx-community/whisper-small_timestamped"
  | "onnx-community/whisper-medium_timestamped"
  | "onnx-community/whisper-large-v3-turbo_timestamped";
export type WasmWhisperModelId =
  | "tiny.en"
  | "tiny"
  | "base.en"
  | "base"
  | "small.en"
  | "small"
  | "tiny.en-q5_1"
  | "tiny-q5_1"
  | "base.en-q5_1"
  | "base-q5_1"
  | "small.en-q5_1"
  | "small-q5_1"
  | "medium.en-q5_0"
  | "medium-q5_0"
  | "large-q5_0";
export type WasmTranscriptionModelId = `wasm:${WasmWhisperModelId}`;
export type TranscriptionModelId = OnnxTranscriptionModelId | WasmTranscriptionModelId;

export type SupertonicVoiceId =
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5";

export type AppSettings = {
  audio: {
    transcriptionChunkMs: number;
    opfsChunkMs: number;
    overlapMs: number;
    recordingExportFormat: RecordingExportFormat;
  };
  transcript: {
    autoScrollSpeed: number;
  };
  transcription: {
    modelId: TranscriptionModelId;
    device: "webgpu";
    isMultilingual: boolean;
    language: string;
    task: "transcribe" | "translate";
    cacheModelOnFirstUse: boolean;
  };
  vad: {
    enabled: boolean;
    mode: VadMode;
    minSpeechMs: number;
    paragraphSilenceMs: number;
    partSilenceMs: number;
    adaptiveRms: {
      frameMs: number;
      minRms: number;
      noisePercentile: number;
      noiseMultiplier: number;
    };
    fixedRms: {
      frameMs: number;
      threshold: number;
    };
    rmsZcr: {
      frameMs: number;
      minRms: number;
      minZeroCrossingRate: number;
      maxZeroCrossingRate: number;
    };
    silero: {
      modelId: string;
      threshold: number;
      fallbackMode: Exclude<VadMode, "silero-vad" | "transformers-audio-classification">;
    };
    ml: {
      modelId: string;
      device: "webgpu" | "wasm";
      speechLabels: string[];
      threshold: number;
      fallbackMode: Exclude<VadMode, "transformers-audio-classification">;
    };
  };
  waveform: {
    historySamples: number;
    samplesPerFrame: number;
  };
  subtitles: {
    renderer: "jassub";
    assDurationSeconds: number;
    fontFamily: string;
    fontSize: number;
    marginV: number;
  };
  tts: {
    provider: TtsProvider;
    sentencePlaybackMode: SentencePlaybackMode;
    enabledByDefault: boolean;
    lang: string;
    rate: number;
    pitch: number;
    volume: number;
    supertonic: {
      assetsBasePath: string;
      onnxDir: string;
      voiceStylesDir: string;
      defaultVoiceId: SupertonicVoiceId;
      language: string;
      totalStep: number;
      speed: number;
      silenceDuration: number;
      voices: Array<{
        id: SupertonicVoiceId;
        name: string;
        styleFile: string;
      }>;
    };
  };
};

export const appSettings: AppSettings = {
  audio: {
    transcriptionChunkMs: 5000,
    opfsChunkMs: 2000,
    overlapMs: 750,
    recordingExportFormat: "native"
  },
  transcript: {
    autoScrollSpeed: 5
  },
  transcription: {
    modelId: "onnx-community/whisper-small.en_timestamped",
    device: "webgpu",
    isMultilingual: false,
    language: "en",
    task: "transcribe",
    cacheModelOnFirstUse: true
  },
  vad: {
    enabled: false,
    mode: "adaptive-rms",
    minSpeechMs: 180,
    paragraphSilenceMs: 1200,
    partSilenceMs: 1200,
    adaptiveRms: {
      frameMs: 30,
      minRms: 0.012,
      noisePercentile: 0.2,
      noiseMultiplier: 3.2
    },
    fixedRms: {
      frameMs: 30,
      threshold: 0.018
    },
    rmsZcr: {
      frameMs: 30,
      minRms: 0.011,
      minZeroCrossingRate: 0.015,
      maxZeroCrossingRate: 0.35
    },
    silero: {
      modelId: "BricksDisplay/silero-vad-6.2",
      threshold: 0.5,
      fallbackMode: "adaptive-rms"
    },
    ml: {
      modelId: "BricksDisplay/silero-vad-6.2",
      device: "webgpu",
      speechLabels: ["speech", "voice", "talking"],
      threshold: 0.5,
      fallbackMode: "adaptive-rms"
    }
  },
  waveform: {
    historySamples: 1200,
    samplesPerFrame: 16
  },
  subtitles: {
    renderer: "jassub",
    assDurationSeconds: 60,
    fontFamily: defaultTypeface.assFamily,
    fontSize: 54,
    marginV: 58
  },
  tts: {
    provider: "web-speech",
    sentencePlaybackMode: "tts",
    enabledByDefault: false,
    lang: "en-US",
    rate: 1,
    pitch: 1,
    volume: 0.9,
    supertonic: {
      assetsBasePath: "https://huggingface.co/Supertone/supertonic-3/resolve/main",
      onnxDir: "https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx",
      voiceStylesDir: "https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles",
      defaultVoiceId: "M1",
      language: "en",
      totalStep: 8,
      speed: 1.05,
      silenceDuration: 0.3,
      voices: [
        { id: "M1", name: "Supertonic Male 1", styleFile: "M1.json" },
        { id: "M2", name: "Supertonic Male 2", styleFile: "M2.json" },
        { id: "M3", name: "Supertonic Male 3", styleFile: "M3.json" },
        { id: "M4", name: "Supertonic Male 4", styleFile: "M4.json" },
        { id: "M5", name: "Supertonic Male 5", styleFile: "M5.json" },
        { id: "F1", name: "Supertonic Female 1", styleFile: "F1.json" },
        { id: "F2", name: "Supertonic Female 2", styleFile: "F2.json" },
        { id: "F3", name: "Supertonic Female 3", styleFile: "F3.json" },
        { id: "F4", name: "Supertonic Female 4", styleFile: "F4.json" },
        { id: "F5", name: "Supertonic Female 5", styleFile: "F5.json" }
      ]
    }
  }
};

export function isWasmTranscriptionModelId(modelId: TranscriptionModelId): modelId is WasmTranscriptionModelId {
  return modelId.startsWith("wasm:");
}

export function getWasmWhisperModelId(modelId: WasmTranscriptionModelId): WasmWhisperModelId {
  return modelId.slice("wasm:".length) as WasmWhisperModelId;
}
