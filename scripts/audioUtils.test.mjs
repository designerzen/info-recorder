import assert from "node:assert/strict";
import test from "node:test";
import { concatAudio, getRms, resampleLinear, toMono } from "../.tmp-audio-tests/audioUtils.js";

test("toMono averages every channel without using browser AudioBuffer globals", () => {
  const left = new Float32Array([1, 0, -1]);
  const right = new Float32Array([-1, 1, 1]);
  const fakeBuffer = {
    length: left.length,
    numberOfChannels: 2,
    getChannelData(channel) {
      return channel === 0 ? left : right;
    }
  };

  assert.deepEqual(Array.from(toMono(fakeBuffer)), [0, 0.5, 0]);
});

test("concatAudio preserves order and sample values", () => {
  const result = concatAudio(new Float32Array([0.1, 0.2]), new Float32Array([0.3]));

  assert.deepEqual(Array.from(result), [
    Math.fround(0.1),
    Math.fround(0.2),
    Math.fround(0.3)
  ]);
});

test("getRms returns the root mean square for samples", () => {
  assert.equal(getRms(new Float32Array([1, -1, 1, -1])), 1);
  assert.equal(getRms(new Float32Array()), 0);
});

test("resampleLinear changes sample rates without browser audio globals", () => {
  const result = resampleLinear(new Float32Array([0, 1]), 2, 4);

  assert.deepEqual(Array.from(result), [0, 0.5, 1, 1]);
});
