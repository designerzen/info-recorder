import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSettings } from "../../src/config/settings";

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({ text: "Hello world" })),
  pipeline: vi.fn(),
  nemotronLoad: vi.fn(async () => {}),
  nemotronTranscribe: vi.fn(async () => "Hello world"),
  nemotronClose: vi.fn(async () => {})
}));
vi.mock("@huggingface/transformers", () => ({
  env: { fetch: vi.fn() },
  pipeline: mocks.pipeline,
  ModelRegistry: {
    is_pipeline_cached_files: vi.fn(async () => ({ allCached: true, files: [] })),
    get_pipeline_files: vi.fn(async () => []),
    get_file_metadata: vi.fn()
  }
}));
vi.mock("@timur00kh/whisper.wasm", () => ({ ModelManager: class {}, WhisperWasmService: class {}, getAllModels: () => [] }));
vi.mock("@moonshine-ai/moonshine-wasm", () => ({ ModelArch: {}, Stream: class {}, Transcriber: class {}, TranscribeFlags: {} }));
vi.mock("../../src/recorder/nemotron/nemotron", () => ({
  NemotronBrowserASR: class {
    load = mocks.nemotronLoad;
    transcribe = mocks.nemotronTranscribe;
    close = mocks.nemotronClose;
  }
}));
vi.mock("../../src/recorder/nemotron/modelAssets", () => ({
  inspectNemotronCache: async () => ({ cached: true, cachedFiles: 7, totalFiles: 7, cachedBytes: 791032783, sizeBytes: 791032783 })
}));

async function workerFor(modelId: typeof appSettings.transcription.modelId) {
  await import("../../src/recorder/whisperWorker");
  const send = (data: unknown) => self.onmessage!(new MessageEvent("message", { data }));
  send({ type: "configure", transcription: { ...appSettings.transcription, modelId } });
  return send;
}

describe("transcription model dispatch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.pipeline.mockResolvedValue(mocks.recognize);
    vi.stubGlobal("postMessage", vi.fn());
    Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
  });

  it("loads Parakeet with q8 for inference and inventory, without Whisper generation arguments", async () => {
    const send = await workerFor("onnx-community/parakeet-ctc-0.6b-ONNX");
    send({ type: "transcribe", audio: new Float32Array(16000), sampleRate: 16000, offsetSeconds: 12, startsNewParagraph: true, isFinal: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "segment", text: "Hello world", startsNewParagraph: true,
      words: [{ text: "Hello world", startMs: 12000, endMs: 13000 }] }));
    expect(mocks.pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "onnx-community/parakeet-ctc-0.6b-ONNX", expect.objectContaining({ dtype: "q8", device: "webgpu" }));
    expect(mocks.recognize).toHaveBeenCalledWith(expect.any(Float32Array), {});
    const { ModelRegistry } = await import("@huggingface/transformers");
    expect(ModelRegistry.get_pipeline_files).toHaveBeenCalledWith("automatic-speech-recognition", "onnx-community/parakeet-ctc-0.6b-ONNX", { dtype: "q8", device: "webgpu" });
  });

  it("uses Nemotron's adapter without WebGPU, resamples audio and reports capture timing", async () => {
    Reflect.deleteProperty(navigator, "gpu");
    const send = await workerFor("nemotron:streaming-0.6b-int4");
    send({ type: "transcribe", audio: new Float32Array(8000), sampleRate: 8000, offsetSeconds: 3, startsNewParagraph: false, isFinal: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "segment", text: "Hello world", startsNewParagraph: false,
      words: [{ text: "Hello world", startMs: 3000, endMs: 4000 }] }));
    expect(mocks.nemotronLoad).toHaveBeenCalledOnce();
    expect(mocks.nemotronTranscribe).toHaveBeenCalledWith(expect.objectContaining({ samples: 16000, frames: 101 }), 101, expect.any(Function));
    expect(mocks.pipeline).not.toHaveBeenCalled();
    send({ type: "configure", transcription: { ...appSettings.transcription } });
    expect(mocks.nemotronClose).toHaveBeenCalledOnce();
  });

  it("keeps Whisper word timestamps and chunking", async () => {
    const send = await workerFor("onnx-community/whisper-small.en_timestamped");
    send({ type: "transcribe", audio: new Float32Array(16000 * 15), sampleRate: 16000, offsetSeconds: 0, startsNewParagraph: false, isFinal: true });
    await vi.waitFor(() => expect(mocks.recognize).toHaveBeenCalled());
    expect(mocks.recognize).toHaveBeenCalledWith(expect.any(Float32Array), { return_timestamps: "word", chunk_length_s: 15, stride_length_s: 2 });
  });
});
