# Info Recorder

Info Recorder is a browser-only speech recorder and transcription prototype. It records microphone audio into the browser's Origin Private File System (OPFS), draws a live waveform, uses local voice activity detection to split speech into phrase parts, and transcribes speech on screen with Transformers.js and WebGPU.

No microphone audio is sent to an application server. Transcription runs client-side. On first use, the browser downloads the Whisper model files and stores them in browser cache storage. Later runs reuse the cached files unless the user clears site data/cache storage, changes browser profile, changes device, or changes the model/revision.

## Features

- Microphone recording with `MediaRecorder`
- Timestamped audio chunks written to OPFS under `recordings/session-...`
- Full-recording download from stored OPFS chunks
- Per-part downloads, where a part is a spoken phrase separated by low activity or silence
- Live scrolling waveform drawn with an `OffscreenCanvas` worker
- Live ASS subtitle rendering with JASSUB on a canvas
- Optional read-aloud of the current subtitle with either built-in Web Speech API voices or Supertonic WebGPU voices loaded from Hugging Face
- Interchangeable voice activity detection modes for paragraph and part boundaries
- Client-side Whisper transcription through `@huggingface/transformers`
- WebGPU-only model execution
- First-run Whisper model download with browser Cache API reuse on later runs
- OPFS playback through an AudioWorklet after decoding stored chunks to PCM

## Requirements

- A Chromium-based browser with WebGPU enabled
- Microphone permission
- OPFS support through `navigator.storage.getDirectory()`
- AudioWorklet and OffscreenCanvas support for playback and worker-rendered waveform visuals

## Run

```sh
pnpm install
pnpm dev
```

Open the Vite URL in a supported browser, usually:

```txt
http://127.0.0.1:5173/
```

## Usage

1. Leave `Write timestamped MediaRecorder chunks to OPFS` enabled.
2. Press `Cache Model` once to download and cache Whisper before recording, or let the first `Listen` do it automatically.
3. Choose the chunk size for OPFS writes.
4. Press `Listen`.
5. Speak normally. The waveform scrolls as audio arrives, and text appears as transcription chunks complete.
6. Pause between phrases to create part boundaries.
7. Press `Stop`.
8. Use `Download Full Audio` for the whole recording, or the per-part buttons for phrase-level audio.

## Settings

Application defaults live in [`src/settings.ts`](src/settings.ts). This file controls:

- microphone/transcription chunk timings
- Whisper model, language, task, device, and cache behavior
- VAD mode and detector thresholds
- optional ML VAD model settings
- waveform history and scrolling density
- JASSUB subtitle renderer and ASS style defaults
- current TTS provider, language, rate, pitch, volume, Supertonic asset paths, and Supertonic voice preset defaults

The default VAD mode is `adaptive-rms`. It has the best performance and lowest footprint for this app because it uses audio already decoded for transcription, requires no extra model download, and adapts to the local noise floor. Other modes are available when you need different behavior:

- `adaptive-rms`: default, fast noise-floor adaptive energy detector
- `fixed-rms`: simple fixed threshold detector for controlled environments
- `rms-zcr`: combines RMS with zero-crossing rate to reject some low-frequency rumble and high-frequency noise
- `transformers-audio-classification`: optional ML-backed detector using a configurable Transformers.js audio-classification model, loaded only when selected

## Storage Layout

Each recording session is stored in OPFS:

```txt
recordings/
  session-YYYY-MM-DDTHH-MM-SS-sssZ/
    session.json
    000000-YYYY-MM-DDTHH-MM-SS-sssZ.webm
    000000-YYYY-MM-DDTHH-MM-SS-sssZ.json
    ...
```

`session.json` contains session metadata, chunk metadata, and phrase part metadata. Each chunk also has a matching JSON metadata file with start time, end time, duration, MIME type, and byte length.

## Implementation Notes

- The app requires WebGPU and passes `device: "webgpu"` to Transformers.js.
- The current model is `onnx-community/whisper-tiny.en`.
- `env.useBrowserCache = true` and `env.useWasmCache = true` are enabled in the transcription worker.
- The worker checks `ModelRegistry.is_pipeline_cached_files(...)` for the exact WebGPU ASR pipeline and reports whether the model is cached.
- VAD runs through `src/vad.ts` and is selected through `appSettings.vad.mode`.
- Phrase parts are created when VAD sees low activity or a long trailing silence.
- ML VAD is optional and lazy-loaded, so the default build does not pull the model path into the initial UI bundle.
- The waveform worker only draws. The main thread still reads `AnalyserNode` samples because Web Audio analyser nodes live in the main audio graph.
- Stored audio chunks use the browser's selected `MediaRecorder` MIME type, usually WebM/Opus.
- Live subtitles are generated as ASS content and rendered through JASSUB, with worker/WASM/font assets bundled by Vite.
- Subtitle read-aloud can use `SpeechSynthesisUtterance` or the Supertonic browser helper vendored from `supertone-inc/supertonic`. Supertonic is loaded lazily, downloads static model assets from Hugging Face, runs through `onnxruntime-web` with the `webgpu` execution provider, and uses the M1-M5/F1-F5 voice presets.

## Supertonic Voices

The `Supertonic WebGPU` voice engine is available from the subtitle voice controls. It is not loaded until selected and used.

The required Supertonic 3 web assets are loaded directly from [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) on Hugging Face:

```txt
https://huggingface.co/Supertone/supertonic-3/resolve/main/
  onnx/
    duration_predictor.onnx
    text_encoder.onnx
    vector_estimator.onnx
    vocoder.onnx
    tts.json
    unicode_indexer.json
  voice_styles/
    M1.json ... M5.json
    F1.json ... F5.json
```

The browser downloads those static model/config/style assets on first Supertonic use. No microphone audio, transcript text, or generated speech is posted to an application server by this app.

The model assets are distributed by Supertone under the license published in the Hugging Face model repository. Large ONNX files should not be committed to this repo; GitHub rejects normal Git blobs over 100 MB.

## Verification

```sh
pnpm build
```

The build runs TypeScript and creates the production Vite output.
