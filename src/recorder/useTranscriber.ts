import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canUseOpfsRecording,
  canUseOpfsPlayback,
  createOpfsSession,
  readStoredChunkFiles,
  writeMediaRecorderChunk,
  writeSessionPart,
  type StoredAudioChunk,
  type StoredAudioPart,
  type OpfsSession
} from "./audioStorage";
import type { RuntimeSettings } from "../config/settingsOptions";
import { concatAudio, getRms, toMono } from "./audioUtils";
import { exportRecordingBlob, getRecordingExportExtension } from "./audioExport";
import { detectVoiceActivity, type VoiceActivity } from "./vad";
import { findVadBoundaryEnd } from "./uploadBoundaryVad";

type WorkerMessage =
  | { type: "ready" }
  | { type: "progress"; message: string; progress: number }
  | { type: "partial"; text: string }
  | { type: "segment"; text: string; startsNewParagraph: boolean }
  | {
      type: "cache-status";
      cached: boolean;
      cachedFiles: number;
      totalFiles: number;
      message?: string;
    }
  | { type: "error"; message: string };

const createFloat32Buffer = (length: number) =>
  new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
const WHISPER_CONTEXT_MS = 30_000;
const UPLOADED_MEDIA_MIN_CHUNK_MS = 10_000;
const UPLOADED_MEDIA_TARGET_CHUNK_MS = 24_000;

