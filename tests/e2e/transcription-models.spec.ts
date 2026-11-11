import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("all four speech recognition families can be selected and persist in the URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const model = page.getByRole("combobox", { name: "Transcription model", exact: true });
  for (const id of ["moonshine:small-streaming-en", "onnx-community/whisper-tiny.en_timestamped", "onnx-community/parakeet-ctc-0.6b-ONNX", "nemotron:streaming-0.6b-int4"]) {
    await model.selectOption(id);
    await expect(model).toHaveValue(id);
    await expect.poll(() => new URL(page.url()).searchParams.get("transcriptionModel")).toBe(id);
  }
  await expect(model.locator("option:checked")).toHaveText(/Nemotron/);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Transcription model", exact: true })).toHaveValue("nemotron:streaming-0.6b-int4");
});

test("Parakeet transcribes real audio using WebGPU", async ({ page }) => {
  test.skip(!process.env.PARAKEET_FILES, "Set PARAKEET_FILES to run real-model inference");
  test.setTimeout(300_000);
  const require = createRequire(import.meta.url);
  const transformersRequire = createRequire(require.resolve("@huggingface/transformers"));
  const server = createServer((req, res) => {
    const name = new URL(req.url!, "http://localhost").pathname.slice(1).replace(/^models\//, "");
    try {
      const file = name.startsWith("ort-")
        ? transformersRequire.resolve(`onnxruntime-web/${name}`)
        : join(process.env.PARAKEET_FILES!, name);
      if (!statSync(file).isFile()) throw new Error("Not a model file");
      res.writeHead(200, { "Content-Length": statSync(file).size, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin", "Content-Type": name.endsWith(".mjs") ? "application/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" });
      createReadStream(file).pipe(res);
    } catch { res.writeHead(404, { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  try {
    await page.route("**/src/main.tsx*", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
    await page.goto("/");
    const text = await page.evaluate(async (root) => {
      // @ts-expect-error Vite's prebundled browser module.
      const { env, pipeline } = await import("/node_modules/.vite/deps/@huggingface_transformers.js");
      env.allowLocalModels = false;
      env.useBrowserCache = false;
      env.useWasmCache = false;
      env.remoteHost = root;
      env.remotePathTemplate = "models/";
      env.backends.onnx.wasm.wasmPaths = { mjs: `${root}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${root}ort-wasm-simd-threaded.asyncify.wasm` };
      const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await (await fetch(`${root}sample.wav`)).arrayBuffer());
      const recognize = await pipeline("automatic-speech-recognition", "onnx-community/parakeet-ctc-0.6b-ONNX", { dtype: "q8", device: "webgpu" });
      try { return (await recognize(audio.getChannelData(0))).text; }
      finally { await recognize.dispose(); }
    }, root);
    expect(text.toLowerCase()).toContain("fellow americans");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

// Optional real-weight test. Point NEMOTRON_FILES to downloaded pinned model files
// plus sample.wav; the normal suite never downloads hundreds of MB of weights.
test("Nemotron transcribes real audio using WASM", async ({ page }) => {
  test.skip(!process.env.NEMOTRON_FILES, "Set NEMOTRON_FILES to run real-model inference");
  test.setTimeout(300_000);
  await page.route("**/src/main.tsx*", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  const server = createServer((req, res) => {
    const file = join(process.env.NEMOTRON_FILES!, new URL(req.url!, "http://localhost").pathname.split("/").pop()!);
    res.writeHead(200, { "Content-Length": statSync(file).size, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await page.route("**/src/recorder/nemotron/modelAssets.ts*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/https:\/\/huggingface.co\/onnx-community\/nemotron-3\.5-asr-streaming-0\.6b-onnx-int4\/resolve\/[a-f0-9]+/g, `http://127.0.0.1:${port}`);
    await route.fulfill({ response, body });
  });
  try {
    await page.route("**/sample.wav", (route) => route.fulfill({ path: join(process.env.NEMOTRON_FILES!, "sample.wav"), contentType: "audio/wav" }));
    await page.goto("/");
    const text = await page.evaluate(async () => {
      Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
      // @ts-expect-error Vite resolves the browser-side module path.
      const { NemotronBrowserASR } = await import("/src/recorder/nemotron/nemotron.ts");
      // @ts-expect-error Vite resolves the browser-side module path.
      const { logMelSpectrogram } = await import("/src/recorder/nemotron/audio.ts");
      const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await (await fetch("/sample.wav")).arrayBuffer());
      const model = new NemotronBrowserASR();
      try {
        await model.load(() => {});
        return await model.transcribe(logMelSpectrogram(audio.getChannelData(0)), 101, () => {});
      } finally { await model.close(); }
    });
    expect(text.toLowerCase()).toContain("fellow americans");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
