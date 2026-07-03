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
import { resetSileroVadRuntimeState, type SileroVadRuntimeState } from "./sileroVad";
import { withTimeout } from "./asyncTimeout";
import type { TranscriptParagraph, TranscriptWord } from "../transcript/timedTranscript";
import { getTranscriptionRuntimeSupport } from "./runtimeSupport";
import { isWasmTranscriptionModelId } from "../config/settings";
import type { ModelInventoryEntry } from "./modelInventory";
import { GeoLocationService } from "./geoLocationService";

type WorkerMessage =
  | { type: "ready" }
  | { type: "idle" }
  | {
      type: "progress";
      message: string;
      progress: number;
      loadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }
  | { type: "partial"; text: string }
  | { type: "segment"; text: string; startsNewParagraph: boolean; words: TranscriptWord[] }
  | {
      type: "cache-status";
      cached: boolean;
      cachedFiles: number;
      totalFiles: number;
      sizeBytes?: number;
      cachedBytes?: number;
      message?: string;
    }
  | { type: "catalog-status"; entries: ModelInventoryEntry[]; message?: string }
  | { type: "error"; message: string };

const createFloat32Buffer = (length: number) =>
  new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

const WHISPER_CONTEXT_MS = 30_000;
const LIVE_ANALYSIS_CHUNK_MS = 500;
const UPLOADED_MEDIA_MIN_CHUNK_MS = 10_000;
const UPLOADED_MEDIA_TARGET_CHUNK_MS = 24_000;
const MODEL_SPEED_STORAGE_KEY = "info-recorder-model-download-bps";

