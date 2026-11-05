# Info Recorder

Word Trail (Info Recorder) is an offline speech recorder and transcription app for the browser and Electron desktop. It turns speech and location into subtitles split into sentences. Press a sentence to hear it, play the whole transcript with each word highlighted, or follow the sentences along a route on a map.

No microphone audio is sent to an application server. Transcription runs client-side. On first use, the browser downloads the selected model files and stores them in browser-managed offline storage. Later runs reuse the cached files unless the user clears site data, changes browser profile or device, or changes models.

Microphone transcription defaults to browser speech recognition only when `processLocally` and on-device language-pack support are available. Missing packs are installed when supported; unavailable, failed, or stalled (60 seconds) local setup falls back to the selected model, which defaults to Moonshine. Browser speech recognition is always configured with `processLocally: true`; remote browser recognition is never used. File transcription and translation continue to use the selected model. Browser recognition provides no word timestamps, so word timings are estimated from capture time and word length; sentence replay and highlighting are approximate on this path.

## Features

- One button to record and pause, with an upload button and settings. There is no Stop: pausing releases the microphone and location, and sessions save themselves
- Activity indicator, live waveform and recording clock from the moment Record is pressed; audio is captured while the transcription engine gets ready
- Media files can be uploaded or dropped anywhere on the page
- Sentences show their time, length, location and engine on hover, keyboard focus, or long press
- Whole-transcript karaoke playback that keeps the current word in view, using recorded audio or a voice, with pause, speed, and pressing a sentence to continue from it
- A map of where each sentence was spoken, with the route, a timeline slider and playback following along
- Automatic saving with restore after a reload or crash; earlier recordings are listed in Settings
- Sentence correction, search and copy
- Text, SRT, VTT, GPX, GeoJSON, audio and captioned video downloads
- Screen wake lock while recording, and a clear pause if the microphone is disconnected
- Moonshine models through the official browser WASM runtime, and Whisper through Transformers.js WebGPU or whisper.cpp WASM
- Optional read-aloud with Web Speech API voices or Supertonic WebGPU voices

## Requirements

- A current Chromium-based browser with WebAssembly; Whisper ONNX choices also need WebGPU
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers for Moonshine's threaded WASM build (already configured for Vite dev and preview)
- Microphone permission
- OPFS support through `navigator.storage.getDirectory()`
- AudioWorklet and OffscreenCanvas support for playback and worker-rendered waveform visuals

### Offline use

Word Trail is an offline application. The production web build registers `isolation-worker.js`,
which stores the built app so it opens with no network, including in a new tab. It is
installable as an app through `manifest.webmanifest`. These still need a network once, and are
then kept on the device:

- the on-device speech language pack, or the Moonshine model (Settings has a button to download it ahead of time). Uploads always use the model, because browser speech cannot read files
- the optional Supertonic voices and the ffmpeg encoder used for audio conversion and video export

Map images come from OpenStreetMap, which sees the area being viewed; recordings and text are
never sent. Areas already viewed stay available offline, and without images the route,
sentences and playback still work. Electron bundles the app itself, but downloads and map images
are not cached by the worker there.

### GitHub Pages

The Pages workflow builds with `/info-recorder/` as the base path and deploys
`dist/` on pushes to `main`. GitHub Pages does not supply the COOP/COEP headers
configured for Vite. On static hosts, the app registers `isolation-worker.js`
within its base path, waits for it to take control, and reloads once before
starting the app. The worker adds COOP/COEP to same-origin responses, including
worker scripts, without changing other projects on the origin.
The page URL, settings, recordings, and model caches are preserved.

Service workers must be allowed in the browser. Hosts that already supply the
headers (Vite and Electron) skip this setup. Verify a Pages build with:

```sh
pnpm exec tsc -b
pnpm exec vite build --base=/info-recorder/
pnpm test:pages
```

This smoke test serves production files without isolation headers, checks a
fresh visit and reload, and exchanges shared memory with a real browser worker.
The Pages workflow runs it before uploading the deployment artifact.

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

### Desktop app and downloads

