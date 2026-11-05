import { h, Fragment, defineElement, patch, type DomEvent } from "./ui/dom";
import { createLifecycle, sameInputs } from "./ui/lifecycle";
import { createNavigationMachine, createStateMachine } from "./state/machine";
import { TranslationSettings } from "./components/TranslationSettings";
import { createBrowserTranslation } from "./translation/createBrowserTranslation";
import { CornerDownRight, Ellipsis, Play, Search, Square, Upload } from "./ui/icons";
import "./styles.css";
import "./studio.css";
import "./settings.css";
import "./design/system.css";
import "./help.css";
import "./releases.css";
import "./minimal.css";
import { HelpPage } from "./components/HelpPage";
import { ReleasesPage } from "./components/ReleasesPage";
import { PageStyleSheet } from "./components/PageStyleSheet";
import { PhraseLocationMap } from "./components/PhraseLocationMap";
import { SimpleSettings } from "./components/SimpleSettings";
import type { PageStyleSettings } from "./config/pageStyle";
import { cloneRuntimeSettings, defaultRuntimeSettings, encodeSettingsInUrl, getTranscriptionModelOption, readSettingsFromUrl, type RuntimeTtsSettings, type SettingsOption } from "./config/settingsOptions";
import type { TranscriptionModelId } from "./config/settings";
import { getTypefaceAssFamily } from "./config/typefaces";
import { createTranscriber } from "./recorder/createTranscriber";
import { createSubtitleSpeech } from "./speech/createSubtitleSpeech";
import { createJassubSubtitles } from "./subtitles/createJassubSubtitles";
import { splitParagraphIntoSentences, type TranscriptSentence } from "./transcript/timedTranscript";
import { locateTranscriptSentences } from "./transcript/locatedTranscript";
import { TranscriptDownloads } from "./components/TranscriptDownloads";
import { buildOriginalCaptions, captionsToSrt, captionsToVtt, downloadTranscriptBlob, locatedTranscriptToGeoJson, locatedTranscriptToGpx } from "./transcript/transcriptExport";
import { describeSentence, formatClock } from "./transcript/sentenceMeta";
import { TranscriptParagraph } from "./components/TranscriptParagraph";
import { SavedSessions } from "./components/SavedSessions";
import type { TranscriptParagraph as TranscriptParagraphData } from "./transcript/timedTranscript";
type TranscriptPlaybackChoice = "source:original" | "source:normalized" | `web:${string}` | `model:${string}`;
const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const MEDIA_FILE_PATTERN = /\.(aac|aiff?|avi|flac|m4a|m4v|mkv|mov|mp3|mp4|oga|ogg|opus|wav|webm|wma)$/i;
const LONG_PRESS_MS = 500;
const USER_SCROLL_HOLD_MS = 4000;
const isMediaFile = (file: File) => file.type.startsWith("audio/") || file.type.startsWith("video/") || MEDIA_FILE_PATTERN.test(file.name);
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
        playbackRate: 1,
        isDraggingFile: false,
        isEditing: false,
        copyLabel: "Copy",
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
    const setPlaybackRate = (value: number) => contextStore.send({ type: "playbackRate", value });
    const setIsDraggingFile = (value: boolean) => contextStore.send({ type: "isDraggingFile", value });
    const setIsEditing = (value: boolean) => contextStore.send({ type: "isEditing", value });
    const setCopyLabel = (value: string) => contextStore.send({ type: "copyLabel", value });
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
    const timerRef: {
        current: HTMLElement | null;
    } = { current: null };
    const searchCountRef: {
        current: HTMLElement | null;
    } = { current: null };
    const searchInputRef: {
        current: HTMLInputElement | null;
    } = { current: null };
    const searchGoRef: {
        current: HTMLButtonElement | null;
    } = { current: null };
    const sentencesByParagraph = new WeakMap<TranscriptParagraphData, ReturnType<typeof splitParagraphIntoSentences>>();
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
    let transcriptBlocks = recorder.partialText
        ? [...recorder.paragraphs, recorder.partialText]
        : recorder.paragraphs;
    // Unchanged paragraphs keep their sentence arrays, so appending does not redraw earlier text.
    const calculatetranscriptParagraphs = () => recorder.transcriptParagraphs.map((paragraph) => {
        let sentences = sentencesByParagraph.get(paragraph);
        if (!sentences) {
            sentences = splitParagraphIntoSentences(paragraph);
            sentencesByParagraph.set(paragraph, sentences);
        }
        return { ...paragraph, sentences };
    });
    let transcriptParagraphs = calculatetranscriptParagraphs();
    let calculatetranscriptParagraphsInputs: readonly unknown[] | undefined;
    const calculatelocatedPhraseMessages = () => {
        const sentences = transcriptParagraphs.flatMap((paragraph) => paragraph.sentences);
        return locateTranscriptSentences(sentences, recorder.locationTrack);
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
    let showSubtitleOverlay = speech.isSpeaking && state.settings.subtitles.overlayEnabled;
    let playbackText = transcriptBlocks.join("\n").trim();
    let hasSourceAudio = Boolean(recorder.sourceMedia || recorder.hasRecordingAudio || recorder.opfsChunkCount > 0);
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
    let subtitleText = showSubtitleOverlay ? speech.activePhraseText || transcriptText : "";
    const setSubtitleCanvas = createJassubSubtitles(subtitleText, state.settings.subtitles, (cause) => {
        setPlaybackError(cause instanceof Error ? cause.message : "Subtitle rendering failed.");
    });
    scope.own(setSubtitleCanvas.dispose);
    let isBusyTranscribingMedia = recorder.isTranscribingMedia;
    let isBlocking = recorder.isModelLoading || (recorder.isPreparing && !isBusyTranscribingMedia);
    let activityMessage = recorder.isModelLoading ? recorder.modelLoadMessage || "Loading model files. Keep this tab open."
        : isBlocking ? "Starting the microphone and transcription engine. Allow microphone access if prompted."
            : isBusyTranscribingMedia ? recorder.progress || "Preparing media. You can review the transcript as text arrives."
                : "";
    const handleMediaFiles = (files: FileList | null | undefined) => {
        if (!files?.length)
            return;
        const file = Array.from(files).find(isMediaFile);
        if (!file) {
            setPlaybackError(`${files[0].name} can't be transcribed. Choose an audio or video file.`);
            return;
        }
        if (recorder.isTranscribingMedia || recorder.isPreparing || recorder.isModelLoading) {
            setPlaybackError("Wait for the current transcription to finish, or cancel it, before adding a file.");
            return;
        }
        if (recorder.isRecording && !recorder.isPaused) {
            setPlaybackError("Pause the recording before adding a file.");
            return;
        }
        if (!confirmDiscard())
            return;
        setPlaybackError("");
        speech.stopSpeaking();
        void recorder.transcribeMediaFile(file);
    };
    /** Sessions are autosaved, so replacing one only needs asking when saving is turned off. */
    const confirmDiscard = () => playbackText.length === 0 ||
        (state.settings.recording.shouldRecordToOpfs && recorder.isOpfsRecordingAvailable) ||
        window.confirm("Saving is turned off, so this transcript will be lost. Continue?");
    const copyTranscript = async () => {
        try {
            await navigator.clipboard.writeText(`${playbackText}\n`);
            setCopyLabel("Copied");
            window.setTimeout(() => setCopyLabel("Copy"), 1500);
        }
        catch {
            setPlaybackError("The browser did not allow copying to the clipboard.");
        }
    };
    const downloadText = (text: string, fileName: string, type: string) => downloadTranscriptBlob(new Blob([text], { type: `${type};charset=utf-8` }), fileName);
    const engineLabel = () => {
        const engine = recorder.transcriptionEngine;
        if (!engine)
            return "";
        if (engine === "speech")
            return "On-device browser speech (timings estimated)";
        return getTranscriptionModelOption(engine as TranscriptionModelId)?.label ?? engine;
    };
    const searchRef = { query: "", matches: [] as Element[], index: -1 };
    const applySearch = (query = searchRef.query) => {
        searchRef.query = query;
        const panel = transcriptRef.current;
        const needle = query.trim().toLowerCase();
        panel?.querySelectorAll(".search-match, .search-current").forEach((element) => element.classList.remove("search-match", "search-current"));
        searchRef.matches = needle && panel ? Array.from(panel.querySelectorAll(".sentence-button")).filter((element) => element.textContent?.toLowerCase().includes(needle)) : [];
        searchRef.matches.forEach((element) => element.classList.add("search-match"));
        searchRef.index = Math.min(searchRef.index, searchRef.matches.length - 1);
        searchRef.matches[searchRef.index]?.classList.add("search-current");
        renderSearchCount();
    };
    const renderSearchCount = () => {
        if (searchCountRef.current)
            searchCountRef.current.textContent = searchRef.query.trim() ? `${searchRef.index + 1}/${searchRef.matches.length}` : "";
        if (searchGoRef.current)
            searchGoRef.current.hidden = !searchRef.matches.length;
    };
    const goToMatch = (step: 1 | -1 = 1) => {
        if (!searchRef.matches.length)
            return;
        searchRef.matches[searchRef.index]?.classList.remove("search-current");
        const { length } = searchRef.matches;
        searchRef.index = step === 1 || searchRef.index >= 0 ? (searchRef.index + step + length) % length : length - 1;
        const match = searchRef.matches[searchRef.index];
        match.classList.add("search-current");
        match.scrollIntoView({ block: "center" });
        renderSearchCount();
    };
    // Typing stays in the search box, so moving to the sentence is its own step. Escape comes back.
    const focusCurrentMatch = () => {
        if (searchRef.index < 0)
            goToMatch();
        // The match may be behind the map, and a hidden element cannot take focus.
        setWorkspaceView("transcript");
        requestAnimationFrame(() => {
            const match = searchRef.matches[searchRef.index] as HTMLElement | undefined;
            match?.focus({ preventScroll: true });
            match?.scrollIntoView({ block: "center" });
        });
    };
    const closeMoreMenu = (focusSummary = false) => {
        const menu = document.querySelector<HTMLDetailsElement>(".transcript-download-menu[open]");
        if (!menu)
            return;
        menu.open = false;
        if (focusSummary)
            menu.querySelector("summary")?.focus();
    };
    const returnToSearch = (event: KeyboardEvent) => {
        if (event.key === "Escape" && searchRef.query.trim() && (event.target as Element).matches(".sentence-button"))
            searchInputRef.current?.focus();
    };
    // Word highlighting writes to the DOM directly: see subscribePosition in createSubtitleSpeech.
    const highlightRef: {
        sentence: Element | null;
        word: Element | null;
        lastSentenceId: string | null;
        userScrolledAt: number;
    } = { sentence: null, word: null, lastSentenceId: null, userScrolledAt: 0 };
    const followActive = (element: Element) => {
        const panel = transcriptRef.current;
        if (!panel || panel.hidden || Date.now() - highlightRef.userScrolledAt < USER_SCROLL_HOLD_MS)
            return;
        const bounds = panel.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (rect.top >= bounds.top + bounds.height * 0.1 && rect.bottom <= bounds.bottom - bounds.height * 0.25)
            return;
        panel.scrollTo({
            top: panel.scrollTop + rect.top - bounds.top - panel.clientHeight * 0.35,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        });
    };
    const applyHighlight = () => {
        const panel = transcriptRef.current;
        const sentenceId = speech.activeSentenceId;
        const sentence = sentenceId && panel ? panel.querySelector(`[data-sentence-id="${CSS.escape(sentenceId)}"]`) : null;
        const word = sentence?.children[speech.activeWordIndex] ?? null;
        const changed = sentence !== highlightRef.sentence || word !== highlightRef.word;
        if (sentence !== highlightRef.sentence)
            highlightRef.sentence?.classList.remove("active");
        if (word !== highlightRef.word)
            highlightRef.word?.classList.remove("active");
        sentence?.classList.add("active");
        word?.classList.add("active");
        highlightRef.sentence = sentence;
        highlightRef.word = word;
        if (changed && (word ?? sentence))
            followActive((word ?? sentence)!);
    };
    scope.own(speech.subscribePosition(() => {
        applyHighlight();
        // Only the map and the optional overlay render from the position, one sentence at a time.
        if (speech.activeSentenceId !== highlightRef.lastSentenceId || showSubtitleOverlay) {
            highlightRef.lastSentenceId = speech.activeSentenceId;
            if (state.workspaceView === "map" || showSubtitleOverlay)
                scope.invalidate();
        }
    }));
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
        if (sentence && speech.isSpeaking && speech.isPlayingAll && speech.seekToSentence(sentence))
            return;
        if (sentence && speech.isSpeaking && speech.activeSentenceId === sentence.id) {
            playbackRequestRef.current += 1;
            speech.stopSpeaking();
            return;
        }
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
            else if (transcriptSentences.length > 0) {
                speech.playAll(transcriptSentences);
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
        if (!speech.isSpeaking)
            void playPassage();
        else if (speech.isPlaybackPaused)
            speech.resumePlayback();
        else
            speech.pausePlayback();
    };
    const stopTranscript = () => {
        playbackRequestRef.current += 1;
        speech.stopSpeaking();
    };
    const startNewSession = () => {
        if (!confirmDiscard())
            return;
        stopTranscript();
        setIsEditing(false);
        setWorkspaceView("transcript");
        setPlaybackError("");
        void recorder.newSession();
    };
    const playSentenceFromTranscript = (sentence: TranscriptSentence) => { void playPassage(sentence); };
    function render() {
        const hasTranscript = playbackText.length > 0;
        const hasWorkspace = hasTranscript || recorder.isRecording || recorder.isPreparing || isBusyTranscribingMedia;
        const capturing = recorder.isRecording && !recorder.isPaused;
        const showCapture = recorder.isRecording && !recorder.isPreparing && !isBusyTranscribingMedia;
        const buttonLabel = capturing ? "Pause recording" : recorder.isPaused ? "Resume recording" : "Start recording";
        const captureLabel = recorder.isPreparing ? "Starting" : recorder.isPaused ? "Paused" : recorder.isModelLoading ? "Recording, preparing transcription" : "Recording";
        const isWorking = recorder.isPreparing || recorder.isChangingCapture || recorder.isModelLoading || isBusyTranscribingMedia;
        const recordState = capturing ? "recording" : recorder.isPaused ? "paused" : "idle";
        const workProgress = isBusyTranscribingMedia ? recorder.mediaTranscriptionProgress : recorder.isModelLoading && recorder.modelLoadProgress > 0 ? recorder.modelLoadProgress : null;
        // Uploaded media has no location, so the map only exists for recordings.
        const canShowMap = !recorder.sourceMedia;
        const view = canShowMap ? state.workspaceView : "transcript";
        const views = canShowMap ? ["transcript", "map"] as const : ["transcript"] as const;
        const toggleRecording = () => {
            if (recorder.isPaused) void recorder.resume();
            else if (recorder.isRecording) void recorder.pause();
            else if (confirmDiscard()) { stopTranscript(); void recorder.start(); }
        };
        const page = isHelpPage ? <HelpPage /> : isReleasesPage ? <ReleasesPage /> : null;
        return (
          <main className="app-shell compact-app" data-recording={capturing} data-has-content={hasTranscript} data-workspace={hasWorkspace} data-page={page ? "document" : "workspace"}>
            <PageStyleSheet settings={state.settings.pageStyle} />
            <TranscriptionSupportDialog isOpen={!recorder.isTranscriptionSupported} requiresCrossOriginIsolation={recorder.requiresCrossOriginIsolation} requiresWebGpu={recorder.requiresWebGpu} support={recorder.runtimeSupport} />
            <SimpleSettings
              disabled={capturing || isBusyTranscribingMedia || isBlocking}
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
              sessionControls={<div className="saved-recordings">
                <SavedSessions isOpen={machine.value.endsWith("-settings")} disabled={recorder.isRecording || isBlocking} list={recorder.listSessions}
                  onOpen={(name) => { stopTranscript(); setIsSettingsOpen(false); setWorkspaceView("transcript"); void recorder.openSession(name); }}
                  onDelete={recorder.deleteSession} />
                <div className="offline-model">
                  <p className="settings-hint">{recorder.modelCacheStatus}</p>
                  <button type="button" disabled={recorder.isModelCached || recorder.isModelLoading} onClick={() => recorder.cacheModel()}>Download model for offline use</button>
                </div>
              </div>}
              onReset={() => { translation.disable(); resetSettings(); }}
              onSetPageStyle={setPageStyle} onSetMicrophone={setMicrophone}
              onSetVoice={speech.setSelectedVoiceId} onUpdate={updateSettings}
            />
            {page ? <div className="app-document" inert={machine.value.endsWith("-settings")}>{page}</div> : <div className="app-layout" inert={machine.value.endsWith("-settings")}>
              <h1 className="sr-only" id="recorder-title" tabIndex={-1}>Word Trail</h1>
              {/* First in Tab order, though shown below: a long transcript must not stand between Tab and Record. */}
              <div className="record-control">
                {showCapture ? <div className="live-capture" data-state={recorder.isPaused ? "paused" : recorder.isPreparing ? "starting" : "recording"}>
                  <span className="live-capture-label" role="status">{captureLabel}</span>
                  <span ref={timerRef} className="live-capture-timer" role="timer" aria-live="off" aria-label="Recording duration">{formatClock(recorder.getElapsedMs())}</span>
                  <canvas ref={recorder.setWaveformCanvas} className="live-capture-waveform" aria-hidden="true" />
                </div> : null}
                {isBlocking || isBusyTranscribingMedia ? <p className="record-status" role="status">{activityMessage}</p> : null}
                {isBusyTranscribingMedia ? <div className="media-progress">
                  <progress max={100} value={recorder.mediaTranscriptionProgress} aria-label="Transcription progress" />
                  <button type="button" onClick={() => recorder.cancelMediaTranscription()}>Cancel</button>
                </div> : null}
                <div className="record-dock">
                  <button className="upload-button" type="button" onClick={() => mediaInputRef.current?.click()} aria-label="Upload media" title="Upload media"
                    disabled={capturing || recorder.isPreparing || recorder.isChangingCapture || recorder.isModelLoading || isBusyTranscribingMedia}><Upload size={22} /></button>
                  <input ref={mediaInputRef} className="media-input" hidden type="file" accept="audio/*,video/*" onChange={handleMediaInputChange} />
                  <button className="record-button" type="button" onClick={toggleRecording} data-state={recordState} data-working={isWorking ? "true" : undefined}
                    disabled={recorder.isPreparing || recorder.isChangingCapture || recorder.isTranscribingMedia || !recorder.isTranscriptionSupported}
                    aria-label={buttonLabel} title={buttonLabel} aria-busy={isWorking}>
                    <svg className="record-spinner" viewBox="0 0 100 100" aria-hidden="true" data-determinate={workProgress === null ? undefined : "true"}>
                      <circle cx="50" cy="50" r="45" pathLength="100" style={workProgress === null ? undefined : { strokeDasharray: `${workProgress} 100` }} />
                    </svg>
                    <span className="record-glyph" aria-hidden="true" />
                  </button>
                  <button className="settings-button" type="button" onClick={() => setIsSettingsOpen(true)} aria-label="Settings" title="Settings">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>
              {hasWorkspace ? <header className="workspace-toolbar">
                <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
                  {views.map(item => <button key={item} id={`${item}-tab`} type="button" role="tab"
                    aria-selected={view === item} aria-controls={`${item}-panel`} tabIndex={view === item ? 0 : -1}
                    onClick={() => setWorkspaceView(item)} onKeyDown={(event: KeyboardEvent) => {
                      if (!canShowMap || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const next = event.key === "Home" ? "transcript" : event.key === "End" ? "map" : item === "map" ? "transcript" : "map";
                      setWorkspaceView(next); document.getElementById(`${next}-tab`)?.focus();
                    }}>{item === "map" ? "Map" : "Transcript"}</button>)}
                </div>
                {hasTranscript || recorder.isPaused ? <div className="workspace-tools">
                  {state.isEditing ? <button type="button" className="done-button" onClick={() => setIsEditing(false)}>Done</button> : null}
                  {hasTranscript && !isBusyTranscribingMedia && !isSentencePlaybackUnavailable && !state.isEditing ? <>
                    <button className="speech-button playback-cta" type="button" onClick={playTranscript}
                      aria-label={!speech.isSpeaking ? "Read the transcript aloud" : speech.isPlaybackPaused ? "Resume reading" : "Pause reading"}
                      title={!speech.isSpeaking ? "Play transcript" : speech.isPlaybackPaused ? "Resume" : "Pause"}>
                      {speech.isSpeaking && !speech.isPlaybackPaused ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="5" height="18" rx="1" /><rect x="14" y="3" width="5" height="18" rx="1" /></svg> : <Play size={20} />}
                    </button>
                    {speech.isSpeaking ? <button className="speech-button" type="button" onClick={stopTranscript} aria-label="Stop reading the transcript aloud" title="Stop"><Square size={20} /></button> : null}
                  </> : null}
                  {hasTranscript ? <div className="transcript-search">
                    <Search size={18} />
                    <input ref={searchInputRef} type="search" aria-label="Search transcript" placeholder="Search" onInput={(event: Event) => { searchRef.index = -1; applySearch((event.target as HTMLInputElement).value); goToMatch(); }}
                      onKeyDown={(event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); goToMatch(event.shiftKey ? -1 : 1); } }} />
                    <span ref={searchCountRef} className="transcript-search-count" aria-live="polite">{searchRef.query.trim() ? `${searchRef.index + 1}/${searchRef.matches.length}` : ""}</span>
                    <button ref={searchGoRef} type="button" aria-label="Go to sentence" title="Go to sentence" hidden={!searchRef.matches.length} onClick={focusCurrentMatch}><CornerDownRight size={18} /></button>
                  </div> : null}
                  <details className="transcript-download-menu">
                    <summary aria-label="More options" title="More"><Ellipsis size={22} /></summary>
                    <div className="more-panel">
                      {/* Hidden rather than removed: inserting it moves its siblings, and moved items collapsed inside the closed menu. */}
                      <div className="more-playback" hidden={!hasTranscript || isBusyTranscribingMedia || isSentencePlaybackUnavailable || state.isEditing}>
                        <label>Voice
                          <select aria-label="Transcript playback voice" className="playback-select" value={state.transcriptPlaybackChoice} disabled={speech.isSpeaking}
                    onChange={(event: DomEvent<Event, HTMLSelectElement>) => handleTranscriptPlaybackChoice(event.currentTarget.value as TranscriptPlaybackChoice)}>
                    {transcriptPlaybackOptions.map((group) => <optgroup key={group.group} label={group.group}>{group.items.map((item) => <option key={item.value} value={item.value} disabled={item.disabled}>{item.label}</option>)}</optgroup>)}
                  </select>
                        </label>
                        <label>Speed
                          <select aria-label="Playback speed" className="playback-speed" value={String(state.playbackRate)}
                    onChange={(event: DomEvent<Event, HTMLSelectElement>) => { const rate = Number(event.currentTarget.value); setPlaybackRate(rate); speech.setPlaybackRate(rate); }}>
                    {PLAYBACK_SPEEDS.map((speed) => <option key={speed} value={String(speed)}>{speed}x</option>)}
                  </select>
                        </label>
                      </div>
                      {hasTranscript ? <>
                        <button type="button" onClick={() => void copyTranscript()}>{state.copyLabel}</button>
                        <button type="button" disabled={capturing || isBusyTranscribingMedia} onClick={() => { closeMoreMenu(); speech.stopSpeaking(); setIsEditing(true); }}>Edit</button>
                      </> : null}
                      <button className="new-session-button" type="button" onClick={() => { closeMoreMenu(); startNewSession(); }} disabled={capturing || isBusyTranscribingMedia || isBlocking}
                        aria-label="New recording" title="Save this and start again">New recording</button>
                      {hasTranscript ? <>
                      <div className="transcript-export-buttons">
                      <button type="button" onClick={() => downloadText(`${playbackText}\n`, "transcript.txt", "text/plain")}>Download text</button>
                    <button type="button" onClick={() => downloadText(captionsToSrt(buildOriginalCaptions(transcriptSentences)), "transcript.srt", "application/x-subrip")}>Subtitles (SRT)</button>
                    <button type="button" onClick={() => downloadText(captionsToVtt(buildOriginalCaptions(transcriptSentences)), "transcript.vtt", "text/vtt")}>Subtitles (VTT)</button>
                    {locatedPhraseMessages.length > 0 ? <>
                      <button type="button" onClick={() => downloadText(locatedTranscriptToGpx(locatedPhraseMessages, recorder.locationTrack, recorder.recordingStartedAt), "transcript.gpx", "application/gpx+xml")}>Route (GPX)</button>
                      <button type="button" onClick={() => downloadText(locatedTranscriptToGeoJson(locatedPhraseMessages, recorder.locationTrack, recorder.recordingStartedAt), "transcript.geojson", "application/geo+json")}>Route (GeoJSON)</button>
                    </> : null}
                  </div>
                  <details className="more-media">
                        <summary>Audio and video</summary>
                        <TranscriptDownloads showTextDownload={false} text={playbackText} sentences={transcriptSentences} hasSourceAudio={hasSourceAudio}
                    getSourceMedia={async () => recorder.sourceMedia ?? await recorder.getRecordingSourceMedia()}
                    busy={capturing || recorder.isChangingCapture || recorder.isPreparing || isBusyTranscribingMedia || isBlocking} />
                      </details>
                      </> : null}
                    </div>
                  </details>
                </div> : null}
              </header> : null}
              {recorder.error ? <p className="error" role="alert">{recorder.error}</p> : null}
              {recorder.opfsError ? <p className="error" role="alert">Saving failed: {recorder.opfsError}</p> : null}
              {hasWorkspace ? <section ref={transcriptRef} id="transcript-panel" hidden={view === "map"} className="transcript" role="tabpanel" aria-labelledby="transcript-tab" aria-label="Transcript" aria-live="polite" onKeyDown={returnToSearch}>
                {transcriptParagraphs.map((paragraph) => <TranscriptParagraph key={paragraph.id} sentences={paragraph.sentences}
                  translations={translation.enabled ? Object.fromEntries(paragraph.sentences.flatMap((sentence) => translation.translations[sentence.id]?.source === sentence.text ? [[sentence.id, translation.translations[sentence.id].text]] : [])) : null}
                  translationKey={translation.enabled ? paragraph.sentences.map((sentence) => translation.translations[sentence.id]?.source === sentence.text ? translation.translations[sentence.id].text : "").join("\n") : ""}
                  translationLanguage={state.settings.translation.targetLanguage} disabled={isSentencePlaybackUnavailable} editing={state.isEditing}
                  onPlay={playSentenceFromTranscript} onEdit={recorder.editSentence} />)}
                {recorder.paragraphs.slice(transcriptParagraphs.length).map((paragraph, index) => <p key={`plain-${index}`} className="transcript-paragraph">{paragraph}</p>)}
                {recorder.partialText ? <p key="partial" className="partial">{recorder.partialText}</p> : null}
                <div ref={transcriptEndRef} className="transcript-end-anchor" aria-hidden="true" />
              </section> : null}
              {showSubtitleOverlay ? <div className="subtitle-layer" aria-hidden="true"><canvas ref={setSubtitleCanvas.setCanvas} className="subtitle-canvas" /></div> : null}
              {hasWorkspace && canShowMap ? <section id="map-panel" hidden={view !== "map"} role="tabpanel" aria-labelledby="map-tab" className="transcript-map">
                {view === "map" && (locatedPhraseMessages.length > 0 ?
                <PhraseLocationMap messages={locatedPhraseMessages} track={recorder.locationTrack} onPlay={(message) => void playPassage(message)} activeMessageId={speech.activeSentenceId}
                  isPlaying={speech.isSpeaking} playbackLabel={selectedTranscriptPlaybackOption?.label ?? "Selected voice"} playbackUnavailable={isSentencePlaybackUnavailable}
                  onStop={stopTranscript} /> : <p className="location-unknown" role="status">{getLocationMessage(recorder.locationStatus)}</p>)}
              </section> : null}
              {state.playbackError ? <p role="alert" className="error">{state.playbackError}</p> : null}
              {!state.playbackError && speech.speechStatus.includes("failed") ? <p role="alert" className="error">{speech.speechStatus}</p> : null}
              {state.isDraggingFile ? <div className="drop-overlay" aria-hidden="true"><Upload size={32} /><span>Drop to transcribe</span></div> : null}
            </div>}
          </main>
        );
    }
    function refresh() {
        isHelpPage = state.currentPage === '#help';
        isReleasesPage = state.currentPage === '#downloads';
        recorder.update(state.settings);
        transcriptText = recorder.partialText || recorder.paragraphs.at(-1) || "";
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
            const inputs = [recorder.locationTrack, transcriptParagraphs];
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
        showSubtitleOverlay = speech.isSpeaking && state.settings.subtitles.overlayEnabled;
        playbackText = transcriptBlocks.join("\n").trim();
        hasSourceAudio = Boolean(recorder.sourceMedia || recorder.hasRecordingAudio || recorder.opfsChunkCount > 0);
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
        subtitleText = showSubtitleOverlay ? speech.activePhraseText || transcriptText : "";
        setSubtitleCanvas.update(subtitleText, state.settings.subtitles);
        isBusyTranscribingMedia = recorder.isTranscribingMedia;
        isBlocking = recorder.isModelLoading || (recorder.isPreparing && !isBusyTranscribingMedia);
        activityMessage = recorder.isModelLoading ? recorder.modelLoadMessage || "Loading model files. Keep this tab open."
            : isBlocking ? "Starting the microphone and transcription engine. Allow microphone access if prompted."
                : isBusyTranscribingMedia ? recorder.progress || "Preparing media. You can review the transcript as text arrives." : "";
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
        scope.watch("recording-clock", [recorder.isRecording && !recorder.isPaused && !isBusyTranscribingMedia], () => {
            if (!recorder.isRecording || recorder.isPaused || isBusyTranscribingMedia)
                return;
            const interval = window.setInterval(() => {
                if (timerRef.current)
                    timerRef.current.textContent = formatClock(recorder.getElapsedMs());
            }, 250);
            return () => window.clearInterval(interval);
        });
        scope.watch("unsaved-recording-guard", [], () => {
            const warn = (event: BeforeUnloadEvent) => {
                if (recorder.isRecording && !recorder.isPaused)
                    event.preventDefault();
            };
            window.addEventListener("beforeunload", warn);
            return () => window.removeEventListener("beforeunload", warn);
        });
        scope.watch("file-drop", [], () => {
            let depth = 0;
            const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
            const onDragEnter = (event: DragEvent) => {
                if (!carriesFiles(event))
                    return;
                event.preventDefault();
                depth += 1;
                setIsDraggingFile(true);
            };
            // Without this the browser navigates away to the dropped file.
            const onDragOver = (event: DragEvent) => {
                if (!carriesFiles(event))
                    return;
                event.preventDefault();
                if (event.dataTransfer)
                    event.dataTransfer.dropEffect = "copy";
            };
            const onDragLeave = (event: DragEvent) => {
                if (!carriesFiles(event))
                    return;
                depth = Math.max(0, depth - 1);
                if (depth === 0)
                    setIsDraggingFile(false);
            };
            const onDrop = (event: DragEvent) => {
                if (!carriesFiles(event))
                    return;
                event.preventDefault();
                depth = 0;
                setIsDraggingFile(false);
                if (machine.value === "workspace")
                    handleMediaFiles(event.dataTransfer?.files);
            };
            window.addEventListener("dragenter", onDragEnter);
            window.addEventListener("dragover", onDragOver);
            window.addEventListener("dragleave", onDragLeave);
            window.addEventListener("drop", onDrop);
            return () => {
                window.removeEventListener("dragenter", onDragEnter);
                window.removeEventListener("dragover", onDragOver);
                window.removeEventListener("dragleave", onDragLeave);
                window.removeEventListener("drop", onDrop);
            };
        });
        scope.watch("sentence-details", [], () => {
            const tooltip = document.createElement("div");
            tooltip.className = "sentence-meta";
            tooltip.id = "sentence-meta";
            tooltip.setAttribute("role", "tooltip");
            tooltip.hidden = true;
            document.body.append(tooltip);
            let current: HTMLElement | null = null;
            let pressTimer: number | undefined;
            let suppressClick = false;
            const sentenceFrom = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>(".sentence-button") ?? null;
            const show = (button: HTMLElement) => {
                const sentence = transcriptSentences.find((item) => item.id === button.dataset.sentenceId);
                if (!sentence)
                    return;
                const location = locatedPhraseMessages.find((item) => item.id === sentence.id);
                tooltip.replaceChildren(...describeSentence(sentence, {
                    location,
                    recordingStartedAt: recorder.recordingStartedAt,
                    sourceName: recorder.sourceMedia?.fileName,
                    engineLabel: engineLabel()
                }).flatMap(([label, value]) => {
                    const term = document.createElement("dt");
                    term.textContent = label;
                    const detail = document.createElement("dd");
                    detail.textContent = value;
                    return [term, detail];
                }));
                tooltip.hidden = false;
                const rect = button.getBoundingClientRect();
                const { width, height } = tooltip.getBoundingClientRect();
                const above = rect.top - height - 8;
                tooltip.style.top = `${above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + 8)}px`;
                tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
                button.setAttribute("aria-describedby", tooltip.id);
                current = button;
            };
            const hide = () => {
                tooltip.hidden = true;
                current?.removeAttribute("aria-describedby");
                current = null;
                window.clearTimeout(pressTimer);
            };
            const onPointerOver = (event: PointerEvent) => {
                const button = sentenceFrom(event.target);
                if (button && event.pointerType === "mouse")
                    show(button);
            };
            const onPointerOut = (event: PointerEvent) => {
                if (event.pointerType === "mouse" && sentenceFrom(event.target) && !sentenceFrom(event.relatedTarget))
                    hide();
            };
            const onFocusIn = (event: FocusEvent) => {
                const button = sentenceFrom(event.target);
                if (button?.matches(":focus-visible"))
                    show(button);
            };
            const onFocusOut = () => hide();
            const onPointerDown = (event: PointerEvent) => {
                const button = sentenceFrom(event.target);
                if (!button || event.pointerType === "mouse")
                    return;
                pressTimer = window.setTimeout(() => {
                    suppressClick = true;
                    show(button);
                }, LONG_PRESS_MS);
            };
            const cancelPress = () => window.clearTimeout(pressTimer);
            const onClickCapture = (event: MouseEvent) => {
                if (suppressClick) {
                    suppressClick = false;
                    event.preventDefault();
                    event.stopPropagation();
                }
                else if (sentenceFrom(event.target) === null)
                    hide();
            };
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key !== "Escape")
                    return;
                hide();
                closeMoreMenu(true);
            };
            const onDocumentPointerDown = (event: PointerEvent) => {
                if (!(event.target as Element).closest?.(".transcript-download-menu"))
                    closeMoreMenu();
            };
            // Any manual scroll also stops the playback highlight pulling the view back for a moment.
            const onUserScroll = () => {
                highlightRef.userScrolledAt = Date.now();
                hide();
            };
            const onScrollKey = (event: KeyboardEvent) => {
                if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key))
                    onUserScroll();
            };
            const onTranscriptRendered = () => {
                applyHighlight();
                if (searchRef.query)
                    applySearch();
            };
            host.addEventListener("pointerover", onPointerOver);
            host.addEventListener("pointerout", onPointerOut);
            host.addEventListener("focusin", onFocusIn);
            host.addEventListener("focusout", onFocusOut);
            host.addEventListener("pointerdown", onPointerDown);
            host.addEventListener("pointerup", cancelPress);
            host.addEventListener("pointercancel", cancelPress);
            host.addEventListener("click", onClickCapture, true);
            host.addEventListener("wheel", onUserScroll, { passive: true });
            host.addEventListener("touchmove", onUserScroll, { passive: true });
            host.addEventListener("keydown", onScrollKey);
            host.addEventListener("transcript-rendered", onTranscriptRendered);
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("pointerdown", onDocumentPointerDown);
            return () => {
                host.removeEventListener("pointerover", onPointerOver);
                host.removeEventListener("pointerout", onPointerOut);
                host.removeEventListener("focusin", onFocusIn);
                host.removeEventListener("focusout", onFocusOut);
                host.removeEventListener("pointerdown", onPointerDown);
                host.removeEventListener("pointerup", cancelPress);
                host.removeEventListener("pointercancel", cancelPress);
                host.removeEventListener("click", onClickCapture, true);
                host.removeEventListener("wheel", onUserScroll);
                host.removeEventListener("touchmove", onUserScroll);
                host.removeEventListener("keydown", onScrollKey);
                host.removeEventListener("transcript-rendered", onTranscriptRendered);
                document.removeEventListener("keydown", onKeyDown);
                document.removeEventListener("pointerdown", onDocumentPointerDown);
                tooltip.remove();
            };
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
            // While playing, the highlighted word decides the scroll position instead.
            if (!shouldFollow || speech.isSpeaking)
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
function getLocationMessage(status: string) {
    if (status === "denied")
        return "Location access is off, so sentences can't be placed on the map. Allow location for this site to record it.";
    if (status === "unavailable")
        return "This device doesn't provide a location, so sentences can't be placed on the map.";
    if (status === "waiting" || status === "active")
        return "Waiting for a location fix. Sentences will appear here as they are placed.";
    return "No recorded locations yet.";
}
document.getElementById("root")!.append(App({}));
