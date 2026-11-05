import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createRecorderMachine, createStateMachine } from "../state/machine";
import { canUseOpfsRecording, canUseOpfsPlayback, createOpfsSession, readStoredChunkFiles, writeMediaRecorderChunk, writeSessionPart, type StoredAudioChunk, type StoredAudioPart, type OpfsSession } from "./audioStorage";
import type { RuntimeSettings } from "../config/settingsOptions";
import { concatAudio, getRms, toMono } from "./audioUtils";
import { exportRecordingBlob, getRecordingExportExtension } from "./audioExport";
import { detectVoiceActivity, type AdaptiveVadState, type VoiceActivity } from "./vad";
import { findVadBoundaryEnd } from "./uploadBoundaryVad";
import { resetSileroVadRuntimeState, type SileroVadRuntimeState } from "./sileroVad";
import type { TranscriptParagraph, TranscriptWord } from "../transcript/timedTranscript";
import { getTranscriptionRuntimeSupport } from "./runtimeSupport";
import { isMoonshineModelId, isWasmTranscriptionModelId } from "../config/settings";
import type { ModelInventoryEntry } from "./modelInventory";
import { GeoLocationService, type LocationStatus } from "./geoLocationService";
import { appendSessionAudio, deleteSession as deleteStoredSession, listSessions as listStoredSessions, loadSession, saveSession, saveSessionMedia, type SavedSession } from "./sessionStore";
import { estimateWordTimings, replaceSentenceText, type TranscriptSentence } from "../transcript/timedTranscript";
import type { LocationFix } from "../transcript/locatedTranscript";
import { RecordedAudio } from "./recordedAudio";
import { prepareLocalSpeechRecognition, createLocalSpeechSession, supportsLocalSpeechRecognition } from "./localSpeechRecognition";
type WorkerMessage = {
    type: "ready";
} | {
    type: "idle";
} | {
    type: "progress";
    message: string;
    progress: number;
    loadedBytes?: number;
    totalBytes?: number;
    bytesPerSecond?: number;
} | {
    type: "partial";
    text: string;
} | {
    type: "segment";
    text: string;
    startsNewParagraph: boolean;
    words: TranscriptWord[];
} | {
    type: "cache-status";
    cached: boolean;
    cachedFiles: number;
    totalFiles: number;
    sizeBytes?: number;
    cachedBytes?: number;
    message?: string;
} | {
    type: "catalog-status";
    entries: ModelInventoryEntry[];
    message?: string;
} | {
    type: "error";
    message: string;
};
const createFloat32Buffer = (length: number) => new Float32Array(new ArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
function yieldToBrowser() {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
    });
}
const WHISPER_CONTEXT_MS = 30000;
const LIVE_ANALYSIS_CHUNK_MS = 500;
const UPLOADED_MEDIA_MIN_CHUNK_MS = 10000;
const UPLOADED_MEDIA_TARGET_CHUNK_MS = 24000;
const MODEL_SPEED_STORAGE_KEY = "info-recorder-model-download-bps";
const AUTOSAVE_DELAY_MS = 3000;
// Decoding reads the whole file into memory; larger files stream through a media element instead.
const MAX_DECODABLE_MEDIA_BYTES = 1024 * 1024 * 1024;
type SourceMedia = {
    url: string;
    kind: "audio" | "video";
    fileName: string;
};
export function createTranscriber(...initialInputs: [
    settings: RuntimeSettings
]) {
    let settings = initialInputs[0];
    const scope = createLifecycle();
    const recordedAudio = new RecordedAudio();
    const machine = createRecorderMachine();
    scope.own(machine.subscribe(scope.invalidate));
    scope.own(machine.dispose);
    const contextStore = createStateMachine({ error: "",
        opfsError: "",
        opfsChunkCount: 0,
        opfsSessionName: "",
        audioParts: ([]) as StoredAudioPart[],
        isPlayingRecording: false,
        isPaused: false,
        isChangingCapture: false,
        isModelLoading: false,
        modelLoadProgress: 0,
        modelLoadMessage: "",
        isModelCached: false,
        hasCheckedModelCache: false,
        mediaFileName: "",
        partialText: "",
        progress: "",
        mediaTranscriptionProgress: 0,
        sourceMedia: (null) as SourceMedia | null,
        hasRecordingAudio: false,
        recordingStartedAt: (null) as number | null,
        locationTrack: ([]) as LocationFix[],
        locationStatus: ("off") as LocationStatus,
        transcriptionEngine: "",
        modelCacheStatus: "The transcription model downloads once, then stays available offline on this device.",
        modelInventory: ([]) as ModelInventoryEntry[],
        modelInventoryMessage: "",
        modelDownloadSpeedBps: (readPersistedModelDownloadSpeed)(),
        modelLoadTransferredBytes: 0,
        modelLoadTotalBytes: 0,
        paragraphs: ([]) as string[],
        transcriptParagraphs: ([]) as TranscriptParagraph[] }, () => "ready");
    let state = contextStore.context;
    let pauseStartedAt = 0;
    let pausedMilliseconds = 0;
    const captureNow = () => (pauseStartedAt || Date.now()) - pausedMilliseconds;
    scope.own(contextStore.subscribe(() => { state = contextStore.context; scope.invalidate(); }));
    scope.own(contextStore.dispose);
    const setError = (value: string) => { machine.send(value ? "ERROR" : "RESET"); contextStore.send({ type: "error", value }); };
    const setOpfsError = (value: typeof state.opfsError | ((previous: typeof state.opfsError) => typeof state.opfsError)) => contextStore.send({ type: "opfsError", value });
    const setOpfsChunkCount = (value: typeof state.opfsChunkCount | ((previous: typeof state.opfsChunkCount) => typeof state.opfsChunkCount)) => contextStore.send({ type: "opfsChunkCount", value });
    const setOpfsSessionName = (value: typeof state.opfsSessionName | ((previous: typeof state.opfsSessionName) => typeof state.opfsSessionName)) => contextStore.send({ type: "opfsSessionName", value });
    const setAudioParts = (value: typeof state.audioParts | ((previous: typeof state.audioParts) => typeof state.audioParts)) => contextStore.send({ type: "audioParts", value });
    const setIsPlayingRecording = (value: typeof state.isPlayingRecording | ((previous: typeof state.isPlayingRecording) => typeof state.isPlayingRecording)) => contextStore.send({ type: "isPlayingRecording", value });
    const setIsModelLoading = (value: typeof state.isModelLoading | ((previous: typeof state.isModelLoading) => typeof state.isModelLoading)) => contextStore.send({ type: "isModelLoading", value });
    const setModelLoadProgress = (value: typeof state.modelLoadProgress | ((previous: typeof state.modelLoadProgress) => typeof state.modelLoadProgress)) => contextStore.send({ type: "modelLoadProgress", value });
    const setModelLoadMessage = (value: typeof state.modelLoadMessage | ((previous: typeof state.modelLoadMessage) => typeof state.modelLoadMessage)) => contextStore.send({ type: "modelLoadMessage", value });
    const setIsModelCached = (value: typeof state.isModelCached | ((previous: typeof state.isModelCached) => typeof state.isModelCached)) => contextStore.send({ type: "isModelCached", value });
    const setHasCheckedModelCache = (value: typeof state.hasCheckedModelCache | ((previous: typeof state.hasCheckedModelCache) => typeof state.hasCheckedModelCache)) => contextStore.send({ type: "hasCheckedModelCache", value });
    const setIsPreparing = (value: boolean) => machine.send(value ? "PREPARE" : "READY");
    const setIsRecording = (value: boolean) => machine.send(value ? "RECORD" : "STOP");
    const setIsTranscribingMedia = (value: boolean) => machine.send(value ? "TRANSCRIBE" : "COMPLETE");
    const setMediaFileName = (value: typeof state.mediaFileName | ((previous: typeof state.mediaFileName) => typeof state.mediaFileName)) => contextStore.send({ type: "mediaFileName", value });
    const setPartialText = (value: typeof state.partialText | ((previous: typeof state.partialText) => typeof state.partialText)) => contextStore.send({ type: "partialText", value });
    const setProgress = (value: typeof state.progress | ((previous: typeof state.progress) => typeof state.progress)) => contextStore.send({ type: "progress", value });
    const setMediaTranscriptionProgress = (value: typeof state.mediaTranscriptionProgress | ((previous: typeof state.mediaTranscriptionProgress) => typeof state.mediaTranscriptionProgress)) => contextStore.send({ type: "mediaTranscriptionProgress", value });
    const setSourceMedia = (value: typeof state.sourceMedia | ((previous: typeof state.sourceMedia) => typeof state.sourceMedia)) => contextStore.send({ type: "sourceMedia", value });
    const setRecordingStartedAt = (value: typeof state.recordingStartedAt | ((previous: typeof state.recordingStartedAt) => typeof state.recordingStartedAt)) => contextStore.send({ type: "recordingStartedAt", value });
    const setModelCacheStatus = (value: typeof state.modelCacheStatus | ((previous: typeof state.modelCacheStatus) => typeof state.modelCacheStatus)) => contextStore.send({ type: "modelCacheStatus", value });
    const setModelInventory = (value: typeof state.modelInventory | ((previous: typeof state.modelInventory) => typeof state.modelInventory)) => contextStore.send({ type: "modelInventory", value });
    const setModelInventoryMessage = (value: typeof state.modelInventoryMessage | ((previous: typeof state.modelInventoryMessage) => typeof state.modelInventoryMessage)) => contextStore.send({ type: "modelInventoryMessage", value });
    const setModelDownloadSpeedBps = (value: typeof state.modelDownloadSpeedBps | ((previous: typeof state.modelDownloadSpeedBps) => typeof state.modelDownloadSpeedBps)) => contextStore.send({ type: "modelDownloadSpeedBps", value });
    const setModelLoadTransferredBytes = (value: typeof state.modelLoadTransferredBytes | ((previous: typeof state.modelLoadTransferredBytes) => typeof state.modelLoadTransferredBytes)) => contextStore.send({ type: "modelLoadTransferredBytes", value });
    const setModelLoadTotalBytes = (value: typeof state.modelLoadTotalBytes | ((previous: typeof state.modelLoadTotalBytes) => typeof state.modelLoadTotalBytes)) => contextStore.send({ type: "modelLoadTotalBytes", value });
    const setParagraphs = (value: typeof state.paragraphs | ((previous: typeof state.paragraphs) => typeof state.paragraphs)) => contextStore.send({ type: "paragraphs", value });
    const setTranscriptParagraphs = (value: typeof state.transcriptParagraphs | ((previous: typeof state.transcriptParagraphs) => typeof state.transcriptParagraphs)) => contextStore.send({ type: "transcriptParagraphs", value });
    const mediaRecorderRef: {
        current: MediaRecorder | null;
    } = { current: null };
    const streamRef: {
        current: MediaStream | null;
    } = { current: null };
    const audioContextRef: {
        current: AudioContext | null;
    } = { current: null };
    const analyserRef: {
        current: AnalyserNode | null;
    } = { current: null };
    const analyserSourceRef: {
        current: MediaStreamAudioSourceNode | null;
    } = { current: null };
    const analyserGainRef: {
        current: GainNode | null;
    } = { current: null };
    const microphoneSourceRef: {
        current: MediaStreamAudioSourceNode | null;
    } = { current: null };
    const microphoneProcessorNodeRef: {
        current: AudioWorkletNode | null;
    } = { current: null };
    const microphoneSilentGainRef: {
        current: GainNode | null;
    } = { current: null };
    const microphonePcmChunksRef: {
        current: Float32Array[];
    } = { current: [] };
    const microphonePcmBufferedSamplesRef = { current: 0 };
    const microphoneProcessQueueRef = { current: Promise.resolve() };
    const liveSpeechChunksRef: {
        current: Float32Array[];
    } = { current: [] };
    const liveSpeechBufferedSamplesRef = { current: 0 };
    const liveSpeechStartsParagraphRef = { current: false };
    const waveformCanvasRef: {
        current: HTMLCanvasElement | null;
    } = { current: null };
    const waveformWorkerRef: {
        current: Worker | null;
    } = { current: null };
    const waveformResizeObserverRef: {
        current: ResizeObserver | null;
    } = { current: null };
    const hasTransferredWaveformCanvasRef = { current: false };
    const waveformRafRef: {
        current: number | null;
    } = { current: null };
    const analyserBufferRef: {
        current: Float32Array<ArrayBuffer>;
    } = { current: createFloat32Buffer(2048) };
    const mediaElementRef: {
        current: HTMLMediaElement | null;
    } = { current: null };
    const mediaObjectUrlRef = { current: "" };
    const mediaSourceNodeRef: {
        current: MediaElementAudioSourceNode | null;
    } = { current: null };
    const mediaProcessorNodeRef: {
        current: AudioWorkletNode | null;
    } = { current: null };
    const mediaSilentGainRef: {
        current: GainNode | null;
    } = { current: null };
    const sourceMediaUrlRef = { current: "" };
    const recordedSourceRef: {
        current: {
            url: string;
            chunkCount: number;
        } | null;
    } = { current: null };
    const playbackContextRef: {
        current: AudioContext | null;
    } = { current: null };
    const playbackNodeRef: {
        current: AudioWorkletNode | null;
    } = { current: null };
    const playbackTimerRef: {
        current: number | null;
    } = { current: null };
    const opfsSessionRef: {
        current: OpfsSession | null;
    } = { current: null };
    const opfsWriteQueueRef = { current: Promise.resolve() };
    const opfsChunkSequenceRef = { current: 0 };
    const opfsNextChunkStartMsRef = { current: 0 };
    const currentPartChunksRef: {
        current: StoredAudioChunk[];
    } = { current: [] };
    const currentPartStartsAtRef = { current: "" };
    const geoLocationServiceRef = { current: new GeoLocationService() };
    const getElapsedMs = () => state.recordingStartedAt === null ? 0 : Math.max(0, captureNow() - state.recordingStartedAt);
    geoLocationServiceRef.current.observe(getElapsedMs, () => {
        contextStore.send({ type: "locationTrack", value: geoLocationServiceRef.current.track });
        contextStore.send({ type: "locationStatus", value: geoLocationServiceRef.current.status });
    });
    const engineReadyRef = { current: Promise.resolve() };
    const engineFailedRef = { current: false };
    const wakeLockRef: {
        current: WakeLockSentinel | null;
    } = { current: null };
    const mediaCancelRef = { current: false };
    const cancelPlayableMediaRef: {
        current: (() => void) | null;
    } = { current: null };
    const ignoreWorkerResultsRef = { current: false };
    const sessionRef: {
        current: {
            name: string;
            kind: SavedSession["kind"];
            startedAt: number;
            durationMs: number;
            media?: SavedSession["media"];
            pcmSequence: number;
        } | null;
    } = { current: null };
    const sessionWritesRef = { current: Promise.resolve() };
    const autosaveTimerRef: {
        current: number | null;
    } = { current: null };
    const tailRef: {
        current: Float32Array;
    } = { current: new Float32Array() };
    const latestVoiceRef: {
        current: VoiceActivity;
    } = { current: {
            hasSpeech: false,
            score: 0,
            trailingSilenceMs: 0,
            mode: "unknown"
        } };
    const nextSegmentStartsParagraphRef = { current: false };
    const adaptiveVadStateRef: {
        current: AdaptiveVadState;
    } = { current: { noiseFloor: null } };
    const sileroVadStateRef: {
        current: SileroVadRuntimeState;
    } = { current: { state: null } };
    const hasTranscriptRef = { current: false };
    const transcriptParagraphSequenceRef = { current: 0 };
    const liveTranscribedSecondsRef = { current: 0 };
    const liveSpeechStartSecondsRef = { current: 0 };
    const lastActivityUpdateRef = { current: 0 };
    const isWorkerReadyRef = { current: false };
    const workerReadyPromiseRef: {
        current: Promise<void> | null;
    } = { current: null };
    const workerReadyResolveRef: {
        current: (() => void) | null;
    } = { current: null };
    const workerReadyRejectRef: {
        current: ((cause?: unknown) => void) | null;
    } = { current: null };
    const workerIdlePromiseRef: {
        current: Promise<void> | null;
    } = { current: null };
    const workerIdleResolveRef: {
        current: (() => void) | null;
    } = { current: null };
    const workerIdleRejectRef: {
        current: ((cause?: unknown) => void) | null;
    } = { current: null };
    const isModelCachedRef = { current: false };
    const hasCheckedModelCacheRef = { current: false };
    const persistedDownloadSpeedBpsRef = { current: readPersistedModelDownloadSpeed() };
    const worker = (() => new Worker(new URL("./whisperWorker.ts", import.meta.url), { type: "module" }))();
    let runtimeSupport = getTranscriptionRuntimeSupport();
    let requiresWebGpu = !isWasmTranscriptionModelId(settings.transcription.modelId) &&
        !isMoonshineModelId(settings.transcription.modelId);
    let requiresCrossOriginIsolation = isMoonshineModelId(settings.transcription.modelId);
    const canUseSelectedModel = () => runtimeSupport.hasWebAssembly &&
        runtimeSupport.isSecureContext &&
        (!requiresCrossOriginIsolation || runtimeSupport.hasCrossOriginIsolation) &&
        (!requiresWebGpu || runtimeSupport.hasWebGpu);
    let isTranscriptionSupported = canUseSelectedModel() || (runtimeSupport.isSecureContext && settings.transcription.task === "transcribe" && supportsLocalSpeechRecognition());
    let isOpfsRecordingAvailable = canUseOpfsRecording();
    let isOpfsPlaybackAvailable = canUseOpfsPlayback();
    let opfsChunkMs = settings.audio.opfsChunkMs;
    let shouldRecordToOpfs = settings.recording.shouldRecordToOpfs;
    const resizeWaveform = () => {
        const canvas = waveformCanvasRef.current;
        const worker = waveformWorkerRef.current;
        if (!canvas || !worker)
            return;
        const rect = canvas.getBoundingClientRect();
        worker.postMessage({
            type: "resize",
            width: rect.width,
            height: rect.height,
            pixelRatio: window.devicePixelRatio || 1
        });
    };
    const clearWaveform = () => {
        waveformWorkerRef.current?.postMessage({ type: "clear" });
    };
    const disposeWaveformWorker = () => {
        waveformResizeObserverRef.current?.disconnect();
        waveformResizeObserverRef.current = null;
        waveformWorkerRef.current?.terminate();
        waveformWorkerRef.current = null;
    };
    const renderWaveformFallback = () => {
        const canvas = waveformCanvasRef.current;
        if (!canvas)
            return;
        const rect = canvas.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(rect.width * pixelRatio));
        const height = Math.max(1, Math.floor(rect.height * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        const context = canvas.getContext("2d");
        if (!context)
            return;
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#f7faf7";
        context.fillRect(0, 0, width, height);
        context.strokeStyle = "#d2ddd5";
        context.lineWidth = Math.max(1, pixelRatio);
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
    };
    const setWaveformCanvas = (canvas: HTMLCanvasElement | null) => {
        if (waveformCanvasRef.current === canvas)
            return;
        disposeWaveformWorker();
        hasTransferredWaveformCanvasRef.current = false;
        waveformResizeObserverRef.current?.disconnect();
        waveformResizeObserverRef.current = null;
        waveformCanvasRef.current = canvas;
        if (!canvas || hasTransferredWaveformCanvasRef.current)
            return;
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
        worker.postMessage({
            type: "init",
            canvas: offscreen,
            stroke: getComputedStyle(canvas).color,
            width: rect.width,
            height: rect.height,
            pixelRatio: window.devicePixelRatio || 1
        }, [offscreen]);
        const observer = new ResizeObserver(() => resizeWaveform());
        observer.observe(canvas);
        waveformResizeObserverRef.current = observer;
    };
    const stopAnalyser = () => {
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
        clearWaveform();
    };
    const cleanupMediaSource = () => {
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
    };
    const clearSourceMedia = () => {
        recordedAudio.clear();
        contextStore.send({ type: "hasRecordingAudio", value: false });
        contextStore.send({ type: "locationTrack", value: [] });
        contextStore.send({ type: "locationStatus", value: "off" });
        if (recordedSourceRef.current) {
            URL.revokeObjectURL(recordedSourceRef.current.url);
            recordedSourceRef.current = null;
        }
        if (sourceMediaUrlRef.current) {
            URL.revokeObjectURL(sourceMediaUrlRef.current);
            sourceMediaUrlRef.current = "";
        }
        setSourceMedia(null);
        opfsSessionRef.current = null;
        setAudioParts([]);
        setOpfsChunkCount(0);
        setRecordingStartedAt(null);
    };
    const getRecordingSourceMedia = async (): Promise<SourceMedia | null> => {
        // WAV snapshots have a finite duration and can seek before capture ends.
        if (recordedAudio.hasAudio) return recordedAudio.getSourceMedia();
        const session = opfsSessionRef.current;
        if (!session)
            return null;
        await opfsWriteQueueRef.current;
        if (session.chunks.length === 0)
            return null;
        const chunkCount = session.chunks.length;
        if (recordedSourceRef.current?.chunkCount !== chunkCount) {
            const files = await readStoredChunkFiles(session);
            if (opfsSessionRef.current !== session)
                return null;
            const url = URL.createObjectURL(new Blob(files, { type: session.mimeType }));
            if (recordedSourceRef.current)
                URL.revokeObjectURL(recordedSourceRef.current.url);
            recordedSourceRef.current = { url, chunkCount };
        }
        return { url: recordedSourceRef.current!.url, kind: "audio", fileName: session.name };
    };
    const cleanupMicrophoneCapture = () => {
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
    };
    const tickWaveform = () => {
        const analyser = analyserRef.current;
        if (!analyser)
            return;
        const buffer = analyserBufferRef.current;
        analyser.getFloatTimeDomainData(buffer);
        const activityRms = getRms(buffer);
        const now = performance.now();
        if (now - lastActivityUpdateRef.current > 80) {
            lastActivityUpdateRef.current = now;
            // Written straight to the DOM: this changes too often to re-render the app for.
            waveformCanvasRef.current?.closest<HTMLElement>(".record-control")?.style.setProperty("--input-level", Math.min(1, activityRms * 8).toFixed(2));
        }
        const samples = createFloat32Buffer(buffer.length);
        samples.set(buffer);
        waveformWorkerRef.current?.postMessage({ type: "samples", samples }, [samples.buffer]);
        waveformRafRef.current = window.requestAnimationFrame(tickWaveform);
    };
    const startAnalyser = (stream: MediaStream, audioContext: AudioContext) => {
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
    };
    const ensureWorkerReady = () => {
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
    };
    const waitForWorkerIdle = () => {
        if (!workerIdlePromiseRef.current) {
            workerIdlePromiseRef.current = new Promise<void>((resolve, reject) => {
                workerIdleResolveRef.current = resolve;
                workerIdleRejectRef.current = reject;
            });
            worker.postMessage({ type: "flush" });
        }
        return workerIdlePromiseRef.current;
    };
    const stopPlayback = () => {
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
    };
    let localSpeech: ReturnType<typeof createLocalSpeechSession> | null = null;
    const releaseMicrophone = () => {
        streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
        streamRef.current = null;
    };
    const acquireWakeLock = async () => {
        try {
            wakeLockRef.current = await navigator.wakeLock?.request("screen") ?? null;
        }
        catch {
            // A sleeping screen may end capture, but refusal must not stop recording.
        }
    };
    const releaseWakeLock = () => {
        void wakeLockRef.current?.release().catch(() => { });
        wakeLockRef.current = null;
    };
    const canPersist = () => shouldRecordToOpfs && isOpfsRecordingAvailable;
    const saveCurrentSession = (closed = false) => {
        const session = sessionRef.current;
        if (!session)
            return sessionWritesRef.current;
        const pcm = recordedAudio.takeUnsaved();
        const recordingMs = machine.value === "recording" ? getElapsedMs() : 0;
        session.durationMs = Math.max(session.durationMs, recordingMs, state.transcriptParagraphs.at(-1)?.words.at(-1)?.endMs ?? 0);
        const snapshot: SavedSession = {
            version: 1,
            name: session.name,
            kind: session.kind,
            startedAt: session.startedAt,
            durationMs: session.durationMs,
            sampleRate: recordedAudio.sampleRateHz,
            engine: state.transcriptionEngine,
            paragraphs: state.transcriptParagraphs,
            locationTrack: state.locationTrack,
            media: session.media,
            closed
        };
        const pcmSequence = pcm ? session.pcmSequence++ : 0;
        sessionWritesRef.current = sessionWritesRef.current.then(async () => {
            if (pcm)
                await appendSessionAudio(session.name, pcmSequence, pcm);
            await saveSession(snapshot);
        }).catch((cause) => {
            setOpfsError(cause instanceof Error ? cause.message : "Unable to save this session.");
        });
        return sessionWritesRef.current;
    };
    const closeCurrentSession = async () => {
        if (autosaveTimerRef.current !== null) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
        const session = sessionRef.current;
        if (!session)
            return;
        const isEmpty = state.transcriptParagraphs.length === 0;
        await saveCurrentSession(true);
        sessionRef.current = null;
        if (isEmpty)
            await deleteStoredSession(session.name).catch(() => { });
    };
    const resetCaptureState = () => {
        localSpeech?.dispose();
        localSpeech = null;
        contextStore.send({ type: "isPaused", value: false });
        contextStore.send({ type: "isChangingCapture", value: false });
        pauseStartedAt = 0;
        pausedMilliseconds = 0;
        mediaRecorderRef.current = null;
        releaseWakeLock();
        cleanupMediaSource();
        stopAnalyser();
        geoLocationServiceRef.current.stop();
        releaseMicrophone();
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
        liveSpeechStartSecondsRef.current = 0;
        setIsPreparing(false);
        setIsRecording(false);
        setIsTranscribingMedia(false);
        setPartialText("");
    };
    const startOpfsRecording = async (mimeType: string) => {
        if (!isOpfsRecordingAvailable) {
            throw new Error("This browser does not support OPFS recording.");
        }
        const session = await createOpfsSession(mimeType);
        opfsSessionRef.current = session;
        opfsWriteQueueRef.current = Promise.resolve();
        opfsChunkSequenceRef.current = 0;
        opfsNextChunkStartMsRef.current = Date.now();
        setRecordingStartedAt(opfsNextChunkStartMsRef.current);
        sessionRef.current = { name: session.name, kind: "recording", startedAt: session.startedAt, durationMs: 0, pcmSequence: 0 };
        currentPartChunksRef.current = [];
        currentPartStartsAtRef.current = "";
        setOpfsSessionName(`recordings/${session.name}`);
        setOpfsChunkCount(0);
        setAudioParts([]);
        setOpfsError("");
    };
    const finalizeCurrentPart = () => {
        const activeSession = opfsSessionRef.current;
        if (!activeSession)
            return;
        opfsWriteQueueRef.current = opfsWriteQueueRef.current
            .then(async () => {
            const chunks = currentPartChunksRef.current;
            if (chunks.length === 0)
                return;
            const sequence = activeSession.parts.length;
            const first = chunks[0];
            const last = chunks[chunks.length - 1];
            const location = geoLocationServiceRef.current.finishPhrase();
            const part: StoredAudioPart = {
                name: `part-${sequence.toString().padStart(4, "0")}`,
                sequence,
                startIso: currentPartStartsAtRef.current || first.startIso,
                endIso: last.endIso,
                durationMs: Math.max(0, new Date(last.endIso).getTime() -
                    new Date(currentPartStartsAtRef.current || first.startIso).getTime()),
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
            setOpfsError(cause instanceof Error ? cause.message : "Unable to write audio part metadata.");
        });
    };
    const storeMediaRecorderChunk = (blob: Blob, voice: VoiceActivity) => {
        const activeSession = opfsSessionRef.current;
        if (!activeSession || !blob.size)
            return;
        const sequence = opfsChunkSequenceRef.current;
        const endMs = captureNow();
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
            setOpfsError(cause instanceof Error ? cause.message : "Unable to write audio chunk to OPFS.");
        });
    };
    const processPcmChunk = async (mono: Float32Array, sampleRate: number) => {
        recordedAudio.append(mono, sampleRate);
        if (recordedAudio.hasAudio && !state.hasRecordingAudio)
            contextStore.send({ type: "hasRecordingAudio", value: true });
        // Audio queues here while the engine gets ready, so speech is not lost to a slow start.
        await engineReadyRef.current;
        if (engineFailedRef.current)
            return;
        if (localSpeech) {
            // Keep recording PCM for playback/downloads without duplicate model results.
            latestVoiceRef.current = settings.vad.enabled
                ? await detectVoiceActivity(mono, sampleRate, settings.vad, adaptiveVadStateRef.current, sileroVadStateRef.current)
                : { hasSpeech: true, score: 1, trailingSilenceMs: 0, mode: "browser-local" };
            liveTranscribedSecondsRef.current += mono.length / sampleRate;
            return;
        }
        await ensureWorkerReady();
        const chunkStartSeconds = liveTranscribedSecondsRef.current;
        liveTranscribedSecondsRef.current += mono.length / sampleRate;
        if (!settings.vad.enabled) {
            latestVoiceRef.current = {
                hasSpeech: true,
                score: 1,
                trailingSilenceMs: 0,
                mode: "raw-audio"
            };
            if (liveSpeechBufferedSamplesRef.current === 0) {
                liveSpeechStartSecondsRef.current = chunkStartSeconds;
                liveSpeechStartsParagraphRef.current = nextSegmentStartsParagraphRef.current;
                nextSegmentStartsParagraphRef.current = false;
            }
            appendAudioChunk(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef, mono);
            const targetSamples = getSamplesForMs(sampleRate, isMoonshineModelId(settings.transcription.modelId)
                ? LIVE_ANALYSIS_CHUNK_MS
                : settings.audio.transcriptionChunkMs);
            if (liveSpeechBufferedSamplesRef.current >= targetSamples) {
                const speechAudio = consumeBufferedAudio(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef);
                const audio = concatAudio(tailRef.current, speechAudio);
                const offsetSeconds = Math.max(0, liveSpeechStartSecondsRef.current - (tailRef.current.length / sampleRate));
                const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
                tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
                worker.postMessage({
                    type: "transcribe",
                    audio,
                    sampleRate,
                    isFinal: false,
                    startsNewParagraph: liveSpeechStartsParagraphRef.current,
                    offsetSeconds
                }, [audio.buffer]);
                liveSpeechStartsParagraphRef.current = false;
            }
            return latestVoiceRef.current;
        }
        const voice = await detectVoiceActivity(mono, sampleRate, settings.vad, settings.vad.mode === "adaptive-rms" ? adaptiveVadStateRef.current : undefined, settings.vad.mode === "silero-vad" ? sileroVadStateRef.current : undefined);
        latestVoiceRef.current = voice;
        const targetSamples = getSamplesForMs(sampleRate, isMoonshineModelId(settings.transcription.modelId)
            ? LIVE_ANALYSIS_CHUNK_MS
            : settings.audio.transcriptionChunkMs);
        const paragraphSilenceSamples = getSamplesForMs(sampleRate, settings.vad.paragraphSilenceMs);
        if (voice.hasSpeech) {
            if (liveSpeechBufferedSamplesRef.current === 0) {
                liveSpeechStartSecondsRef.current = chunkStartSeconds;
                liveSpeechStartsParagraphRef.current = nextSegmentStartsParagraphRef.current;
                nextSegmentStartsParagraphRef.current = false;
            }
            appendAudioChunk(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef, mono);
            if (liveSpeechBufferedSamplesRef.current >= targetSamples) {
                const speechAudio = consumeBufferedAudio(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef);
                const audio = concatAudio(tailRef.current, speechAudio);
                const offsetSeconds = Math.max(0, liveSpeechStartSecondsRef.current - (tailRef.current.length / sampleRate));
                const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
                tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
                worker.postMessage({
                    type: "transcribe",
                    audio,
                    sampleRate,
                    isFinal: false,
                    startsNewParagraph: liveSpeechStartsParagraphRef.current,
                    offsetSeconds
                }, [audio.buffer]);
                liveSpeechStartsParagraphRef.current = false;
            }
            return voice;
        }
        if (liveSpeechBufferedSamplesRef.current > 0) {
            appendAudioChunk(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef, mono);
            if (voice.trailingSilenceMs >= settings.vad.paragraphSilenceMs ||
                liveSpeechBufferedSamplesRef.current >= targetSamples + paragraphSilenceSamples) {
                const speechAudio = consumeBufferedAudio(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef);
                const audio = concatAudio(tailRef.current, speechAudio);
                const offsetSeconds = Math.max(0, liveSpeechStartSecondsRef.current - (tailRef.current.length / sampleRate));
                const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
                tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
                worker.postMessage({
                    type: "transcribe",
                    audio,
                    sampleRate,
                    isFinal: false,
                    startsNewParagraph: liveSpeechStartsParagraphRef.current,
                    offsetSeconds
                }, [audio.buffer]);
                liveSpeechStartsParagraphRef.current = false;
                if (hasTranscriptRef.current) {
                    nextSegmentStartsParagraphRef.current = true;
                }
                setPartialText("");
                tailRef.current = new Float32Array();
            }
        }
        else {
            tailRef.current = new Float32Array();
            if (hasTranscriptRef.current) {
                nextSegmentStartsParagraphRef.current = true;
            }
            setPartialText("");
        }
        return voice;
    };
    const processUploadedPcmChunk = async (mono: Float32Array, sampleRate: number, startsNewParagraph: boolean, chunkOffsetSeconds: number, overlapMs = 0) => {
        if (mono.length === 0)
            return;
        const tailSeconds = tailRef.current.length / sampleRate;
        const audio = concatAudio(tailRef.current, mono);
        const overlapSamples = Math.floor(sampleRate * (overlapMs / 1000));
        tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
        worker.postMessage({
            type: "transcribe",
            audio,
            sampleRate,
            isFinal: false,
            startsNewParagraph,
            offsetSeconds: Math.max(0, chunkOffsetSeconds - tailSeconds)
        }, [audio.buffer]);
    };
    const flushMicrophonePcmCapture = async (sampleRate: number, disconnect = true) => {
        const pendingQueue = microphoneProcessQueueRef.current;
        if (disconnect) {
        microphoneProcessorNodeRef.current?.port.close();
        microphoneProcessorNodeRef.current?.disconnect();
        microphoneProcessorNodeRef.current = null;
        microphoneSilentGainRef.current?.disconnect();
        microphoneSilentGainRef.current = null;
        microphoneSourceRef.current?.disconnect();
        microphoneSourceRef.current = null;
        }
        await pendingQueue;
        const finalChunk = consumeBufferedAudio(microphonePcmChunksRef.current, microphonePcmBufferedSamplesRef);
        microphoneProcessQueueRef.current = Promise.resolve();
        if (finalChunk.length > 0) {
            await processPcmChunk(finalChunk, sampleRate);
        }
        if (liveSpeechBufferedSamplesRef.current > 0) {
            const speechAudio = consumeBufferedAudio(liveSpeechChunksRef.current, liveSpeechBufferedSamplesRef);
            const audio = concatAudio(tailRef.current, speechAudio);
            const offsetSeconds = Math.max(0, liveSpeechStartSecondsRef.current - (tailRef.current.length / sampleRate));
            const overlapSamples = Math.floor(sampleRate * (settings.audio.overlapMs / 1000));
            tailRef.current = audio.slice(Math.max(0, audio.length - overlapSamples));
            worker.postMessage({
                type: "transcribe",
                audio,
                sampleRate,
                isFinal: true,
                startsNewParagraph: liveSpeechStartsParagraphRef.current,
                offsetSeconds
            }, [audio.buffer]);
            liveSpeechStartsParagraphRef.current = false;
        }
    };
    const stop = async () => {
        if (!machine.send("STOP"))
            return;
        const sampleRate = audioContextRef.current?.sampleRate ?? 16000;
        const recorder = mediaRecorderRef.current;
        const stopped = recorder && recorder.state !== "inactive"
            ? new Promise<void>((resolve) => {
                recorder.addEventListener("stop", () => resolve(), { once: true });
                recorder.stop();
            })
            : Promise.resolve();
        mediaRecorderRef.current = null;
        try {
            await flushMicrophonePcmCapture(sampleRate);
            if (localSpeech) await localSpeech.stop();
            else await waitForWorkerIdle();
            await stopped;
            await opfsWriteQueueRef.current;
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to finish live transcription.");
        }
        resetCaptureState();
        await saveCurrentSession();
    };
    const startMicrophonePcmCapture = async (stream: MediaStream, audioContext: AudioContext) => {
        cleanupMicrophoneCapture();
        await audioContext.audioWorklet.addModule(new URL("./mediaChunkWorklet.js", import.meta.url));
        const source = audioContext.createMediaStreamSource(stream);
        const processor = new AudioWorkletNode(audioContext, "media-chunk-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
        });
        const silentGain = audioContext.createGain();
        const chunkSamples = Math.max(1, Math.floor(audioContext.sampleRate * (LIVE_ANALYSIS_CHUNK_MS / 1000)));
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);
        microphoneSourceRef.current = source;
        microphoneProcessorNodeRef.current = processor;
        microphoneSilentGainRef.current = silentGain;
        processor.port.onmessage = (event: MessageEvent<{
            type?: string;
            samples?: Float32Array;
        }>) => {
            if (event.data?.type !== "samples" || !event.data.samples)
                return;
            appendAudioChunk(microphonePcmChunksRef.current, microphonePcmBufferedSamplesRef, event.data.samples);
            microphoneProcessQueueRef.current = microphoneProcessQueueRef.current
                .then(async () => {
                while (microphonePcmBufferedSamplesRef.current >= chunkSamples) {
                    const chunk = consumeBufferedAudio(microphonePcmChunksRef.current, microphonePcmBufferedSamplesRef, chunkSamples);
                    await processPcmChunk(chunk, audioContext.sampleRate);
                }
            })
                .catch((cause) => {
                setError(cause instanceof Error ? cause.message : "Live transcription failed.");
            });
        };
    };
    const watchMicrophone = (stream: MediaStream) => {
        for (const track of stream.getAudioTracks()) {
            track.onended = () => {
                void pause().then(() => {
                    contextStore.send({ type: "error", value: "The microphone was disconnected. Reconnect it and press Resume to continue." });
                });
            };
        }
    };
    const startMediaRecorder = (stream: MediaStream) => {
        const recorder = new MediaRecorder(stream, {
            mimeType: getSupportedMimeType()
        });
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
            const voice = latestVoiceRef.current;
            if (voice) {
                storeMediaRecorderChunk(event.data, voice);
                if (!voice.hasSpeech ||
                    voice.trailingSilenceMs >= settings.vad.partSilenceMs) {
                    finalizeCurrentPart();
                }
            }
        };
        recorder.onstop = () => {
            finalizeCurrentPart();
            worker.postMessage({ type: "flush" });
        };
        recorder.start(opfsChunkMs);
    };
    /** Use on-device Speech when processLocally is available, otherwise the selected model. */
    const prepareEngine = async (stream: MediaStream) => {
        // Translation still needs the selected model; browser recognition only transcribes.
        const recognition = settings.transcription.task === "transcribe"
            ? await prepareLocalSpeechRecognition(settings.transcription.language)
            : null;
        if (streamRef.current !== stream)
            return;
        if (recognition) {
            // Recognition results arrive late, so the first partial best marks when speech began.
            let resultStartMs: number | null = null;
            let resultEndMs = 0;
            const capturedMs = () => liveTranscribedSecondsRef.current * 1000;
            localSpeech = createLocalSpeechSession(recognition, stream.getAudioTracks()[0], {
                onFinal: (text) => {
                    const words = estimateWordTimings(text, resultStartMs ?? resultEndMs, capturedMs());
                    resultStartMs = null;
                    resultEndMs = words.at(-1)?.endMs ?? resultEndMs;
                    hasTranscriptRef.current = true;
                    setTranscriptParagraphs((current) => {
                        const next = [...current, { id: `p-${transcriptParagraphSequenceRef.current++}`, text, words }];
                        setParagraphs(next.map((paragraph) => paragraph.text));
                        return next;
                    });
                },
                onPartial: (text) => {
                    if (text && resultStartMs === null)
                        resultStartMs = Math.max(resultEndMs, capturedMs() - LIVE_ANALYSIS_CHUNK_MS);
                    setPartialText(text);
                },
                onError: (message) => {
                    if (!canUseSelectedModel()) {
                        void stop();
                        contextStore.send({ type: "error", value: message });
                        return;
                    }
                    localSpeech?.dispose();
                    localSpeech = null;
                    setPartialText("");
                    contextStore.send({ type: "transcriptionEngine", value: settings.transcription.modelId });
                    setProgress("Switching to the selected on-device transcription model...");
                    void ensureWorkerReady().catch((cause) => {
                        setError(cause instanceof Error ? cause.message : message);
                    });
                }
            });
            try {
                await localSpeech.start();
                contextStore.send({ type: "transcriptionEngine", value: "speech" });
                return;
            }
            catch {
                localSpeech.dispose();
                localSpeech = null;
            }
        }
        if (!canUseSelectedModel())
            throw new Error("Local browser speech recognition is unavailable and the selected model is not supported in this browser context.");
        contextStore.send({ type: "transcriptionEngine", value: settings.transcription.modelId });
        if (!isModelCachedRef.current) {
            setModelLoadProgress(0);
            setModelLoadMessage(hasCheckedModelCacheRef.current ? "Checking model files..." : "Checking model cache...");
        }
        await ensureWorkerReady();
    };
    const start = async () => {
        if (!machine.can("PREPARE"))
            return;
        setError("");
        setIsPreparing(true);
        pauseStartedAt = 0;
        pausedMilliseconds = 0;
        contextStore.send({ type: "isPaused", value: false });
        await closeCurrentSession();
        clearSourceMedia();
        setParagraphs([]);
        setTranscriptParagraphs([]);
        setPartialText("");
        hasTranscriptRef.current = false;
        transcriptParagraphSequenceRef.current = 0;
        contextStore.send({ type: "transcriptionEngine", value: "" });
        if (!isTranscriptionSupported) {
            setIsPreparing(false);
            setError("The selected transcription model is not supported in this browser context.");
            return;
        }
        try {
            const stream = await getMicrophoneStream(settings);
            streamRef.current = stream;
            watchMicrophone(stream);
            latestVoiceRef.current = {
                hasSpeech: false,
                score: 0,
                trailingSilenceMs: 0,
                mode: "unknown"
            };
            adaptiveVadStateRef.current = { noiseFloor: null };
            engineFailedRef.current = false;
            engineReadyRef.current = prepareEngine(stream).catch((cause) => {
                engineFailedRef.current = true;
                resetCaptureState();
                worker.postMessage({ type: "flush" });
                contextStore.send({ type: "error", value: cause instanceof Error ? cause.message : "Unable to start transcription." });
            });
            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;
            startAnalyser(stream, audioContext);
            await startMicrophonePcmCapture(stream, audioContext);
            setRecordingStartedAt(Date.now());
            if (shouldRecordToOpfs && isOpfsRecordingAvailable) {
                await startOpfsRecording(getSupportedMimeType());
                startMediaRecorder(stream);
            }
            geoLocationServiceRef.current.start();
            setMediaTranscriptionProgress(0);
            setIsRecording(true);
            setIsPreparing(false);
            void acquireWakeLock();
        }
        catch (cause) {
            resetCaptureState();
            worker.postMessage({ type: "flush" });
            setError(cause instanceof Error ? cause.message : "Unable to start recording.");
        }
    };
    /** Pausing is a real release: the microphone, location and wake lock all stop until Resume. */
    const pause = async () => {
        const context = audioContextRef.current;
        if (!context || state.isPaused || state.isChangingCapture || machine.value !== "recording") return;
        contextStore.send({ type: "isChangingCapture", value: true });
        try {
            await engineReadyRef.current;
            await context.suspend();
            pauseStartedAt = Date.now();
            const media = mediaRecorderRef.current;
            mediaRecorderRef.current = null;
            if (media && media.state !== "inactive") {
                await new Promise<void>((resolve) => {
                    media.addEventListener("stop", () => resolve(), { once: true });
                    media.stop();
                });
            }
            stopAnalyser();
            microphoneSourceRef.current?.disconnect();
            microphoneSourceRef.current = null;
            releaseMicrophone();
            geoLocationServiceRef.current.stop();
            releaseWakeLock();
            contextStore.send({ type: "isPaused", value: true });
            // Finish captured words without disconnecting or resetting the session.
            await flushMicrophonePcmCapture(context.sampleRate, false);
            if (localSpeech) await localSpeech.stop();
            else {
                worker.postMessage({ type: "flush" });
                await waitForWorkerIdle();
            }
            await opfsWriteQueueRef.current;
            tailRef.current = new Float32Array();
            nextSegmentStartsParagraphRef.current = hasTranscriptRef.current;
            liveSpeechStartsParagraphRef.current = hasTranscriptRef.current;
            await saveCurrentSession();
        } catch (cause) {
            contextStore.send({ type: "error", value: cause instanceof Error ? cause.message : "Unable to pause recording." });
        } finally {
            contextStore.send({ type: "isChangingCapture", value: false });
        }
    };
    const resume = async () => {
        const context = audioContextRef.current;
        if (!context || !state.isPaused || state.isChangingCapture) return;
        contextStore.send({ type: "isChangingCapture", value: true });
        try {
            const stream = await getMicrophoneStream(settings);
            streamRef.current = stream;
            watchMicrophone(stream);
            const source = context.createMediaStreamSource(stream);
            if (microphoneProcessorNodeRef.current)
                source.connect(microphoneProcessorNodeRef.current);
            microphoneSourceRef.current = source;
            startAnalyser(stream, context);
            await context.resume();
            pausedMilliseconds += Date.now() - pauseStartedAt;
            pauseStartedAt = 0;
            if (shouldRecordToOpfs && isOpfsRecordingAvailable && opfsSessionRef.current)
                startMediaRecorder(stream);
            geoLocationServiceRef.current.resume();
            void acquireWakeLock();
            contextStore.send({ type: "error", value: "" });
            if (localSpeech) await localSpeech.start(stream.getAudioTracks()[0]);
            contextStore.send({ type: "isPaused", value: false });
        } catch (cause) {
            contextStore.send({ type: "error", value: cause instanceof Error ? cause.message : "Unable to resume recording." });
        } finally {
            contextStore.send({ type: "isChangingCapture", value: false });
        }
    };
    const cacheModel = () => {
        setError("");
        setModelLoadProgress(0);
        setModelLoadMessage(state.isModelCached ? "Transcription model is already available offline." : "Preparing offline transcription model cache...");
        setModelCacheStatus(state.isModelCached ? "Transcription model available offline." : "Preparing offline transcription model cache...");
        if (state.isModelCached) {
            setIsModelLoading(false);
            return;
        }
        worker.postMessage({ type: "warm-cache" });
    };
    /** Decode without playing, including video containers, so long files take far less than real time. */
    const decodeMediaFile = async (file: File) => {
        if (file.size > MAX_DECODABLE_MEDIA_BYTES)
            return null;
        const audioContext = new AudioContext({ sampleRate: 16000 });
        try {
            const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
            audioContextRef.current = audioContext;
            return decoded;
        }
        catch {
            void audioContext.close();
            return null;
        }
    };
    const transcribeDecodedAudio = async (file: File, decoded: AudioBuffer) => {
        const mono = toMono(decoded);
        let startsNewParagraph = false;
        let offset = 0;
        while (offset < mono.length && !mediaCancelRef.current) {
            const end = await getUploadedMediaSplitEnd(mono, offset, decoded.sampleRate, settings, true);
            if (end === null)
                break;
            const chunk = mono.slice(offset, end);
            await processUploadedPcmChunk(chunk, decoded.sampleRate, startsNewParagraph, offset / decoded.sampleRate);
            startsNewParagraph = true;
            offset = end;
            const percent = Math.round((end / mono.length) * 100);
            setMediaTranscriptionProgress(percent);
            setProgress(`Transcribing ${file.name} ${percent}%`);
            await yieldToBrowser();
        }
        if (mediaCancelRef.current)
            return;
        setMediaTranscriptionProgress(100);
        await waitForWorkerIdle();
    };
    const transcribePlayableMediaFile = async (file: File) => {
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
        processor.port.onmessage = (event: MessageEvent<{
            type?: string;
            samples?: Float32Array;
        }>) => {
            if (isEnded)
                return;
            if (event.data?.type !== "samples" || !event.data.samples)
                return;
            buffered = concatAudio(buffered, event.data.samples);
            processQueue = processQueue.then(async () => {
                while (buffered.length >= minChunkSamples) {
                    const splitEnd = await getBufferedUploadedMediaSplitEnd(buffered, audioContext.sampleRate, minChunkSamples, settings);
                    if (splitEnd === null)
                        break;
                    const chunk = buffered.slice(0, splitEnd);
                    buffered = buffered.slice(splitEnd);
                    await processUploadedPcmChunk(chunk, audioContext.sampleRate, startsNewParagraph, Math.max(0, media.currentTime - (chunk.length / audioContext.sampleRate)));
                    startsNewParagraph = true;
                }
            }).catch((cause) => {
                setError(cause instanceof Error ? cause.message : "Unable to continue media transcription.");
            });
        };
        await new Promise<void>((resolve, reject) => {
            cancelPlayableMediaRef.current = () => {
                isEnded = true;
                media.pause();
                resolve();
            };
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
                        await processUploadedPcmChunk(finalChunk, audioContext.sampleRate, startsNewParagraph, Math.max(0, media.duration - (finalChunk.length / audioContext.sampleRate)));
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
    };
    const transcribeMediaFile = async (file: File) => {
        if (state.isPaused)
            await stop();
        if (!machine.can("PREPARE"))
            return;
        if (!canUseSelectedModel()) {
            setError("The selected transcription model is not supported in this browser context.");
            return;
        }
        setError("");
        setProgress(`Preparing ${file.name}...`);
        setMediaTranscriptionProgress(0);
        setMediaFileName(file.name);
        setIsPreparing(true);
        setIsRecording(true);
        setIsTranscribingMedia(true);
        mediaCancelRef.current = false;
        await closeCurrentSession();
        clearSourceMedia();
        setParagraphs([]);
        setTranscriptParagraphs([]);
        setPartialText("");
        hasTranscriptRef.current = false;
        transcriptParagraphSequenceRef.current = 0;
        const kind = file.type.startsWith("video/") ? "video" : "audio";
        contextStore.send({ type: "transcriptionEngine", value: settings.transcription.modelId });
        const nextSourceUrl = URL.createObjectURL(file);
        sourceMediaUrlRef.current = nextSourceUrl;
        setSourceMedia({
            url: nextSourceUrl,
            kind,
            fileName: file.name
        });
        if (!state.isModelCached) {
            setModelLoadProgress(0);
            setModelLoadMessage(state.hasCheckedModelCache ? "Checking model files..." : "Checking model cache...");
        }
        try {
            if (canPersist()) {
                const session = await createOpfsSession(file.type);
                await saveSessionMedia(session.name, file);
                sessionRef.current = {
                    name: session.name,
                    kind: "upload",
                    startedAt: session.startedAt,
                    durationMs: 0,
                    media: { fileName: file.name, kind, type: file.type },
                    pcmSequence: 0
                };
            }
            await ensureWorkerReady();
            const decoded = await decodeMediaFile(file);
            if (decoded) {
                await transcribeDecodedAudio(file, decoded);
            }
            else if (!mediaCancelRef.current) {
                await transcribePlayableMediaFile(file);
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to transcribe that media file.");
        }
        finally {
            cancelPlayableMediaRef.current = null;
            cleanupMediaSource();
            stopAnalyser();
            releaseMicrophone();
            audioContextRef.current?.close();
            audioContextRef.current = null;
            tailRef.current = new Float32Array();
            nextSegmentStartsParagraphRef.current = false;
            setIsPreparing(false);
            setIsRecording(false);
            setIsTranscribingMedia(false);
            setMediaTranscriptionProgress(0);
            setProgress("");
            await saveCurrentSession();
        }
    };
    /** Keeps whatever has been transcribed so far and drops anything still queued in the worker. */
    const cancelMediaTranscription = () => {
        if (machine.value !== "transcribing" || mediaCancelRef.current)
            return;
        mediaCancelRef.current = true;
        ignoreWorkerResultsRef.current = true;
        setPartialText("");
        worker.postMessage({ type: "flush" });
        cancelPlayableMediaRef.current?.();
    };
    const editSentence = (sentence: TranscriptSentence, text: string) => {
        setTranscriptParagraphs((current) => {
            const next = current
                .map((paragraph) => paragraph.id === sentence.paragraphId ? replaceSentenceText(paragraph, sentence, text) : paragraph)
                .filter((paragraph) => paragraph.text.length > 0);
            setParagraphs(next.map((paragraph) => paragraph.text));
            return next;
        });
    };
    const listSessions = async () => canPersist() ? listStoredSessions() : [];
    const openSession = async (name: string) => {
        if (!machine.can("PREPARE"))
            return;
        await closeCurrentSession();
        const { session, pcmParts, media } = await loadSession(name);
        clearSourceMedia();
        setError("");
        setPartialText("");
        hasTranscriptRef.current = session.paragraphs.length > 0;
        transcriptParagraphSequenceRef.current = session.paragraphs.reduce((highest, paragraph) => Math.max(highest, Number(paragraph.id.slice(2)) + 1 || 0), session.paragraphs.length);
        setTranscriptParagraphs(session.paragraphs);
        setParagraphs(session.paragraphs.map((paragraph) => paragraph.text));
        contextStore.send({ type: "locationTrack", value: session.locationTrack });
        contextStore.send({ type: "transcriptionEngine", value: session.engine });
        setRecordingStartedAt(session.startedAt);
        if (pcmParts.length) {
            recordedAudio.restore(pcmParts, session.sampleRate);
            contextStore.send({ type: "hasRecordingAudio", value: true });
        }
        if (media && session.media) {
            sourceMediaUrlRef.current = URL.createObjectURL(media);
            setSourceMedia({ url: sourceMediaUrlRef.current, kind: session.media.kind, fileName: session.media.fileName });
        }
        sessionRef.current = {
            name: session.name,
            kind: session.kind,
            startedAt: session.startedAt,
            durationMs: session.durationMs,
            media: session.media,
            pcmSequence: pcmParts.length
        };
        await saveCurrentSession();
    };
    const deleteSession = async (name: string) => {
        if (sessionRef.current?.name === name) {
            sessionRef.current = null;
            if (machine.can("PREPARE"))
                clear();
        }
        await sessionWritesRef.current;
        await deleteStoredSession(name);
    };
    /** There is no Stop in the UI: starting something new is what ends a session. */
    const newSession = async () => {
        if (machine.value === "recording")
            await stop();
        await closeCurrentSession();
        clear();
    };
    const restoreUnfinishedSession = async () => {
        if (!canPersist())
            return;
        try {
            const [latest] = await listStoredSessions();
            if (latest && !latest.closed && machine.value === "idle" && state.transcriptParagraphs.length === 0)
                await openSession(latest.name);
        }
        catch {
            // A damaged or unavailable store must not stop the app from starting.
        }
    };
    const playOpfsRecording = async () => {
        const activeSession = opfsSessionRef.current;
        if (!activeSession || activeSession.chunks.length === 0)
            return;
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
        }
        catch (cause) {
            stopPlayback();
            setOpfsError(cause instanceof Error ? cause.message : "Unable to play the OPFS recording.");
        }
    };
    const downloadBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const downloadFullRecording = async () => {
        const activeSession = opfsSessionRef.current;
        if (!activeSession || activeSession.chunks.length === 0)
            return;
        try {
            setOpfsError("");
            await opfsWriteQueueRef.current;
            const files = await readStoredChunkFiles(activeSession);
            const source = new Blob(files, { type: activeSession.mimeType });
            const exported = await exportRecordingBlob(source, settings.audio.recordingExportFormat, setProgress);
            const extension = getRecordingExportExtension(settings.audio.recordingExportFormat, activeSession.mimeType);
            downloadBlob(exported, `${activeSession.name}.${extension}`);
        }
        catch (cause) {
            setOpfsError(cause instanceof Error ? cause.message : "Unable to export recording.");
        }
        finally {
            setProgress("");
        }
    };
    const downloadPart = async (part: StoredAudioPart) => {
        const activeSession = opfsSessionRef.current;
        if (!activeSession)
            return;
        try {
            setOpfsError("");
            await opfsWriteQueueRef.current;
            const files = await readStoredChunkFiles(activeSession, part.chunks);
            const source = new Blob(files, { type: activeSession.mimeType });
            const exported = await exportRecordingBlob(source, settings.audio.recordingExportFormat, setProgress);
            const extension = getRecordingExportExtension(settings.audio.recordingExportFormat, activeSession.mimeType);
            downloadBlob(exported, `${activeSession.name}-${part.name}.${extension}`);
        }
        catch (cause) {
            setOpfsError(cause instanceof Error ? cause.message : "Unable to export recording part.");
        }
        finally {
            setProgress("");
        }
    };
    const clear = () => {
        setParagraphs([]);
        setTranscriptParagraphs([]);
        setPartialText("");
        setError("");
        hasTranscriptRef.current = false;
        nextSegmentStartsParagraphRef.current = false;
        transcriptParagraphSequenceRef.current = 0;
        contextStore.send({ type: "transcriptionEngine", value: "" });
        clearSourceMedia();
    };
    const snapshot = () => ({
        error: state.error,
        isOpfsRecordingAvailable,
        isOpfsPlaybackAvailable,
        isPlayingRecording: state.isPlayingRecording,
        isPaused: state.isPaused,
        isChangingCapture: state.isChangingCapture,
        isModelLoading: state.isModelLoading,
        isPreparing: (machine.value === "preparing" || machine.value === "transcribing"),
        isRecording: (machine.value === "recording" || machine.value === "transcribing" || machine.value === "stopping"),
        isTranscribingMedia: (machine.value === "transcribing"),
        isTranscriptionSupported,
        requiresCrossOriginIsolation,
        requiresWebGpu,
        runtimeSupport,
        mediaFileName: state.mediaFileName,
        opfsChunkCount: state.opfsChunkCount,
        opfsChunkMs,
        opfsError: state.opfsError,
        opfsSessionName: state.opfsSessionName,
        modelCacheStatus: state.modelCacheStatus,
        modelInventory: state.modelInventory,
        modelInventoryMessage: state.modelInventoryMessage,
        modelDownloadSpeedBps: getEstimatedDownloadSpeedBps(state.modelDownloadSpeedBps, persistedDownloadSpeedBpsRef.current),
        modelLoadMessage: state.modelLoadMessage,
        modelLoadProgress: state.modelLoadProgress,
        modelLoadTransferredBytes: state.modelLoadTransferredBytes,
        modelLoadTotalBytes: state.modelLoadTotalBytes,
        isModelCached: state.isModelCached,
        audioParts: state.audioParts,
        partialText: state.partialText,
        progress: state.progress,
        mediaTranscriptionProgress: state.mediaTranscriptionProgress,
        sourceMedia: state.sourceMedia,
        hasRecordingAudio: state.hasRecordingAudio,
        recordingStartedAt: state.recordingStartedAt,
        locationTrack: state.locationTrack,
        locationStatus: state.locationStatus,
        transcriptionEngine: state.transcriptionEngine,
        getElapsedMs,
        getRecordingSourceMedia,
        paragraphs: state.paragraphs,
        transcriptParagraphs: state.transcriptParagraphs,
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
        pause,
        resume,
        transcribeMediaFile,
        cancelMediaTranscription,
        editSentence,
        listSessions,
        openSession,
        deleteSession,
        newSession,
        clear
    });
    const listeners = new Set<() => void>();
    function refresh() {
        runtimeSupport = getTranscriptionRuntimeSupport();
        requiresWebGpu = !isWasmTranscriptionModelId(settings.transcription.modelId) &&
            !isMoonshineModelId(settings.transcription.modelId);
        requiresCrossOriginIsolation = isMoonshineModelId(settings.transcription.modelId);
        isTranscriptionSupported = canUseSelectedModel() ||
            (runtimeSupport.isSecureContext && settings.transcription.task === "transcribe" && supportsLocalSpeechRecognition());
        isOpfsRecordingAvailable = canUseOpfsRecording();
        isOpfsPlaybackAvailable = canUseOpfsPlayback();
        opfsChunkMs = settings.audio.opfsChunkMs;
        shouldRecordToOpfs = settings.recording.shouldRecordToOpfs;
        scope.watch("model-configuration", [settings.transcription, worker], () => {
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
            setModelCacheStatus("Checking offline transcription model cache...");
            setModelLoadTransferredBytes(0);
            setModelLoadTotalBytes(0);
            worker.postMessage({ type: "configure", transcription: settings.transcription });
            worker.postMessage({ type: "cache-status" });
            worker.postMessage({ type: "catalog-status" });
        });
        scope.watch("worker-messages", [resetCaptureState, worker], () => {
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
                    setModelLoadMessage("Transcription model is ready.");
                    setProgress("");
                    setIsModelCached(true);
                    setModelCacheStatus("Transcription model available offline.");
                    worker.postMessage({ type: "catalog-status" });
                }
                if (data.type === "idle") {
                    ignoreWorkerResultsRef.current = false;
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
                if (data.type === "partial" && !ignoreWorkerResultsRef.current) {
                    setPartialText(data.text);
                }
                if (data.type === "segment" && !ignoreWorkerResultsRef.current) {
                    setPartialText("");
                    const normalized = data.text.trim();
                    if (!normalized)
                        return;
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
                        setModelLoadMessage("Transcription model is already available offline.");
                        setModelCacheStatus("Transcription model available offline.");
                        setModelLoadTransferredBytes(data.sizeBytes ?? data.cachedBytes ?? 0);
                        setModelLoadTotalBytes(data.sizeBytes ?? data.cachedBytes ?? 0);
                    }
                    else if (data.totalFiles > 0) {
                        setIsModelCached(false);
                        setModelCacheStatus(`Transcription model will download once. ${data.cachedFiles}/${data.totalFiles} files are already available offline.`);
                        setModelLoadTransferredBytes(data.cachedBytes ?? 0);
                        setModelLoadTotalBytes(data.sizeBytes ?? 0);
                    }
                    else {
                        setModelCacheStatus(data.message ?? "Transcription model cache status unavailable.");
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
        });
        scope.watch("session-autosave", [state.transcriptParagraphs, state.locationTrack], () => {
            if (!sessionRef.current || autosaveTimerRef.current !== null)
                return;
            autosaveTimerRef.current = window.setTimeout(() => {
                autosaveTimerRef.current = null;
                void saveCurrentSession();
            }, AUTOSAVE_DELAY_MS);
        });
        scope.watch("page-lifecycle", [], () => {
            const onVisibilityChange = () => {
                if (document.visibilityState === "hidden") {
                    void saveCurrentSession();
                }
                else if (machine.value === "recording" && !state.isPaused) {
                    // Browsers drop the wake lock whenever the page is hidden.
                    void acquireWakeLock();
                }
            };
            const onPageHide = () => { void saveCurrentSession(); };
            document.addEventListener("visibilitychange", onVisibilityChange);
            window.addEventListener("pagehide", onPageHide);
            return () => {
                document.removeEventListener("visibilitychange", onVisibilityChange);
                window.removeEventListener("pagehide", onPageHide);
            };
        });
        scope.watch("capture-lifetime", [cleanupMediaSource, cleanupMicrophoneCapture, clearSourceMedia, disposeWaveformWorker, stopAnalyser, stopPlayback], () => {
            return () => {
                localSpeech?.dispose();
                localSpeech = null;
                stopPlayback();
                stopAnalyser();
                cleanupMicrophoneCapture();
                cleanupMediaSource();
                clearSourceMedia();
                disposeWaveformWorker();
                geoLocationServiceRef.current.stop();
                releaseWakeLock();
                if (autosaveTimerRef.current !== null)
                    window.clearTimeout(autosaveTimerRef.current);
            };
        });
        scope.flush();
        for (const listener of listeners)
            listener();
    }
    scope.setRefresh(refresh);
    refresh();
    void restoreUnfinishedSession();
    let previousInputs: readonly unknown[] = initialInputs;
    return {
        get error() { return snapshot().error; },
        get isOpfsRecordingAvailable() { return snapshot().isOpfsRecordingAvailable; },
        get isOpfsPlaybackAvailable() { return snapshot().isOpfsPlaybackAvailable; },
        get isPlayingRecording() { return snapshot().isPlayingRecording; },
        get isPaused() { return snapshot().isPaused; },
        get isChangingCapture() { return snapshot().isChangingCapture; },
        get isModelLoading() { return snapshot().isModelLoading; },
        get isPreparing() { return snapshot().isPreparing; },
        get isRecording() { return snapshot().isRecording; },
        get isTranscribingMedia() { return snapshot().isTranscribingMedia; },
        get isTranscriptionSupported() { return snapshot().isTranscriptionSupported; },
        get requiresCrossOriginIsolation() { return snapshot().requiresCrossOriginIsolation; },
        get requiresWebGpu() { return snapshot().requiresWebGpu; },
        get runtimeSupport() { return snapshot().runtimeSupport; },
        get mediaFileName() { return snapshot().mediaFileName; },
        get opfsChunkCount() { return snapshot().opfsChunkCount; },
        get opfsChunkMs() { return snapshot().opfsChunkMs; },
        get opfsError() { return snapshot().opfsError; },
        get opfsSessionName() { return snapshot().opfsSessionName; },
        get modelCacheStatus() { return snapshot().modelCacheStatus; },
        get modelInventory() { return snapshot().modelInventory; },
        get modelInventoryMessage() { return snapshot().modelInventoryMessage; },
        get modelDownloadSpeedBps() { return snapshot().modelDownloadSpeedBps; },
        get modelLoadMessage() { return snapshot().modelLoadMessage; },
        get modelLoadProgress() { return snapshot().modelLoadProgress; },
        get modelLoadTransferredBytes() { return snapshot().modelLoadTransferredBytes; },
        get modelLoadTotalBytes() { return snapshot().modelLoadTotalBytes; },
        get isModelCached() { return snapshot().isModelCached; },
        get audioParts() { return snapshot().audioParts; },
        get partialText() { return snapshot().partialText; },
        get progress() { return snapshot().progress; },
        get mediaTranscriptionProgress() { return snapshot().mediaTranscriptionProgress; },
        get sourceMedia() { return snapshot().sourceMedia; },
        get hasRecordingAudio() { return snapshot().hasRecordingAudio; },
        get recordingStartedAt() { return snapshot().recordingStartedAt; },
        get locationTrack() { return snapshot().locationTrack; },
        get locationStatus() { return snapshot().locationStatus; },
        get transcriptionEngine() { return snapshot().transcriptionEngine; },
        get getElapsedMs() { return snapshot().getElapsedMs; },
        get getRecordingSourceMedia() { return snapshot().getRecordingSourceMedia; },
        get paragraphs() { return snapshot().paragraphs; },
        get transcriptParagraphs() { return snapshot().transcriptParagraphs; },
        get vadMode() { return snapshot().vadMode; },
        get setWaveformCanvas() { return snapshot().setWaveformCanvas; },
        get shouldRecordToOpfs() { return snapshot().shouldRecordToOpfs; },
        get cacheModel() { return snapshot().cacheModel; },
        get downloadFullRecording() { return snapshot().downloadFullRecording; },
        get downloadPart() { return snapshot().downloadPart; },
        get playOpfsRecording() { return snapshot().playOpfsRecording; },
        get stopPlayback() { return snapshot().stopPlayback; },
        get start() { return snapshot().start; },
        get stop() { return snapshot().stop; },
        get pause() { return snapshot().pause; },
        get resume() { return snapshot().resume; },
        get transcribeMediaFile() { return snapshot().transcribeMediaFile; },
        get cancelMediaTranscription() { return snapshot().cancelMediaTranscription; },
        get editSentence() { return snapshot().editSentence; },
        get listSessions() { return snapshot().listSessions; },
        get openSession() { return snapshot().openSession; },
        get deleteSession() { return snapshot().deleteSession; },
        get newSession() { return snapshot().newSession; },
        get clear() { return snapshot().clear; },
        get machine() { return machine; },
        update(...inputs: [
            settings: RuntimeSettings
        ]) { if (sameInputs(previousInputs, inputs))
            return; previousInputs = inputs; [settings] = inputs; refresh(); },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { scope.dispose(); listeners.clear(); }
    };
}
function readPersistedModelDownloadSpeed() {
    try {
        const raw = window.localStorage.getItem(MODEL_SPEED_STORAGE_KEY);
        if (!raw)
            return getNavigatorDownloadSpeedEstimate();
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : getNavigatorDownloadSpeedEstimate();
    }
    catch {
        return getNavigatorDownloadSpeedEstimate();
    }
}
function persistModelDownloadSpeed(value: number) {
    try {
        window.localStorage.setItem(MODEL_SPEED_STORAGE_KEY, String(Math.round(value)));
    }
    catch {
        // Ignore storage failures and keep the in-memory estimate.
    }
}
function getNavigatorDownloadSpeedEstimate() {
    const connection = (navigator as Navigator & {
        connection?: {
            downlink?: number;
        };
    }).connection;
    if (!connection?.downlink || connection.downlink <= 0)
        return 0;
    return (connection.downlink * 1000000) / 8;
}
function getEstimatedDownloadSpeedBps(liveBytesPerSecond: number, persistedBytesPerSecond: number) {
    if (liveBytesPerSecond > 0)
        return liveBytesPerSecond;
    if (persistedBytesPerSecond > 0)
        return persistedBytesPerSecond;
    return getNavigatorDownloadSpeedEstimate();
}
function getSupportedMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
function getSamplesForMs(sampleRate: number, ms: number) {
    return Math.max(1, Math.floor(sampleRate * (ms / 1000)));
}
async function getUploadedMediaSplitEnd(audio: Float32Array, offset: number, sampleRate: number, settings: RuntimeSettings, allowPartialFinalChunk: boolean) {
    const remainingSamples = audio.length - offset;
    const minSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_MIN_CHUNK_MS);
    const maxSamples = getSamplesForMs(sampleRate, Math.max(UPLOADED_MEDIA_TARGET_CHUNK_MS, WHISPER_CONTEXT_MS));
    if (remainingSamples <= 0)
        return offset;
    if (remainingSamples < minSamples) {
        return allowPartialFinalChunk ? audio.length : null;
    }
    if (settings.vad.enabled && settings.vad.mode === "silero-vad") {
        const searchStart = offset + minSamples;
        const searchEnd = Math.min(audio.length, offset + maxSamples);
        const quietSamples = getSamplesForMs(sampleRate, settings.vad.partSilenceMs);
        const boundary = await findVadBoundaryEnd(audio, offset, searchStart, searchEnd, sampleRate, quietSamples, settings.vad.silero.modelId);
        if (boundary !== null)
            return boundary;
    }
    if (remainingSamples >= maxSamples) {
        return offset + maxSamples;
    }
    if (allowPartialFinalChunk)
        return audio.length;
    return null;
}
async function getBufferedUploadedMediaSplitEnd(audio: Float32Array, sampleRate: number, minSamples: number, settings: RuntimeSettings) {
    if (audio.length < minSamples)
        return null;
    const targetSamples = getSamplesForMs(sampleRate, UPLOADED_MEDIA_TARGET_CHUNK_MS);
    if (settings.vad.enabled && settings.vad.mode === "silero-vad") {
        const quietSamples = getSamplesForMs(sampleRate, settings.vad.partSilenceMs);
        const boundary = await findVadBoundaryEnd(audio, 0, minSamples, Math.min(audio.length, targetSamples), sampleRate, quietSamples, settings.vad.silero.modelId);
        if (boundary !== null)
            return boundary;
    }
    if (audio.length >= targetSamples) {
        return targetSamples;
    }
    return null;
}
function appendAudioChunk(chunks: Float32Array[], sampleCountRef: {
    current: number;
}, chunk: Float32Array) {
    if (chunk.length === 0)
        return;
    chunks.push(chunk);
    sampleCountRef.current += chunk.length;
}
function consumeBufferedAudio(chunks: Float32Array[], sampleCountRef: {
    current: number;
}, maxSamples = sampleCountRef.current) {
    const targetSamples = Math.max(0, Math.min(sampleCountRef.current, maxSamples));
    if (targetSamples === 0)
        return new Float32Array();
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
    if (!left)
        return right;
    if (!right)
        return left;
    if (left.endsWith(right))
        return left;
    if (right.startsWith(left))
        return right;
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
function mergeTranscriptParagraphs(current: TranscriptParagraph[], incomingText: string, incomingWords: TranscriptWord[], startsNewParagraph: boolean, options: {
    nextParagraphId: () => string;
}) {
    if (startsNewParagraph || current.length === 0) {
        if (current.at(-1)?.text === incomingText)
            return current;
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
    if (previous.length === 0)
        return incoming;
    if (incoming.length === 0)
        return previous;
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
    }
    catch (cause) {
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
    if (!deviceId)
        return false;
    if (!(cause instanceof DOMException))
        return false;
    return cause.name === "NotFoundError" || cause.name === "OverconstrainedError";
}
