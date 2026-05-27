import { describe, expect, it } from "vitest";
import { appSettings } from "../../src/config/settings";
import { detectVoiceActivity, type AdaptiveVadState } from "../../src/recorder/vad";

function createSineWave(amplitude: number, durationMs: number, sampleRate: number) {
  const length = Math.floor(sampleRate * (durationMs / 1000));
  const audio = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    audio[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * amplitude;
  }

  return audio;
}

describe("vad", () => {
  it("detects speech on the first adaptive live chunk instead of using that speech as its noise floor", async () => {
    const state: AdaptiveVadState = { noiseFloor: null };
    const audio = createSineWave(0.05, 500, 16_000);

    const result = await detectVoiceActivity(audio, 16_000, appSettings.vad, state);

    expect(result.mode).toBe("adaptive-rms");
    expect(result.hasSpeech).toBe(true);
    expect(state.noiseFloor).toBeGreaterThan(0);
  });

  it("learns a quieter background floor from silent chunks", async () => {
    const state: AdaptiveVadState = { noiseFloor: null };
    const quiet = createSineWave(0.003, 500, 16_000);

    const result = await detectVoiceActivity(quiet, 16_000, appSettings.vad, state);

    expect(result.hasSpeech).toBe(false);
    expect(state.noiseFloor).toBeGreaterThan(0);
    expect(state.noiseFloor).toBeLessThan(appSettings.vad.adaptiveRms.minRms);
  });
});
