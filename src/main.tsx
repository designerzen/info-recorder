import { TranslationSettings } from "./components/TranslationSettings";
import { useBrowserTranslation } from "./translation/useBrowserTranslation";
import { createRoot } from "react-dom/client";
import { Circle, FileText, Map, Pause, Play, SlidersHorizontal, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import "./styles.css";
import { ActivityMeter } from "./components/ActivityMeter";
import { ModelLoadDialog } from "./components/ModelLoadDialog";
import { PageStyleSheet } from "./components/PageStyleSheet";
import { PhraseLocationMap, type PhraseLocationMapMessage } from "./components/PhraseLocationMap";
import { SimpleSettings } from "./components/SimpleSettings";
import type { PageStyleSettings } from "./config/pageStyle";
import {
  cloneRuntimeSettings,
  defaultRuntimeSettings,
  encodeSettingsInUrl,
  getRealtimeSilenceRms,
  readSettingsFromUrl,
  type RuntimeTtsSettings,
  type SettingsOption
} from "./config/settingsOptions";
import { getTypefaceAssFamily } from "./config/typefaces";
import { useTranscriber } from "./recorder/useTranscriber";
import { useSubtitleSpeech } from "./speech/useSubtitleSpeech";
import { useJassubSubtitles } from "./subtitles/useJassubSubtitles";
import { splitParagraphIntoSentences, type TranscriptSentence } from "./transcript/timedTranscript";
import { locateTranscriptSentences } from "./transcript/locatedTranscript";

type TranscriptPlaybackChoice = "source:original" | "source:normalized" | `web:${string}` | `model:${string}`;

function App() {
  const [settings, setSettings] = useState(() => readSettingsFromUrl());
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [workspaceView, setWorkspaceView] = useState<"transcript" | "map">("transcript");
  const [playbackError, setPlaybackError] = useState("");
  const playbackRequestRef = useRef(0);
  const [transcriptPlaybackChoice, setTranscriptPlaybackChoice] =
    useState<TranscriptPlaybackChoice>("source:normalized");
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
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
      pageStyle,
      subtitles: {
        ...current.subtitles,
        fontFamily: getTypefaceAssFamily(pageStyle.fontFamily)
      }
    }));
  }, []);
  const recorder = useTranscriber(settings);
  const transcriptText = recorder.partialText || recorder.paragraphs.at(-1) || "";
  const aria = getAriaCopy(settings.pageStyle.roleVerbosity);
  const transcriptBlocks = recorder.partialText
    ? [...recorder.paragraphs, recorder.partialText]
    : recorder.paragraphs;
  const transcriptParagraphs = useMemo(
    () =>
      recorder.transcriptParagraphs.map((paragraph) => ({
        ...paragraph,
        sentences: splitParagraphIntoSentences(paragraph)
      })),
    [recorder.transcriptParagraphs]
  );
  const locatedPhraseMessages = useMemo<PhraseLocationMapMessage[]>(() => {
    const sentences = transcriptParagraphs.flatMap((paragraph) => paragraph.sentences);
    return locateTranscriptSentences(sentences, recorder.audioParts, recorder.recordingStartedAt);
  }, [recorder.audioParts, recorder.recordingStartedAt, transcriptParagraphs]);
  const transcriptSentences = useMemo(
    () => transcriptParagraphs.flatMap((paragraph) => paragraph.sentences),
    [transcriptParagraphs]
  );
  const translation = useBrowserTranslation(transcriptSentences, settings.translation.sourceLanguage, settings.translation.targetLanguage);
  const speech = useSubtitleSpeech(transcriptText, transcriptSentences, settings.tts, updateTtsSettings);
  const showSubtitleOverlay = speech.isSpeaking;
  const playbackText = transcriptBlocks.join("\n").trim();
  const hasSourceAudio = Boolean(recorder.sourceMedia || recorder.opfsChunkCount > 0);
  const transcriptPlaybackOptions = useMemo(
    () => [
      {
        group: "Audio",
        items: [
          {
            description: hasSourceAudio ? "Play the original recording." : "No recorded audio available.",
            disabled: !hasSourceAudio,
            icon: "◎",
            label: "Original Audio",
            value: "source:original" as TranscriptPlaybackChoice
          },
          {
            description: hasSourceAudio
              ? "Play recorded audio with voice-focused normalization."
              : "Read the transcription using the selected speech engine.",
            disabled: false,
            icon: "◉",
            label: "Normalised Audio",
            value: "source:normalized" as TranscriptPlaybackChoice
          }
        ]
      },
      {
        group: "Built-in TTS Voices",
        items: speech.browserVoiceOptions.map((voice) => ({
          description: voice.lang ? `Browser speech synthesis voice, ${voice.lang}.` : "Browser speech synthesis voice.",
          disabled: false,
          icon: "◌",
          label: voice.name,
          value: `web:${voice.id}` as TranscriptPlaybackChoice
        }))
      },
      {
        group: "Local Model Voices",
        items: speech.modelVoiceOptions.map((voice) => ({
          description: "Local model voice rendered through the WebGPU voice engine.",
          disabled: false,
          icon: "◆",
          label: voice.name,
          value: `model:${voice.id}` as TranscriptPlaybackChoice
        }))
      }
    ],
    [hasSourceAudio, speech.browserVoiceOptions, speech.modelVoiceOptions]
  );
  const selectedTranscriptPlaybackOption = transcriptPlaybackOptions
    .flatMap((group) => group.items)
    .find((item) => item.value === transcriptPlaybackChoice);
  const sentencePlaybackMode: RuntimeTtsSettings["sentencePlaybackMode"] =
    transcriptPlaybackChoice.startsWith("source:") && hasSourceAudio ? "source-audio" : "tts";
  const isSentencePlaybackUnavailable = sentencePlaybackMode === "tts" && !speech.isSpeechSupported;
  const subtitleText = speech.isSpeaking ? speech.activePhraseText || transcriptText : "";
  const setSubtitleCanvas = useJassubSubtitles(subtitleText, settings.subtitles);
  const isBusyTranscribingMedia = recorder.isTranscribingMedia;
  const heroTitle = recorder.isRecording
    ? "Recording live transcript"
    : isBusyTranscribingMedia
      ? "Transcribing your media"
      : transcriptBlocks.length > 0
        ? "Transcript workspace"
        : "Word Trail";
  const heroDescription = recorder.isRecording
    ? "The microphone is live. Your transcript will keep updating below as new speech arrives."
    : isBusyTranscribingMedia
      ? "Uploaded media is being processed locally. You can follow progress and review the transcript as chunks finish."
      : transcriptBlocks.length > 0
        ? "Review, play back, and follow the transcript from one focused workspace."
        : "Record from the microphone or upload audio and video files for fast local transcription.";
  const statusLabel = recorder.isRecording
    ? "Live microphone"
    : isBusyTranscribingMedia
      ? "Media transcription"
      : recorder.sourceMedia
        ? "Uploaded media ready"
        : "Ready to record";
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
    const selectedDeviceId = settings.microphone.deviceId;
    if (!selectedDeviceId) return;
    if (microphoneDevices.length === 0) return;
    if (microphoneDevices.some((device) => device.deviceId === selectedDeviceId)) return;

    setMicrophone("");
  }, [microphoneDevices, setMicrophone, settings.microphone.deviceId]);

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
    if (transcriptPlaybackChoice === "source:original" && !hasSourceAudio) {
      setTranscriptPlaybackChoice("source:normalized");
    }
  }, [hasSourceAudio, transcriptPlaybackChoice]);

  const handleTranscriptPlaybackChoice = useCallback(
    (value: TranscriptPlaybackChoice) => {
      setTranscriptPlaybackChoice(value);

      if (value.startsWith("web:")) {
        updateTtsSettings({
          provider: "web-speech",
          selectedVoiceId: value.slice("web:".length)
        });
        return;
      }

      if (value.startsWith("model:")) {
        updateTtsSettings({
          provider: "supertonic-web",
          selectedVoiceId: value.slice("model:".length)
        });
      }
    },
    [updateTtsSettings]
  );

  const playPassage = useCallback(async (sentence?: TranscriptSentence) => {
    const request = ++playbackRequestRef.current;
    setPlaybackError("");
    speech.stopSpeaking();
    try {
      if (sentencePlaybackMode === "source-audio") {
        const source = recorder.sourceMedia ?? await recorder.getRecordingSourceMedia();
        if (request !== playbackRequestRef.current) return;
        if (!source) throw new Error("Recorded audio is unavailable for this transcription.");
        const mode = transcriptPlaybackChoice === "source:normalized" ? "normalized" : "original";
        if (sentence) speech.playSentence(sentence, source, "source-audio", mode);
        else await speech.playSourceMedia(source, mode, { sentences: transcriptSentences });
      } else if (sentence) {
        speech.playSentence(sentence, null, "tts");
      } else {
        speech.speakText(playbackText);
      }
    } catch (cause) {
      if (request === playbackRequestRef.current) {
        setPlaybackError(cause instanceof Error ? cause.message : "Playback failed.");
      }
    }
  }, [playbackText, recorder.sourceMedia, recorder.getRecordingSourceMedia, sentencePlaybackMode, speech, transcriptPlaybackChoice, transcriptSentences]);

  const playTranscript = useCallback(() => {
    if (speech.isSpeaking) {
      playbackRequestRef.current += 1;
      speech.stopSpeaking();
      return;
    }
    void playPassage();
  }, [playPassage, speech]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) return;
    if (transcriptBlocks.length === 0) {
      container.scrollTop = 0;
      return;
    }
    if (!isAutoScrollEnabled) return;

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const distanceFromBottom = maxScrollTop - container.scrollTop;
    const shouldFollow = distanceFromBottom < Math.max(96, container.clientHeight * 0.2);
    if (!shouldFollow) return;

    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [isAutoScrollEnabled, transcriptBlocks, workspaceView]);

  return (
    <main className="app-shell" data-recording={recorder.isRecording}>
      <ModelLoadDialog
        isOpen={recorder.isModelLoading}
        message={recorder.modelLoadMessage}
        progress={recorder.modelLoadProgress}
        transferredBytes={recorder.modelLoadTransferredBytes}
        totalBytes={recorder.modelLoadTotalBytes}
        downloadSpeedBps={recorder.modelDownloadSpeedBps}
      />
      <TranscriptionSupportDialog
        isOpen={!recorder.isTranscriptionSupported}
        requiresCrossOriginIsolation={recorder.requiresCrossOriginIsolation}
        requiresWebGpu={recorder.requiresWebGpu}
        support={recorder.runtimeSupport}
      />
      <PageStyleSheet settings={settings.pageStyle} />
      <SimpleSettings
        disabled={recorder.isRecording}
        isOpen={isSettingsOpen}
        isOpfsAvailable={recorder.isOpfsRecordingAvailable}
        isSpeaking={speech.isSpeaking}
        microphoneDevices={microphoneDevices}
        modelDownloadSpeedBps={recorder.modelDownloadSpeedBps}
        modelInventory={recorder.modelInventory}
        modelInventoryMessage={recorder.modelInventoryMessage}
        selectedVoiceId={speech.selectedVoiceId}
        settings={settings}
        voiceOptions={speech.voiceOptions}
        onClose={() => setIsSettingsOpen(false)}
        translationControls={<TranslationSettings settings={settings} translation={translation} onUpdate={updateSettings} />}
        onReset={() => { translation.disable(); resetSettings(); }}
        onSetPageStyle={setPageStyle}
        onSetMicrophone={setMicrophone}
        onSetVoice={speech.setSelectedVoiceId}
        onUpdate={updateSettings}
      />

      <div className="app-layout">
        <header className="top-bar" aria-label="Application controls">
          <div className="hero-copy">
            <span className="hero-kicker">{statusLabel}</span>
            <h1>{heroTitle}</h1>
            <p>{heroDescription}</p>
          </div>
          <div className="hero-actions">
            <div className="primary-actions">
              <button
                className="record-button"
                type="button"
                onClick={recorder.isRecording ? recorder.stop : recorder.start}
                disabled={recorder.isPreparing || recorder.isTranscribingMedia}
                title={recorder.isRecording ? "Stop recording" : "Start recording"}
                aria-label={recorder.isRecording ? "Stop recording" : "Start recording"}
              >
                {recorder.isRecording ? <Square size={28} /> : <Circle size={30} />}
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
                <Upload size={20} />
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
              <SlidersHorizontal size={20} />
              <span>Settings</span>
            </button>
          </div>
        </header>

        <section className="workspace-shell" aria-label="Transcript workspace">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
            {(["transcript", "map"] as const).map((view) => (
              <button
                key={view}
                id={`${view}-tab`}
                type="button"
                role="tab"
                aria-selected={workspaceView === view}
                aria-controls={`${view}-panel`}
                tabIndex={workspaceView === view ? 0 : -1}
                onClick={() => setWorkspaceView(view)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? "transcript" : event.key === "End" ? "map" : view === "map" ? "transcript" : "map";
                  setWorkspaceView(next);
                  document.getElementById(`${next}-tab`)?.focus();
                }}
              >
                {view === "map" ? <Map size={18} /> : <FileText size={18} />}
                {view === "map" ? "Map" : "Transcript"}
              </button>
            ))}
          </div>
          <section ref={transcriptRef} id="transcript-panel" role="tabpanel" aria-labelledby="transcript-tab" hidden={workspaceView !== "transcript"} className="transcript" aria-label={aria.transcript}>
            <div className="transcript-body">
              {transcriptBlocks.length > 0 ? (
                <>
                  {isBusyTranscribingMedia ? (
                    <div className="transcript-busy-state" role="status" aria-live="polite">
                      <div className="transcript-busy-spinner" aria-hidden="true" />
                      <p>Transcription is running in the background. New text appears here as each chunk finishes.</p>
                    </div>
                  ) : null}
                  {transcriptBlocks.map((paragraph, index) => (
                    <div
                      key={`${index}-${paragraph.slice(0, 16)}`}
                      className={index === transcriptBlocks.length - 1 && recorder.partialText ? "partial" : "transcript-paragraph"}
                    >
                      {index < transcriptParagraphs.length ? (
                        transcriptParagraphs[index].sentences.map((sentence) => {
                          return (
                            <span key={sentence.id} className="translated-sentence">
                            <button
                              type="button"
                              className={`sentence-button${speech.activeSentenceId === sentence.id ? " active" : ""}`}
                              onClick={() => void playPassage(sentence)}
                              disabled={isSentencePlaybackUnavailable}
                              title={
                                sentencePlaybackMode === "source-audio"
                                  ? "Play this sentence from the recording"
                                  : `Read this sentence aloud as ${selectedTranscriptPlaybackOption?.label ?? "the selected voice"}.`
                              }
                            >
                              {sentence.words.length > 0
                                ? sentence.words.map((word, wordIndex) => (
                                    <span
                                      key={`${sentence.id}-${wordIndex}-${word.startMs}`}
                                      className={
                                        speech.activeSentenceId === sentence.id && speech.activeWordIndex === wordIndex
                                          ? "sentence-word active"
                                          : "sentence-word"
                                      }
                                    >
                                      {word.text}
                                    </span>
                                  ))
                                : sentence.text}
                            </button>
                            {translation.enabled && translation.translations[sentence.id]?.source === sentence.text ? (
                              <span className="sentence-translation" lang={settings.translation.targetLanguage} dir="auto">
                                {translation.translations[sentence.id].text}
                              </span>
                            ) : null}
                            </span>
                          );
                        })
                      ) : (
                        paragraph
                      )}
                    </div>
                  ))}
                  <div ref={transcriptEndRef} className="transcript-end-anchor" aria-hidden="true" />
                </>
              ) : isBusyTranscribingMedia ? (
                <div className="transcript-busy-state" role="status" aria-live="polite">
                  <div className="transcript-busy-spinner" aria-hidden="true" />
                  <p>Transcription is running in the background.</p>
                </div>
              ) : (
                <div className="empty-state">
                  <p className="empty">
                    Press record for live speech, or upload media to transcribe an existing audio or video file.
                  </p>
                </div>
              )}
            </div>
            {showSubtitleOverlay ? (
              <div className="subtitle-layer" aria-hidden="true">
                <canvas ref={setSubtitleCanvas} className="subtitle-canvas" />
              </div>
            ) : null}
            {!isBusyTranscribingMedia && recorder.progress ? <p className="progress">{recorder.progress}</p> : null}
            {translation.status && (translation.enabled || translation.loading) ? <p className="progress" role="status">{translation.status}</p> : null}
            {recorder.error ? (
              <p className="error" role="alert">
                {recorder.error}
              </p>
            ) : null}
          </section>

          <section id="map-panel" role="tabpanel" aria-labelledby="map-tab" hidden={workspaceView !== "map"}>
            {workspaceView === "map" && (locatedPhraseMessages.length > 0 ? (
              <PhraseLocationMap
                messages={locatedPhraseMessages}
                onPlay={(message) => void playPassage(message)}
                activeMessageId={speech.activeSentenceId}
                isPlaying={speech.isSpeaking}
                playbackLabel={selectedTranscriptPlaybackOption?.label ?? "Selected voice"}
                playbackUnavailable={isSentencePlaybackUnavailable}
                onStop={() => { playbackRequestRef.current += 1; speech.stopSpeaking(); }}
              />
            ) : (
              <p className="location-unknown" role="status">
                Location unknown for this transcription
              </p>
            ))}
          </section>

          {playbackError ? <p role="alert" className="error">{playbackError}</p> : null}
          {speech.speechStatus ? <p role="status" className="playback-status">{speech.speechStatus}</p> : null}

          <div className="scroll-gadget" aria-label="Transcript controls">
            {!isBusyTranscribingMedia && playbackText ? (
              <div className="playback-gadget">
                <button
                  className="speech-button playback-cta"
                  type="button"
                  onClick={playTranscript}
                  disabled={isSentencePlaybackUnavailable}
                  title={
                    isSentencePlaybackUnavailable
                      ? "The selected speech engine is not available in this browser."
                      : speech.isSpeaking
                        ? "Stop reading the transcript aloud"
                        : `Play transcript as ${selectedTranscriptPlaybackOption?.label ?? "selected audio"}`
                  }
                  aria-label={speech.isSpeaking ? "Stop reading the transcript aloud" : "Read the transcript aloud"}
                >
                  <span className="playback-cta-icon" aria-hidden="true">
                    {speech.isSpeaking ? <Square size={22} /> : <Play size={22} />}
                  </span>
                  <span className="playback-cta-copy">
                    <strong>{speech.isSpeaking ? "Stop playback" : "Play transcript"}</strong>
                    <small>{selectedTranscriptPlaybackOption?.label ?? "Select a playback voice"}</small>
                  </span>
                </button>
                <label className="transcript-playback-picker">
                  <span className="playback-picker-label">Voice</span>
                  <span className="playback-picker-description">
                    {selectedTranscriptPlaybackOption?.description ?? "Choose how the transcript is read aloud."}
                  </span>
                  <select
                    aria-label="Transcript playback voice"
                    className="playback-select"
                    value={transcriptPlaybackChoice}
                    disabled={speech.isSpeaking}
                    onChange={(event) =>
                      handleTranscriptPlaybackChoice(event.target.value as TranscriptPlaybackChoice)
                    }
                  >
                    {transcriptPlaybackOptions.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.items.map((item) => (
                          <option key={item.value} value={item.value} disabled={item.disabled}>
                            {item.icon} {item.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <div className="follow-gadget" aria-label="Transcript follow mode">
              <label>Follow transcript</label>
              <button
                type="button"
                className="scroll-toggle-button"
                onClick={() => setIsAutoScrollEnabled((current) => !current)}
                title={isAutoScrollEnabled ? "Pause automatic transcript scrolling" : "Resume automatic transcript scrolling"}
                aria-label={isAutoScrollEnabled ? "Pause automatic transcript scrolling" : "Resume automatic transcript scrolling"}
                aria-pressed={isAutoScrollEnabled}
              >
                {isAutoScrollEnabled ? <Pause size={16} /> : <Play size={16} />}
                <span>{isAutoScrollEnabled ? "Auto" : "Manual"}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="waveform-strip" aria-hidden="true">
        <canvas ref={recorder.setWaveformCanvas} className="waveform-canvas" />
      </div>

      {recorder.isTranscribingMedia ? (
        <div className="activity-dock progress-dock" role="status" aria-live="polite">
          <div className="transcription-progress">
            <div className="transcription-progress-heading">
              <span className="transcription-progress-title">
                <span className="transcription-progress-spinner" aria-hidden="true" />
                <span>Transcribing media</span>
              </span>
              <span>{Math.round(recorder.mediaTranscriptionProgress)}%</span>
            </div>
            <p className="transcription-progress-message">
              {recorder.progress || (recorder.mediaFileName ? `Preparing ${recorder.mediaFileName}...` : "Preparing media transcription...")}
            </p>
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

function TranscriptionSupportDialog({
  isOpen,
  requiresCrossOriginIsolation,
  requiresWebGpu,
  support
}: {
  isOpen: boolean;
  requiresCrossOriginIsolation: boolean;
  requiresWebGpu: boolean;
  support: {
    hasWebAssembly: boolean;
    hasWebGpu: boolean;
    hasCrossOriginIsolation: boolean;
    isSecureContext: boolean;
  };
}) {
  if (!isOpen) return null;

  const missingFeatures = [
    requiresWebGpu && !support.hasWebGpu ? "WebGPU" : "",
    requiresCrossOriginIsolation && !support.hasCrossOriginIsolation ? "cross-origin isolation" : "",
    !support.hasWebAssembly ? "WebAssembly" : "",
    !support.isSecureContext ? "a secure HTTPS or localhost page" : ""
  ].filter(Boolean);

  return (
    <div className="error-overlay" role="presentation">
      <section
        aria-label="Browser upgrade required"
        aria-modal="true"
        className="error-dialog"
        role="alertdialog"
      >
        <h2>Browser Upgrade Required</h2>
        <p>
          This app cannot transcribe audio in this browser because it is missing{" "}
          {formatFeatureList(missingFeatures)}.
        </p>
        <p>
          Update to the latest Chrome, Edge, or another Chromium-based browser, then open the app
          over HTTPS or localhost. WebAssembly must be enabled. Whisper ONNX models also require
          WebGPU; Moonshine requires COOP and COEP response headers for its threaded WASM runtime.
        </p>
      </section>
    </div>
  );
}

function formatFeatureList(features: string[]) {
  if (features.length === 0) return "required browser features";
  if (features.length === 1) return features[0];
  if (features.length === 2) return `${features[0]} and ${features[1]}`;
  return `${features.slice(0, -1).join(", ")}, and ${features.at(-1)}`;
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
