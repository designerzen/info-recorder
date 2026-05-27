import { describe, expect, it } from "vitest";
import { concatAudio, getRms, resampleLinear, toMono } from "../../src/recorder/audioUtils";

describe("audioUtils", () => {
  it("averages all channels into mono", () => {
    const left = new Float32Array([1, 0, -1]);
    const right = new Float32Array([-1, 1, 1]);
    const fakeBuffer = {
      length: left.length,
      numberOfChannels: 2,
      getChannelData(channel: number) {
        return channel === 0 ? left : right;
      }
    };

    expect(Array.from(toMono(fakeBuffer))).toEqual([0, 0.5, 0]);
  });

  it("concatenates audio chunks in order", () => {
    const result = concatAudio(new Float32Array([0.1, 0.2]), new Float32Array([0.3]));

    expect(Array.from(result)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3)
    ]);
  });

  it("calculates RMS and safely handles empty buffers", () => {
    expect(getRms(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(getRms(new Float32Array())).toBe(0);
  });

  it("resamples audio without browser audio globals", () => {
    const result = resampleLinear(new Float32Array([0, 1]), 2, 4);

    expect(Array.from(result)).toEqual([0, 0.5, 1, 1]);
  });

  it("returns the original buffer when the sample rate is unchanged", () => {
    const audio = new Float32Array([0, 0.5, 1]);

    expect(resampleLinear(audio, 16_000, 16_000)).toBe(audio);
  });

  it("rejects invalid sample rates", () => {
    expect(() => resampleLinear(new Float32Array([0, 1]), 0, 16_000)).toThrow(
      "Sample rates must be greater than zero."
    );
  });
});
