import {
  appSettings,
  type AppSettings,
  type RecordingExportFormat,
  type TtsProvider,
  type VadMode
} from "./settings";
import {
  clonePageStyle,
  decodePageStyle,
  defaultPageStyle,
  encodePageStyle,
  type PageStyleSettings
} from "./pageStyle";

export type RuntimeTtsSettings = AppSettings["tts"] & {
  enabled: boolean;
  selectedVoiceId: string;
};

export type RuntimeSettings = Omit<AppSettings, "tts"> & {
  microphone: {
    deviceId: string;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  pageStyle: PageStyleSettings;
  recording: {
    shouldRecordToOpfs: boolean;
  };
  tts: RuntimeTtsSettings;
};

type SelectOption<T extends string = string> = {
  label: string;
  value: T;
};

export type SettingsOption =
  | {
      key: string;
      section: "microphone" | "activity" | "recording" | "speech" | "transcript";
      label: string;
      kind: "checkbox";
      getValue: (settings: RuntimeSettings) => boolean;
      setValue: (settings: RuntimeSettings, value: boolean) => RuntimeSettings;
    }
  | {
      key: string;
      section: "microphone" | "activity" | "recording" | "speech" | "transcript";
      label: string;
      kind: "number" | "slider";
      min: number;
      max: number;
      step: number;
      valueLabel?: (value: number) => string;
      getValue: (settings: RuntimeSettings) => number;
      setValue: (settings: RuntimeSettings, value: number) => RuntimeSettings;
    }
  | {
      key: string;
      section: "microphone" | "activity" | "recording" | "speech" | "transcript";
      label: string;
      kind: "select";
      options: SelectOption[];
      getValue: (settings: RuntimeSettings) => string;
      setValue: (settings: RuntimeSettings, value: string) => RuntimeSettings;
    };

export const defaultRuntimeSettings: RuntimeSettings = {
  ...appSettings,
  audio: { ...appSettings.audio },
  transcription: { ...appSettings.transcription },
  vad: {
    ...appSettings.vad,
    adaptiveRms: { ...appSettings.vad.adaptiveRms },
    fixedRms: { ...appSettings.vad.fixedRms },
    rmsZcr: { ...appSettings.vad.rmsZcr },
    ml: {
      ...appSettings.vad.ml,
      speechLabels: [...appSettings.vad.ml.speechLabels]
    }
  },
  waveform: { ...appSettings.waveform },
  transcript: { ...appSettings.transcript },
  subtitles: { ...appSettings.subtitles },
  microphone: {
    deviceId: "",
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  pageStyle: clonePageStyle(defaultPageStyle),
  recording: {
    shouldRecordToOpfs: true
  },
  tts: {
    ...appSettings.tts,
    supertonic: {
      ...appSettings.tts.supertonic,
      voices: appSettings.tts.supertonic.voices.map((voice) => ({ ...voice }))
    },
    enabled: appSettings.tts.enabledByDefault,
    selectedVoiceId: appSettings.tts.supertonic.defaultVoiceId
  }
};

export const vadModeOptions: SelectOption<VadMode>[] = [
  { value: "adaptive-rms", label: "Adaptive RMS" },
  { value: "fixed-rms", label: "Fixed RMS" },
  { value: "rms-zcr", label: "RMS + zero crossings" },
  { value: "transformers-audio-classification", label: "Transformers audio classifier" }
];

export const ttsProviderOptions: SelectOption<TtsProvider>[] = [
  { value: "web-speech", label: "Browser voices" },
  { value: "supertonic-web", label: "Supertonic WebGPU" }
];

export const recordingExportFormatOptions: SelectOption<RecordingExportFormat>[] = [
  { value: "native", label: "Native browser recording" },
  { value: "ogg-vorbis", label: "Ogg Vorbis" },
  { value: "ogg-opus", label: "Ogg Opus" },
  { value: "mp3", label: "MP3" },
  { value: "flac", label: "FLAC" },
  { value: "wav", label: "WAV" }
];

export const settingsOptions: SettingsOption[] = [
  {
    key: "echoCancellation",
    section: "microphone",
    label: "Echo cancellation",
    kind: "checkbox",
    getValue: (settings) => settings.microphone.echoCancellation,
    setValue: (settings, value) => ({
      ...settings,
      microphone: { ...settings.microphone, echoCancellation: value }
    })
  },
  {
    key: "noiseSuppression",
    section: "microphone",
    label: "Noise suppression",
    kind: "checkbox",
    getValue: (settings) => settings.microphone.noiseSuppression,
    setValue: (settings, value) => ({
      ...settings,
      microphone: { ...settings.microphone, noiseSuppression: value }
    })
  },
  {
    key: "autoGainControl",
    section: "microphone",
    label: "Auto gain control",
    kind: "checkbox",
    getValue: (settings) => settings.microphone.autoGainControl,
    setValue: (settings, value) => ({
      ...settings,
      microphone: { ...settings.microphone, autoGainControl: value }
    })
  },
  {
    key: "vad",
    section: "activity",
    label: "Detection method",
    kind: "select",
    options: vadModeOptions,
    getValue: (settings) => settings.vad.mode,
    setValue: (settings, value) => ({
      ...settings,
      vad: { ...settings.vad, mode: value as VadMode }
    })
  },
  {
    key: "adaptiveSilence",
    section: "activity",
    label: "Adaptive silence floor",
    kind: "slider",
    min: 0.001,
    max: 0.08,
    step: 0.001,
    valueLabel: formatRmsValue,
    getValue: (settings) => settings.vad.adaptiveRms.minRms,
    setValue: (settings, value) => ({
      ...settings,
      vad: {
        ...settings.vad,
        adaptiveRms: { ...settings.vad.adaptiveRms, minRms: value }
      }
    })
  },
  {
    key: "fixedSilence",
    section: "activity",
    label: "Fixed silence point",
    kind: "slider",
    min: 0.001,
    max: 0.08,
    step: 0.001,
    valueLabel: formatRmsValue,
    getValue: (settings) => settings.vad.fixedRms.threshold,
    setValue: (settings, value) => ({
      ...settings,
      vad: {
        ...settings.vad,
        fixedRms: { ...settings.vad.fixedRms, threshold: value }
      }
    })
  },
  {
    key: "zcrSilence",
    section: "activity",
    label: "RMS+ZCR silence point",
    kind: "slider",
    min: 0.001,
    max: 0.08,
    step: 0.001,
    valueLabel: formatRmsValue,
    getValue: (settings) => settings.vad.rmsZcr.minRms,
    setValue: (settings, value) => ({
      ...settings,
      vad: {
        ...settings.vad,
        rmsZcr: { ...settings.vad.rmsZcr, minRms: value }
      }
    })
  },
  {
    key: "mlSpeechThreshold",
    section: "activity",
    label: "ML speech confidence",
    kind: "slider",
    min: 0.05,
    max: 0.95,
    step: 0.05,
    valueLabel: (value) => `${Math.round(value * 100)}%`,
    getValue: (settings) => settings.vad.ml.threshold,
    setValue: (settings, value) => ({
      ...settings,
      vad: {
        ...settings.vad,
        ml: { ...settings.vad.ml, threshold: value }
      }
    })
  },
  {
    key: "minSpeech",
    section: "activity",
    label: "Minimum speech (ms)",
    kind: "number",
    min: 0,
    max: 2000,
    step: 10,
    getValue: (settings) => settings.vad.minSpeechMs,
    setValue: (settings, value) => ({
      ...settings,
      vad: { ...settings.vad, minSpeechMs: value }
    })
  },
  {
    key: "paragraphSilence",
    section: "activity",
    label: "Paragraph silence (ms)",
    kind: "number",
    min: 100,
    max: 5000,
    step: 50,
    getValue: (settings) => settings.vad.paragraphSilenceMs,
    setValue: (settings, value) => ({
      ...settings,
      vad: { ...settings.vad, paragraphSilenceMs: value }
    })
  },
  {
    key: "partSilence",
    section: "activity",
    label: "Part silence (ms)",
    kind: "number",
    min: 100,
    max: 5000,
    step: 50,
    getValue: (settings) => settings.vad.partSilenceMs,
    setValue: (settings, value) => ({
      ...settings,
      vad: { ...settings.vad, partSilenceMs: value }
    })
  },
  {
    key: "recordOpfs",
    section: "recording",
    label: "Record to OPFS",
    kind: "checkbox",
    getValue: (settings) => settings.recording.shouldRecordToOpfs,
    setValue: (settings, value) => ({
      ...settings,
      recording: { ...settings.recording, shouldRecordToOpfs: value }
    })
  },
  {
    key: "opfsChunk",
    section: "recording",
    label: "OPFS chunk (ms)",
    kind: "select",
    options: [
      { value: "1000", label: "1 second" },
      { value: "2000", label: "2 seconds" },
      { value: "5000", label: "5 seconds" }
    ],
    getValue: (settings) => String(settings.audio.opfsChunkMs),
    setValue: (settings, value) => ({
      ...settings,
      audio: { ...settings.audio, opfsChunkMs: Number(value) }
    })
  },
  {
    key: "recordingFormat",
    section: "recording",
    label: "Saved recording format",
    kind: "select",
    options: recordingExportFormatOptions,
    getValue: (settings) => settings.audio.recordingExportFormat,
    setValue: (settings, value) => ({
      ...settings,
      audio: { ...settings.audio, recordingExportFormat: value as RecordingExportFormat }
    })
  },
  {
    key: "transcriptionChunk",
    section: "recording",
    label: "Transcription chunk (ms)",
    kind: "number",
    min: 1000,
    max: 15000,
    step: 250,
    getValue: (settings) => settings.audio.transcriptionChunkMs,
    setValue: (settings, value) => ({
      ...settings,
      audio: { ...settings.audio, transcriptionChunkMs: value }
    })
  },
  {
    key: "overlap",
    section: "recording",
    label: "Overlap (ms)",
    kind: "number",
    min: 0,
    max: 3000,
    step: 50,
    getValue: (settings) => settings.audio.overlapMs,
    setValue: (settings, value) => ({
      ...settings,
      audio: { ...settings.audio, overlapMs: value }
    })
  },
  {
    key: "transcriptScrollSpeed",
    section: "transcript",
    label: "Transcript scroll speed",
    kind: "slider",
    min: 1,
    max: 10,
    step: 1,
    valueLabel: (value) => `${Math.round(value)}/10`,
    getValue: (settings) => settings.transcript.autoScrollSpeed,
    setValue: (settings, value) => ({
      ...settings,
      transcript: { ...settings.transcript, autoScrollSpeed: value }
    })
  },
  {
    key: "speech",
    section: "speech",
    label: "Read subtitles aloud",
    kind: "checkbox",
    getValue: (settings) => settings.tts.enabled,
    setValue: (settings, value) => ({
      ...settings,
      tts: { ...settings.tts, enabled: value }
    })
  },
  {
    key: "voiceEngine",
    section: "speech",
    label: "Voice engine",
    kind: "select",
    options: ttsProviderOptions,
    getValue: (settings) => settings.tts.provider,
    setValue: (settings, value) => ({
      ...settings,
      tts: { ...settings.tts, provider: value as TtsProvider }
    })
  },
  {
    key: "speechRate",
    section: "speech",
    label: "Speech rate",
    kind: "number",
    min: 0.5,
    max: 2,
    step: 0.05,
    getValue: (settings) => settings.tts.rate,
    setValue: (settings, value) => ({
      ...settings,
      tts: { ...settings.tts, rate: value }
    })
  },
  {
    key: "speechPitch",
    section: "speech",
    label: "Speech pitch",
    kind: "number",
    min: 0,
    max: 2,
    step: 0.05,
    getValue: (settings) => settings.tts.pitch,
    setValue: (settings, value) => ({
      ...settings,
      tts: { ...settings.tts, pitch: value }
    })
  },
  {
    key: "speechVolume",
    section: "speech",
    label: "Speech volume",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.05,
    getValue: (settings) => settings.tts.volume,
    setValue: (settings, value) => ({
      ...settings,
      tts: { ...settings.tts, volume: value }
    })
  }
];

export const settingSectionLabels: Record<SettingsOption["section"], string> = {
  microphone: "Microphone",
  activity: "Activity",
  recording: "Recording",
  speech: "Speech",
  transcript: "Transcript"
};

export function readSettingsFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  const settings = settingsOptions.reduce((currentSettings, option) => {
    const rawValue = params.get(option.key);
    if (rawValue === null) return currentSettings;

    if (option.kind === "checkbox") {
      return option.setValue(currentSettings, rawValue === "1" || rawValue === "true");
    }

    if (option.kind === "number" || option.kind === "slider") {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) return currentSettings;
      return option.setValue(currentSettings, clamp(parsed, option.min, option.max));
    }

    if (option.kind !== "select") return currentSettings;
    if (!option.options.some((item) => item.value === rawValue)) return currentSettings;
    return option.setValue(currentSettings, rawValue);
  }, cloneRuntimeSettings(defaultRuntimeSettings));

  const selectedVoiceId = params.get("voice");
  const microphoneDeviceId = params.get("mic");
  const pageStyle = decodePageStyle(params.get("pageStyle"));

  return {
    ...settings,
    microphone: {
      ...settings.microphone,
      deviceId: microphoneDeviceId ?? settings.microphone.deviceId
    },
    pageStyle,
    tts: {
      ...settings.tts,
      selectedVoiceId: selectedVoiceId ?? settings.tts.selectedVoiceId
    }
  };
}

