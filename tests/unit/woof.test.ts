import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kernelsWasm } from "../../src/speech/woof/kernels";
import { normalize } from "../../src/speech/woof/normalize";
import { loadNpz, type NpyArray } from "../../src/speech/woof/npz";
import { Respeller } from "../../src/speech/woof/respell";
import { encodeText, TorchRandn } from "../../src/speech/woof/runtime";
import { splitText } from "../../src/speech/woof/textsplit";
import { encodeWav } from "../../src/speech/woofTts";

// Expected text comes from the reference Python normalizer (respelling off), at the pinned revision.
const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name));
const cases = JSON.parse(fixture("woof-normalize.json").toString("utf8")) as Array<{ text: string; spoken: string; pieces: string[] }>;

describe("Woof text front end", () => {
  it.each(cases)("reads $text as the reference does", ({ text, spoken, pieces }) => {
    expect(normalize(text)).toBe(spoken);
    expect(splitText(spoken)).toEqual(pieces);
  });

  it("respells hard names as the reference does", () => {
    const respeller = new Respeller("# comment\nSiobhan\tShivawn\t\nSaoirse Ronan\tSeersha Rohnan\t\nSaoirse\tSeersha\t\ngnocchi\tnyocky\t\nRose Byrne\tRoz Burn\tc\n");
    expect(respeller.respell("Saoirse Ronan met Siobhan's friend over gnocchi.")).toBe("Seersha Rohnan met Shivawn's friend over nyocky.");
    expect(respeller.respell("A Siobhan-led team; dove-cote stays.")).toBe("A Shivawn-led team; dove-cote stays.");
    expect(respeller.respell("rose byrne and Rose Byrne")).toBe("rose byrne and Roz Burn");
    expect(respeller.respell("Saoirse alone, GNOCCHI loud.")).toBe("Seersha alone, Nyocky loud.");
  });

  it("maps characters outside the model's alphabet to the unknown token", () => {
    expect(encodeText("Hi…—~")).toEqual([1, 37, 12, 93, 94, 2]);
  });
});

describe("Woof runtime", () => {
  it("draws the same noise as torch.manual_seed(0); torch.randn(32)", () => {
    const noise = new TorchRandn(0).randn(32);
    expect(Array.from(noise.slice(0, 6))).toEqual([-1.1258398294448853, -1.152360200881958, -0.2505785822868347, -0.4338788390159607, 0.848710298538208, 0.6920092701911926]);
  });

  it("reads the weights archive and its nested tree", () => {
    const bytes = fixture("woof-tiny.npz");
    const tree = loadNpz(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as any;
    expect(tree.name).toBe("tiny");
    expect((tree.a as NpyArray).dtype).toBe("f2");
    expect(Array.from((tree.a as NpyArray).data)).toEqual([1.5, -2]);
    expect(tree.s[0]).toBe(1);
    expect(tree.s[1].shape).toEqual([2, 2]);
    expect(Array.from(tree.s[1].data)).toEqual([1, -2, 3, 4]);
  });

  it("multiplies matrices in WebAssembly as plain loops do, on awkward shapes", () => {
    const memory = new WebAssembly.Memory({ initial: 4 });
    const binary = Uint8Array.from(atob(kernelsWasm), (char) => char.charCodeAt(0));
    const kernels = new WebAssembly.Instance(new WebAssembly.Module(binary), { env: { memory } }).exports as any;
    const f32 = new Float32Array(memory.buffer);
    for (const [t, k, n, lda] of [[1, 5, 1, 5], [5, 13, 13, 20], [9, 3, 1, 48], [7, 33, 37, 33]]) {
      const a = 16, b = a + t * lda * 4 + 16, out = b + k * n * 4 + 16;
      for (let i = 0; i < t * lda; i++) f32[a / 4 + i] = Math.sin(i + 1);
      for (let i = 0; i < k * n; i++) f32[b / 4 + i] = Math.cos(i + 2);
      for (let i = 0; i < t * n; i++) f32[out / 4 + i] = 0.5;
      kernels.gemm(a, lda, t, k, b, n, out);
      for (let r = 0; r < t; r++) for (let c = 0; c < n; c++) {
        let expected = 0.5;
        for (let i = 0; i < k; i++) expected += f32[a / 4 + r * lda + i] * f32[b / 4 + i * n + c];
        expect(f32[out / 4 + r * n + c]).toBeCloseTo(expected, 4);
      }
    }
    // int8 rows times a float vector
    const w = 64, x = 1024, y = 2048;
    const weights = new Int8Array(memory.buffer, w, 2 * 32);
    for (let i = 0; i < weights.length; i++) weights[i] = (i % 7) - 3;
    for (let i = 0; i < 32; i++) f32[x / 4 + i] = i / 8;
    kernels.matvecI8(w, 2, 32, x, y);
    for (let r = 0; r < 2; r++) {
      let expected = 0;
      for (let i = 0; i < 32; i++) expected += weights[r * 32 + i] * f32[x / 4 + i];
      expect(f32[y / 4 + r]).toBeCloseTo(expected, 4);
    }
  });

  it("writes 16-bit mono WAV", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 24000));
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)]).toEqual([0, 32767, -32767, 32767]);
  });
});
