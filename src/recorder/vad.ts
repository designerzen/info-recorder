import type { AllTasks } from "@huggingface/transformers";
import type { AppSettings } from "../config/settings";

export type VoiceActivity = {
  hasSpeech: boolean;
  score: number;
  trailingSilenceMs: number;
  mode: string;
};

type AudioClassificationPipeline = AllTasks["audio-classification"];

let mlDetectorPromise: Promise<AudioClassificationPipeline> | null = null;

export async function detectVoiceActivity(
  audio: Float32Array,
  sampleRate: number,
  settings: AppSettings["vad"]
): Promise<VoiceActivity> {
  if (settings.mode === "fixed-rms") {
    return detectFixedRms(audio, sampleRate, settings);
  }

  if (settings.mode === "rms-zcr") {
    return detectRmsZcr(audio, sampleRate, settings);
  }

  if (settings.mode === "transformers-audio-classification") {
    return detectWithTransformers(audio, sampleRate, settings);
  }

  return detectAdaptiveRms(audio, sampleRate, settings);
}

function detectAdaptiveRms(
  audio: Float32Array,
  sampleRate: number,
  settings: AppSettings["vad"]
): VoiceActivity {
  const rmsFrames = getRmsFrames(audio, sampleRate, settings.adaptiveRms.frameMs);
  const sorted = [...rmsFrames].sort((left, right) => left - right);
  const percentileIndex = Math.floor(sorted.length * settings.adaptiveRms.noisePercentile);
  const noiseFloor = sorted[percentileIndex] ?? 0;
  const threshold = Math.max(
    settings.adaptiveRms.minRms,
    noiseFloor * settings.adaptiveRms.noiseMultiplier
  );
  const voicedFrames = rmsFrames.map((rms) => rms >= threshold);

  return summarizeFrames(voicedFrames, rmsFrames, settings, "adaptive-rms");
}

function detectFixedRms(
  audio: Float32Array,
  sampleRate: number,
  settings: AppSettings["vad"]
): VoiceActivity {
  const rmsFrames = getRmsFrames(audio, sampleRate, settings.fixedRms.frameMs);
  const voicedFrames = rmsFrames.map((rms) => rms >= settings.fixedRms.threshold);

  return summarizeFrames(voicedFrames, rmsFrames, settings, "fixed-rms");
}

function detectRmsZcr(
  audio: Float32Array,
  sampleRate: number,
  settings: AppSettings["vad"]
): VoiceActivity {
  const frameSamples = getFrameSamples(sampleRate, settings.rmsZcr.frameMs);
  const rmsFrames: number[] = [];
  const voicedFrames: boolean[] = [];

  for (let start = 0; start < audio.length; start += frameSamples) {
    const end = Math.min(audio.length, start + frameSamples);
    let sum = 0;
    let crossings = 0;
    let previous = audio[start] ?? 0;

    for (let index = start; index < end; index += 1) {
      const sample = audio[index];
      sum += sample * sample;
      if ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0)) {
        crossings += 1;
      }
      previous = sample;
    }

    const rms = Math.sqrt(sum / (end - start));
    const zeroCrossingRate = crossings / Math.max(1, end - start);
    rmsFrames.push(rms);
    voicedFrames.push(
      rms >= settings.rmsZcr.minRms &&
        zeroCrossingRate >= settings.rmsZcr.minZeroCrossingRate &&
        zeroCrossingRate <= settings.rmsZcr.maxZeroCrossingRate
    );
  }

  return summarizeFrames(voicedFrames, rmsFrames, settings, "rms-zcr");
}

async function detectWithTransformers(
  audio: Float32Array,
  sampleRate: number,
  settings: AppSettings["vad"]
): Promise<VoiceActivity> {
  try {
    mlDetectorPromise ??= import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("audio-classification", settings.ml.modelId, {
        device: settings.ml.device
      })
    );
    const detector = await mlDetectorPromise;
    const result = await detector(audio, { top_k: 5 });
    const labels = Array.isArray(result[0]) ? result.flat() : result;
    const speechScore = labels.reduce((best, item) => {
      const label = String(item.label ?? "").toLowerCase();
      const isSpeech = settings.ml.speechLabels.some((speechLabel) =>
        label.includes(speechLabel)
      );
      return isSpeech ? Math.max(best, Number(item.score ?? 0)) : best;
    }, 0);
    const fallback = detectFallback(audio, sampleRate, settings);

    return {
      ...fallback,
      hasSpeech: speechScore >= settings.ml.threshold || fallback.hasSpeech,
      score: Math.max(speechScore, fallback.score),
      mode: "transformers-audio-classification"
    };
  } catch {
    return detectFallback(audio, sampleRate, settings);
  }
}

function detectFallback(audio: Float32Array, sampleRate: number, settings: AppSettings["vad"]) {
  if (settings.ml.fallbackMode === "fixed-rms") {
    return detectFixedRms(audio, sampleRate, settings);
  }

  if (settings.ml.fallbackMode === "rms-zcr") {
    return detectRmsZcr(audio, sampleRate, settings);
  }

  return detectAdaptiveRms(audio, sampleRate, settings);
}

function getRmsFrames(audio: Float32Array, sampleRate: number, frameMs: number) {
  const frameSamples = getFrameSamples(sampleRate, frameMs);
  const rmsFrames: number[] = [];

  for (let start = 0; start < audio.length; start += frameSamples) {
    let sum = 0;
    const end = Math.min(audio.length, start + frameSamples);

    for (let index = start; index < end; index += 1) {
      sum += audio[index] * audio[index];
    }

    rmsFrames.push(Math.sqrt(sum / (end - start)));
  }

  return rmsFrames;
}

function summarizeFrames(
  voicedFrames: boolean[],
  rmsFrames: number[],
  settings: AppSettings["vad"],
  mode: string
): VoiceActivity {
  const frameMs = getEffectiveFrameMs(settings, mode);
  const voicedMs = voicedFrames.filter(Boolean).length * frameMs;
  const score =
    rmsFrames.reduce((sum, rms) => sum + rms, 0) / Math.max(1, rmsFrames.length);
  let trailingSilentFrames = 0;

  for (let index = voicedFrames.length - 1; index >= 0; index -= 1) {
    if (voicedFrames[index]) break;
    trailingSilentFrames += 1;
  }

  return {
    hasSpeech: voicedMs >= settings.minSpeechMs,
    score,
    trailingSilenceMs: trailingSilentFrames * frameMs,
    mode
  };
}

function getEffectiveFrameMs(settings: AppSettings["vad"], mode: string) {
  if (mode === "fixed-rms") return settings.fixedRms.frameMs;
  if (mode === "rms-zcr") return settings.rmsZcr.frameMs;
  return settings.adaptiveRms.frameMs;
}

function getFrameSamples(sampleRate: number, frameMs: number) {
  return Math.max(1, Math.floor(sampleRate * (frameMs / 1000)));
}
