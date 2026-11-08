// Derived from Underdog Woof by Conway: Underdog Non-Commercial License 1.0. See LICENSE and README.md in this folder.
/** Underdog Woof inference in TypeScript: a port of the model's numpy runtime (speech model, one-step flow head and audio
 * decoder). The heavy products run in small WebAssembly SIMD kernels over one memory that holds the weights, the
 * attention cache and the working arrays. It runs on the CPU, so it belongs in a worker. */
import { kernelsWasm } from "./kernels";
import type { NpyArray, Tree } from "./npz";

export const SAMPLE_RATE = 24000;
const EPS = 1.1920928955078125e-7;
const CHARS = [..." abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?;:'\"-()&/%$€£@#+=*_<>[]", "…", "—"];
const VOCAB = new Map(CHARS.map((char, index) => [char, index + 3]));
const MAX_LEN = 1100;
const CHUNK_FRAMES = 8;

export function encodeText(text: string) {
  return [1, ...Array.from(text, (char) => VOCAB.get(char) ?? 2)];
}

/** torch.manual_seed(seed); torch.randn(n) for n a multiple of 16, so a seed gives the same take as the reference. */
export class TorchRandn {
  private mt = new Uint32Array(624);
  private index = 624;

  constructor(seed = 0) {
    this.seed(seed);
  }

