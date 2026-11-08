# Underdog Woof in the browser

This folder is derived from [Underdog Woof](https://huggingface.co/ConwayResearch/Underdog-Woof) by Conway
([underdog.ai/woof](https://underdog.ai/woof)) and is licensed under the
[Underdog Non-Commercial License 1.0](LICENSE), not under this app's terms. Keep `LICENSE` and `NOTICE` with it,
unchanged. It is free for non-commercial use with credit; commercial use needs a license from license@conway.tech.

The weights are not stored here. The worker downloads `woof_int8.npz` and `underdog_woof/respell.tsv` from the Hugging
Face repository at revision `be702960539777fc3f698e54335276a8391b00f9`, the one this port was checked against.

## What was changed

The reference runtime is Python with numpy. This folder ports it to TypeScript for a browser worker:

- `runtime.ts` ports `runtime.py`: the speech model, flow head and audio decoder. Matrix products run in WebAssembly
  SIMD kernels (`kernels.wat`, built by `scripts/build-woof-kernels.mjs`). The decoder's convolutions run in chunks of
  eight frames, carrying their state from chunk to chunk, rather than over the whole sentence at once. The random
  numbers follow `torch.manual_seed` and `torch.randn`, as the reference does.
- `normalize.ts` ports `normalize.py` rule for rule, with NeMo off as in the reference's default. `pyre.ts` gives
  JavaScript regular expressions Python's `re` behaviour for those rules.
- `respell.ts` ports `respell.py`, `textsplit.ts` ports `textsplit.py`, and `woof.ts` ports the `Woof` class in
  `__init__.py`, with its retries for takes that run long or stall.
- `npz.ts` reads the `.npz` weights file.

Checked against the reference at that revision with the same seed: the normalizer gives identical text, the speech
model's first latent frames agree to about 1e-6, and the decoder's audio for the same latents agrees to about 1e-6.

The app shows "Voice by Underdog Woof" with a link to underdog.ai wherever the voice is offered or plays, as the license
asks.
