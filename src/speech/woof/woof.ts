// Derived from Underdog Woof by Conway: Underdog Non-Commercial License 1.0. See LICENSE and README.md in this folder.
/** Text in, 24 kHz audio out, as Underdog Woof's own Woof class does it: normalize, split into utterances, and redraw a
 * take that runs far too long or stalls in the middle, keeping the best of up to four. */
import { loadNpz } from "./npz";
import { normalize } from "./normalize";
import { Respeller } from "./respell";
import { SAMPLE_RATE, TorchRandn, WoofModel, type WoofVoice } from "./runtime";
import { splitText } from "./textsplit";

export { SAMPLE_RATE, type WoofVoice };

/** Longest run (seconds) of 40 ms frames under -50 dBFS between the first and last voiced frame. */
function stall(wav: Float32Array, hop = 960, db = -50) {
  const n = Math.floor(wav.length / hop);
  if (n < 3) return 0;
  const quiet: boolean[] = [];
  for (let frame = 0; frame < n; frame++) {
    let sum = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i++) sum += wav[i] * wav[i];
    quiet.push(20 * Math.log10(Math.sqrt(sum / hop) + 1e-9) < db);
  }
  const first = quiet.indexOf(false);
  const last = quiet.lastIndexOf(false);
  if (first < 0 || first === last) return 0;
  let best = 0;
  let current = 0;
  for (let i = first; i <= last; i++) {
    current = quiet[i] ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return (best * hop) / SAMPLE_RATE;
}

export type WoofOptions = { temp?: number; eos?: number; maxSecondsPerChar?: number; stallSeconds?: number; retries?: number };

export class Woof {
  private rng = new TorchRandn(0);
  private options: Required<WoofOptions>;

  constructor(private model: WoofModel, private respeller?: Respeller, options: WoofOptions = {}) {
    this.options = { temp: 0.5, eos: 0.9, maxSecondsPerChar: 0.095, stallSeconds: 1, retries: 3, ...options };
  }

  static fromBuffers(weights: ArrayBuffer, lexicon?: string, options?: WoofOptions) {
    return new Woof(new WoofModel(loadNpz(weights)), lexicon ? new Respeller(lexicon) : undefined, options);
  }

  /** The text the model will actually read. */
  prepare(text: string) {
    const spoken = normalize(text, this.respeller ? (value) => this.respeller!.respell(value) : undefined);
    const pieces = splitText(spoken);
    return pieces.length ? pieces : [spoken];
  }

  private piece(text: string, voice: WoofVoice, signal?: AbortSignal) {
    const { temp, eos, maxSecondsPerChar, stallSeconds, retries } = this.options;
    let best: { score: [number, number, number]; wav: Float32Array } | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const { latents, frames } = this.model.latents(text, voice, this.rng, temp, eos, signal);
      const wav = this.model.decode(latents, frames);
      const run = stall(wav);
      const secondsPerChar = wav.length / SAMPLE_RATE / Math.max(1, Array.from(text).length);
      const bad = Number(run >= stallSeconds) + Number(secondsPerChar > maxSecondsPerChar || frames >= this.model.maxFrames);
      const score: [number, number, number] = [bad, run, secondsPerChar];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) {
        best = { score, wav };
      }
      if (!bad) break;
    }
    return best!.wav;
  }

  /** Synthesizes all of `text`; `onPiece` hears each utterance as soon as it is ready. */
  synthesize(text: string, voice: WoofVoice = "juno", options: { seed?: number; signal?: AbortSignal; onPiece?: (wav: Float32Array) => void } = {}) {
    if (options.seed !== undefined) this.rng.seed(options.seed);
    const wavs = this.prepare(text).map((piece) => {
      const wav = this.piece(piece, voice, options.signal);
      options.onPiece?.(wav);
      return wav;
    });
    if (wavs.length === 1) return wavs[0];
    const out = new Float32Array(wavs.reduce((total, wav) => total + wav.length, 0));
    let offset = 0;
    for (const wav of wavs) {
      out.set(wav, offset);
      offset += wav.length;
    }
    return out;
  }
}
