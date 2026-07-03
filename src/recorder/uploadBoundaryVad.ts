import {
  runSileroVadFrames,
  SILERO_VAD_SAMPLE_RATE,
  SILERO_VAD_WINDOW_SAMPLES,
  type SileroVadRuntimeState
} from "./sileroVad";

const SPEECH_THRESHOLD = 0.5;

export async function findVadBoundaryEnd(
  audio: Float32Array,
  segmentStart: number,
  searchStart: number,
  searchEnd: number,
  sampleRate: number,
  requiredQuietSamples: number,
  modelId?: string
) {
  if (searchEnd <= searchStart) return null;

  const frames = await runSileroVadFrames(
    audio.subarray(segmentStart, searchEnd),
    sampleRate,
    { state: null } satisfies SileroVadRuntimeState,
    modelId
  );
  const minWindowSamples = Math.round(
    SILERO_VAD_WINDOW_SAMPLES * (sampleRate / SILERO_VAD_SAMPLE_RATE)
  );
  const requiredQuietVadSamples = Math.max(minWindowSamples, requiredQuietSamples);
  let quietStart: number | null = null;
  let bestBoundary: number | null = null;

  for (const frame of frames) {
    const sourceStart = segmentStart + frame.startSample;
    const sourceEnd = Math.min(searchEnd, segmentStart + frame.endSample);

    if (sourceEnd < searchStart) {
      quietStart = frame.probability < SPEECH_THRESHOLD ? sourceStart : null;
      continue;
    }

    if (frame.probability < SPEECH_THRESHOLD) {
      quietStart ??= sourceStart;
      if (sourceEnd - quietStart >= requiredQuietVadSamples) {
        bestBoundary = sourceEnd;
      }
      continue;
    }

    quietStart = null;
  }

  return bestBoundary;
}
