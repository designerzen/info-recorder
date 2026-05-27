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
import { detectVoiceActivity, type AdaptiveVadState, type VoiceActivity } from "./vad";
import { findVadBoundaryEnd } from "./uploadBoundaryVad";

type WorkerMessage =
  | { type: "ready" }
  | { type: "idle" }
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
const LIVE_ANALYSIS_CHUNK_MS = 500;
const UPLOADED_MEDIA_MIN_CHUNK_MS = 10_000;
const UPLOADED_MEDIA_TARGET_CHUNK_MS = 24_000;
const UPLOADED_MEDIA_BOUNDARY_TIMEOUT_MS = 8_000;
let isUploadedBoundaryVadUnavailable = false;

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
  const microphonePcmChunksRef = useRef<Float32Array[]>([]);
  const microphonePcmBufferedSamplesRef = useRef(0);
  const microphoneProcessQueueRef = useRef(Promise.resolve());
  const liveSpeechChunksRef = useRef<Float32Array[]>([]);
  const liveSpeechBufferedSamplesRef = useRef(0);
  const liveSpeechStartsParagraphRef = useRef(false);
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
  const adaptiveVadStateRef = useRef<AdaptiveVadState>({ noiseFloor: null });
  const hasTranscriptRef = useRef(false);
  const lastActivityUpdateRef = useRef(0);
  const isWorkerReadyRef = useRef(false);
  const workerReadyPromiseRef = useRef<Promise<void> | null>(null);
  const workerReadyResolveRef = useRef<(() => void) | null>(null);
  const workerReadyRejectRef = useRef<((cause?: unknown) => void) | null>(null);
  const workerIdlePromiseRef = useRef<Promise<void> | null>(null);
  const workerIdleResolveRef = useRef<(() => void) | null>(null);
  const workerIdleRejectRef = useRef<((cause?: unknown) => void) | null>(null);
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

  const isTranscriptionSupported = "gpu" in navigator;
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
    microphonePcmChunksRef.current = [];
    microphonePcmBufferedSamplesRef.current = 0;
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
    worker.postMessage({ type: "cache-status" });
  }, [worker]);

  const ensureWorkerReady = useCallback(() => {
    if (isWorkerReadyRef.current) {
      return Promise.resolve();
    }

    if (!workerReadyPromiseRef.current) {
      workerReadyPromiseRef.current = new Promise<void>((resolve, reject) => {
        workerReadyResolveRef.current = resolve;
        workerReadyRejectRef.current = reject;
      });
      worker.postMessage({ type: "load" });
    }

    return workerReadyPromiseRef.current;
  }, [worker]);

  const waitForWorkerIdle = useCallback(() => {
    if (!workerIdlePromiseRef.current) {
      workerIdlePromiseRef.current = new Promise<void>((resolve, reject) => {
        workerIdleResolveRef.current = resolve;
        workerIdleRejectRef.current = reject;
      });
      worker.postMessage({ type: "flush" });
    }

    return workerIdlePromiseRef.current;
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

  const resetCaptureState = useCallback(() => {
    mediaRecorderRef.current = null;
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
    adaptiveVadStateRef.current = { noiseFloor: null };
    microphonePcmChunksRef.current = [];
    microphonePcmBufferedSamplesRef.current = 0;
    microphoneProcessQueueRef.current = Promise.resolve();
    liveSpeechChunksRef.current = [];
    liveSpeechBufferedSamplesRef.current = 0;
    liveSpeechStartsParagraphRef.current = false;
    setIsPreparing(false);
    setIsRecording(false);
    setIsTranscribingMedia(false);
    setPartialText("");
    setSourceActivityRms(0);
  }, [cleanupMediaSource, stopAnalyser]);

  useEffect(() => {
    worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.type === "ready") {
        isWorkerReadyRef.current = true;
        workerReadyResolveRef.current?.();
        workerReadyResolveRef.current = null;
        workerReadyRejectRef.current = null;
        workerReadyPromiseRef.current = null;
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

      if (data.type === "idle") {
        workerIdleResolveRef.current?.();
        workerIdleResolveRef.current = null;
        workerIdleRejectRef.current = null;
        workerIdlePromiseRef.current = null;
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
          const merged = mergeTranscriptText(previous, normalized);
          if (merged === previous) return current;
          next[next.length - 1] = merged;
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
        isWorkerReadyRef.current = false;
        workerReadyRejectRef.current?.(new Error(data.message));
        workerReadyResolveRef.current = null;
        workerReadyRejectRef.current = null;
        workerReadyPromiseRef.current = null;
        workerIdleRejectRef.current?.(new Error(data.message));
        workerIdleResolveRef.current = null;
        workerIdleRejectRef.current = null;
        workerIdlePromiseRef.current = null;
        setIsModelLoading(false);
        resetCaptureState();
        setError(data.message);
      }
    };

    return () => {
      worker.terminate();
    };
  }, [resetCaptureState, worker]);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopAnalyser();
      cleanupMicrophoneCapture();
      cleanupMediaSource();
      disposeWaveformWorker();
    };
  }, [cleanupMediaSource, cleanupMicrophoneCapture, disposeWaveformWorker, stopAnalyser, stopPlayback]);

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
      const voice = await detectVoiceActivity(
        mono,
        sampleRate,
        settings.vad,
        settings.vad.mode === "adaptive-rms" ? adaptiveVadStateRef.current : undefined
      );
      latestVoiceRef.current = voice;
      const targetSamples = getSamplesForMs(sampleRate, settings.audio.transcriptionChunkMs);
      const paragraphSilenceSamples = getSamplesForMs(sampleRate, settings.vad.paragraphSilenceMs);

      if (voice.hasSpeech) {
        if (liveSpeechBufferedSamplesRef.current === 0) {
          liveSpeechStartsParagraphRef.current = nextSegmentStartsParagraphRef.current;
          nextSegmentStartsParagraphRef.current = false;
        }
        appendAudioChunk(
          liveSpeechChunksRef.current,
          liveSpeechBufferedSamplesRef,
          mono
        );

        if (liveSpeechBufferedSamplesRef.current >= targetSamples) {
          const speechAudio = consumeBufferedAudio(
            liveSpeechChunksRef.current,
            liveSpeechBufferedSamplesRef
          );
          const audio = concatAudio(tailRef.current, speechAudio);
          const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
          tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));

          worker.postMessage(
            {
              type: "transcribe",
              audio,
              sampleRate,
              isFinal: false,
              startsNewParagraph: liveSpeechStartsParagraphRef.current
            },
            [audio.buffer]
          );
          liveSpeechStartsParagraphRef.current = false;
        }

        return voice;
      }

      if (liveSpeechBufferedSamplesRef.current > 0) {
        appendAudioChunk(
          liveSpeechChunksRef.current,
          liveSpeechBufferedSamplesRef,
          mono
        );

        if (
          voice.trailingSilenceMs >= settings.vad.paragraphSilenceMs ||
          liveSpeechBufferedSamplesRef.current >= targetSamples + paragraphSilenceSamples
        ) {
          const speechAudio = consumeBufferedAudio(
            liveSpeechChunksRef.current,
            liveSpeechBufferedSamplesRef
          );
          const audio = concatAudio(tailRef.current, speechAudio);
          const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
          tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));

          worker.postMessage(
            {
              type: "transcribe",
              audio,
              sampleRate,
              isFinal: false,
              startsNewParagraph: liveSpeechStartsParagraphRef.current
            },
            [audio.buffer]
          );
          liveSpeechStartsParagraphRef.current = false;

          if (hasTranscriptRef.current) {
            nextSegmentStartsParagraphRef.current = true;
          }
          setPartialText("");
        }
      } else {
        if (hasTranscriptRef.current) {
          nextSegmentStartsParagraphRef.current = true;
        }
        setPartialText("");
      }

      return voice;
    },
    [settings, worker]
  );

  const processUploadedPcmChunk = useCallback(
    async (
      mono: Float32Array,
      sampleRate: number,
      startsNewParagraph: boolean,
      overlapMs = 0
    ) => {
      if (mono.length === 0) return;

      const audio = concatAudio(tailRef.current, mono);
      const overlapSamples = Math.floor(sampleRate * (overlapMs / 1000));
      tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));

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
    },
    [worker]
  );

  const flushMicrophonePcmCapture = useCallback(
    async (sampleRate: number) => {
      const pendingQueue = microphoneProcessQueueRef.current;

      microphoneProcessorNodeRef.current?.port.close();
      microphoneProcessorNodeRef.current?.disconnect();
      microphoneProcessorNodeRef.current = null;
      microphoneSilentGainRef.current?.disconnect();
      microphoneSilentGainRef.current = null;
      microphoneSourceRef.current?.disconnect();
      microphoneSourceRef.current = null;

      await pendingQueue;

      const finalChunk = consumeBufferedAudio(
        microphonePcmChunksRef.current,
        microphonePcmBufferedSamplesRef
      );
      microphoneProcessQueueRef.current = Promise.resolve();

      if (finalChunk.length > 0) {
        await processPcmChunk(finalChunk, sampleRate);
      }

      if (liveSpeechBufferedSamplesRef.current > 0) {
        const speechAudio = consumeBufferedAudio(
          liveSpeechChunksRef.current,
          liveSpeechBufferedSamplesRef
        );
        const audio = concatAudio(tailRef.current, speechAudio);
        const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
        tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
        worker.postMessage(
          {
            type: "transcribe",
            audio,
            sampleRate,
            isFinal: true,
            startsNewParagraph: liveSpeechStartsParagraphRef.current
          },
          [audio.buffer]
        );
        liveSpeechStartsParagraphRef.current = false;
      }
    },
    [processPcmChunk, settings.audio.overlapMs, worker]
  );

  const stop = useCallback(async () => {
    const sampleRate = audioContextRef.current?.sampleRate ?? 16000;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    try {
      await flushMicrophonePcmCapture(sampleRate);
      await waitForWorkerIdle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finish live transcription.");
    }
    resetCaptureState();
  }, [flushMicrophonePcmCapture, resetCaptureState, waitForWorkerIdle]);

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
        Math.floor(audioContext.sampleRate * (LIVE_ANALYSIS_CHUNK_MS / 1000))
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

        appendAudioChunk(
          microphonePcmChunksRef.current,
          microphonePcmBufferedSamplesRef,
          event.data.samples
        );

        microphoneProcessQueueRef.current = microphoneProcessQueueRef.current
          .then(async () => {
            while (microphonePcmBufferedSamplesRef.current >= chunkSamples) {
              const chunk = consumeBufferedAudio(
                microphonePcmChunksRef.current,
                microphonePcmBufferedSamplesRef,
                chunkSamples
              );
              await processPcmChunk(chunk, audioContext.sampleRate);
            }
          })
          .catch((cause) => {
            setError(cause instanceof Error ? cause.message : "Live transcription failed.");
          });
      };
    },
    [cleanupMicrophoneCapture, processPcmChunk]
  );

  const start = useCallback(async () => {
    setError("");
    setIsPreparing(true);

    if (!isTranscriptionSupported) {
      setIsPreparing(false);
      setError("This prototype requires a browser with WebGPU enabled.");
      return;
    }

    try {
      latestVoiceRef.current = {
        hasSpeech: false,
        score: 0,
        trailingSilenceMs: 0,
        mode: "unknown"
      };
      adaptiveVadStateRef.current = { noiseFloor: null };
      const stream = await getMicrophoneStream(settings);
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
      setIsPreparing(false);
    } catch (cause) {
      resetCaptureState();
      worker.postMessage({ type: "flush" });
      setError(cause instanceof Error ? cause.message : "Unable to access the microphone.");
    }
  }, [
    isTranscriptionSupported,
    isOpfsRecordingAvailable,
    opfsChunkMs,
    settings,
    finalizeCurrentPart,
    resetCaptureState,
    shouldRecordToOpfs,
    startAnalyser,
    startMicrophonePcmCapture,
    startOpfsRecording,
    storeMediaRecorderChunk,
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
      let startsNewParagraph = false;
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
        await processUploadedPcmChunk(chunk, decoded.sampleRate, startsNewParagraph);
        startsNewParagraph = true;
        offset = end;
        const percent = Math.round((end / mono.length) * 100);
        setMediaTranscriptionProgress(percent);
        setProgress(`Transcribing ${file.name} ${percent}%`);
      }

      setMediaTranscriptionProgress(100);
      await waitForWorkerIdle();
    },
    [processUploadedPcmChunk, settings, waitForWorkerIdle]
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
      let startsNewParagraph = false;

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
            const splitEnd = await getBufferedUploadedMediaSplitEnd(
              buffered,
              audioContext.sampleRate,
              settings,
              minChunkSamples
            );
            if (splitEnd === null) break;

            const chunk = buffered.slice(0, splitEnd);
            buffered = buffered.slice(splitEnd);
            await processUploadedPcmChunk(chunk, audioContext.sampleRate, startsNewParagraph);
            startsNewParagraph = true;
          }
        }).catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Unable to continue media transcription.");
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
              await processUploadedPcmChunk(finalChunk, audioContext.sampleRate, startsNewParagraph);
            });
          }
          void processQueue
            .then(async () => {
              await waitForWorkerIdle();
              setMediaTranscriptionProgress(100);
              resolve();
            })
            .catch(reject);
        };
        media.onloadedmetadata = () => {
          void media.play().catch(reject);
        };
      });
    },
    [processUploadedPcmChunk, settings, waitForWorkerIdle]
  );

  const transcribeMediaFile = useCallback(
    async (file: File) => {
      if (!isTranscriptionSupported) {
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
      await ensureWorkerReady();

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
      ensureWorkerReady,
      isTranscriptionSupported,
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
    isTranscriptionSupported,
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

async function findDedicatedVadBoundaryEnd(
  audio: Float32Array,
  segmentStart: number,
  searchStart: number,
  searchEnd: number,
  sampleRate: number,
  settings: RuntimeSettings
) {
  if (isUploadedBoundaryVadUnavailable) return null;

  const requiredQuietSamples = getSamplesForMs(
    sampleRate,
    Math.max(settings.vad.paragraphSilenceMs, settings.audio.overlapMs)
  );

  try {
    return await withTimeout(
      findVadBoundaryEnd(
        audio,
        segmentStart,
        searchStart,
        searchEnd,
        sampleRate,
        requiredQuietSamples
      ),
      UPLOADED_MEDIA_BOUNDARY_TIMEOUT_MS
    );
  } catch (cause) {
    isUploadedBoundaryVadUnavailable = true;
    console.warn(
      "Dedicated upload VAD boundary detection failed; falling back to fixed media chunks.",
      cause
    );
    return null;
  }
}

function getSamplesForMs(sampleRate: number, ms: number) {
  return Math.max(1, Math.floor(sampleRate * (ms / 1000)));
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
  const maxSamples = getSamplesForMs(
    sampleRate,
    Math.max(UPLOADED_MEDIA_TARGET_CHUNK_MS, WHISPER_CONTEXT_MS)
  );

  if (remainingSamples <= 0) return offset;
  if (remainingSamples < minSamples) {
    return allowPartialFinalChunk ? audio.length : null;
  }

  const searchStart = offset + minSamples;
  const searchEnd = Math.min(audio.length, offset + maxSamples);
  const quietEnd = await findDedicatedVadBoundaryEnd(
    audio,
    offset,
    searchStart,
    searchEnd,
    sampleRate,
    settings
  );
  if (quietEnd !== null) return quietEnd;

  if (remainingSamples >= maxSamples) {
    return offset + maxSamples;
  }

  if (allowPartialFinalChunk) return audio.length;
  return null;
}

async function getBufferedUploadedMediaSplitEnd(
  audio: Float32Array,
  sampleRate: number,
  settings: RuntimeSettings,
  minSamples: number
) {
  if (audio.length < minSamples) return null;

  const targetSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_TARGET_CHUNK_MS);
  const searchStart = minSamples;
  const searchEnd = Math.min(audio.length, targetSamples);

  if (searchEnd > searchStart) {
    const quietEnd = await findDedicatedVadBoundaryEnd(
      audio,
      0,
      searchStart,
      searchEnd,
      sampleRate,
      settings
    );
    if (quietEnd !== null) return quietEnd;
  }

  if (audio.length >= targetSamples) {
    return targetSamples;
  }

  return null;
}

function appendAudioChunk(
  chunks: Float32Array[],
  sampleCountRef: { current: number },
  chunk: Float32Array
) {
  if (chunk.length === 0) return;
  chunks.push(chunk);
  sampleCountRef.current += chunk.length;
}

function consumeBufferedAudio(
  chunks: Float32Array[],
  sampleCountRef: { current: number },
  maxSamples = sampleCountRef.current
) {
  const targetSamples = Math.max(0, Math.min(sampleCountRef.current, maxSamples));
  if (targetSamples === 0) return new Float32Array();

  const output = new Float32Array(targetSamples);
  let writeOffset = 0;

  while (writeOffset < targetSamples && chunks.length > 0) {
    const chunk = chunks[0];
    const remaining = targetSamples - writeOffset;

    if (chunk.length <= remaining) {
      output.set(chunk, writeOffset);
      writeOffset += chunk.length;
      chunks.shift();
      continue;
    }

    output.set(chunk.subarray(0, remaining), writeOffset);
    chunks[0] = chunk.subarray(remaining);
    writeOffset += remaining;
  }

  sampleCountRef.current -= targetSamples;
  return output;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (cause) => {
        window.clearTimeout(timeoutId);
        reject(cause);
      }
    );
  });
}

