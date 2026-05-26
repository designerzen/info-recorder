import { appSettings } from "../config/settings";

type WaveformMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      pixelRatio: number;
    }
  | { type: "resize"; width: number; height: number; pixelRatio: number }
  | { type: "samples"; samples: Float32Array }
  | { type: "clear" };

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let width = 1;
let height = 1;
let pixelRatio = 1;
const waveformHistory = new Float32Array(appSettings.waveform.historySamples);

self.onmessage = ({ data }: MessageEvent<WaveformMessage>) => {
  if (data.type === "init") {
    canvas = data.canvas;
    context = canvas.getContext("2d");
    resize(data.width, data.height, data.pixelRatio);
    draw();
  }

  if (data.type === "resize") {
    resize(data.width, data.height, data.pixelRatio);
    draw();
  }

  if (data.type === "samples") {
    appendSamples(data.samples);
    draw();
  }

  if (data.type === "clear") {
    waveformHistory.fill(0);
    draw();
  }
};

function resize(nextWidth: number, nextHeight: number, nextPixelRatio: number) {
  width = Math.max(1, Math.floor(nextWidth * nextPixelRatio));
  height = Math.max(1, Math.floor(nextHeight * nextPixelRatio));
  pixelRatio = nextPixelRatio;

  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
}

function appendSamples(samples: Float32Array) {
  const samplesPerFrame = appSettings.waveform.samplesPerFrame;
  waveformHistory.copyWithin(0, samplesPerFrame);

  for (let index = 0; index < samplesPerFrame; index += 1) {
    const sourceIndex = Math.floor((index / samplesPerFrame) * samples.length);
    waveformHistory[waveformHistory.length - samplesPerFrame + index] =
      samples[sourceIndex] ?? 0;
  }
}

function draw() {
  if (!context) return;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f7faf7";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#d2ddd5";
  context.lineWidth = Math.max(1, pixelRatio);
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  context.strokeStyle = "#15655a";
  context.lineWidth = Math.max(2, 2 * pixelRatio);
  context.beginPath();

  for (let index = 0; index < waveformHistory.length; index += 1) {
    const x = (index / (waveformHistory.length - 1)) * width;
    const y = height / 2 + waveformHistory[index] * height * 0.42;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}
