import { appSettings, type SupertonicVoiceId } from "../config/settings";
import {
  loadTextToSpeech,
  loadVoiceStyle,
  writeWavFile,
  type SupertonicStyle,
  type SupertonicTextToSpeech
} from "../vendor/supertonic/helper.js";

type LoadedSupertonic = {
  textToSpeech: SupertonicTextToSpeech;
};

let ttsPromise: Promise<LoadedSupertonic> | null = null;
let synthesisQueue: Promise<unknown> = Promise.resolve();
const stylePromises = new Map<SupertonicVoiceId, Promise<SupertonicStyle>>();
const validatedVoices = new Set<SupertonicVoiceId>();

export function getSupertonicVoiceStyleUrl(voiceId: SupertonicVoiceId) {
  const voice = appSettings.tts.supertonic.voices.find((item) => item.id === voiceId);
  if (!voice) {
    throw new Error(`Unknown Supertonic voice: ${voiceId}`);
  }
  return `${appSettings.tts.supertonic.voiceStylesDir}/${voice.styleFile}`;
}

export async function assertSupertonicAssetsAvailable(voiceId: SupertonicVoiceId) {
  const checks = [
    `${appSettings.tts.supertonic.onnxDir}/tts.json`,
    `${appSettings.tts.supertonic.onnxDir}/unicode_indexer.json`,
    getSupertonicVoiceStyleUrl(voiceId)
  ];
  const missing: string[] = [];

  await Promise.all(
    checks.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        missing.push(url);
      }
    })
  );

  if (missing.length > 0) {
    throw new Error(
      `Supertonic assets are not available from the configured Hugging Face URLs. Missing: ${missing.join(
        ", "
      )}`
    );
  }
}

async function loadSupertonic() {
  if (!ttsPromise) {
    ttsPromise = loadTextToSpeech(
      appSettings.tts.supertonic.onnxDir,
      {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all"
      },
      (modelName, current, total) => {
        console.info(`Loading Supertonic ONNX model ${current}/${total}: ${modelName}`);
      }
    ).then(({ textToSpeech }) => ({ textToSpeech })).catch((error) => {
      ttsPromise = null;
      throw error;
    });
  }

  return ttsPromise;
}

async function loadStyle(voiceId: SupertonicVoiceId) {
  const existing = stylePromises.get(voiceId);
  if (existing) return existing;

  const promise = loadVoiceStyle([getSupertonicVoiceStyleUrl(voiceId)], false).catch((error) => {
    stylePromises.delete(voiceId);
    throw error;
  });
  stylePromises.set(voiceId, promise);
  return promise;
}

export async function synthesizeSupertonicSpeech(text: string, voiceId: SupertonicVoiceId) {
  const { samples, sampleRate } = await synthesizeSupertonicSamples(text, voiceId);
  const buffer = writeWavFile(samples, sampleRate);
  return new Blob([buffer], { type: "audio/wav" });
}

export function synthesizeSupertonicSamples(text: string, voiceId: SupertonicVoiceId) {
  const result = synthesisQueue.then(() => generateSamples(text, voiceId));
  synthesisQueue = result.catch(() => undefined);
  return result;
}

async function generateSamples(text: string, voiceId: SupertonicVoiceId) {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("No text was provided for Supertonic speech synthesis.");
  }

  if (!validatedVoices.has(voiceId)) {
    await assertSupertonicAssetsAvailable(voiceId);
    validatedVoices.add(voiceId);
  }
  const [{ textToSpeech }, style] = await Promise.all([loadSupertonic(), loadStyle(voiceId)]);
  const { wav, duration } = await textToSpeech.call(
    normalized,
    appSettings.tts.supertonic.language,
    style,
    appSettings.tts.supertonic.totalStep,
    appSettings.tts.supertonic.speed,
    appSettings.tts.supertonic.silenceDuration
  );
  const wavLength = Math.floor(textToSpeech.sampleRate * duration[0]);
  return { samples: wav.slice(0, wavLength), sampleRate: textToSpeech.sampleRate };
}