function mergeTranscriptText(previous: string, incoming: string) {
  const left = previous.trim();
  const right = incoming.trim();

  if (!left) return right;
  if (!right) return left;
  if (left.endsWith(right)) return left;
  if (right.startsWith(left)) return right;

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(leftWords.length, rightWords.length, 24);

  for (let size = maxOverlap; size >= 2; size -= 1) {
    const leftTail = leftWords.slice(-size).join(" ").toLowerCase();
    const rightHead = rightWords.slice(0, size).join(" ").toLowerCase();
    if (leftTail === rightHead) {
      return `${left} ${rightWords.slice(size).join(" ")}`.trim();
    }
  }

  return `${left} ${right}`.trim();
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

async function getMicrophoneStream(settings: RuntimeSettings) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: getMicrophoneConstraints(settings)
    });
  } catch (cause) {
    if (!shouldRetryWithDefaultMicrophone(cause, settings.microphone.deviceId)) {
      throw cause;
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: settings.microphone.echoCancellation,
        noiseSuppression: settings.microphone.noiseSuppression,
        autoGainControl: settings.microphone.autoGainControl
      }
    });
  }
}

function shouldRetryWithDefaultMicrophone(cause: unknown, deviceId: string) {
  if (!deviceId) return false;
  if (!(cause instanceof DOMException)) return false;

  return cause.name === "NotFoundError" || cause.name === "OverconstrainedError";
}