  seed(seed: number) {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) {
      const previous = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (Math.imul(1812433253, previous) + i) >>> 0;
    }
    this.index = 624;
  }

  private next() {
    if (this.index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = (this.mt[i] & 0x80000000) | (this.mt[(i + 1) % 624] & 0x7fffffff);
        this.mt[i] = this.mt[(i + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  randn(n: number) {
    const u = new Float64Array(n);
    for (let i = 0; i < n; i++) u[i] = (this.next() & 0xffffff) * 2 ** -24;
    const out = new Float32Array(n);
    for (let group = 0; group < n; group += 16) {
      for (let j = 0; j < 8; j++) {
        const r = Math.sqrt(-2 * Math.log(1 - u[group + j]));
        const theta = 2 * Math.PI * u[group + 8 + j];
        out[group + j] = r * Math.cos(theta);
        out[group + 8 + j] = r * Math.sin(theta);
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ memory and kernels

type Kernels = {
  gemm(a: number, lda: number, t: number, k: number, b: number, n: number, out: number): void;
  matvecI8(w: number, rows: number, cols: number, x: number, out: number): void;
  matvecF32(w: number, rows: number, cols: number, x: number, out: number): void;
};

/** A float32 array inside the WebAssembly memory: `ptr` for the kernels, `a` for JavaScript. */
type F32 = { ptr: number; a: Float32Array };

/** One fixed-size WebAssembly memory. It never grows, so views into it stay valid. */
class Heap {
  readonly kernels: Kernels;
  private buffer: ArrayBuffer;
  private top = 64;

  constructor(bytes: number) {
    const memory = new WebAssembly.Memory({ initial: Math.ceil(bytes / 65536) + 1 });
    const binary = Uint8Array.from(atob(kernelsWasm), (char) => char.charCodeAt(0));
    this.kernels = new WebAssembly.Instance(new WebAssembly.Module(binary), { env: { memory } }).exports as unknown as Kernels;
    this.buffer = memory.buffer;
  }

  private reserve(bytes: number) {
    const ptr = this.top;
    this.top = (this.top + bytes + 15) & ~15;
    if (this.top > this.buffer.byteLength) throw new Error("Woof: the voice ran out of working memory.");
    return ptr;
  }

  f32(length: number, from?: ArrayLike<number>): F32 {
    const ptr = this.reserve(length * 4);
    const a = new Float32Array(this.buffer, ptr, length);
    // Released memory is reused, and the kernels add into their output, so a new array always starts from zero.
    if (from) a.set(from);
    else a.fill(0);
    return { ptr, a };
  }

  i8(from: Int8Array) {
    const ptr = this.reserve(from.length);
    new Int8Array(this.buffer, ptr, from.length).set(from);
    return ptr;
  }

  /** Working arrays for one call are released together. */
  mark() {
    return this.top;
  }

  release(mark: number) {
    this.top = mark;
  }
}

// ------------------------------------------------------------------------------------------------ weights

type Node = { [key: string]: Tree };
const node = (tree: Tree) => tree as Node;
const array = (tree: Tree) => tree as NpyArray;
const floats = (tree: Tree) => array(tree).data as Float32Array;

/** Bytes the weights take once loaded: speech int8 stays int8, decoder int8 becomes float32. */
function weightBytes(tree: Tree, widen = false): number {
  if (Array.isArray(tree)) return tree.reduce((total: number, item) => total + weightBytes(item, widen), 0);
  if (tree && typeof tree === "object") {
    if ("data" in tree && ArrayBuffer.isView((tree as NpyArray).data)) {
      const { data } = tree as NpyArray;
      return data instanceof Int8Array && widen ? data.length * 4 : data.byteLength;
    }
    return Object.entries(tree).reduce((total, [key, value]) => total + weightBytes(value, widen || key === "decoder") + 16, 0);
  }
  return 0;
}

/** y = (W x) * scale * gain + bias for W (rows, cols): int8 with a per-row scale, or float32. */
class Linear {
  readonly rows: number;
  readonly cols: number;
  private ptr: number;
  private int8: boolean;
  private scale?: Float32Array;
  private bias?: Float32Array;

  constructor(private heap: Heap, tree: Tree) {
    const entry = node(tree);
    const weight = array(entry.q ?? entry.w);
    [this.rows, this.cols] = weight.shape;
    this.int8 = weight.data instanceof Int8Array;
    this.ptr = this.int8 ? heap.i8(weight.data as Int8Array) : heap.f32(weight.data.length, weight.data).ptr;
    this.scale = entry.s ? floats(entry.s) : undefined;
    this.bias = entry.b ? floats(entry.b) : undefined;
  }

  run(x: F32, out: F32, gain = 1) {
    (this.int8 ? this.heap.kernels.matvecI8 : this.heap.kernels.matvecF32)(this.ptr, this.rows, this.cols, x.ptr, out.ptr);
    const { scale, bias } = this;
    for (let r = 0; r < this.rows; r++) out.a[r] = out.a[r] * (scale ? scale[r] : 1) * gain + (bias ? bias[r] : 0);
    return out;
  }
}

/** Grouped-int8 decoder tensor {q8, s, shape, axis, g}, or a plain array, as float32 in its stated shape. */
function dequantize(tree: Tree): { shape: number[]; data: Float32Array } {
  const entry = tree as Node & NpyArray;
  if (!("q8" in entry)) return { shape: entry.shape, data: entry.data as Float32Array };
  const q = array(entry.q8);
  const s = floats(entry.s);
  const shape = entry.shape as unknown as number[];
  const axis = entry.axis as unknown as number;
  const g = entry.g as unknown as number;
  const [rows, n] = q.shape;
  const groups = array(entry.s).shape[1];
  const m = new Float32Array(rows * n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < n; c++) m[r * n + c] = q.data[r * n + c] * s[r * groups + Math.floor(c / g)];
  }
  if (axis === 0) return { shape, data: m };
  // m is (shape[axis], ...rest); move that axis back into place. Only 3-d tensors with axis 1 occur.
  const [d0, d1, d2] = shape;
  const out = new Float32Array(m.length);
  for (let j = 0; j < d1; j++) {
    for (let i = 0; i < d0; i++) {
      for (let k = 0; k < d2; k++) out[(i * d1 + j) * d2 + k] = m[(j * d0 + i) * d2 + k];
    }
  }
  return { shape, data: out };
}

/** (rows, cols) -> (cols, rows) */
function transpose(data: Float32Array, rows: number, cols: number) {
  const out = new Float32Array(data.length);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c * rows + r] = data[r * cols + c];
  return out;
}

// ------------------------------------------------------------------------------------------------ speech model

const silu = (x: number) => x / (1 + Math.exp(-x));

function rmsInverse(x: Float32Array) {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return 1 / Math.sqrt(sum / x.length + EPS);
}

function layerNorm(h: Float32Array, out: Float32Array, offset = 0, length = h.length, eps = 1e-5) {
  let mean = 0;
  for (let i = 0; i < length; i++) mean += h[offset + i];
  mean /= length;
  let variance = 0;
  for (let i = 0; i < length; i++) variance += (h[offset + i] - mean) ** 2;
  const inverse = 1 / Math.sqrt(variance / length + eps);
  for (let i = 0; i < length; i++) out[offset + i] = (h[offset + i] - mean) * inverse;
  return out;
}

class Speech {
  readonly latent: number;
  private layers: number;
  private d: number;
  private heads: number;
  private ff: number;
  private hw: number;
  private headDim: number;
  private depth: number;
  private blocks: Linear[][];
  private ce: Linear;
  private ada: Linear;
  private hblocks: Linear[][];
  private latIn: Linear;
  private hInp: Linear;
  private hOut: Linear;
  private textEmb: Float32Array;
  private bos: Float32Array;
  private cos: Float32Array;
  private sin: Float32Array;
  private kv: F32;
  private scale: number;
  private s: Record<"x" | "qkv" | "a" | "proj" | "gu" | "act" | "scores" | "ce" | "cond" | "A" | "h" | "y" | "hidden" | "update" | "flow" | "z", F32>;

  constructor(private heap: Heap, tree: Tree) {
    const st = node(tree);
    const cfg = st.cfg as unknown as Record<string, number>;
    this.layers = cfg.L;
    this.d = cfg.d;
    this.heads = cfg.H;
    this.ff = cfg.ff;
    this.hw = cfg.hw;
    this.latent = cfg.latent;
    this.depth = cfg.depth;
    this.headDim = this.d / this.heads;
    const linear = (item: Tree) => new Linear(heap, item);
    this.blocks = (st.layers as Tree[]).map((layer) => (layer as Tree[]).map(linear));
    this.ce = linear(st.ce);
    this.ada = linear(st.ada);
    this.hblocks = (st.hblocks as Tree[]).map((block) => (block as Tree[]).map(linear));
    this.latIn = linear(st.lat_in);
    this.hInp = linear(st.h_inp);
    this.hOut = linear(st.h_out);
    this.textEmb = floats(st.text_emb);
    this.bos = floats(st.bos);
    const dh = this.headDim;
    const half = dh / 2;
    this.cos = new Float32Array(MAX_LEN * dh);
    this.sin = new Float32Array(MAX_LEN * dh);
    for (let p = 0; p < MAX_LEN; p++) {
      for (let i = 0; i < half; i++) {
        const inv = Math.fround(1 / Math.fround(cfg.rope_base ** Math.fround((2 * i) / dh)));
        const angle = Math.fround(p * inv);
        this.cos[p * dh + i] = this.cos[p * dh + half + i] = Math.cos(angle);
        this.sin[p * dh + i] = -Math.sin(angle);
        this.sin[p * dh + half + i] = Math.sin(angle);
      }
    }
    // Keys and values per layer and head, each a contiguous (MAX_LEN, headDim) block.
    this.kv = heap.f32(this.layers * 2 * this.heads * MAX_LEN * dh);
    this.scale = dh ** -0.5;
    const d = this.d;
    this.s = {
      x: heap.f32(d), qkv: heap.f32(3 * d), a: heap.f32(d), proj: heap.f32(d), gu: heap.f32(2 * this.ff), act: heap.f32(this.ff),
      scores: heap.f32(MAX_LEN), ce: heap.f32(this.ce.rows), cond: heap.f32(this.hw), A: heap.f32(this.ada.rows),
      h: heap.f32(this.hw), y: heap.f32(this.hw), hidden: heap.f32(this.hblocks[0][0].rows), update: heap.f32(this.hw),
      flow: heap.f32(this.latent), z: heap.f32(this.latent)
    };
  }

  static bytes(tree: Tree) {
    const cfg = node(node(tree).cfg) as unknown as Record<string, number>;
    return weightBytes(tree) + cfg.L * 2 * cfg.H * MAX_LEN * (cfg.d / cfg.H) * 4 + (1 << 20);
  }

  private cache(layer: number, kind: 0 | 1, head: number) {
    return ((layer * 2 + kind) * this.heads + head) * MAX_LEN * this.headDim;
  }

  /** Rotary position on one head vector in place. */
  private rope(v: Float32Array, offset: number, position: number) {
    const dh = this.headDim;
    const half = dh / 2;
    const base = position * dh;
    for (let i = 0; i < half; i++) {
      const a = v[offset + i];
      const b = v[offset + half + i];
      v[offset + i] = a * this.cos[base + i] + b * this.sin[base + i];
      v[offset + half + i] = b * this.cos[base + half + i] + a * this.sin[base + half + i];
    }
  }

  /** One transformer block for the token in `x` at `position`, attending to everything cached up to it. */
  private block(i: number, position: number) {
    const [wqkv, wo, w1, w2] = this.blocks[i];
    const { heads, headDim: dh, d, ff, kv, heap } = this;
    const { x, qkv, a, proj, gu, act, scores } = this.s;
    wqkv.run(x, qkv, rmsInverse(x.a));
    for (let h = 0; h < heads; h++) {
      this.rope(qkv.a, h * dh, position);
      this.rope(qkv.a, d + h * dh, position);
      kv.a.set(qkv.a.subarray(d + h * dh, d + (h + 1) * dh), this.cache(i, 0, h) + position * dh);
      kv.a.set(qkv.a.subarray(2 * d + h * dh, 2 * d + (h + 1) * dh), this.cache(i, 1, h) + position * dh);
    }
    a.a.fill(0);
    const count = position + 1;
    for (let h = 0; h < heads; h++) {
      heap.kernels.matvecF32(kv.ptr + this.cache(i, 0, h) * 4, count, dh, qkv.ptr + h * dh * 4, scores.ptr);
      let max = -Infinity;
      for (let p = 0; p < count; p++) max = Math.max(max, scores.a[p] *= this.scale);
      let sum = 0;
      for (let p = 0; p < count; p++) sum += scores.a[p] = Math.exp(scores.a[p] - max);
      for (let p = 0; p < count; p++) scores.a[p] /= sum;
      heap.kernels.gemm(scores.ptr, count, 1, count, kv.ptr + this.cache(i, 1, h) * 4, dh, a.ptr + h * dh * 4);
    }
    wo.run(a, proj);
    for (let j = 0; j < d; j++) x.a[j] += proj.a[j];
    w1.run(x, gu, rmsInverse(x.a));
    for (let j = 0; j < ff; j++) act.a[j] = silu(gu.a[j]) * gu.a[ff + j];
    w2.run(act, proj);
    for (let j = 0; j < d; j++) x.a[j] += proj.a[j];
  }

  /** Conditioning from the newest token: the flow head's input and the end-of-speech score. */
  private condition() {
    const { ce, cond, x } = this.s;
    this.ce.run(x, ce, rmsInverse(x.a));
    for (let j = 0; j < this.hw; j++) cond.a[j] = silu(ce.a[j]);
    return ce.a[this.hw];
  }

  private head(z: F32) {
    const hw = this.hw;
    const { A, h, y, hidden, update, cond, flow } = this.s;
    this.ada.run(cond, A);
    this.hInp.run(z, h);
    const normed = new Float32Array(hw);
    for (let j = 0; j < this.depth; j++) {
      const o = 3 * hw * j;
      layerNorm(h.a, normed);
      for (let k = 0; k < hw; k++) y.a[k] = A.a[o + k] + normed[k] * A.a[o + hw + k];
      const [l1, l2] = this.hblocks[j];
      l1.run(y, hidden);
      for (let k = 0; k < hidden.a.length; k++) hidden.a[k] = silu(hidden.a[k]);
      l2.run(hidden, update);
      for (let k = 0; k < hw; k++) h.a[k] += A.a[o + 2 * hw + k] * update.a[k];
    }
    const o = 3 * hw * this.depth;
    layerNorm(h.a, normed);
    for (let k = 0; k < hw; k++) y.a[k] = A.a[o + k] + normed[k] * A.a[o + hw + k];
    return this.hOut.run(y, flow);
  }

  /** One latent frame per step until the end-of-speech score passes the threshold. Returns (frames, latent). */
  generate(voice: Float32Array, textIds: number[], rng: TorchRandn, maxFrames: number, temp: number, eosThreshold: number, signal?: AbortSignal) {
    const { d, layers, latent } = this;
    const { x, z } = this.s;
    const voiceRows = voice.length / d;
    const prefix = voiceRows + textIds.length + 1;
    maxFrames = Math.min(maxFrames, MAX_LEN - prefix);
    if (maxFrames <= 4) throw new Error("Woof: this sentence is too long to read in one go.");
    // The prefix (voice, text, start token) runs causally a row at a time; its last row conditions frame 0.
    for (let p = 0; p < prefix; p++) {
      if (p < voiceRows) x.a.set(voice.subarray(p * d, (p + 1) * d));
      else if (p < prefix - 1) x.a.set(this.textEmb.subarray(textIds[p - voiceRows] * d, (textIds[p - voiceRows] + 1) * d));
      else x.a.set(this.bos);
      for (let i = 0; i < layers; i++) this.block(i, p);
    }
    let eos = this.condition();
    const eosLogit = Math.log(eosThreshold / (1 - eosThreshold));
    const out = new Float32Array(maxFrames * latent);
    let count = 0;
    for (let frame = 0; frame < maxFrames; frame++) {
      if (signal?.aborted) throw new DOMException("Speech was cancelled.", "AbortError");
      if (frame > 3 && eos > eosLogit) break;
      const noise = rng.randn(latent);
      for (let j = 0; j < latent; j++) z.a[j] = Math.fround(noise[j] * temp);
      const flow = this.head(z);
      for (let j = 0; j < latent; j++) out[frame * latent + j] = z.a[j] = z.a[j] + flow.a[j];
      count = frame + 1;
      this.latIn.run(z, x);
      for (let i = 0; i < layers; i++) this.block(i, prefix + frame);
      eos = this.condition();
    }
    return out.slice(0, count * latent);
  }
}

// ------------------------------------------------------------------------------------------------ decoder

/** Abramowitz-Stegun 7.1.26, as the reference uses. */
function erf(x: number) {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return x < 0 ? -y : y;
}

const gelu = (x: number) => 0.5 * x * (1 + erf(x * Math.SQRT1_2));

function elu(x: Float32Array) {
  for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = Math.expm1(x[i]);
  return x;
}

/** Causal 1-d convolution over (T, Cin) rows that carries its last k-1 input rows from chunk to chunk. */
class Conv {
  readonly cin: number;
  readonly cout: number;
  private k: number;
  private taps: number[];
  private bias: Float32Array;
  private state: Float32Array;

  constructor(private heap: Heap, tree: Tree) {
    const st = node(tree);
    const { shape, data } = dequantize(st.w);
    [this.cout, this.cin, this.k] = shape;
    const { cin, cout, k } = this;
    this.bias = floats(st.b);
    this.taps = Array.from({ length: k }, (_, j) => {
      const tap = heap.f32(cin * cout);
      for (let o = 0; o < cout; o++) for (let i = 0; i < cin; i++) tap.a[i * cout + o] = data[(o * cin + i) * k + j];
      return tap.ptr;
    });
    this.state = new Float32Array((k - 1) * cin);
  }

  reset() {
    this.state.fill(0);
  }

  run(x: F32, t: number, residual?: F32) {
    const { k, cin, cout, heap } = this;
    const padded = heap.f32((t + k - 1) * cin);
    padded.a.set(this.state);
    padded.a.set(x.a.subarray(0, t * cin), (k - 1) * cin);
    this.state.set(padded.a.subarray(t * cin));
    const out = heap.f32(t * cout);
    for (let row = 0; row < t; row++) out.a.set(this.bias, row * cout);
    if (residual) for (let i = 0; i < t * cout; i++) out.a[i] += residual.a[i];
    for (let j = 0; j < k; j++) heap.kernels.gemm(padded.ptr + j * cin * 4, cin, t, cin, this.taps[j], cout, out.ptr);
    return out;
  }
}

/** Transposed convolution with kernel 2 x stride: each input row writes `stride` rows and carries the overlap on. */
class ConvTranspose {
  readonly cout: number;
  readonly stride: number;
  private cin: number;
  private kernel: number;
  private w: number;
  private bias: Float32Array;
  private carry: Float32Array;

  constructor(private heap: Heap, tree: Tree) {
    const st = node(tree);
    const { shape, data } = dequantize(st.w);
    [this.cin, this.cout, this.kernel] = shape;
    const { cin, cout, kernel: k } = this;
    this.stride = st.stride as unknown as number;
    this.bias = floats(st.b);
    const w = heap.f32(cin * k * cout);
    for (let i = 0; i < cin; i++) for (let o = 0; o < cout; o++) for (let j = 0; j < k; j++) w.a[(i * k + j) * cout + o] = data[(i * cout + o) * k + j];
    this.w = w.ptr;
    this.carry = new Float32Array(this.stride * cout);
  }

  reset() {
    this.carry.fill(0);
  }

  run(x: F32, t: number) {
    const { heap, cout } = this;
    const width = this.kernel * cout;
    const sc = this.stride * cout;
    const z = heap.f32(t * width);
    heap.kernels.gemm(x.ptr, this.cin, t, this.cin, this.w, width, z.ptr);
    const out = heap.f32(t * sc);
    for (let row = 0; row < t; row++) {
      for (let j = 0; j < sc; j++) {
        out.a[row * sc + j] = z.a[row * width + j] + this.bias[j % cout] + (row > 0 ? z.a[(row - 1) * width + sc + j] : this.carry[j]);
      }
    }
    if (t > 0) this.carry.set(z.a.subarray((t - 1) * width + sc, t * width));
    return out;
  }
}

type DecoderOp = { kind: "elu" } | { kind: "conv"; op: Conv } | { kind: "convt"; op: ConvTranspose } | { kind: "res"; op: [Conv, Conv] };

class Decoder {
  private heads: number;
  private headDim: number;
  private window: number;
  private eps: number;
  private width: number;
  private inpW: number;
  private inpB: Float32Array;
  private invFreq: Float32Array;
  private tf: Array<{ ln1: Float32Array[]; ln2: Float32Array[]; qkv: number; o: number; fc1: number; fc2: number }>;
  private ops: DecoderOp[];

  constructor(private heap: Heap, tree: Tree) {
    const st = node(tree);
    const cfg = st.cfg as unknown as Record<string, number>;
    this.heads = cfg.heads;
    this.headDim = cfg.head_dim;
    this.window = cfg.window;
    this.eps = cfg.eps;
    this.width = this.heads * this.headDim;
    const transposed = (item: Tree) => {
      const { shape, data } = dequantize(item);
      return heap.f32(data.length, transpose(data, shape[0], shape[1])).ptr;
    };
    const [inp, inpB] = st.inp as Tree[];
    this.inpW = transposed(inp);
    this.inpB = dequantize(inpB).data;
    this.invFreq = floats(st.inv_freq);
    this.tf = (st.tf as Tree[]).map((layerTree) => {
      const layer = node(layerTree);
      return {
        ln1: (layer.ln1 as Tree[]).map((item) => dequantize(item).data),
        ln2: (layer.ln2 as Tree[]).map((item) => dequantize(item).data),
        qkv: transposed(layer.qkv),
        o: transposed(layer.o),
        fc1: transposed(layer.fc1),
        fc2: transposed(layer.fc2)
      };
    });
    this.ops = (st.seanet as Tree[]).map((entry) => {
      const [kind, p] = entry as [string, Tree];
      if (kind === "conv") return { kind, op: new Conv(heap, p) };
      if (kind === "convt") return { kind, op: new ConvTranspose(heap, p) };
      if (kind === "res") return { kind, op: [new Conv(heap, (p as Tree[])[0]), new Conv(heap, (p as Tree[])[1])] as [Conv, Conv] };
      return { kind: "elu" };
    });
  }

  /** Working memory for a sentence of `frames` frames, on top of the weights. */
  static bytes(frames: number, width = 512) {
    return frames * width * 16 * 4 + (48 << 20);
  }

  private layerNormAffine(h: F32, t: number, [weight, bias]: Float32Array[]) {
    const D = this.width;
    const out = this.heap.f32(t * D);
    for (let row = 0; row < t; row++) {
      layerNorm(h.a, out.a, row * D, D, this.eps);
      for (let j = 0; j < D; j++) out.a[row * D + j] = out.a[row * D + j] * weight[j] + bias[j];
    }
    return out;
  }

  private transformer(h: F32, t: number) {
    const { heads, headDim: hd, heap, width: D } = this;
    const half = hd / 2;
    const cos = new Float32Array(t * half);
    const sin = new Float32Array(t * half);
    for (let p = 0; p < t; p++) {
      for (let i = 0; i < half; i++) {
        const angle = Math.fround(p * this.invFreq[i]);
        cos[p * half + i] = Math.cos(angle);
        sin[p * half + i] = Math.sin(angle);
      }
    }
    const scale = 1 / Math.sqrt(hd);
    for (const layer of this.tf) {
      const mark = heap.mark();
      const y = this.layerNormAffine(h, t, layer.ln1);
      const qkv = heap.f32(t * 3 * D);
      heap.kernels.gemm(y.ptr, D, t, D, layer.qkv, 3 * D, qkv.ptr);
      // Per head, contiguous rotated queries and keys, and values, so the kernels can read them in rows.
      const q = heap.f32(t * hd);
      const k = heap.f32(t * hd);
      const v = heap.f32(t * hd);
      const scores = heap.f32(Math.min(t, this.window));
      const attended = heap.f32(t * D);
      const row = heap.f32(hd);
      for (let head = 0; head < heads; head++) {
        for (let p = 0; p < t; p++) {
          const base = p * 3 * D + head * hd;
          for (let i = 0; i < half; i++) {
            const c = cos[p * half + i];
            const s = sin[p * half + i];
            const qa = qkv.a[base + i];
            const qb = qkv.a[base + half + i];
            q.a[p * hd + i] = qa * c - qb * s;
            q.a[p * hd + half + i] = qb * c + qa * s;
            const ka = qkv.a[base + D + i];
            const kb = qkv.a[base + D + half + i];
            k.a[p * hd + i] = ka * c - kb * s;
            k.a[p * hd + half + i] = kb * c + ka * s;
          }
          v.a.set(qkv.a.subarray(base + 2 * D, base + 2 * D + hd), p * hd);
        }
        for (let i = 0; i < t; i++) {
          const first = Math.max(0, i - this.window + 1);
          const count = i - first + 1;
          heap.kernels.matvecF32(k.ptr + first * hd * 4, count, hd, q.ptr + i * hd * 4, scores.ptr);
          let max = -Infinity;
          for (let j = 0; j < count; j++) max = Math.max(max, scores.a[j] *= scale);
          let sum = 0;
          for (let j = 0; j < count; j++) sum += scores.a[j] = Math.exp(scores.a[j] - max);
          for (let j = 0; j < count; j++) scores.a[j] /= sum;
          row.a.fill(0);
          heap.kernels.gemm(scores.ptr, count, 1, count, v.ptr + first * hd * 4, hd, row.ptr);
          attended.a.set(row.a, i * D + head * hd);
        }
      }
      const projected = heap.f32(t * D);
      heap.kernels.gemm(attended.ptr, D, t, D, layer.o, D, projected.ptr);
      for (let i = 0; i < t * D; i++) h.a[i] += projected.a[i];
      const y2 = this.layerNormAffine(h, t, layer.ln2);
      const hidden = heap.f32(t * 4 * D);
      heap.kernels.gemm(y2.ptr, D, t, D, layer.fc1, 4 * D, hidden.ptr);
      for (let i = 0; i < hidden.a.length; i++) hidden.a[i] = gelu(hidden.a[i]);
      const out = heap.f32(t * D);
      heap.kernels.gemm(hidden.ptr, 4 * D, t, 4 * D, layer.fc2, D, out.ptr);
      for (let i = 0; i < t * D; i++) h.a[i] += out.a[i];
      heap.release(mark);
    }
    return h;
  }

  /** (frames, latent) denormalized latents -> 24 kHz mono samples, streamed through the convolutions in chunks. */
  decode(latents: Float32Array, frames: number, onChunk?: (samples: Float32Array) => void) {
    const { heap, width: D } = this;
    const latent = latents.length / frames;
    const mark = heap.mark();
    const input = heap.f32(latents.length, latents);
    const h = heap.f32(frames * D);
    for (let row = 0; row < frames; row++) h.a.set(this.inpB, row * D);
    heap.kernels.gemm(input.ptr, latent, frames, latent, this.inpW, D, h.ptr);
    this.transformer(h, frames);
    for (const step of this.ops) {
      if (step.kind === "res") step.op.forEach((conv) => conv.reset());
      else if (step.kind !== "elu") step.op.reset();
    }
    const parts: Float32Array[] = [];
    for (let start = 0; start < frames; start += CHUNK_FRAMES) {
      const chunkMark = heap.mark();
      let rows = Math.min(CHUNK_FRAMES, frames - start);
      let x = heap.f32(rows * D, h.a.subarray(start * D, (start + rows) * D));
      let width = D;
      for (const step of this.ops) {
        if (step.kind === "elu") elu(x.a);
        else if (step.kind === "conv") {
          x = step.op.run(x, rows);
          width = step.op.cout;
        } else if (step.kind === "convt") {
          x = step.op.run(x, rows);
          rows *= step.op.stride;
          width = step.op.cout;
        } else {
          const [first, second] = step.op;
          const copy = heap.f32(rows * width, x.a);
          const inner = first.run({ ptr: copy.ptr, a: elu(copy.a) }, rows);
          x = second.run({ ptr: inner.ptr, a: elu(inner.a) }, rows, x);
        }
      }
      const samples = width === 1 ? x.a.slice(0, rows) : x.a.filter((_, index) => index % width === 0);
      parts.push(samples);
      onChunk?.(samples);
      heap.release(chunkMark);
    }
    heap.release(mark);
    const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ full model

export type WoofVoice = "juno" | "mira";

export class WoofModel {
  readonly maxFrames: number;
  readonly fps: number;
  private speech: Speech;
  private decoder: Decoder;
  private mean: Float32Array;
  private std: Float32Array;
  private voices: Record<string, Float32Array>;

  constructor(tree: Tree) {
    const st = node(tree);
    this.maxFrames = st.max_frames as number;
    this.fps = st.fps as number;
    const heap = new Heap(Speech.bytes(st.speech) + weightBytes(st.decoder, true) + Decoder.bytes(this.maxFrames));
    this.speech = new Speech(heap, st.speech);
    this.decoder = new Decoder(heap, st.decoder);
    this.mean = floats(st.mean);
    this.std = floats(st.std);
    this.voices = Object.fromEntries(Object.entries(node(st.voices)).map(([name, value]) => [name, floats(value)]));
  }

  latents(text: string, voice: WoofVoice, rng: TorchRandn, temp = 0.5, eos = 0.9, signal?: AbortSignal) {
    const latents = this.speech.generate(this.voices[voice], encodeText(text), rng, this.maxFrames, temp, eos, signal);
    return { latents, frames: latents.length / this.speech.latent };
  }

  decode(latents: Float32Array, frames: number, onChunk?: (samples: Float32Array) => void) {
    const latent = this.mean.length;
    const scaled = new Float32Array(latents.length);
    for (let i = 0; i < latents.length; i++) scaled[i] = latents[i] * this.std[i % latent] + this.mean[i % latent];
    return this.decoder.decode(scaled, frames, onChunk);
  }
}