export function encodeSettingsInUrl(settings: RuntimeSettings) {
  const params = new URLSearchParams(window.location.search);

  for (const option of settingsOptions) {
    const value = option.getValue(settings);
    params.set(option.key, option.kind === "checkbox" ? (value ? "1" : "0") : String(value));
  }
  params.set("voice", settings.tts.selectedVoiceId);
  params.set("mic", settings.microphone.deviceId);
  params.set("pageStyle", encodePageStyle(settings.pageStyle));

  const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

export function cloneRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  return {
    ...settings,
    audio: { ...settings.audio },
    transcription: { ...settings.transcription },
    vad: {
      ...settings.vad,
      adaptiveRms: { ...settings.vad.adaptiveRms },
      fixedRms: { ...settings.vad.fixedRms },
      rmsZcr: { ...settings.vad.rmsZcr },
      ml: {
        ...settings.vad.ml,
        speechLabels: [...settings.vad.ml.speechLabels]
      }
    },
    waveform: { ...settings.waveform },
    transcript: { ...settings.transcript },
    subtitles: { ...settings.subtitles },
    microphone: { ...settings.microphone },
    pageStyle: clonePageStyle(settings.pageStyle),
    recording: { ...settings.recording },
    tts: {
      ...settings.tts,
      supertonic: {
        ...settings.tts.supertonic,
        voices: settings.tts.supertonic.voices.map((voice) => ({ ...voice }))
      }
    }
  };
}

export function getRealtimeSilenceRms(settings: RuntimeSettings) {
  if (settings.vad.mode === "fixed-rms") return settings.vad.fixedRms.threshold;
  if (settings.vad.mode === "rms-zcr") return settings.vad.rmsZcr.minRms;
  if (settings.vad.mode === "transformers-audio-classification") {
    const fallbackMode = settings.vad.ml.fallbackMode;
    if (fallbackMode === "fixed-rms") return settings.vad.fixedRms.threshold;
    if (fallbackMode === "rms-zcr") return settings.vad.rmsZcr.minRms;
  }
  return settings.vad.adaptiveRms.minRms;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatRmsValue(value: number) {
  return value.toFixed(3);
}
