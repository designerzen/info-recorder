import { h, Fragment, defineElement, patch, type DomEvent } from "./ui/dom";
import { createLifecycle, sameInputs } from "./ui/lifecycle";
import { createNavigationMachine, createStateMachine } from "./state/machine";
import { TranslationSettings } from "./components/TranslationSettings";
import { createBrowserTranslation } from "./translation/createBrowserTranslation";
import { Circle, FileText, Map, Play, SlidersHorizontal, Square, Upload } from "./ui/icons";
import "./styles.css";
import "./studio.css";
import "./settings.css";
import "./design/system.css";
import "./help.css";
import "./releases.css";
import "./minimal.css";
import { HelpPage } from "./components/HelpPage";
import { ReleasesPage } from "./components/ReleasesPage";
import { ActivityProgress } from "./components/ActivityProgress";
import { PageStyleSheet } from "./components/PageStyleSheet";
import { PhraseLocationMap } from "./components/PhraseLocationMap";
import { SimpleSettings } from "./components/SimpleSettings";
import type { PageStyleSettings } from "./config/pageStyle";
import { cloneRuntimeSettings, defaultRuntimeSettings, encodeSettingsInUrl, getRealtimeSilenceRms, readSettingsFromUrl, type RuntimeTtsSettings, type SettingsOption } from "./config/settingsOptions";
import { getTypefaceAssFamily } from "./config/typefaces";
import { createTranscriber } from "./recorder/createTranscriber";
import { createSubtitleSpeech } from "./speech/createSubtitleSpeech";
import { createJassubSubtitles } from "./subtitles/createJassubSubtitles";
import { splitParagraphIntoSentences, type TranscriptSentence } from "./transcript/timedTranscript";
import { locateTranscriptSentences } from "./transcript/locatedTranscript";
import { TranscriptDownloads } from "./components/TranscriptDownloads";
type TranscriptPlaybackChoice = "source:original" | "source:normalized" | `web:${string}` | `model:${string}`;
const App = defineElement<Record<string, never>>("wt-app", (initialProps, host) => {
    const scope = createLifecycle();
    const machine = createNavigationMachine(window.location.hash);
    scope.own(machine.subscribe(scope.invalidate));
    scope.own(machine.dispose);
    const contextStore = createStateMachine({ settings: (() => readSettingsFromUrl())(),
        microphoneDevices: ([]) as MediaDeviceInfo[],
        currentPage: (() => window.location.hash)(),
        workspaceView: ("transcript") as "transcript" | "map",
        playbackError: "",
        transcriptPlaybackChoice: ("source:normalized") as TranscriptPlaybackChoice }, () => "ready");
    let state = contextStore.context;
    scope.own(contextStore.subscribe(() => { state = contextStore.context; scope.invalidate(); }));
    scope.own(contextStore.dispose);
    const setSettings = (value: typeof state.settings | ((previous: typeof state.settings) => typeof state.settings)) => contextStore.send({ type: "settings", value });
    const setMicrophoneDevices = (value: typeof state.microphoneDevices | ((previous: typeof state.microphoneDevices) => typeof state.microphoneDevices)) => contextStore.send({ type: "microphoneDevices", value });
    const setIsSettingsOpen = (value: boolean) => machine.send(value ? "OPEN_SETTINGS" : "CLOSE_SETTINGS");
    const setCurrentPage = (value: string) => { machine.send(value === "#help" ? "HELP" : value === "#downloads" ? "DOWNLOADS" : "WORKSPACE"); contextStore.send({ type: "currentPage", value }); };
    const setWorkspaceView = (value: typeof state.workspaceView | ((previous: typeof state.workspaceView) => typeof state.workspaceView)) => contextStore.send({ type: "workspaceView", value });
    const setPlaybackError = (value: typeof state.playbackError | ((previous: typeof state.playbackError) => typeof state.playbackError)) => contextStore.send({ type: "playbackError", value });
    const setTranscriptPlaybackChoice = (value: typeof state.transcriptPlaybackChoice | ((previous: typeof state.transcriptPlaybackChoice) => typeof state.transcriptPlaybackChoice)) => contextStore.send({ type: "transcriptPlaybackChoice", value });
    const previousPageRef = { current: state.currentPage };
    const playbackRequestRef = { current: 0 };
    const mediaInputRef: {
        current: HTMLInputElement | null;
    } = { current: null };
    const transcriptRef: {
        current: HTMLElement | null;
    } = { current: null };
    const transcriptEndRef: {
        current: HTMLDivElement | null;
    } = { current: null };
    let isHelpPage = state.currentPage === '#help';
    let isReleasesPage = state.currentPage === '#downloads';
    const updateSettings = (option: SettingsOption, value: boolean | number | string) => {
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
    };
    const updateTtsSettings = (update: Partial<RuntimeTtsSettings>) => {
        setSettings((current) => ({
            ...current,
            tts: { ...current.tts, ...update }
        }));
    };
    const resetSettings = () => {
        setSettings(cloneRuntimeSettings(defaultRuntimeSettings));
    };
    const setMicrophone = (deviceId: string) => {
        setSettings((current) => ({
            ...current,
            microphone: {
                ...current.microphone,
                deviceId
            }
        }));
    };
    const setPageStyle = (pageStyle: PageStyleSettings) => {
        setSettings((current) => ({
            ...current,
            pageStyle,
            subtitles: {
                ...current.subtitles,
                fontFamily: getTypefaceAssFamily(pageStyle.fontFamily)
            }
        }));
    };
    const recorder = createTranscriber(state.settings);
    scope.own(recorder.dispose);
    scope.own(recorder.subscribe(scope.invalidate));
    let transcriptText = recorder.partialText || recorder.paragraphs.at(-1) || "";
    let aria = getAriaCopy(state.settings.pageStyle.roleVerbosity);
    let transcriptBlocks = recorder.partialText
        ? [...recorder.paragraphs, recorder.partialText]
        : recorder.paragraphs;
    const calculatetranscriptParagraphs = () => recorder.transcriptParagraphs.map((paragraph) => ({
        ...paragraph,
        sentences: splitParagraphIntoSentences(paragraph)
    }));
    let transcriptParagraphs = calculatetranscriptParagraphs();
    let calculatetranscriptParagraphsInputs: readonly unknown[] | undefined;
    const calculatelocatedPhraseMessages = () => {
        const sentences = transcriptParagraphs.flatMap((paragraph) => paragraph.sentences);
        return locateTranscriptSentences(sentences, recorder.audioParts, recorder.recordingStartedAt);
    };
    let locatedPhraseMessages = calculatelocatedPhraseMessages();
    let calculatelocatedPhraseMessagesInputs: readonly unknown[] | undefined;
    const calculatetranscriptSentences = () => transcriptParagraphs.flatMap((paragraph) => paragraph.sentences);
    let transcriptSentences = calculatetranscriptSentences();
    let calculatetranscriptSentencesInputs: readonly unknown[] | undefined;
    const translation = createBrowserTranslation(transcriptSentences, state.settings.translation.sourceLanguage, state.settings.translation.targetLanguage);
    scope.own(translation.dispose);
    scope.own(translation.subscribe(scope.invalidate));
    const speech = createSubtitleSpeech(transcriptText, transcriptSentences, state.settings.tts, updateTtsSettings);
    scope.own(speech.dispose);
    scope.own(speech.subscribe(scope.invalidate));
    let showSubtitleOverlay = speech.isSpeaking;
    let playbackText = transcriptBlocks.join("\n").trim();
    let hasSourceAudio = Boolean(recorder.sourceMedia || recorder.opfsChunkCount > 0);
    const calculatetranscriptPlaybackOptions = () => [
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
    ];
    let transcriptPlaybackOptions = calculatetranscriptPlaybackOptions();
    let calculatetranscriptPlaybackOptionsInputs: readonly unknown[] | undefined;
    let selectedTranscriptPlaybackOption = transcriptPlaybackOptions
        .flatMap((group) => group.items)
        .find((item) => item.value === state.transcriptPlaybackChoice);
    let sentencePlaybackMode: RuntimeTtsSettings["sentencePlaybackMode"] = state.transcriptPlaybackChoice.startsWith("source:") && hasSourceAudio ? "source-audio" : "tts";
    let isSentencePlaybackUnavailable = sentencePlaybackMode === "tts" && !speech.isSpeechSupported;
    let subtitleText = speech.isSpeaking ? speech.activePhraseText || transcriptText : "";
    const setSubtitleCanvas = createJassubSubtitles(subtitleText, state.settings.subtitles, (cause) => {
        setPlaybackError(cause instanceof Error ? cause.message : "Subtitle rendering failed.");
    });
    scope.own(setSubtitleCanvas.dispose);
    let isBusyTranscribingMedia = recorder.isTranscribingMedia;
    let isLiveRecording = recorder.isRecording && !isBusyTranscribingMedia && !recorder.isPreparing;
    let isBlocking = recorder.isModelLoading || (recorder.isPreparing && !isBusyTranscribingMedia);
    let activityActive = isBlocking || isBusyTranscribingMedia || isLiveRecording || translation.loading || speech.isSpeaking || Boolean(recorder.progress);
    let activityTitle = recorder.isModelLoading ? "Preparing transcription model"
        : isBlocking ? "Preparing microphone"
            : isBusyTranscribingMedia ? "Transcribing media"
                : isLiveRecording ? "Recording"
                    : translation.loading ? "Preparing translation"
                        : speech.isSpeaking ? "Playing transcript"
                            : recorder.progress ? "Processing audio" : "Ready";
    let activityMessage = recorder.isModelLoading ? recorder.modelLoadMessage || "Loading model files. Keep this tab open."
        : isBlocking ? "Starting the microphone and transcription engine. Allow microphone access if prompted."
            : isBusyTranscribingMedia ? recorder.progress || "Preparing media. You can review the transcript as text arrives."
                : isLiveRecording ? recorder.progress || "Microphone is live. New speech will appear in the transcript."
                    : translation.loading ? translation.status
                        : speech.isSpeaking ? speech.speechStatus || "Playing the selected audio or voice."
                            : recorder.progress || speech.speechStatus || (translation.enabled ? translation.status : "Record or upload media to begin.");
    let activityProgress = recorder.isModelLoading
        ? recorder.modelLoadTotalBytes > 0 ? recorder.modelLoadProgress : undefined
        : isBusyTranscribingMedia && recorder.mediaTranscriptionProgress > 0 ? recorder.mediaTranscriptionProgress : undefined;
    const handleMediaFiles = (files: FileList | null) => {
        if (!files)
            return;
        const file = Array.from(files).find((item) => item.type.startsWith("audio/") || item.type.startsWith("video/"));
        if (!file)
            return;
        void recorder.transcribeMediaFile(file);
    };
    const handleMediaInputChange = (event: DomEvent<Event, HTMLInputElement>) => {
        handleMediaFiles(event.target.files);
        event.currentTarget.value = "";
    };
    const handleTranscriptPlaybackChoice = (value: TranscriptPlaybackChoice) => {
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
    };
    const playPassage = async (sentence?: TranscriptSentence) => {
        const request = ++playbackRequestRef.current;
        setPlaybackError("");
        speech.stopSpeaking();
        try {
            if (sentencePlaybackMode === "source-audio") {
                const source = recorder.sourceMedia ?? await recorder.getRecordingSourceMedia();
                if (request !== playbackRequestRef.current)
                    return;
                if (!source)
                    throw new Error("Recorded audio is unavailable for this transcription.");
                const mode = state.transcriptPlaybackChoice === "source:normalized" ? "normalized" : "original";
                if (sentence)
                    speech.playSentence(sentence, source, "source-audio", mode);
                else
                    await speech.playSourceMedia(source, mode, { sentences: transcriptSentences });
            }
            else if (sentence) {
                speech.playSentence(sentence, null, "tts");
            }
            else {
                speech.speakText(playbackText);
            }
        }
        catch (cause) {
            if (request === playbackRequestRef.current) {
                setPlaybackError(cause instanceof Error ? cause.message : "Playback failed.");
            }
        }
    };
    const playTranscript = () => {
        if (speech.isSpeaking) {
            playbackRequestRef.current += 1;
            speech.stopSpeaking();
            return;
        }
        void playPassage();
    };
    function render() {
        const hasTranscript = playbackText.length > 0;
        const capturing = recorder.isRecording && !recorder.isPaused;
        const buttonLabel = capturing ? "Pause recording" : recorder.isPaused ? "Resume recording" : "Start recording";
        const toggleRecording = () => {
            if (recorder.isPaused) void recorder.resume();
            else if (recorder.isRecording) void recorder.pause();
            else void recorder.start();
        };
        return (
          <main className="app-shell compact-app" data-recording={capturing} data-has-content={hasTranscript}>
            <PageStyleSheet settings={state.settings.pageStyle} />
            <TranscriptionSupportDialog isOpen={!recorder.isTranscriptionSupported} requiresCrossOriginIsolation={recorder.requiresCrossOriginIsolation} requiresWebGpu={recorder.requiresWebGpu} support={recorder.runtimeSupport} />
            <SimpleSettings
              disabled={recorder.isRecording || isBlocking}
              isOpen={machine.value.endsWith("-settings")}
              isOpfsAvailable={recorder.isOpfsRecordingAvailable}
              isSpeaking={speech.isSpeaking}
              microphoneDevices={state.microphoneDevices}
              modelDownloadSpeedBps={recorder.modelDownloadSpeedBps}
              modelInventory={recorder.modelInventory}
              modelInventoryMessage={recorder.modelInventoryMessage}
              selectedVoiceId={speech.selectedVoiceId}
              settings={state.settings}
              voiceOptions={speech.voiceOptions}
              onClose={() => setIsSettingsOpen(false)}
              translationControls={<TranslationSettings settings={state.settings} translation={translation} onUpdate={updateSettings} />}
              onReset={() => { translation.disable(); resetSettings(); }}
              onSetPageStyle={setPageStyle} onSetMicrophone={setMicrophone}
              onSetVoice={speech.setSelectedVoiceId} onUpdate={updateSettings}
            />
            <div className="app-layout" inert={machine.value.endsWith("-settings")}>
              <h1 className="sr-only" id="recorder-title" tabIndex={-1}>Word Trail</h1>
              <button className="settings-button" type="button" onClick={() => setIsSettingsOpen(true)} aria-label="Settings" title="Settings">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="record-control">
                <button className="record-button" type="button" onClick={toggleRecording}
                  disabled={recorder.isPreparing || recorder.isChangingCapture || recorder.isTranscribingMedia || !recorder.isTranscriptionSupported}
                  aria-label={buttonLabel} title={buttonLabel} aria-busy={recorder.isPreparing || recorder.isChangingCapture}>
                  {capturing ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="5" height="18" rx="1" /><rect x="14" y="3" width="5" height="18" rx="1" /></svg> : <Circle size={24} />}
                  <span>{recorder.isPreparing ? "Starting" : capturing ? "Pause" : "Record"}</span>
                </button>
                {isBlocking || isBusyTranscribingMedia ? <p className="record-status" role="status">{activityMessage}</p> : null}
              </div>
              {recorder.error ? <p className="error" role="alert">{recorder.error}</p> : null}
              {hasTranscript && locatedPhraseMessages.length > 0 ? <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
                {(["transcript", "map"] as const).map(view => <button key={view} id={`${view}-tab`} type="button" role="tab"
                  aria-selected={state.workspaceView === view} aria-controls={`${view}-panel`} tabIndex={state.workspaceView === view ? 0 : -1}
                  onClick={() => setWorkspaceView(view)} onKeyDown={(event: KeyboardEvent) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === "Home" ? "transcript" : event.key === "End" ? "map" : view === "map" ? "transcript" : "map";
                    setWorkspaceView(next); document.getElementById(`${next}-tab`)?.focus();
                  }}>{view === "map" ? <Map size={18} /> : <FileText size={18} />}{view === "map" ? "Map" : "Transcript"}</button>)}
              </div> : null}
              {hasTranscript ? <section ref={transcriptRef} id="transcript-panel" hidden={locatedPhraseMessages.length > 0 && state.workspaceView === "map"} className="transcript" role="region" aria-label="Transcript" aria-live="polite">
                {transcriptBlocks.map((paragraph, index) => <p key={index} className={index === transcriptBlocks.length - 1 && recorder.partialText ? "partial" : "transcript-paragraph"}>
                  {index < transcriptParagraphs.length ? transcriptParagraphs[index].sentences.map((sentence) => <span key={sentence.id} className="translated-sentence">
                    <button type="button" className={`sentence-button${speech.activeSentenceId === sentence.id ? " active" : ""}`}
                      disabled={isSentencePlaybackUnavailable} onClick={() => void playPassage(sentence)} title="Play this sentence">
                      {sentence.words.length ? sentence.words.map((word, wordIndex) => <span key={wordIndex}
                        className={speech.activeSentenceId === sentence.id && speech.activeWordIndex === wordIndex ? "sentence-word active" : "sentence-word"}>{word.text}</span>) : sentence.text}
                    </button>
                    {translation.enabled && translation.translations[sentence.id]?.source === sentence.text ? <span className="sentence-translation" lang={state.settings.translation.targetLanguage} dir="auto">{translation.translations[sentence.id].text}</span> : null}
                  </span>) : paragraph}
                </p>)}
                <div ref={transcriptEndRef} className="transcript-end-anchor" aria-hidden="true" />
              </section> : null}
              {showSubtitleOverlay ? <div className="subtitle-layer" aria-hidden="true"><canvas ref={setSubtitleCanvas.setCanvas} className="subtitle-canvas" /></div> : null}
              {hasTranscript && locatedPhraseMessages.length > 0 && state.workspaceView === "map" ? <section id="map-panel" role="tabpanel" aria-labelledby="map-tab" className="transcript-map">
                <PhraseLocationMap messages={locatedPhraseMessages} onPlay={(message) => void playPassage(message)} activeMessageId={speech.activeSentenceId}
                  isPlaying={speech.isSpeaking} playbackLabel={selectedTranscriptPlaybackOption?.label ?? "Selected voice"} playbackUnavailable={isSentencePlaybackUnavailable}
                  onStop={() => { playbackRequestRef.current += 1; speech.stopSpeaking(); }} />
              </section> : null}
              {hasTranscript && !isBusyTranscribingMedia && !isSentencePlaybackUnavailable ? <div className="transcript-controls" aria-label="Transcript controls">
                <div className="playback-gadget">
                  <button className="speech-button playback-cta" type="button" onClick={playTranscript}
                    aria-label={speech.isSpeaking ? "Stop reading the transcript aloud" : "Read the transcript aloud"}>
                    {speech.isSpeaking ? <Square size={20} /> : <Play size={20} />}<span>{speech.isSpeaking ? "Stop playback" : "Play transcript"}</span>
                  </button>
                  <select aria-label="Transcript playback voice" className="playback-select" value={state.transcriptPlaybackChoice} disabled={speech.isSpeaking}
                    onChange={(event: DomEvent<Event, HTMLSelectElement>) => handleTranscriptPlaybackChoice(event.currentTarget.value as TranscriptPlaybackChoice)}>
                    {transcriptPlaybackOptions.map((group) => <optgroup key={group.group} label={group.group}>{group.items.map((item) => <option key={item.value} value={item.value} disabled={item.disabled}>{item.label}</option>)}</optgroup>)}
                  </select>
                </div>
              </div> : null}
              {state.playbackError ? <p role="alert" className="error">{state.playbackError}</p> : null}
              {hasTranscript ? <footer className="transcription-download-footer">
                <details className="transcript-download-menu">
                  <summary>Download transcription</summary>
                  <TranscriptDownloads text={playbackText} sentences={transcriptSentences} hasSourceAudio={hasSourceAudio}
                    getSourceMedia={async () => recorder.sourceMedia ?? await recorder.getRecordingSourceMedia()}
                    busy={capturing || recorder.isChangingCapture || recorder.isPreparing || isBusyTranscribingMedia || isBlocking} />
                </details>
              </footer> : null}
            </div>
          </main>
        );
    }
    function refresh() {
        isHelpPage = state.currentPage === '#help';
        isReleasesPage = state.currentPage === '#downloads';
        recorder.update(state.settings);
        transcriptText = recorder.partialText || recorder.paragraphs.at(-1) || "";
        aria = getAriaCopy(state.settings.pageStyle.roleVerbosity);
        transcriptBlocks = recorder.partialText
            ? [...recorder.paragraphs, recorder.partialText]
            : recorder.paragraphs;
        {
            const inputs = [recorder.transcriptParagraphs];
            if (!sameInputs(calculatetranscriptParagraphsInputs, inputs)) {
                transcriptParagraphs = calculatetranscriptParagraphs();
                calculatetranscriptParagraphsInputs = inputs;
            }
        }
        {
            const inputs = [recorder.audioParts, recorder.recordingStartedAt, transcriptParagraphs];
            if (!sameInputs(calculatelocatedPhraseMessagesInputs, inputs)) {
                locatedPhraseMessages = calculatelocatedPhraseMessages();
                calculatelocatedPhraseMessagesInputs = inputs;
            }
        }
        {
            const inputs = [transcriptParagraphs];
            if (!sameInputs(calculatetranscriptSentencesInputs, inputs)) {
                transcriptSentences = calculatetranscriptSentences();
                calculatetranscriptSentencesInputs = inputs;
            }
        }
        translation.update(transcriptSentences, state.settings.translation.sourceLanguage, state.settings.translation.targetLanguage);
        speech.update(transcriptText, transcriptSentences, state.settings.tts, updateTtsSettings);
        showSubtitleOverlay = speech.isSpeaking;
        playbackText = transcriptBlocks.join("\n").trim();
        hasSourceAudio = Boolean(recorder.sourceMedia || recorder.opfsChunkCount > 0);
        {
            const inputs = [hasSourceAudio, speech.browserVoiceOptions, speech.modelVoiceOptions];
            if (!sameInputs(calculatetranscriptPlaybackOptionsInputs, inputs)) {
                transcriptPlaybackOptions = calculatetranscriptPlaybackOptions();
                calculatetranscriptPlaybackOptionsInputs = inputs;
            }
        }
        selectedTranscriptPlaybackOption = transcriptPlaybackOptions
            .flatMap((group) => group.items)
            .find((item) => item.value === state.transcriptPlaybackChoice);
        sentencePlaybackMode = state.transcriptPlaybackChoice.startsWith("source:") && hasSourceAudio ? "source-audio" : "tts";
        isSentencePlaybackUnavailable = sentencePlaybackMode === "tts" && !speech.isSpeechSupported;
        subtitleText = speech.isSpeaking ? speech.activePhraseText || transcriptText : "";
        setSubtitleCanvas.update(subtitleText, state.settings.subtitles);
        isBusyTranscribingMedia = recorder.isTranscribingMedia;
        isLiveRecording = recorder.isRecording && !isBusyTranscribingMedia && !recorder.isPreparing;
        isBlocking = recorder.isModelLoading || (recorder.isPreparing && !isBusyTranscribingMedia);
        activityActive = isBlocking || isBusyTranscribingMedia || isLiveRecording || translation.loading || speech.isSpeaking || Boolean(recorder.progress);
        activityTitle = recorder.isModelLoading ? "Preparing transcription model"
            : isBlocking ? "Preparing microphone"
                : isBusyTranscribingMedia ? "Transcribing media"
                    : isLiveRecording ? "Recording"
                        : translation.loading ? "Preparing translation"
                            : speech.isSpeaking ? "Playing transcript"
                                : recorder.progress ? "Processing audio" : "Ready";
        activityMessage = recorder.isModelLoading ? recorder.modelLoadMessage || "Loading model files. Keep this tab open."
            : isBlocking ? "Starting the microphone and transcription engine. Allow microphone access if prompted."
                : isBusyTranscribingMedia ? recorder.progress || "Preparing media. You can review the transcript as text arrives."
                    : isLiveRecording ? recorder.progress || "Microphone is live. New speech will appear in the transcript."
                        : translation.loading ? translation.status
                            : speech.isSpeaking ? speech.speechStatus || "Playing the selected audio or voice."
                                : recorder.progress || speech.speechStatus || (translation.enabled ? translation.status : "Record or upload media to begin.");
        activityProgress = recorder.isModelLoading
            ? recorder.modelLoadTotalBytes > 0 ? recorder.modelLoadProgress : undefined
            : isBusyTranscribingMedia && recorder.mediaTranscriptionProgress > 0 ? recorder.mediaTranscriptionProgress : undefined;
        patch(host, render());
        scope.watch("settings-url", [state.settings], () => {
            encodeSettingsInUrl(state.settings);
        });
        scope.watch("hash-navigation", [], () => {
            const syncPage = () => setCurrentPage(window.location.hash);
            window.addEventListener("hashchange", syncPage);
            return () => window.removeEventListener("hashchange", syncPage);
        });
        scope.watch("page-focus", [state.currentPage, isHelpPage, isReleasesPage], () => {
            document.title = isHelpPage ? "Help — Word Trail" : isReleasesPage ? "Downloads — Word Trail" : "Word Trail";
            // Move focus for in-app navigation; leave initial page focus to the browser.
            if (previousPageRef.current !== state.currentPage) {
                document.getElementById(isHelpPage ? "help-title" : isReleasesPage ? "releases-title" : "recorder-title")?.focus({ preventScroll: true });
            }
            previousPageRef.current = state.currentPage;
            window.scrollTo(0, 0);
        });
        scope.watch("history-settings", [], () => {
            const syncSettingsFromUrl = () => setSettings(readSettingsFromUrl());
            window.addEventListener("popstate", syncSettingsFromUrl);
            return () => window.removeEventListener("popstate", syncSettingsFromUrl);
        });
        scope.watch("microphone-devices", [], () => {
            let isMounted = true;
            const refreshMicrophones = async () => {
                if (!navigator.mediaDevices?.enumerateDevices)
                    return;
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (!isMounted)
                    return;
                setMicrophoneDevices(devices.filter((device) => device.kind === "audioinput"));
            };
            void refreshMicrophones();
            navigator.mediaDevices?.addEventListener?.("devicechange", refreshMicrophones);
            return () => {
                isMounted = false;
                navigator.mediaDevices?.removeEventListener?.("devicechange", refreshMicrophones);
            };
        });
        scope.watch("selected-microphone", [state.microphoneDevices, setMicrophone, state.settings.microphone.deviceId], () => {
            const selectedDeviceId = state.settings.microphone.deviceId;
            if (!selectedDeviceId)
                return;
            if (state.microphoneDevices.length === 0)
                return;
            if (state.microphoneDevices.some((device) => device.deviceId === selectedDeviceId))
                return;
            setMicrophone("");
        });
        scope.watch("recording-microphones", [recorder?.isRecording], () => {
            if (recorder?.isRecording) {
                void navigator.mediaDevices
                    ?.enumerateDevices()
                    .then((devices) => setMicrophoneDevices(devices.filter((device) => device.kind === "audioinput")));
            }
        });
        scope.watch("playback-choice", [hasSourceAudio, state.transcriptPlaybackChoice], () => {
            if (state.transcriptPlaybackChoice === "source:original" && !hasSourceAudio) {
                setTranscriptPlaybackChoice("source:normalized");
            }
        });
        scope.watch("transcript-follow", [transcriptBlocks, state.workspaceView], () => {
            const container = transcriptRef.current;
            if (!container)
                return;
            if (transcriptBlocks.length === 0) {
                container.scrollTop = 0;
                return;
            }
            const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
            const distanceFromBottom = maxScrollTop - container.scrollTop;
            const shouldFollow = distanceFromBottom < Math.max(96, container.clientHeight * 0.2);
            if (!shouldFollow)
                return;
            transcriptEndRef.current?.scrollIntoView({ block: "end" });
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) { refresh(); }, dispose: scope.dispose };
});
function TranscriptionSupportDialog({ isOpen, requiresCrossOriginIsolation, requiresWebGpu, support }: {
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
    if (!isOpen)
        return null;
    const missingFeatures = [
        requiresWebGpu && !support.hasWebGpu ? "WebGPU" : "",
        requiresCrossOriginIsolation && !support.hasCrossOriginIsolation ? "cross-origin isolation" : "",
        !support.hasWebAssembly ? "WebAssembly" : "",
        !support.isSecureContext ? "a secure HTTPS or localhost page" : ""
    ].filter(Boolean);
    return (<div className="error-overlay" role="presentation">
      <section aria-label="Browser upgrade required" aria-modal="true" className="error-dialog" role="alertdialog">
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
    </div>);
}
function formatFeatureList(features: string[]) {
    if (features.length === 0)
        return "required browser features";
    if (features.length === 1)
        return features[0];
    if (features.length === 2)
        return `${features[0]} and ${features[1]}`;
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
document.getElementById("root")!.append(App({}));