export function useTranscriber(settings: RuntimeSettings) {
  const worker = useMemo(
    () => new Worker(new URL("./whisperWorker.ts", import.meta.url), { type: "module" }),
    []
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserGainRef = useRef<GainNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneProcessorNodeRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSilentGainRef = useRef<GainNode | null>(null);
  const microphonePcmBufferRef = useRef<Float32Array>(new Float32Array());
  const microphoneProcessQueueRef = useRef(Promise.resolve());
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformWorkerRef = useRef<Worker | null>(null);
  const waveformResizeObserverRef = useRef<ResizeObserver | null>(null);
  const hasTransferredWaveformCanvasRef = useRef(false);
  const waveformRafRef = useRef<number | null>(null);
  const analyserBufferRef = useRef<Float32Array<ArrayBuffer>>(createFloat32Buffer(2048));
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const mediaObjectUrlRef = useRef("");
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const mediaProcessorNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaSilentGainRef = useRef<GainNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const opfsSessionRef = useRef<OpfsSession | null>(null);
  const opfsWriteQueueRef = useRef(Promise.resolve());
  const opfsChunkSequenceRef = useRef(0);
  const opfsNextChunkStartMsRef = useRef(0);
  const currentPartChunksRef = useRef<StoredAudioChunk[]>([]);
  const currentPartStartsAtRef = useRef("");
  const tailRef = useRef<Float32Array>(new Float32Array());
  const latestVoiceRef = useRef<VoiceActivity>({
    hasSpeech: false,
    score: 0,
    trailingSilenceMs: 0,
    mode: "unknown"
  });
  const nextSegmentStartsParagraphRef = useRef(false);
  const hasTranscriptRef = useRef(false);
  const lastActivityUpdateRef = useRef(0);
  const [error, setError] = useState("");
  const [opfsError, setOpfsError] = useState("");
  const [opfsChunkCount, setOpfsChunkCount] = useState(0);
  const [opfsSessionName, setOpfsSessionName] = useState("");
  const [audioParts, setAudioParts] = useState<StoredAudioPart[]>([]);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState(0);
  const [modelLoadMessage, setModelLoadMessage] = useState("");
  const [isModelCached, setIsModelCached] = useState(false);
  const [hasCheckedModelCache, setHasCheckedModelCache] = useState(false);
  const isModelCachedRef = useRef(false);
  const hasCheckedModelCacheRef = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingMedia, setIsTranscribingMedia] = useState(false);
  const [mediaFileName, setMediaFileName] = useState("");
  const [partialText, setPartialText] = useState("");
  const [progress, setProgress] = useState("");
  const [mediaTranscriptionProgress, setMediaTranscriptionProgress] = useState(0);
  const [sourceActivityRms, setSourceActivityRms] = useState(0);
  const [modelCacheStatus, setModelCacheStatus] = useState(
    "Whisper downloads once, then reuses browser cache storage."
  );
  const [paragraphs, setParagraphs] = useState<string[]>([]);

  const isWebGpuAvailable = "gpu" in navigator;
  const isOpfsRecordingAvailable = canUseOpfsRecording();
  const isOpfsPlaybackAvailable = canUseOpfsPlayback();
  const opfsChunkMs = settings.audio.opfsChunkMs;
  const shouldRecordToOpfs = settings.recording.shouldRecordToOpfs;

  const resizeWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    const worker = waveformWorkerRef.current;
    if (!canvas || !worker) return;

    const rect = canvas.getBoundingClientRect();
    worker.postMessage({
      type: "resize",
      width: rect.width,
      height: rect.height,
      pixelRatio: window.devicePixelRatio || 1
    });
  }, []);

  const clearWaveform = useCallback(() => {
    waveformWorkerRef.current?.postMessage({ type: "clear" });
  }, []);

  const disposeWaveformWorker = useCallback(() => {
    waveformResizeObserverRef.current?.disconnect();
    waveformResizeObserverRef.current = null;
    waveformWorkerRef.current?.terminate();
    waveformWorkerRef.current = null;
  }, []);

  const renderWaveformFallback = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * pixelRatio));
    const height = Math.max(1, Math.floor(rect.height * pixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
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
  }, []);

  const setWaveformCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      waveformResizeObserverRef.current?.disconnect();
      waveformResizeObserverRef.current = null;
      waveformCanvasRef.current = canvas;

      if (!canvas || hasTransferredWaveformCanvasRef.current) return;
      if (!("transferControlToOffscreen" in canvas)) {
        renderWaveformFallback();
        return;
      }

      const worker = new Worker(new URL("./waveformWorker.ts", import.meta.url), {
        type: "module"
      });
      const rect = canvas.getBoundingClientRect();
      const offscreen = canvas.transferControlToOffscreen();
      waveformWorkerRef.current = worker;
      hasTransferredWaveformCanvasRef.current = true;
      worker.postMessage(
        {
          type: "init",
          canvas: offscreen,
          width: rect.width,
          height: rect.height,
          pixelRatio: window.devicePixelRatio || 1
        },
        [offscreen]
      );

      const observer = new ResizeObserver(() => resizeWaveform());
      observer.observe(canvas);
      waveformResizeObserverRef.current = observer;
    },
    [renderWaveformFallback, resizeWaveform]
  );

  const stopAnalyser = useCallback(() => {
    if (waveformRafRef.current !== null) {
      window.cancelAnimationFrame(waveformRafRef.current);
      waveformRafRef.current = null;
    }

    analyserSourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    analyserGainRef.current?.disconnect();
    analyserSourceRef.current = null;
    analyserRef.current = null;
    analyserGainRef.current = null;
    setSourceActivityRms(0);
    clearWaveform();
  }, [clearWaveform]);

  const cleanupMediaSource = useCallback(() => {
    mediaElementRef.current?.pause();
    mediaElementRef.current?.removeAttribute("src");
    mediaElementRef.current?.load();
    mediaElementRef.current = null;
    mediaProcessorNodeRef.current?.disconnect();
    mediaProcessorNodeRef.current = null;
    mediaSilentGainRef.current?.disconnect();
    mediaSilentGainRef.current = null;
    mediaSourceNodeRef.current?.disconnect();
    mediaSourceNodeRef.current = null;
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
      mediaObjectUrlRef.current = "";
    }
  }, []);

  const cleanupMicrophoneCapture = useCallback(() => {
    microphoneProcessorNodeRef.current?.port.close();
    microphoneProcessorNodeRef.current?.disconnect();
    microphoneProcessorNodeRef.current = null;
    microphoneSilentGainRef.current?.disconnect();
    microphoneSilentGainRef.current = null;
    microphoneSourceRef.current?.disconnect();
    microphoneSourceRef.current = null;
    microphonePcmBufferRef.current = new Float32Array();
    microphoneProcessQueueRef.current = Promise.resolve();
  }, []);

  const tickWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = analyserBufferRef.current;
    analyser.getFloatTimeDomainData(buffer);
    const activityRms = getRms(buffer);
    const now = performance.now();
    if (now - lastActivityUpdateRef.current > 80) {
      lastActivityUpdateRef.current = now;
      setSourceActivityRms(activityRms);
    }
    const samples = createFloat32Buffer(buffer.length);
    samples.set(buffer);
    waveformWorkerRef.current?.postMessage({ type: "samples", samples }, [samples.buffer]);
    waveformRafRef.current = window.requestAnimationFrame(tickWaveform);
  }, []);

  const startAnalyser = useCallback(
    (stream: MediaStream, audioContext: AudioContext) => {
      stopAnalyser();

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const silentGain = audioContext.createGain();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      silentGain.gain.value = 0;
      analyserBufferRef.current = createFloat32Buffer(analyser.fftSize);

      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioContext.destination);

      analyserSourceRef.current = source;
      analyserRef.current = analyser;
      analyserGainRef.current = silentGain;
      waveformRafRef.current = window.requestAnimationFrame(tickWaveform);
    },
    [stopAnalyser, tickWaveform]
  );

  useEffect(() => {
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "ready") {
        isModelCachedRef.current = true;
        hasCheckedModelCacheRef.current = true;
        setIsModelLoading(false);
        setModelLoadProgress(100);
        setModelLoadMessage("Whisper model is ready.");
        setIsPreparing(false);
        setProgress("");
        setIsModelCached(true);
        setModelCacheStatus("Whisper model cached locally.");
      }

      if (data.type === "progress") {
        const nextProgress = data.progress <= 1 ? data.progress * 100 : data.progress;
        if (isModelCachedRef.current) {
          setIsModelLoading(false);
        } else {
          setIsModelLoading(true);
        }
        setModelLoadProgress(Math.min(100, Math.max(0, nextProgress)));
        setModelLoadMessage(data.message);
        if (!isModelCachedRef.current) {
          setProgress(data.message);
        }
      }

      if (data.type === "partial") {
        setPartialText(data.text);
      }

      if (data.type === "segment") {
        setPartialText("");
        setParagraphs((current) => {
          const normalized = data.text.trim();
          if (!normalized) return current;

          hasTranscriptRef.current = true;

          if (data.startsNewParagraph || current.length === 0) {
            if (current.at(-1) === normalized) return current;
            return [...current, normalized];
          }

          const next = [...current];
          const previous = next.at(-1) ?? "";
          if (previous.endsWith(normalized)) return current;
          next[next.length - 1] = `${previous} ${normalized}`.trim();
          return next;
        });
      }

      if (data.type === "cache-status") {
        hasCheckedModelCacheRef.current = true;
        isModelCachedRef.current = data.cached;
        setHasCheckedModelCache(true);
        if (data.cached) {
          setIsModelCached(true);
          setIsModelLoading(false);
          setModelLoadProgress(100);
          setModelLoadMessage("Whisper model is already cached.");
          setModelCacheStatus("Whisper model cached locally.");
        } else if (data.totalFiles > 0) {
          setIsModelCached(false);
          setModelCacheStatus(
            `Whisper model will download once. Cached ${data.cachedFiles}/${data.totalFiles} files.`
          );
        } else {
          setModelCacheStatus(data.message ?? "Whisper model cache status unavailable.");
        }
      }

      if (data.type === "error") {
        setIsModelLoading(false);
        setIsPreparing(false);
        setIsRecording(false);
        setError(data.message);
      }
    };

    return () => {
      worker.terminate();
    };
  }, [worker]);

  useEffect(() => {
    worker.postMessage({ type: "cache-status" });
  }, [worker]);

  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }

    playbackNodeRef.current?.port.postMessage({ type: "clear" });
    playbackNodeRef.current?.disconnect();
    playbackNodeRef.current = null;
    playbackContextRef.current?.close();
    playbackContextRef.current = null;
    setIsPlayingRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopAnalyser();
      cleanupMicrophoneCapture();
      cleanupMediaSource();
      disposeWaveformWorker();
    };
  }, [cleanupMediaSource, cleanupMicrophoneCapture, disposeWaveformWorker, stopAnalyser, stopPlayback]);

  const stop = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    cleanupMicrophoneCapture();
    cleanupMediaSource();
    stopAnalyser();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    tailRef.current = new Float32Array();
    latestVoiceRef.current = {
      hasSpeech: false,
      score: 0,
      trailingSilenceMs: 0,
      mode: "unknown"
    };
    nextSegmentStartsParagraphRef.current = false;
    setIsRecording(false);
    setIsTranscribingMedia(false);
    setPartialText("");
    worker.postMessage({ type: "flush" });
  }, [cleanupMediaSource, cleanupMicrophoneCapture, stopAnalyser, worker]);

  const startOpfsRecording = useCallback(
    async (mimeType: string) => {
      if (!isOpfsRecordingAvailable) {
        throw new Error("This browser does not support OPFS recording.");
      }

      const session = await createOpfsSession(mimeType);
      opfsSessionRef.current = session;
      opfsWriteQueueRef.current = Promise.resolve();
      opfsChunkSequenceRef.current = 0;
      opfsNextChunkStartMsRef.current = Date.now();
      currentPartChunksRef.current = [];
      currentPartStartsAtRef.current = "";
      setOpfsSessionName(`recordings/${session.name}`);
      setOpfsChunkCount(0);
      setAudioParts([]);
      setOpfsError("");
    },
    [isOpfsRecordingAvailable]
  );

  const finalizeCurrentPart = useCallback(() => {
    const activeSession = opfsSessionRef.current;
    if (!activeSession) return;

    opfsWriteQueueRef.current = opfsWriteQueueRef.current
      .then(async () => {
        const chunks = currentPartChunksRef.current;
        if (chunks.length === 0) return;

        const sequence = activeSession.parts.length;
        const first = chunks[0];
        const last = chunks[chunks.length - 1];
        const part: StoredAudioPart = {
          name: `part-${sequence.toString().padStart(4, "0")}`,
          sequence,
          startIso: currentPartStartsAtRef.current || first.startIso,
          endIso: last.endIso,
          durationMs: Math.max(
            0,
            new Date(last.endIso).getTime() -
              new Date(currentPartStartsAtRef.current || first.startIso).getTime()
          ),
          chunks: chunks.map((chunk) => chunk.fileName)
        };

        currentPartChunksRef.current = [];
        currentPartStartsAtRef.current = "";
        const stored = await writeSessionPart(activeSession, part);
        setAudioParts((current) => [...current, stored]);
      })
      .catch((cause) => {
        setOpfsError(
          cause instanceof Error ? cause.message : "Unable to write audio part metadata."
        );
      });
  }, []);

  const storeMediaRecorderChunk = useCallback((blob: Blob, voice: VoiceActivity) => {
    const activeSession = opfsSessionRef.current;
    if (!activeSession || !blob.size) return;

    const sequence = opfsChunkSequenceRef.current;
    const endMs = Date.now();
    const startMs = opfsNextChunkStartMsRef.current || endMs;
    opfsChunkSequenceRef.current += 1;
    opfsNextChunkStartMsRef.current = endMs;

    opfsWriteQueueRef.current = opfsWriteQueueRef.current
      .then(async () => {
        const stored = await writeMediaRecorderChunk(activeSession, blob, sequence, startMs, endMs);
        if (voice.hasSpeech) {
          if (currentPartChunksRef.current.length === 0) {
            currentPartStartsAtRef.current = stored.startIso;
          }

          currentPartChunksRef.current.push(stored);
        }

        setOpfsChunkCount((count) => count + 1);
      })
      .catch((cause) => {
        setOpfsError(
          cause instanceof Error ? cause.message : "Unable to write audio chunk to OPFS."
        );
      });
  }, []);

  const processPcmChunk = useCallback(
    async (mono: Float32Array, sampleRate: number) => {
      const voice = await detectVoiceActivity(mono, sampleRate, settings.vad);
      latestVoiceRef.current = voice;

      if (!voice.hasSpeech) {
        if (hasTranscriptRef.current) {
          nextSegmentStartsParagraphRef.current = true;
        }
        setPartialText("");
        return voice;
      }

      const audio = concatAudio(tailRef.current, mono);
      const overlapSamples = Math.floor(
        sampleRate * (settings.audio.overlapMs / 1000)
      );
      tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
      const startsNewParagraph = nextSegmentStartsParagraphRef.current;
      nextSegmentStartsParagraphRef.current =
        voice.trailingSilenceMs >= settings.vad.paragraphSilenceMs;

      worker.postMessage(
        {
          type: "transcribe",
          audio,
          sampleRate,
          isFinal: false,
          startsNewParagraph
        },
        [audio.buffer]
      );

      return voice;
    },
    [settings, worker]
  );

  const startMicrophonePcmCapture = useCallback(
    async (stream: MediaStream, audioContext: AudioContext) => {
      cleanupMicrophoneCapture();
      await audioContext.audioWorklet.addModule(new URL("./mediaChunkWorklet.js", import.meta.url));

      const source = audioContext.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(audioContext, "media-chunk-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      const silentGain = audioContext.createGain();
      const chunkSamples = Math.max(
        1,
        Math.floor(audioContext.sampleRate * (settings.audio.transcriptionChunkMs / 1000))
      );

      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      microphoneSourceRef.current = source;
      microphoneProcessorNodeRef.current = processor;
      microphoneSilentGainRef.current = silentGain;

      processor.port.onmessage = (event: MessageEvent<{ type?: string; samples?: Float32Array }>) => {
        if (event.data?.type !== "samples" || !event.data.samples) return;

        microphonePcmBufferRef.current = concatAudio(
          microphonePcmBufferRef.current,
          event.data.samples
        );

        microphoneProcessQueueRef.current = microphoneProcessQueueRef.current
          .then(async () => {
            while (microphonePcmBufferRef.current.length >= chunkSamples) {
              const chunk = microphonePcmBufferRef.current.slice(0, chunkSamples);
              microphonePcmBufferRef.current = microphonePcmBufferRef.current.slice(chunkSamples);
              await processPcmChunk(chunk, audioContext.sampleRate);
            }
          })
          .catch((cause) => {
            setError(cause instanceof Error ? cause.message : "Live transcription failed.");
          });
      };
    },
    [cleanupMicrophoneCapture, processPcmChunk, settings.audio.transcriptionChunkMs]
  );

  const start = useCallback(async () => {
    setError("");

    if (!isWebGpuAvailable) {
      setError("This prototype requires a browser with WebGPU enabled.");
      return;
    }

    try {
      setIsPreparing(true);
      latestVoiceRef.current = {
        hasSpeech: false,
        score: 0,
        trailingSilenceMs: 0,
        mode: "unknown"
      };
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: getMicrophoneConstraints(settings)
      });
      streamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      startAnalyser(stream, audioContext);
      await startMicrophonePcmCapture(stream, audioContext);

      const mimeType = getSupportedMimeType();
      if (shouldRecordToOpfs && isOpfsRecordingAvailable) {
        await startOpfsRecording(mimeType);

        const recorder = new MediaRecorder(stream, {
          mimeType
        });
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          const voice = latestVoiceRef.current;
          if (voice) {
            storeMediaRecorderChunk(event.data, voice);
            if (
              !voice.hasSpeech ||
              voice.trailingSilenceMs >= settings.vad.partSilenceMs
            ) {
              finalizeCurrentPart();
            }
          }
        };
        recorder.onstop = () => {
          finalizeCurrentPart();
          worker.postMessage({ type: "flush" });
        };
        recorder.start(opfsChunkMs);
      }

      worker.postMessage({ type: "load" });
      if (!isModelCachedRef.current) {
        setModelLoadProgress(0);
        setModelLoadMessage(
          hasCheckedModelCacheRef.current ? "Checking model files..." : "Checking model cache..."
        );
      }
      setMediaTranscriptionProgress(0);
      setIsRecording(true);
    } catch (cause) {
      stop();
      setIsPreparing(false);
      setError(cause instanceof Error ? cause.message : "Unable to access the microphone.");
    }
  }, [
    isWebGpuAvailable,
    isOpfsRecordingAvailable,
    opfsChunkMs,
    settings,
    finalizeCurrentPart,
    shouldRecordToOpfs,
    startAnalyser,
    startMicrophonePcmCapture,
    startOpfsRecording,
    storeMediaRecorderChunk,
    stop,
    worker
  ]);

  const cacheModel = useCallback(() => {
    setError("");
    setModelLoadProgress(0);
    setModelLoadMessage(isModelCached ? "Whisper model is already cached." : "Preparing Whisper model cache...");
    setModelCacheStatus(
      isModelCached ? "Whisper model cached locally." : "Preparing Whisper model cache..."
    );
    if (isModelCached) {
      setIsModelLoading(false);
      return;
    }
    worker.postMessage({ type: "warm-cache" });
  }, [isModelCached, worker]);

  const transcribeAudioFile = useCallback(
    async (file: File) => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      const mono = toMono(decoded);
      let offset = 0;

      while (offset < mono.length) {
        const end = await getUploadedMediaSplitEnd(
          mono,
          offset,
          decoded.sampleRate,
          settings,
          true
        );
        if (end === null) break;
        const chunk = mono.slice(offset, end);
        await processPcmChunk(chunk, decoded.sampleRate);
        offset = end;
        const percent = Math.round((offset / mono.length) * 100);
        setMediaTranscriptionProgress(percent);
        setProgress(`Transcribing ${file.name} ${percent}%`);
      }

      setMediaTranscriptionProgress(100);
      worker.postMessage({ type: "flush" });
    },
    [processPcmChunk, settings, worker]
  );

  const transcribePlayableMediaFile = useCallback(
    async (file: File) => {
      const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      const objectUrl = URL.createObjectURL(file);
      const audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(media);
      await audioContext.audioWorklet.addModule(new URL("./mediaChunkWorklet.js", import.meta.url));
      const processor = new AudioWorkletNode(audioContext, "media-chunk-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      const silentGain = audioContext.createGain();
      const minChunkSamples = getSamplesForMs(audioContext.sampleRate, UPLOADED_MEDIA_MIN_CHUNK_MS);
      let buffered = new Float32Array();
      let processQueue = Promise.resolve();
      let isEnded = false;

      mediaElementRef.current = media;
      mediaObjectUrlRef.current = objectUrl;
      mediaSourceNodeRef.current = source;
      mediaProcessorNodeRef.current = processor;
      mediaSilentGainRef.current = silentGain;
      audioContextRef.current = audioContext;
      silentGain.gain.value = 0;

      media.src = objectUrl;
      media.muted = false;
      media.volume = 1;
      if (media instanceof HTMLVideoElement) {
        media.playsInline = true;
      }
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      processor.port.onmessage = (event: MessageEvent<{ type?: string; samples?: Float32Array }>) => {
        if (isEnded) return;
        if (event.data?.type !== "samples" || !event.data.samples) return;

        buffered = concatAudio(buffered, event.data.samples);

        processQueue = processQueue.then(async () => {
          while (buffered.length >= minChunkSamples) {
            const splitEnd = await getUploadedMediaSplitEnd(
              buffered,
              0,
              audioContext.sampleRate,
              settings,
              false
            );
            if (splitEnd === null) break;

            const chunk = buffered.slice(0, splitEnd);
            buffered = buffered.slice(splitEnd);
            await processPcmChunk(chunk, audioContext.sampleRate);
          }
        });
      };

      await new Promise<void>((resolve, reject) => {
        media.onerror = () => reject(new Error("This browser could not read that media file."));
        media.ontimeupdate = () => {
          if (Number.isFinite(media.duration) && media.duration > 0) {
            const percent = Math.round((media.currentTime / media.duration) * 100);
            setMediaTranscriptionProgress(percent);
            setProgress(`Transcribing ${file.name} ${percent}%`);
          }
        };
        media.onended = () => {
          isEnded = true;
          if (buffered.length > 0) {
            const finalChunk = buffered;
            buffered = new Float32Array();
            processQueue = processQueue.then(async () => {
              await processPcmChunk(finalChunk, audioContext.sampleRate);
            });
          }
          void processQueue
            .then(() => {
              setMediaTranscriptionProgress(100);
              worker.postMessage({ type: "flush" });
              resolve();
            })
            .catch(reject);
        };
        media.onloadedmetadata = () => {
          void media.play().catch(reject);
        };
      });
    },
    [processPcmChunk, settings, worker]
  );

  const transcribeMediaFile = useCallback(
    async (file: File) => {
      if (!isWebGpuAvailable) {
        setError("This prototype requires a browser with WebGPU enabled.");
        return;
      }

      setError("");
      setProgress(`Preparing ${file.name}...`);
      setMediaTranscriptionProgress(0);
      setMediaFileName(file.name);
      setIsPreparing(true);
      setIsRecording(true);
      setIsTranscribingMedia(true);
      if (!isModelCached) {
        setModelLoadProgress(0);
        setModelLoadMessage(
          hasCheckedModelCache ? "Checking model files..." : "Checking model cache..."
        );
      }
      worker.postMessage({ type: "load" });

      try {
        if (file.type.startsWith("audio/")) {
          await transcribeAudioFile(file);
        } else {
          await transcribePlayableMediaFile(file);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to transcribe that media file.");
      } finally {
        cleanupMediaSource();
        stopAnalyser();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        audioContextRef.current?.close();
        audioContextRef.current = null;
        tailRef.current = new Float32Array();
        nextSegmentStartsParagraphRef.current = false;
        setIsPreparing(false);
        setIsRecording(false);
        setIsTranscribingMedia(false);
        setMediaTranscriptionProgress(0);
        setProgress("");
      }
    },
    [
      cleanupMediaSource,
      isWebGpuAvailable,
      stopAnalyser,
      transcribeAudioFile,
      transcribePlayableMediaFile,
      hasCheckedModelCache,
      isModelCached,
      worker
    ]
  );

  const playOpfsRecording = useCallback(async () => {
    const activeSession = opfsSessionRef.current;
    if (!activeSession || activeSession.chunks.length === 0) return;

    try {
      setOpfsError("");
      stopPlayback();
      await opfsWriteQueueRef.current;

      const context = new AudioContext();
      playbackContextRef.current = context;
      await context.audioWorklet.addModule(new URL("./pcmPlaybackWorklet.js", import.meta.url));

      const playbackNode = new AudioWorkletNode(context, "pcm-playback-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      playbackNode.connect(context.destination);
      playbackNodeRef.current = playbackNode;

      const files = await readStoredChunkFiles(activeSession);
      const combined = new Blob(files, { type: activeSession.mimeType });
      const decoded = await context.decodeAudioData(await combined.arrayBuffer());
      const pcm = toMono(decoded);
      playbackNode.port.postMessage({ type: "enqueue", audio: pcm }, [pcm.buffer]);
      setIsPlayingRecording(true);

      playbackTimerRef.current = window.setTimeout(() => {
        stopPlayback();
      }, Math.ceil(decoded.duration * 1000) + 250);
    } catch (cause) {
      stopPlayback();
      setOpfsError(
        cause instanceof Error ? cause.message : "Unable to play the OPFS recording."
      );
    }
  }, [stopPlayback]);

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const downloadFullRecording = useCallback(async () => {
    const activeSession = opfsSessionRef.current;
    if (!activeSession || activeSession.chunks.length === 0) return;

    try {
      setOpfsError("");
      await opfsWriteQueueRef.current;
      const files = await readStoredChunkFiles(activeSession);
      const source = new Blob(files, { type: activeSession.mimeType });
      const exported = await exportRecordingBlob(
        source,
        settings.audio.recordingExportFormat,
        setProgress
      );
      const extension = getRecordingExportExtension(
        settings.audio.recordingExportFormat,
        activeSession.mimeType
      );
      downloadBlob(
        exported,
        `${activeSession.name}.${extension}`
      );
    } catch (cause) {
      setOpfsError(cause instanceof Error ? cause.message : "Unable to export recording.");
    } finally {
      setProgress("");
    }
  }, [downloadBlob, settings.audio.recordingExportFormat]);

  const downloadPart = useCallback(
    async (part: StoredAudioPart) => {
      const activeSession = opfsSessionRef.current;
      if (!activeSession) return;

      try {
        setOpfsError("");
        await opfsWriteQueueRef.current;
        const files = await readStoredChunkFiles(activeSession, part.chunks);
        const source = new Blob(files, { type: activeSession.mimeType });
        const exported = await exportRecordingBlob(
          source,
          settings.audio.recordingExportFormat,
          setProgress
        );
        const extension = getRecordingExportExtension(
          settings.audio.recordingExportFormat,
          activeSession.mimeType
        );
        downloadBlob(
          exported,
          `${activeSession.name}-${part.name}.${extension}`
        );
      } catch (cause) {
        setOpfsError(cause instanceof Error ? cause.message : "Unable to export recording part.");
      } finally {
        setProgress("");
      }
    },
    [downloadBlob, settings.audio.recordingExportFormat]
  );

  const clear = useCallback(() => {
    setParagraphs([]);
    setPartialText("");
    setError("");
    hasTranscriptRef.current = false;
    nextSegmentStartsParagraphRef.current = false;
  }, []);

  return {
    error,
    isOpfsRecordingAvailable,
    isOpfsPlaybackAvailable,
    isPlayingRecording,
    isModelLoading,
    isPreparing,
    isRecording,
    isTranscribingMedia,
    isWebGpuAvailable,
    mediaFileName,
    opfsChunkCount,
    opfsChunkMs,
    opfsError,
    opfsSessionName,
    modelCacheStatus,
    modelLoadMessage,
    modelLoadProgress,
    isModelCached,
    audioParts,
    partialText,
    progress,
    mediaTranscriptionProgress,
    sourceActivityRms,
    paragraphs,
    vadMode: settings.vad.mode,
    setWaveformCanvas,
    shouldRecordToOpfs,
    cacheModel,
    downloadFullRecording,
    downloadPart,
    playOpfsRecording,
    stopPlayback,
    start,
    stop,
    transcribeMediaFile,
    clear
  };
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function getUploadedMediaSplitEnd(
  audio: Float32Array,
  offset: number,
  sampleRate: number,
  settings: RuntimeSettings,
  allowPartialFinalChunk: boolean
) {
  const remainingSamples = audio.length - offset;
  const minSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_MIN_CHUNK_MS);
  const targetSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_TARGET_CHUNK_MS);
  const maxSamples = getSamplesForMs(
    sampleRate,
    Math.max(UPLOADED_MEDIA_TARGET_CHUNK_MS, WHISPER_CONTEXT_MS - settings.audio.overlapMs)
  );

  if (remainingSamples <= 0) return offset;
  if (remainingSamples < minSamples) {
    return allowPartialFinalChunk ? audio.length : null;
  }

  const searchStart = offset + minSamples;
  const searchEnd = Math.min(audio.length, offset + maxSamples);
  const quietEnd = await findDedicatedVadBoundaryEnd(audio, offset, searchStart, searchEnd, sampleRate, settings);
  if (quietEnd !== null) return quietEnd;

  if (remainingSamples >= maxSamples) {
    return offset + maxSamples;
  }

  if (allowPartialFinalChunk) return audio.length;
  return null;
}

async function findDedicatedVadBoundaryEnd(
  audio: Float32Array,
  segmentStart: number,
  searchStart: number,
  searchEnd: number,
  sampleRate: number,
  settings: RuntimeSettings
) {
  const requiredQuietSamples = getSamplesForMs(
    sampleRate,
    Math.max(settings.vad.paragraphSilenceMs, settings.audio.overlapMs)
  );

  return findVadBoundaryEnd(
    audio,
    segmentStart,
    searchStart,
    searchEnd,
    sampleRate,
    requiredQuietSamples
  );
}

function getSamplesForMs(sampleRate: number, ms: number) {
  return Math.max(1, Math.floor(sampleRate * (ms / 1000)));
}

function getMicrophoneConstraints(settings: RuntimeSettings): MediaTrackConstraints {
  return {
    channelCount: 1,
    deviceId: settings.microphone.deviceId
      ? { exact: settings.microphone.deviceId }
      : undefined,
    echoCancellation: settings.microphone.echoCancellation,
    noiseSuppression: settings.microphone.noiseSuppression,
    autoGainControl: settings.microphone.autoGainControl
  };
}