Open **Help → Desktop downloads** in Electron, or visit `#downloads` in the web app, for platform choices, installation
guidance, and [GitHub Releases](https://github.com/designerzen/info-recorder/releases).
The page uses the latest published release rather than hard-coded versioned URLs.
Downloads become available after the first release is published.

Use Node.js 24 and the pnpm version pinned in `package.json`. After `pnpm install`:

```sh
pnpm desktop:dev    # Vite + Electron, with hot reload
pnpm desktop:pack   # Production app folder in release/, without an installer
pnpm desktop:build  # Production installers for the current platform
```

The Windows build creates an NSIS installer; macOS creates DMG and ZIP files;
Linux creates AppImage and Debian packages. macOS builds run on macOS and
Windows builds run on Windows. The release workflow builds Windows/Linux x64
and macOS x64/arm64 on native GitHub runners.

The desktop renderer has no Node integration or preload bridge. A sandboxed,
isolated Chromium renderer serves bundled assets from `wordtrail://app/`, with
COOP/COEP headers for threaded WASM, OPFS, workers, and local model caches.
Microphone and optional location access require approval. External web links
open in your default browser. Recordings and model caches live in Electron's
application profile, separately from the browser app. Development uses its own
`Word Trail Development` profile. Models still need their initial download;
WebGPU depends on the GPU/driver, and built-in browser translation may be absent.

Only compiled web assets and the Electron shell are staged in `.desktop-app/`.
Browser build dependencies and optional Node inference binaries are excluded.
The build pipeline starts from `public/icon.svg`; run `pnpm icons` after editing
it to regenerate ICO, ICNS, Linux PNGs, favicon assets, and the touch icon.
Generated icons are committed, so local packaging does not require regeneration.

### Creating a release

1. Update `package.json`'s version and install to keep the lockfile current.
2. Commit and push the changes, then push a matching tag, such as `v0.1.0`.
3. **Desktop builds and release** tests and packages all four platform/architecture
   combinations, uploads workflow artifacts, and creates a **draft GitHub release**
   containing installers, SHA-256 checksums, installation guidance, and generated
   change notes. A tag that differs from the package version fails the build.
4. Review the draft in GitHub Releases and publish it. The Downloads page's latest
   release link then resolves to that version. Update the Pages deployment as usual
   by pushing to `main`.

Manual workflow runs build downloadable workflow artifacts without creating a
release. Relevant pull requests also build and test without release write access.
Re-running a tag workflow reuses the release and replaces its matching assets.

Current community builds are unsigned on Windows and ad-hoc signed on macOS,
without notarization. SmartScreen/Gatekeeper may require approval or block them.
Publisher signing needs your own certificates and credentials. To configure
Developer ID signing, replace `mac.identity` in `electron-builder.cjs`, enable
`mac.hardenedRuntime`, configure notarization with your Apple credentials, and
provide signing secrets through GitHub Actions. Windows signing likewise needs a
publisher certificate/service. Never commit signing credentials. Updates are
installed manually; no background updater is configured.

Desktop verification:

```sh
pnpm test:desktop
pnpm desktop:prepare
pnpm test:desktop:smoke
```

The smoke test launches the production renderer with a temporary profile and
checks secure context, cross-origin isolation, OPFS writes, model cache storage,
shared-memory workers, AudioWorklet loading, sandbox preferences, and Downloads
navigation. On headless Linux use `xvfb-run --auto-servernum pnpm test:desktop:smoke`.
It does not record a microphone or download speech models.
The release workflow runs these checks against each packaged executable.

To check a packaged executable, run
`node scripts/electron-smoke.mjs --executable "release/win-unpacked/Word Trail.exe"`.

### Recording

1. Press `Record` and allow the microphone and location. The clock and waveform start straight away.
2. Speak normally. Sentences appear below and the transcript follows along.
3. Press `Pause` when you are done. This stops the microphone, location and wake lock. Press `Resume` to carry on.
4. Press a sentence to hear it, or `Play transcript` for the whole recording with each word highlighted.
5. Open `Map` to see where each sentence was spoken.
6. Press `New`, or `Upload` a file, to begin something new. The previous session stays in Settings under Saved recordings.

Sessions save automatically every few seconds and on pause, and reopen after a reload until you start something new. Turning off `Save audio chunks` in Settings also turns off saving, and the app then asks before discarding a transcript.

The download panel below the transcript saves the displayed transcript as UTF-8
text, or exports the original recording or a local Supertonic TTS voice as MP3,
WAV, FLAC, Ogg Opus, or Ogg Vorbis. Speed (0.5–2×) and pitch (−12 to +12
semitones) are independent export controls. Audio downloads become available
when recording/transcription finishes; text can be saved while it is arriving.
Browser system voices support playback; downloadable TTS uses the local model
voices and requires WebGPU.

`Download captioned video` produces an MP4 with a plain background, the selected
audio, and a switchable `mov_text` closed-caption track. Enable captions in a
compatible player. Original-audio captions use recognition timestamps; generated
speech captions use each synthesized phrase's measured sample duration. Caption
times follow the export speed. Recordings without usable timestamps can still
export audio, or use a TTS voice to generate new timed captions. These exports
run locally with ffmpeg.wasm, which downloads its encoder on first use.

## Settings

Settings → Translation offers optional browser translation when the browser exposes
the built-in `Translator` API. Choose the language of the transcript text and a
target language, then enable translation. Target choices are checked against the
browser's availability API; unavailable pairs are excluded. The browser may
download language packs on first use, then translates text locally. Translations
appear below the original transcript sentences. Speech recognition and playback
continue to use the original transcript. Language choices are saved in the URL;
translation starts disabled and must be enabled again after reloading or changing
languages. Browsers without this API show an unavailable setting.

Application defaults live in [`src/config/settings.ts`](src/config/settings.ts). This file controls:

- microphone/transcription chunk timings
- transcription model, language, task, device, and cache behavior
- VAD mode and detector thresholds
- optional ML VAD model settings
- waveform history and scrolling density
- JASSUB subtitle renderer and ASS style defaults
- current TTS provider, language, rate, pitch, volume, Supertonic asset paths, and Supertonic voice preset defaults

The default VAD mode is `adaptive-rms`. It has the best performance and lowest footprint for this app because it uses audio already decoded for transcription, requires no extra model download, and adapts to the local noise floor. Other modes are available when you need different behavior:

- `adaptive-rms`: default, fast noise-floor adaptive energy detector
- `fixed-rms`: simple fixed threshold detector for controlled environments
- `rms-zcr`: combines RMS with zero-crossing rate to reject some low-frequency rumble and high-frequency noise
- `silero-vad`: optional Silero model detector, lazy-loaded only when selected and cached in local model storage
- `transformers-audio-classification`: optional ML-backed detector using a configurable Transformers.js audio-classification model, loaded only when selected

## Storage Layout

Each recording session is stored in OPFS:

```txt
recordings/
  session-YYYY-MM-DDTHH-MM-SS-sssZ/
    transcript.json
    pcm-000000.raw
    source-media
    session.json
    000000-YYYY-MM-DDTHH-MM-SS-sssZ.webm
    000000-YYYY-MM-DDTHH-MM-SS-sssZ.json
    ...
```

`transcript.json` holds the transcript with word timings, the location track, and what is needed to reopen the session. `pcm-*.raw` holds the recording as 16-bit PCM, which plays and seeks accurately, and `source-media` holds an uploaded file. `session.json` and the numbered chunks hold the `MediaRecorder` audio and phrase part metadata.

## Implementation Notes

- The UI uses native DOM elements and custom elements, with TypeScript state machines in `src/state/machine.ts`. JSX compiles to the local DOM factory; React and React DOM are not used. Recorder, playback, translation, and navigation transitions are explicit, while browser workers, audio, timers, and subscriptions belong to disposable services.
- The default model is Moonshine Small Streaming English, selected for its live-speech latency/accuracy balance. Tiny and Medium Streaming are also available.
- Moonshine runs through the official `moonshine-voice-wasm` v0.1.0 release, caches model assets through the Cache API, and returns word or line timing data through the same transcript path used by Whisper.
- Settings retain all timestamp-capable Whisper ONNX exports and Whisper WASM GGML models. ONNX models provide word timestamps through `return_timestamps: "word"` chunks; WASM GGML models provide segment start/end timestamps from `@timur00kh/whisper.wasm`.
- Whisper ONNX selections require WebGPU and pass `device: "webgpu"` to Transformers.js. Moonshine and whisper.cpp choices run in WASM.
- Current ONNX choices are English-only `tiny/base/small/medium` timestamped, multilingual `tiny/base/small/medium` timestamped, and multilingual `large-v3-turbo` timestamped.
- Current WASM choices are `tiny/base/small` English and multilingual, Q5 `tiny/base/small` English and multilingual, Q5 `medium` English and multilingual, and Q5 `large` multilingual.
- Transformers.js uses a custom persistent cache in origin storage, with browser cache fallback when persistent storage APIs are unavailable.
- The worker checks `ModelRegistry.is_pipeline_cached_files(...)` for the exact WebGPU ASR pipeline and reports whether the model is cached.
- The model selector shows which models are already available offline before you disconnect from the network.
- Live microphone transcription defaults to raw timed audio chunks. Activity detection can be enabled in settings when you want silence-aware chunking.
- Each sentence is placed on the map from a timestamped location track on the same timeline as the audio, so it does not depend on activity detection or saving.
- The playing position is published outside the state machines and written directly to the DOM, and each transcript paragraph only re-renders when its own text changes, so long transcripts stay smooth.
- When enabled, VAD runs through `src/vad.ts` and is selected through `appSettings.vad.mode`.
- Phrase parts are created when activity detection sees low activity or a long trailing silence.
- Large JASSUB subtitles over the transcript are off by default and can be enabled under Advanced settings.
- ML VAD is optional and lazy-loaded, so the default build does not pull the model path into the initial UI bundle.
- The waveform worker only draws. The main thread still reads `AnalyserNode` samples because Web Audio analyser nodes live in the main audio graph.
- Stored audio chunks use the browser's selected `MediaRecorder` MIME type, usually WebM/Opus.
- The optional subtitle overlay is generated as ASS content and rendered through JASSUB, with worker/WASM/font assets bundled by Vite.
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

The [design system](DESIGN_SYSTEM.md) defines the OKLCH palette, AAA-first contrast
rules, button contract, interaction states, and their automated browser checks.
Run `pnpm test:design` for the theme and button accessibility matrix.

```sh
pnpm build
```

The build runs TypeScript and creates the production Vite output.

Run browser checks with `pnpm test:e2e`. Install the matching browser with
`pnpm exec playwright install chromium` after installing or upgrading Playwright.
If the browser download is unavailable, local Windows runs automatically use an
installed Google Chrome browser. The test report names the browser used. CI
continues to require Playwright's managed Chromium; it does not use this fallback.
