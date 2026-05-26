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
const stylePromises = new Map<SupertonicVoiceId, Promise<SupertonicStyle>>();

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
    ).then(({ textToSpeech }) => ({ textToSpeech }));
  }

  return ttsPromise;
}

async function loadStyle(voiceId: SupertonicVoiceId) {
  const existing = stylePromises.get(voiceId);
  if (existing) return existing;

  const promise = loadVoiceStyle([getSupertonicVoiceStyleUrl(voiceId)], false);
  stylePromises.set(voiceId, promise);
  return promise;
}

export async function synthesizeSupertonicSpeech(text: string, voiceId: SupertonicVoiceId) {
  const normalized = text.trim();
  if (!normalized) {
    throw new Error("No text was provided for Supertonic speech synthesis.");
  }

  await assertSupertonicAssetsAvailable(voiceId);
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
  const buffer = writeWavFile(wav.slice(0, wavLength), textToSpeech.sampleRate);
  return new Blob([buffer], { type: "audio/wav" });
}