type SourceMedia = {
  url: string;
  kind: "audio" | "video";
  fileName: string;
};

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
  const sourceMediaUrlRef = useRef("");
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const opfsSessionRef = useRef<OpfsSession | null>(null);
  const opfsWriteQueueRef = useRef(Promise.resolve());
  const opfsChunkSequenceRef = useRef(0);
  const opfsNextChunkStartMsRef = useRef(0);
  const currentPartChunksRef = useRef<StoredAudioChunk[]>([]);
  const currentPartStartsAtRef = useRef("");
  const geoLocationServiceRef = useRef(new GeoLocationService());
  const tailRef = useRef<Float32Array>(new Float32Array());
  const latestVoiceRef = useRef<VoiceActivity>({
    hasSpeech: false,
    score: 0,
    trailingSilenceMs: 0,
    mode: "unknown"
  });
  const nextSegmentStartsParagraphRef = useRef(false);
  const adaptiveVadStateRef = useRef<AdaptiveVadState>({ noiseFloor: null });
  const sileroVadStateRef = useRef<SileroVadRuntimeState>({ state: null });
  const hasTranscriptRef = useRef(false);
  const transcriptParagraphSequenceRef = useRef(0);
  const liveTranscribedSecondsRef = useRef(0);
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
  const [sourceMedia, setSourceMedia] = useState<SourceMedia | null>(null);
  const [modelCacheStatus, setModelCacheStatus] = useState(
    "Whisper downloads once, then stays available offline on this device."
  );
  const [modelInventory, setModelInventory] = useState<ModelInventoryEntry[]>([]);
  const [modelInventoryMessage, setModelInventoryMessage] = useState("");
  const [modelDownloadSpeedBps, setModelDownloadSpeedBps] = useState(readPersistedModelDownloadSpeed);
  const [modelLoadTransferredBytes, setModelLoadTransferredBytes] = useState(0);
  const [modelLoadTotalBytes, setModelLoadTotalBytes] = useState(0);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [transcriptParagraphs, setTranscriptParagraphs] = useState<TranscriptParagraph[]>([]);

  const runtimeSupport = getTranscriptionRuntimeSupport();
  const requiresWebGpu = !isWasmTranscriptionModelId(settings.transcription.modelId);
  const isTranscriptionSupported =
    runtimeSupport.hasWebAssembly &&
    runtimeSupport.isSecureContext &&
    (!requiresWebGpu || runtimeSupport.hasWebGpu);
  const isOpfsRecordingAvailable = canUseOpfsRecording();
  const isOpfsPlaybackAvailable = canUseOpfsPlayback();
  const opfsChunkMs = settings.audio.opfsChunkMs;
  const shouldRecordToOpfs = settings.recording.shouldRecordToOpfs;
  const persistedDownloadSpeedBpsRef = useRef(readPersistedModelDownloadSpeed());

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

  const clearSourceMedia = useCallback(() => {
    if (sourceMediaUrlRef.current) {
      URL.revokeObjectURL(sourceMediaUrlRef.current);
      sourceMediaUrlRef.current = "";
    }
    setSourceMedia(null);
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
    isWorkerReadyRef.current = false;
    workerReadyPromiseRef.current = null;
    workerReadyResolveRef.current = null;
    workerReadyRejectRef.current = null;
    isModelCachedRef.current = false;
    hasCheckedModelCacheRef.current = false;
    setIsModelCached(false);
    setHasCheckedModelCache(false);
    setIsModelLoading(false);
    setModelLoadProgress(0);
    setModelLoadMessage("");
    setModelCacheStatus("Checking offline Whisper model cache...");
    setModelLoadTransferredBytes(0);
    setModelLoadTotalBytes(0);
    worker.postMessage({ type: "configure", transcription: settings.transcription });
    worker.postMessage({ type: "cache-status" });
    worker.postMessage({ type: "catalog-status" });
  }, [settings.transcription, worker]);

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
    geoLocationServiceRef.current.stop();
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
    resetSileroVadRuntimeState(sileroVadStateRef.current);
    microphonePcmChunksRef.current = [];
    microphonePcmBufferedSamplesRef.current = 0;
    microphoneProcessQueueRef.current = Promise.resolve();
    liveSpeechChunksRef.current = [];
    liveSpeechBufferedSamplesRef.current = 0;
    liveSpeechStartsParagraphRef.current = false;
    liveTranscribedSecondsRef.current = 0;
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
        setProgress("");
        setIsModelCached(true);
        setModelCacheStatus("Whisper model available offline.");
        worker.postMessage({ type: "catalog-status" });
      }

      if (data.type === "idle") {
        workerIdleResolveRef.current?.();
        workerIdleResolveRef.current = null;
        workerIdleRejectRef.current = null;
        workerIdlePromiseRef.current = null;
      }

      if (data.type === "progress") {
        const nextProgress = data.progress <= 1 ? data.progress * 100 : data.progress;
        setIsModelLoading(true);
        setModelLoadProgress(Math.min(100, Math.max(0, nextProgress)));
        setModelLoadMessage(data.message);
        if (typeof data.loadedBytes === "number") {
          setModelLoadTransferredBytes(Math.max(0, data.loadedBytes));
        }
        if (typeof data.totalBytes === "number") {
          setModelLoadTotalBytes(Math.max(0, data.totalBytes));
        }
        if (typeof data.bytesPerSecond === "number" && data.bytesPerSecond > 0) {
          setModelDownloadSpeedBps(data.bytesPerSecond);
          persistedDownloadSpeedBpsRef.current = data.bytesPerSecond;
          persistModelDownloadSpeed(data.bytesPerSecond);
        }
        if (!isModelCachedRef.current) {
          setProgress(data.message);
        }
      }

      if (data.type === "partial") {
        setPartialText(data.text);
      }

      if (data.type === "segment") {
        setPartialText("");
        const normalized = data.text.trim();
        if (!normalized) return;

        hasTranscriptRef.current = true;
        setTranscriptParagraphs((current) => {
          const next = mergeTranscriptParagraphs(current, normalized, data.words, data.startsNewParagraph, {
            nextParagraphId: () => `p-${transcriptParagraphSequenceRef.current++}`
          });
          setParagraphs(next.map((paragraph) => paragraph.text));
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
          setModelLoadMessage("Whisper model is already available offline.");
          setModelCacheStatus("Whisper model available offline.");
          setModelLoadTransferredBytes(data.sizeBytes ?? data.cachedBytes ?? 0);
          setModelLoadTotalBytes(data.sizeBytes ?? data.cachedBytes ?? 0);
        } else if (data.totalFiles > 0) {
          setIsModelCached(false);
          setModelCacheStatus(
            `Whisper model will download once. ${data.cachedFiles}/${data.totalFiles} files are already available offline.`
          );
          setModelLoadTransferredBytes(data.cachedBytes ?? 0);
          setModelLoadTotalBytes(data.sizeBytes ?? 0);
        } else {
          setModelCacheStatus(data.message ?? "Whisper model cache status unavailable.");
        }
        worker.postMessage({ type: "catalog-status" });
      }

      if (data.type === "catalog-status") {
        setModelInventory(data.entries);
        setModelInventoryMessage(data.message ?? "");
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
      clearSourceMedia();
      disposeWaveformWorker();
    };
  }, [cleanupMediaSource, cleanupMicrophoneCapture, clearSourceMedia, disposeWaveformWorker, stopAnalyser, stopPlayback]);

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
      geoLocationServiceRef.current.start();
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
        const location = geoLocationServiceRef.current.finishPhrase();
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
          LAT: location.LAT,
          LONG: location.LONG,
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
            geoLocationServiceRef.current.startPhrase();
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
      if (!settings.vad.enabled) {
        latestVoiceRef.current = {
          hasSpeech: true,
          score: 1,
          trailingSilenceMs: 0,
          mode: "raw-audio"
        };

        if (liveSpeechBufferedSamplesRef.current === 0) {
          liveSpeechStartsParagraphRef.current = nextSegmentStartsParagraphRef.current;
          nextSegmentStartsParagraphRef.current = false;
        }
        appendAudioChunk(
          liveSpeechChunksRef.current,
          liveSpeechBufferedSamplesRef,
          mono
        );

        const targetSamples = getSamplesForMs(sampleRate, settings.audio.transcriptionChunkMs);
        if (liveSpeechBufferedSamplesRef.current >= targetSamples) {
          const speechAudio = consumeBufferedAudio(
            liveSpeechChunksRef.current,
            liveSpeechBufferedSamplesRef
          );
          const audio = concatAudio(tailRef.current, speechAudio);
          const offsetSeconds = Math.max(0, liveTranscribedSecondsRef.current - (tailRef.current.length / sampleRate));
          const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
          tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
          liveTranscribedSecondsRef.current += speechAudio.length / sampleRate;

          worker.postMessage(
            {
              type: "transcribe",
              audio,
              sampleRate,
              isFinal: false,
              startsNewParagraph: liveSpeechStartsParagraphRef.current,
              offsetSeconds
            },
            [audio.buffer]
          );
          liveSpeechStartsParagraphRef.current = false;
        }

        return latestVoiceRef.current;
      }

      const voice = await detectVoiceActivity(
        mono,
        sampleRate,
        settings.vad,
        settings.vad.mode === "adaptive-rms" ? adaptiveVadStateRef.current : undefined,
        settings.vad.mode === "silero-vad" ? sileroVadStateRef.current : undefined
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
          const offsetSeconds = Math.max(0, liveTranscribedSecondsRef.current - (tailRef.current.length / sampleRate));
          const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
          tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
          liveTranscribedSecondsRef.current += speechAudio.length / sampleRate;

          worker.postMessage(
            {
              type: "transcribe",
              audio,
              sampleRate,
              isFinal: false,
              startsNewParagraph: liveSpeechStartsParagraphRef.current,
              offsetSeconds
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
          const offsetSeconds = Math.max(0, liveTranscribedSecondsRef.current - (tailRef.current.length / sampleRate));
          const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
          tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
          liveTranscribedSecondsRef.current += speechAudio.length / sampleRate;

          worker.postMessage(
            {
              type: "transcribe",
              audio,
              sampleRate,
              isFinal: false,
              startsNewParagraph: liveSpeechStartsParagraphRef.current,
              offsetSeconds
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
      chunkOffsetSeconds: number,
      overlapMs = 0
    ) => {
      if (mono.length === 0) return;

      const tailSeconds = tailRef.current.length / sampleRate;
      const audio = concatAudio(tailRef.current, mono);
      const overlapSamples = Math.floor(sampleRate * (overlapMs / 1000));
      tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));

      worker.postMessage(
        {
          type: "transcribe",
          audio,
          sampleRate,
          isFinal: false,
          startsNewParagraph,
          offsetSeconds: Math.max(0, chunkOffsetSeconds - tailSeconds)
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
        const offsetSeconds = Math.max(0, liveTranscribedSecondsRef.current - (tailRef.current.length / sampleRate));
        const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
        tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
        liveTranscribedSecondsRef.current += speechAudio.length / sampleRate;
        worker.postMessage(
          {
            type: "transcribe",
            audio,
            sampleRate,
            isFinal: true,
            startsNewParagraph: liveSpeechStartsParagraphRef.current,
            offsetSeconds
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
    clearSourceMedia();
    setIsPreparing(true);

    if (!isTranscriptionSupported) {
      setIsPreparing(false);
      setError("This app needs WebGPU, WebAssembly, and a secure browser context before it can transcribe audio.");
      return;
    }

    try {
      const stream = await getMicrophoneStream(settings);
      streamRef.current = stream;

      if (!isModelCachedRef.current) {
        setModelLoadProgress(0);
        setModelLoadMessage(
          hasCheckedModelCacheRef.current ? "Checking model files..." : "Checking model cache..."
        );
      }
      await ensureWorkerReady();

      latestVoiceRef.current = {
        hasSpeech: false,
        score: 0,
        trailingSilenceMs: 0,
        mode: "unknown"
      };
      adaptiveVadStateRef.current = { noiseFloor: null };
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
      setMediaTranscriptionProgress(0);
      setIsRecording(true);
      setIsPreparing(false);
    } catch (cause) {
      resetCaptureState();
      worker.postMessage({ type: "flush" });
      setError(
        cause instanceof Error ? cause.message : "Unable to start recording."
      );
    }
  }, [
    clearSourceMedia,
    isTranscriptionSupported,
    isOpfsRecordingAvailable,
    opfsChunkMs,
    settings,
    finalizeCurrentPart,
    ensureWorkerReady,
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
    setModelLoadMessage(
      isModelCached ? "Whisper model is already available offline." : "Preparing offline Whisper model cache..."
    );
    setModelCacheStatus(
      isModelCached ? "Whisper model available offline." : "Preparing offline Whisper model cache..."
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
        await processUploadedPcmChunk(chunk, decoded.sampleRate, startsNewParagraph, offset / decoded.sampleRate);
        startsNewParagraph = true;
        offset = end;
        const percent = Math.round((end / mono.length) * 100);
        setMediaTranscriptionProgress(percent);
        setProgress(`Transcribing ${file.name} ${percent}%`);
        await yieldToBrowser();
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
              minChunkSamples,
              settings
            );
            if (splitEnd === null) break;

            const chunk = buffered.slice(0, splitEnd);
            buffered = buffered.slice(splitEnd);
            await processUploadedPcmChunk(
              chunk,
              audioContext.sampleRate,
              startsNewParagraph,
              Math.max(0, media.currentTime - (chunk.length / audioContext.sampleRate))
            );
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
          processQueue = processQueue.then(async () => {
            if (buffered.length > 0) {
              const finalChunk = buffered;
              buffered = new Float32Array();
              await processUploadedPcmChunk(
                finalChunk,
                audioContext.sampleRate,
                startsNewParagraph,
                Math.max(0, media.duration - (finalChunk.length / audioContext.sampleRate))
              );
            }
          });
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
        setError("This app needs WebGPU, WebAssembly, and a secure browser context before it can transcribe audio.");
        return;
      }

      setError("");
      setProgress(`Preparing ${file.name}...`);
      setMediaTranscriptionProgress(0);
      setMediaFileName(file.name);
      setIsPreparing(true);
      setIsRecording(true);
      setIsTranscribingMedia(true);
      clearSourceMedia();
      const nextSourceUrl = URL.createObjectURL(file);
      sourceMediaUrlRef.current = nextSourceUrl;
      setSourceMedia({
        url: nextSourceUrl,
        kind: file.type.startsWith("video/") ? "video" : "audio",
        fileName: file.name
      });
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
      clearSourceMedia,
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
    setTranscriptParagraphs([]);
    setPartialText("");
    setError("");
    hasTranscriptRef.current = false;
    nextSegmentStartsParagraphRef.current = false;
    transcriptParagraphSequenceRef.current = 0;
    clearSourceMedia();
  }, [clearSourceMedia]);

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
    requiresWebGpu,
    runtimeSupport,
    mediaFileName,
    opfsChunkCount,
    opfsChunkMs,
    opfsError,
    opfsSessionName,
    modelCacheStatus,
    modelInventory,
    modelInventoryMessage,
    modelDownloadSpeedBps: getEstimatedDownloadSpeedBps(modelDownloadSpeedBps, persistedDownloadSpeedBpsRef.current),
    modelLoadMessage,
    modelLoadProgress,
    modelLoadTransferredBytes,
    modelLoadTotalBytes,
    isModelCached,
    audioParts,
    partialText,
    progress,
    mediaTranscriptionProgress,
    sourceActivityRms,
    sourceMedia,
    paragraphs,
    transcriptParagraphs,
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

function readPersistedModelDownloadSpeed() {
  try {
    const raw = window.localStorage.getItem(MODEL_SPEED_STORAGE_KEY);
    if (!raw) return getNavigatorDownloadSpeedEstimate();
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : getNavigatorDownloadSpeedEstimate();
  } catch {
    return getNavigatorDownloadSpeedEstimate();
  }
}

function persistModelDownloadSpeed(value: number) {
  try {
    window.localStorage.setItem(MODEL_SPEED_STORAGE_KEY, String(Math.round(value)));
  } catch {
    // Ignore storage failures and keep the in-memory estimate.
  }
}

function getNavigatorDownloadSpeedEstimate() {
  const connection = (navigator as Navigator & {
    connection?: { downlink?: number };
  }).connection;
  if (!connection?.downlink || connection.downlink <= 0) return 0;
  return (connection.downlink * 1_000_000) / 8;
}

function getEstimatedDownloadSpeedBps(liveBytesPerSecond: number, persistedBytesPerSecond: number) {
  if (liveBytesPerSecond > 0) return liveBytesPerSecond;
  if (persistedBytesPerSecond > 0) return persistedBytesPerSecond;
  return getNavigatorDownloadSpeedEstimate();
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
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

  if (settings.vad.enabled && settings.vad.mode === "silero-vad") {
    const searchStart = offset + minSamples;
    const searchEnd = Math.min(audio.length, offset + maxSamples);
    const quietSamples = getSamplesForMs(sampleRate, settings.vad.partSilenceMs);
    const boundary = await findVadBoundaryEnd(
      audio,
      offset,
      searchStart,
      searchEnd,
      sampleRate,
      quietSamples,
      settings.vad.silero.modelId
    );

    if (boundary !== null) return boundary;
  }

  if (remainingSamples >= maxSamples) {
    return offset + maxSamples;
  }

  if (allowPartialFinalChunk) return audio.length;
  return null;
}

async function getBufferedUploadedMediaSplitEnd(
  audio: Float32Array,
  sampleRate: number,
  minSamples: number,
  settings: RuntimeSettings
) {
  if (audio.length < minSamples) return null;

  const targetSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_TARGET_CHUNK_MS);

  if (settings.vad.enabled && settings.vad.mode === "silero-vad") {
    const quietSamples = getSamplesForMs(sampleRate, settings.vad.partSilenceMs);
    const boundary = await findVadBoundaryEnd(
      audio,
      0,
      minSamples,
      Math.min(audio.length, targetSamples),
      sampleRate,
      quietSamples,
      settings.vad.silero.modelId
    );

    if (boundary !== null) return boundary;
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

function mergeTranscriptParagraphs(
  current: TranscriptParagraph[],
  incomingText: string,
  incomingWords: TranscriptWord[],
  startsNewParagraph: boolean,
  options: { nextParagraphId: () => string }
) {
  if (startsNewParagraph || current.length === 0) {
    if (current.at(-1)?.text === incomingText) return current;
    return [
      ...current,
      {
        id: options.nextParagraphId(),
        text: incomingText,
        words: incomingWords
      }
    ];
  }

  const next = [...current];
  const previous = next[next.length - 1];
  if (!previous) {
    return [
      {
        id: options.nextParagraphId(),
        text: incomingText,
        words: incomingWords
      }
    ];
  }

  const mergedText = mergeTranscriptText(previous.text, incomingText);
  const mergedWords = mergeTranscriptWords(previous.words, incomingWords);
  if (mergedText === previous.text && mergedWords.length === previous.words.length) {
    return current;
  }

  next[next.length - 1] = {
    ...previous,
    text: mergedText,
    words: mergedWords
  };
  return next;
}

function mergeTranscriptWords(previous: TranscriptWord[], incoming: TranscriptWord[]) {
  if (previous.length === 0) return incoming;
  if (incoming.length === 0) return previous;

  const maxOverlap = Math.min(previous.length, incoming.length, 24);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const leftTail = previous.slice(-size).map((word) => normalizeTranscriptToken(word.text));
    const rightHead = incoming.slice(0, size).map((word) => normalizeTranscriptToken(word.text));
    if (leftTail.every((token, index) => token === rightHead[index])) {
      return [...previous, ...incoming.slice(size)];
    }
  }

  return [...previous, ...incoming];
}

function normalizeTranscriptToken(text: string) {
  return text.trim().toLowerCase();
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
