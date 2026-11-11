Nemotron 3.5 ASR browser runtime

`nemotron.ts`, `audio.ts`, and `joint-argmax.onnx` are adapted from
https://github.com/People-11/Nemotron_Web/tree/5b37ff1d9fb021db6d9db2ec3a4768e5ee6310e0
under the included MIT license. The joint graph adds ArgMax to avoid copying
the full vocabulary logits from the GPU at every decoding step.

Weights and tokenizer are downloaded on demand from the pinned Hugging Face
revision in modelAssets.ts and cached in OPFS (or Cache Storage). NVIDIA's
model license applies to those assets:
https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b

The app uses English language ID 101 and decodes each incoming audio chunk
independently. It reports chunk timing rather than inventing word alignment.
WebGPU is preferred; the runtime falls back to WASM if GPU initialization fails.
