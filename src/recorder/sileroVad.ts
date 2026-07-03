import type { Tensor } from "@huggingface/transformers";
import { resampleLinear } from "./audioUtils";
import { createTransformersOpfsCache } from "./transformersOpfsCache";

export const SILERO_VAD_MODEL_ID = "BricksDisplay/silero-vad-6.2";
export const SILERO_VAD_SAMPLE_RATE = 16_000;
export const SILERO_VAD_WINDOW_SAMPLES = 512;

const SILERO_VAD_STATE_SAMPLES = 2 * 1 * 128;

type TensorMap = Record<string, Tensor>;
type CallableVadModel = (inputs: TensorMap) => Promise<TensorMap>;
type TensorConstructor = new (...args: [string, ArrayLike<number | bigint>, number[]]) => Tensor;

type LoadedSileroVad = {
  model: CallableVadModel;
  Tensor: TensorConstructor;
};

export type SileroVadRuntimeState = {
  state: Tensor | null;
};

export type SileroVadFrame = {
  startSample: number;
  endSample: number;
  probability: number;
};

const modelPromises = new Map<string, Promise<LoadedSileroVad>>();
let hasConfiguredTransformersCache = false;

export async function runSileroVadFrames(
  audio: Float32Array,
  sampleRate: number,
  runtimeState?: SileroVadRuntimeState,
  modelId = SILERO_VAD_MODEL_ID
) {
  const { model, Tensor } = await loadSileroVadModel(modelId);
  const vadAudio =
    sampleRate === SILERO_VAD_SAMPLE_RATE
      ? audio
      : resampleLinear(audio, sampleRate, SILERO_VAD_SAMPLE_RATE);
  let state =
    runtimeState?.state ??
    new Tensor("float32", new Float32Array(SILERO_VAD_STATE_SAMPLES), [2, 1, 128]);
  const sr = new Tensor("int64", [BigInt(SILERO_VAD_SAMPLE_RATE)], []);
  const sampleRatio = sampleRate / SILERO_VAD_SAMPLE_RATE;
  const frames: SileroVadFrame[] = [];

  for (let start = 0; start < vadAudio.length; start += SILERO_VAD_WINDOW_SAMPLES) {
    const end = start + SILERO_VAD_WINDOW_SAMPLES;
    const window = new Float32Array(SILERO_VAD_WINDOW_SAMPLES);
    window.set(vadAudio.subarray(start, Math.min(vadAudio.length, end)));

    const output = await model({
      input: new Tensor("float32", window, [1, SILERO_VAD_WINDOW_SAMPLES]),
      state,
      sr
    });
    state = getNextState(output) ?? state;

    frames.push({
      startSample: Math.round(start * sampleRatio),
      endSample: Math.round(Math.min(end, vadAudio.length) * sampleRatio),
      probability: getSpeechProbability(output)
    });
  }

  if (runtimeState) {
    runtimeState.state = state;
  }

  return frames;
}

export function resetSileroVadRuntimeState(runtimeState: SileroVadRuntimeState) {
  runtimeState.state = null;
}

async function loadSileroVadModel(modelId: string) {
  const existing = modelPromises.get(modelId);
  if (existing) return existing;

  const promise = (async () => {
    const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
    configureTransformersCache(env);
    const model = await AutoModel.from_pretrained(modelId, {
      dtype: "q8",
      device: "wasm"
    });
    return {
      model: model as unknown as CallableVadModel,
      Tensor: Tensor as TensorConstructor
    };
  })().catch((cause) => {
    modelPromises.delete(modelId);
    throw cause;
  });

  modelPromises.set(modelId, promise);
  return promise;
}

function configureTransformersCache(env: typeof import("@huggingface/transformers").env) {
  if (hasConfiguredTransformersCache) return;

  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = "caches" in globalThis;
  env.useWasmCache = true;
  env.useCustomCache =
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    Boolean(navigator.storage?.getDirectory);
  env.customCache = env.useCustomCache ? createTransformersOpfsCache() : null;
  env.cacheKey = "info-recorder-transformers-cache";
  hasConfiguredTransformersCache = true;
}

function getSpeechProbability(output: TensorMap) {
  const tensor =
    output.output ??
    output.prob ??
    output.probs ??
    Object.entries(output).find(([key]) => !key.toLowerCase().includes("state"))?.[1];
  const value = tensor?.data?.[0];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function getNextState(output: TensorMap) {
  return (
    output.state ??
    output.stateN ??
    output.state_n ??
    Object.entries(output).find(([key]) => key.toLowerCase().includes("state"))?.[1] ??
    null
  );
}
