import type { Tensor } from "@huggingface/transformers";
import { resampleLinear } from "./audioUtils";

const MODEL_ID = "BricksDisplay/silero-vad-6.2";
const VAD_SAMPLE_RATE = 16_000;
const VAD_WINDOW_SAMPLES = 512;
const VAD_STATE_SAMPLES = 2 * 1 * 128;
const SPEECH_THRESHOLD = 0.5;

type TensorMap = Record<string, Tensor>;
type CallableVadModel = (inputs: TensorMap) => Promise<TensorMap>;
type TensorConstructor = new (...args: [string, ArrayLike<number | bigint>, number[]]) => Tensor;

let modelPromise: Promise<{ model: CallableVadModel; Tensor: TensorConstructor }> | null = null;

export async function findVadBoundaryEnd(
  audio: Float32Array,
  segmentStart: number,
  searchStart: number,
  searchEnd: number,
  sampleRate: number,
  requiredQuietSamples: number
) {
  if (searchEnd <= searchStart) return null;

  const { model, Tensor } = await loadModel();
  const source = audio.subarray(segmentStart, searchEnd);
  const vadAudio =
    sampleRate === VAD_SAMPLE_RATE ? source : resampleLinear(source, sampleRate, VAD_SAMPLE_RATE);
  const sampleRatio = sampleRate / VAD_SAMPLE_RATE;
  const requiredQuietVadSamples = Math.max(
    VAD_WINDOW_SAMPLES,
    Math.floor(requiredQuietSamples / sampleRatio)
  );
  let state = new Tensor("float32", new Float32Array(VAD_STATE_SAMPLES), [2, 1, 128]);
  const sr = new Tensor("int64", [BigInt(VAD_SAMPLE_RATE)], []);
  let quietStartVad: number | null = null;
  let bestBoundary: number | null = null;

  for (let start = 0; start < vadAudio.length; start += VAD_WINDOW_SAMPLES) {
    const end = start + VAD_WINDOW_SAMPLES;
    const window = new Float32Array(VAD_WINDOW_SAMPLES);
    window.set(vadAudio.subarray(start, Math.min(vadAudio.length, end)));

    const output = await model({
      input: new Tensor("float32", window, [1, VAD_WINDOW_SAMPLES]),
      state,
      sr
    });
    state = getNextState(output) ?? state;

    const sourceEnd = segmentStart + Math.round(Math.min(end, vadAudio.length) * sampleRatio);
    if (sourceEnd < searchStart) {
      quietStartVad = getSpeechProbability(output) < SPEECH_THRESHOLD ? start : null;
      continue;
    }

    if (getSpeechProbability(output) < SPEECH_THRESHOLD) {
      quietStartVad ??= start;
      if (end - quietStartVad >= requiredQuietVadSamples) {
        bestBoundary = Math.min(searchEnd, sourceEnd);
      }
      continue;
    }

    quietStartVad = null;
  }

  return bestBoundary;
}

async function loadModel() {
  modelPromise ??= (async () => {
    const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = "caches" in globalThis;
    env.useWasmCache = true;

    const model = await AutoModel.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm"
    });
    return {
      model: model as unknown as CallableVadModel,
      Tensor: Tensor as TensorConstructor
    };
  })();

  return modelPromise;
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
