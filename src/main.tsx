import { createRoot } from "react-dom/client";
import { Circle, Minus, Plus, SlidersHorizontal, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./styles.css";
import { ActivityMeter } from "./components/ActivityMeter";
import { ModelLoadDialog } from "./components/ModelLoadDialog";
import { PageStyleSheet } from "./components/PageStyleSheet";
import { SimpleSettings } from "./components/SimpleSettings";
import type { PageStyleSettings } from "./config/pageStyle";
import {
  cloneRuntimeSettings,
  defaultRuntimeSettings,
  encodeSettingsInUrl,
  getRealtimeSilenceRms,
  readSettingsFromUrl,
  settingsOptions,
  type RuntimeTtsSettings,
  type SettingsOption
} from "./config/settingsOptions";
import { useTranscriber } from "./recorder/useTranscriber";
import { useSubtitleSpeech } from "./speech/useSubtitleSpeech";
import { useJassubSubtitles } from "./subtitles/useJassubSubtitles";

function App() {
  const [settings, setSettings] = useState(() => readSettingsFromUrl());
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const transcriptCurrentMarkerRef = useRef<HTMLSpanElement | null>(null);
  const updateSettings = useCallback((option: SettingsOption, value: boolean | number | string) => {
    setSettings((current) => {
      if (option.kind === "checkbox" && typeof value === "boolean") {
        return option.setValue(current, value);
      }
      if ((option.kind === "number" || option.kind === "slider") && typeof value === "number") {
        return option.setValue(current, value);
      }
      if (option.kind === "select" && typeof value === "string") {
        return option.setValue(current, value);
      }
      return current;
    });
  }, []);
  const updateTtsSettings = useCallback((update: Partial<RuntimeTtsSettings>) => {
    setSettings((current) => ({
      ...current,
      tts: { ...current.tts, ...update }
    }));
  }, []);
  const resetSettings = useCallback(() => {
    setSettings(cloneRuntimeSettings(defaultRuntimeSettings));
  }, []);
  const setMicrophone = useCallback((deviceId: string) => {
    setSettings((current) => ({
      ...current,
      microphone: {
        ...current.microphone,
        deviceId
      }
    }));
  }, []);
  const setPageStyle = useCallback((pageStyle: PageStyleSettings) => {
    setSettings((current) => ({
      ...current,
      pageStyle
    }));
  }, []);
  const recorder = useTranscriber(settings);
  const transcriptText = recorder.partialText || recorder.paragraphs.at(-1) || "";
  const speech = useSubtitleSpeech(transcriptText, settings.tts, updateTtsSettings);
  const setSubtitleCanvas = useJassubSubtitles(transcriptText);
  const aria = getAriaCopy(settings.pageStyle.roleVerbosity);
  const transcriptScrollOption = getOption("transcriptScrollSpeed");
  const showSubtitleOverlay = recorder.isRecording && !recorder.isTranscribingMedia;
  const transcriptHistory =
    recorder.partialText
      ? recorder.paragraphs
      : recorder.paragraphs.slice(0, Math.max(0, recorder.paragraphs.length - 1));
  const transcriptBlocks = showSubtitleOverlay
    ? transcriptHistory
    : recorder.partialText
      ? [...recorder.paragraphs, recorder.partialText]
      : recorder.paragraphs;
  const handleMediaFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      const file = Array.from(files).find((item) => item.type.startsWith("audio/") || item.type.startsWith("video/"));
      if (!file) return;
      void recorder.transcribeMediaFile(file);
    },
    [recorder]
  );
  const handleMediaInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleMediaFiles(event.target.files);
      event.currentTarget.value = "";
    },
    [handleMediaFiles]
  );

  useEffect(() => {
    encodeSettingsInUrl(settings);
  }, [settings]);

  useEffect(() => {
    const syncSettingsFromUrl = () => setSettings(readSettingsFromUrl());
    window.addEventListener("popstate", syncSettingsFromUrl);
    return () => window.removeEventListener("popstate", syncSettingsFromUrl);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const refreshMicrophones = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!isMounted) return;
      setMicrophoneDevices(devices.filter((device) => device.kind === "audioinput"));
    };

    void refreshMicrophones();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshMicrophones);
    return () => {
      isMounted = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshMicrophones);
    };
  }, []);

  useEffect(() => {
    if (recorder?.isRecording) {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((devices) =>
          setMicrophoneDevices(devices.filter((device) => device.kind === "audioinput"))
        );
    }
  }, [recorder?.isRecording]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) return;
    if (transcriptBlocks.length === 0) {
      container.scrollTop = 0;
      return;
    }

    let frameId = 0;
    let previous = performance.now();
    const speed = settings.transcript.autoScrollSpeed;

    const step = (timestamp: number) => {
      const elapsed = (timestamp - previous) / 1000;
      previous = timestamp;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      let target = maxScrollTop;

      if (!showSubtitleOverlay) {
        const marker = transcriptCurrentMarkerRef.current;
        if (marker) {
          const anchorOffset = container.clientHeight * 0.46;
          const markerOffset =
            marker.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop;
          target = Math.max(0, Math.min(maxScrollTop, markerOffset - anchorOffset));
        }
      }

      if (maxScrollTop <= 0) {
        if (container.scrollTop !== 0) {
          container.scrollTop = 0;
        }
        frameId = window.requestAnimationFrame(step);
        return;
      }

      const delta = target - container.scrollTop;
      const maxStep = Math.max(1, speed * elapsed);

      if (Math.abs(delta) <= maxStep) {
        container.scrollTop = target;
      } else {
        container.scrollTop += Math.sign(delta) * maxStep;
      }

      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [showSubtitleOverlay, transcriptBlocks, settings.transcript.autoScrollSpeed]);

  return (
    <main className="app-shell" data-recording={recorder.isRecording}>
      <ModelLoadDialog
        isOpen={recorder.isModelLoading}
        message={recorder.modelLoadMessage}
        progress={recorder.modelLoadProgress}
      />
      <WebGpuErrorDialog isOpen={!recorder.isWebGpuAvailable} />
      <PageStyleSheet settings={settings.pageStyle} />
      <SimpleSettings
        disabled={recorder.isRecording}
        isOpen={isSettingsOpen}
        isOpfsAvailable={recorder.isOpfsRecordingAvailable}
        isSpeaking={speech.isSpeaking}
        microphoneDevices={microphoneDevices}
        selectedVoiceId={speech.selectedVoiceId}
        settings={settings}
        voiceOptions={speech.voiceOptions}
        onClose={() => setIsSettingsOpen(false)}
        onReset={resetSettings}
        onSetPageStyle={setPageStyle}
        onSetMicrophone={setMicrophone}
        onSetVoice={speech.setSelectedVoiceId}
        onUpdate={updateSettings}
      />

      <header className="top-bar" aria-label="Application controls">
        <div className="primary-actions">
          <button
            className="record-button"
            type="button"
            onClick={recorder.isRecording ? recorder.stop : recorder.start}
            disabled={!recorder.isWebGpuAvailable || recorder.isPreparing || recorder.isTranscribingMedia}
            title={recorder.isRecording ? "Stop recording" : "Start recording"}
            aria-label={recorder.isRecording ? "Stop recording" : "Start recording"}
          >
            {recorder.isRecording ? <Square size={30} /> : <Circle size={34} />}
            <span>{recorder.isRecording ? "Stop recording" : recorder.isPreparing ? "Loading" : "Record"}</span>
          </button>
          <button
            className="upload-button"
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            disabled={recorder.isRecording || recorder.isPreparing || recorder.isModelLoading}
            title="Upload media"
            aria-label="Upload media"
          >
            <Upload size={22} />
            <span>Upload media</span>
          </button>
          <input
            ref={mediaInputRef}
            className="media-input"
            type="file"
            accept="audio/*,video/*"
            onChange={handleMediaInputChange}
          />
        </div>
        <button
          className="settings-button"
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <SlidersHorizontal size={22} />
          <span>Settings</span>
        </button>
      </header>

      <section ref={transcriptRef} className="transcript" aria-label={aria.transcript}>
        <div className="transcript-body">
          {transcriptBlocks.length > 0 ? (
            <>
              {transcriptBlocks.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 16)}`}>
                  {paragraph}
                  {!showSubtitleOverlay && index === transcriptBlocks.length - 1 ? (
                    <span ref={transcriptCurrentMarkerRef} className="transcript-current-marker" />
                  ) : null}
                </p>
              ))}
            </>
          ) : (
            <p className="empty">
              Press record for live speech, or upload media to transcribe an existing audio or video file.
            </p>
          )}
        </div>
        {showSubtitleOverlay ? (
          <div className="subtitle-layer" aria-hidden="true">
            <canvas ref={setSubtitleCanvas} className="subtitle-canvas" />
          </div>
        ) : null}
        {recorder.progress ? <p className="progress">{recorder.progress}</p> : null}
        {recorder.error ? (
          <p className="error" role="alert">
            {recorder.error}
          </p>
        ) : null}
      </section>

      <div className="scroll-gadget" aria-label="Transcript scroll speed">
        <span>Scroll</span>
        <button
          type="button"
          onClick={() =>
            updateSettings(
              transcriptScrollOption,
              Math.max(2, settings.transcript.autoScrollSpeed - 1)
            )
          }
          title="Slower transcript scroll"
          aria-label="Slower transcript scroll"
        >
          <Minus size={16} />
        </button>
        <strong>{Math.round(settings.transcript.autoScrollSpeed)}</strong>
        <button
          type="button"
          onClick={() =>
            updateSettings(
              transcriptScrollOption,
              Math.min(26, settings.transcript.autoScrollSpeed + 1)
            )
          }
          title="Faster transcript scroll"
          aria-label="Faster transcript scroll"
        >
          <Plus size={16} />
        </button>
      </div>

      {recorder.isTranscribingMedia ? (
        <div className="activity-dock progress-dock" role="status" aria-live="polite">
          <div className="transcription-progress">
            <div className="transcription-progress-heading">
              <span>Transcribing media</span>
              <span>{Math.round(recorder.mediaTranscriptionProgress)}%</span>
            </div>
            <progress
              value={Math.max(0, Math.min(100, recorder.mediaTranscriptionProgress))}
              max={100}
              aria-label="Uploaded media transcription progress"
            />
          </div>
        </div>
      ) : recorder.isRecording ? (
        <div className="activity-dock">
          <ActivityMeter
            activityRms={recorder.sourceActivityRms}
            silenceRms={getRealtimeSilenceRms(settings)}
          />
        </div>
      ) : null}
    </main>
  );
}

function getOption(key: string) {
  const option = settingsOptions.find((item) => item.key === key);
  if (!option) throw new Error(`Missing setting option: ${key}`);
  return option;
}

function WebGpuErrorDialog({ isOpen }: { isOpen: boolean }) {
  if (!isOpen) return null;

  return (
    <div className="error-overlay" role="presentation">
      <section
        aria-label="WebGPU required"
        aria-modal="true"
        className="error-dialog"
        role="alertdialog"
      >
        <h2>WebGPU Required</h2>
        <p>
          This app cannot transcribe audio in this browser because WebGPU is not available.
          Use a supported Chromium browser with WebGPU enabled.
        </p>
      </section>
    </div>
  );
}

function getAriaCopy(verbosity: PageStyleSettings["roleVerbosity"]) {
  if (verbosity === "minimal") {
    return {
      recorder: "Recorder",
      transcript: "Transcript",
      listenButton: "Listen",
    };
  }

  if (verbosity === "detailed") {
    return {
      recorder: "Recorder controls for live microphone capture, uploaded media transcription, model caching, and speech output",
      transcript: "Live transcript text created from microphone or uploaded media audio",
      listenButton: "Start or stop live microphone transcription",
    };
  }

  return {
    recorder: "Recorder controls",
    transcript: "Live transcript",
    listenButton: "Start or stop listening",
  };
}

createRoot(document.getElementById("root")!).render(<App />);
