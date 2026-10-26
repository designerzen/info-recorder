import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createPlaybackMachine, createStateMachine } from "../state/machine";
import { appSettings, type SupertonicVoiceId, type TtsProvider } from "../config/settings";
import type { RuntimeTtsSettings } from "../config/settingsOptions";
import type { TranscriptSentence } from "../transcript/timedTranscript";
import { splitSpeechPhrases } from "./subtitlePhrases";
export type SubtitleVoiceOption = {
    id: string;
    name: string;
    provider: TtsProvider;
    lang?: string;
};
type SourceMediaPlayback = {
    url: string;
    kind: "audio" | "video";
};
type SourceMediaPlaybackMode = "original" | "normalized";
type SentencePlaybackTarget = {
    sentence: TranscriptSentence;
    sourceMedia: SourceMediaPlayback | null;
    sourceMode: SourceMediaPlaybackMode;
};
type ActiveTranscriptPosition = {
    sentenceId: string;
    sentenceText: string;
    wordIndex: number;
};
export function createSubtitleSpeech(...initialInputs: [
    text: string,
    transcriptSentences: TranscriptSentence[],
    settings: RuntimeTtsSettings,
    setSettingsValue: (update: Partial<RuntimeTtsSettings>) => void
]) {
    let text = initialInputs[0];
    let transcriptSentences = initialInputs[1];
    let settings = initialInputs[2];
    let setSettingsValue = initialInputs[3];
    const scope = createLifecycle();
    const machine = createPlaybackMachine();
    scope.own(machine.subscribe(scope.invalidate));
    scope.own(machine.dispose);
    const contextStore = createStateMachine({
        speechStatus: "",
        activePhraseIndex: -1,
        activePhraseText: "",
        activeSentenceId: (null) as string | null,
        activeWordIndex: -1,
        webSpeechVoices: ([]) as SpeechSynthesisVoice[]
    }, () => "ready");
    let state = contextStore.context;
    scope.own(contextStore.subscribe(() => { state = contextStore.context; scope.invalidate(); }));
    scope.own(contextStore.dispose);
    const setIsSpeaking = (value: boolean) => machine.send(value ? "PLAY" : "STOP");
    const setSpeechStatus = (value: typeof state.speechStatus | ((previous: typeof state.speechStatus) => typeof state.speechStatus)) => contextStore.send({ type: "speechStatus", value });
    const setActivePhraseIndex = (value: typeof state.activePhraseIndex | ((previous: typeof state.activePhraseIndex) => typeof state.activePhraseIndex)) => contextStore.send({ type: "activePhraseIndex", value });
    const setActivePhraseText = (value: typeof state.activePhraseText | ((previous: typeof state.activePhraseText) => typeof state.activePhraseText)) => contextStore.send({ type: "activePhraseText", value });
    const setActiveSentenceId = (value: typeof state.activeSentenceId | ((previous: typeof state.activeSentenceId) => typeof state.activeSentenceId)) => contextStore.send({ type: "activeSentenceId", value });
    const setActiveWordIndex = (value: typeof state.activeWordIndex | ((previous: typeof state.activeWordIndex) => typeof state.activeWordIndex)) => contextStore.send({ type: "activeWordIndex", value });
    const setWebSpeechVoices = (value: typeof state.webSpeechVoices | ((previous: typeof state.webSpeechVoices) => typeof state.webSpeechVoices)) => contextStore.send({ type: "webSpeechVoices", value });
    const spokenTextRef = { current: "" };
    const mediaRef: {
        current: HTMLMediaElement | null;
    } = { current: null };
    const mediaAudioContextRef: {
        current: AudioContext | null;
    } = { current: null };
    const mediaSourceNodeRef: {
        current: MediaElementAudioSourceNode | null;
    } = { current: null };
    const mediaUrlRef: {
        current: string | null;
    } = { current: null };
    const speechRunRef = { current: 0 };
    const pendingTimeoutRef: {
        current: number | null;
    } = { current: null };
    const wordFrameRef: {
        current: number | null;
    } = { current: null };
    let isSpeechEnabled = settings.enabled;
    let provider = settings.provider;
    let selectedVoiceId = settings.selectedVoiceId;
    let isSpeechSupported = typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        "SpeechSynthesisUtterance" in window;
    let isSupertonicSupported = typeof window !== "undefined" && "gpu" in navigator;
    let isSelectedProviderSupported = provider === "web-speech" ? isSpeechSupported : isSupertonicSupported;
    const setProvider = (value: TtsProvider) => setSettingsValue({ provider: value });
    const setIsSpeechEnabled = (value: boolean) => setSettingsValue({ enabled: value });
    const setSelectedVoiceId = (value: string) => setSettingsValue({ selectedVoiceId: value });
    const resetActiveSpeech = () => {
        setIsSpeaking(false);
        setSpeechStatus("");
        setActivePhraseIndex(-1);
        setActivePhraseText("");
        setActiveSentenceId(null);
        setActiveWordIndex(-1);
    };
    const stopSpeaking = () => {
        speechRunRef.current += 1;
        if (pendingTimeoutRef.current !== null) {
            window.clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
        if (wordFrameRef.current !== null) {
            window.cancelAnimationFrame(wordFrameRef.current);
            wordFrameRef.current = null;
        }
        if (isSpeechSupported) {
            window.speechSynthesis.cancel();
        }
        if (mediaRef.current) {
            mediaRef.current.pause();
            mediaRef.current.src = "";
            mediaRef.current = null;
        }
        mediaSourceNodeRef.current?.disconnect();
        mediaSourceNodeRef.current = null;
        if (mediaAudioContextRef.current) {
            void mediaAudioContextRef.current.close();
            mediaAudioContextRef.current = null;
        }
        if (mediaUrlRef.current) {
            URL.revokeObjectURL(mediaUrlRef.current);
            mediaUrlRef.current = null;
        }
        resetActiveSpeech();
    };
    const connectNormalizedSourceMedia = async (element: HTMLMediaElement) => {
        const context = new AudioContext();
        mediaAudioContextRef.current = context;
        const sourceNode = context.createMediaElementSource(element);
        mediaSourceNodeRef.current = sourceNode;
        // Lightweight voice-lift chain: remove low rumble, compress peaks, then add makeup gain.
        const highPass = context.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.value = 140;
        highPass.Q.value = 0.7;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 18;
        compressor.ratio.value = 3.5;
        compressor.attack.value = 0.006;
        compressor.release.value = 0.18;
        const makeupGain = context.createGain();
        makeupGain.gain.value = 2.4;
        sourceNode.connect(highPass);
        highPass.connect(compressor);
        compressor.connect(makeupGain);
        makeupGain.connect(context.destination);
        if (context.state === "suspended") {
            await context.resume();
        }
    };
    const playSourceMedia = async (sourceMedia: SourceMediaPlayback | null, mode: SourceMediaPlaybackMode = "original", transcriptPlayback?: {
        sentences: TranscriptSentence[];
    }) => {
        if (!sourceMedia)
            return;
        stopSpeaking();
        const runId = speechRunRef.current;
        const element = document.createElement(sourceMedia.kind === "video" ? "video" : "audio");
        element.volume = settings.volume;
        element.preload = "auto";
        element.src = sourceMedia.url;
        mediaRef.current = element;
        const sentences = transcriptPlayback?.sentences ?? transcriptSentences;
        setActivePhraseText(sentences[0]?.text ?? (mode === "normalized" ? "Normalised audio" : "Original audio"));
        setSpeechStatus(mode === "normalized"
            ? `Playing normalised ${sourceMedia.kind} audio.`
            : `Playing original ${sourceMedia.kind}.`);
        const tick = () => {
            if (speechRunRef.current !== runId || mediaRef.current !== element)
                return;
            const activePosition = getActiveTranscriptPosition(sentences, element.currentTime * 1000);
            if (activePosition) {
                setActiveSentenceId(activePosition.sentenceId);
                setActiveWordIndex(activePosition.wordIndex);
                setActivePhraseText(activePosition.sentenceText);
            }
            else {
                setActiveSentenceId(null);
                setActiveWordIndex(-1);
            }
            wordFrameRef.current = window.requestAnimationFrame(tick);
        };
        element.onplay = () => {
            if (speechRunRef.current !== runId || mediaRef.current !== element)
                return;
            setIsSpeaking(true);
            if (sentences.length > 0) {
                wordFrameRef.current = window.requestAnimationFrame(tick);
            }
        };
        element.onended = () => {
            if (speechRunRef.current === runId) {
                resetActiveSpeech();
            }
        };
        element.onerror = () => {
            if (speechRunRef.current === runId) {
                resetActiveSpeech();
                setSpeechStatus(mode === "normalized"
                    ? "Normalised audio playback failed."
                    : "Original audio playback failed.");
            }
        };
        try {
            if (mode === "normalized") {
                await connectNormalizedSourceMedia(element);
            }
            await element.play();
        }
        catch {
            if (speechRunRef.current === runId) {
                resetActiveSpeech();
                setSpeechStatus(mode === "normalized"
                    ? "Normalised audio playback failed."
                    : "Original audio playback failed.");
            }
        }
    };
    const speakWithWebSpeech = (phrases: string[], runId: number) => {
        if (!isSpeechSupported)
            return;
        const nativeVoice = state.webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
        if (phrases.length === 0)
            return;
        let phraseIndex = 0;
        const speakNext = () => {
            if (speechRunRef.current !== runId)
                return;
            const phrase = phrases[phraseIndex];
            if (!phrase) {
                resetActiveSpeech();
                return;
            }
            setActivePhraseIndex(phraseIndex);
            setActivePhraseText(phrase.trim());
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(phrase.trim());
            utterance.lang = nativeVoice?.lang ?? appSettings.tts.lang;
            utterance.voice = nativeVoice ?? null;
            utterance.rate = settings.rate;
            utterance.pitch = settings.pitch;
            utterance.volume = settings.volume;
            utterance.onstart = () => {
                setSpeechStatus(nativeVoice
                    ? `Speaking phrase ${phraseIndex + 1}/${phrases.length} with ${nativeVoice.name}.`
                    : `Speaking phrase ${phraseIndex + 1}/${phrases.length} with browser voice.`);
                setIsSpeaking(true);
            };
            utterance.onend = () => {
                if (speechRunRef.current !== runId)
                    return;
                phraseIndex += 1;
                pendingTimeoutRef.current = window.setTimeout(() => {
                    pendingTimeoutRef.current = null;
                    speakNext();
                }, 0);
            };
            utterance.onerror = () => {
                if (speechRunRef.current !== runId)
                    return;
                resetActiveSpeech();
                setSpeechStatus("Browser speech synthesis failed.");
            };
            window.speechSynthesis.speak(utterance);
        };
        speakNext();
    };
    const speakWithSupertonic = async (phrases: string[], runId: number) => {
        try {
            const { synthesizeSupertonicSpeech } = await import("./supertonicTts");
            const voiceId = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId)
                ? (selectedVoiceId as SupertonicVoiceId)
                : appSettings.tts.supertonic.defaultVoiceId;
            if (phrases.length === 0)
                return;
            const playPhrase = async (phraseIndex: number): Promise<void> => {
                if (speechRunRef.current !== runId)
                    return;
                const phrase = phrases[phraseIndex];
                if (!phrase) {
                    resetActiveSpeech();
                    return;
                }
                setActivePhraseIndex(phraseIndex);
                setActivePhraseText(phrase.trim());
                setIsSpeaking(true);
                setSpeechStatus(`Generating phrase ${phraseIndex + 1}/${phrases.length} with Supertonic ${selectedVoiceId}.`);
                const blob = await synthesizeSupertonicSpeech(phrase.trim(), voiceId);
                if (speechRunRef.current !== runId)
                    return;
                const url = URL.createObjectURL(blob);
                mediaUrlRef.current = url;
                const audio = new Audio(url);
                audio.volume = settings.volume;
                mediaRef.current = audio;
                audio.onplay = () => setSpeechStatus(`Speaking phrase ${phraseIndex + 1}/${phrases.length} with Supertonic ${selectedVoiceId}.`);
                audio.onended = () => {
                    if (mediaUrlRef.current) {
                        URL.revokeObjectURL(mediaUrlRef.current);
                        mediaUrlRef.current = null;
                    }
                    if (mediaRef.current === audio) {
                        mediaRef.current = null;
                    }
                    void playPhrase(phraseIndex + 1);
                };
                audio.onerror = () => {
                    if (mediaUrlRef.current) {
                        URL.revokeObjectURL(mediaUrlRef.current);
                        mediaUrlRef.current = null;
                    }
                    resetActiveSpeech();
                    setSpeechStatus("Supertonic audio playback failed.");
                };
                await audio.play();
            };
            await playPhrase(0);
        }
        catch (error) {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
        }
    };
    const speak = (value: string, options?: {
        force?: boolean;
    }) => {
        const normalized = value.trim();
        if (!isSelectedProviderSupported || !normalized)
            return;
        if (!options?.force && normalized === spokenTextRef.current)
            return;
        spokenTextRef.current = normalized;
        stopSpeaking();
        const runId = speechRunRef.current;
        const phrases = splitSpeechPhrases(normalized).map((phrase) => phrase.text);
        if (provider === "web-speech") {
            speakWithWebSpeech(phrases, runId);
        }
        else {
            void speakWithSupertonic(phrases, runId);
        }
    };
    const playSourceSentence = (target: SentencePlaybackTarget, runId: number) => {
        const { sentence, sourceMedia, sourceMode } = target;
        if (!sourceMedia || sentence.endMs <= sentence.startMs)
            return;
        const element = document.createElement(sourceMedia.kind === "video" ? "video" : "audio");
        element.volume = settings.volume;
        element.preload = "auto";
        element.src = sourceMedia.url;
        mediaRef.current = element;
        setActiveSentenceId(sentence.id);
        setActiveWordIndex(0);
        setActivePhraseText(sentence.text);
        setSpeechStatus(`Playing sentence from ${sourceMode} ${sourceMedia.kind}.`);
        const startSeconds = Math.max(0, sentence.startMs / 1000);
        const endSeconds = Math.max(startSeconds, sentence.endMs / 1000);
        const tick = () => {
            if (speechRunRef.current !== runId || mediaRef.current !== element)
                return;
            const currentMs = element.currentTime * 1000;
            const activeIndex = sentence.words.findIndex((word) => currentMs >= word.startMs && currentMs < word.endMs);
            setActiveWordIndex(activeIndex === -1 ? sentence.words.length - 1 : activeIndex);
            if (element.currentTime >= endSeconds) {
                element.pause();
                resetActiveSpeech();
                return;
            }
            wordFrameRef.current = window.requestAnimationFrame(tick);
        };
        element.onplay = () => {
            if (speechRunRef.current !== runId || mediaRef.current !== element)
                return;
            setIsSpeaking(true);
            wordFrameRef.current = window.requestAnimationFrame(tick);
        };
        element.onpause = () => {
            if (element.currentTime >= endSeconds && speechRunRef.current === runId) {
                resetActiveSpeech();
            }
        };
        element.onended = () => {
            if (speechRunRef.current === runId)
                resetActiveSpeech();
        };
        element.onerror = () => {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus("Original audio playback failed.");
        };
        element.onloadedmetadata = () => {
            void (async () => {
                try {
                    if (speechRunRef.current !== runId)
                        return;
                    if (startSeconds > 0) {
                        await new Promise<void>((resolve, reject) => {
                            const cleanUp = () => {
                                element.removeEventListener("seeked", onSeeked);
                                element.removeEventListener("error", onError);
                            };
                            const onSeeked = () => { cleanUp(); resolve(); };
                            const onError = () => { cleanUp(); reject(new Error("Unable to seek recorded audio.")); };
                            element.addEventListener("seeked", onSeeked, { once: true });
                            element.addEventListener("error", onError, { once: true });
                            element.currentTime = startSeconds;
                            if (!element.seeking && Math.abs(element.currentTime - startSeconds) < 0.01)
                                onSeeked();
                        });
                    }
                    if (sourceMode === "normalized")
                        await connectNormalizedSourceMedia(element);
                    if (speechRunRef.current !== runId)
                        return;
                    await element.play();
                }
                catch {
                    if (speechRunRef.current !== runId)
                        return;
                    resetActiveSpeech();
                    setSpeechStatus("Recorded audio playback failed.");
                }
            })();
        };
    };
    const speakSentenceWithWebSpeech = (sentence: TranscriptSentence, runId: number) => {
        if (!isSpeechSupported)
            return;
        const nativeVoice = state.webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
        const utterance = new SpeechSynthesisUtterance(sentence.text);
        const ranges = getWordCharRanges(sentence);
        utterance.lang = nativeVoice?.lang ?? appSettings.tts.lang;
        utterance.voice = nativeVoice ?? null;
        utterance.rate = settings.rate;
        utterance.pitch = settings.pitch;
        utterance.volume = settings.volume;
        utterance.onstart = () => {
            if (speechRunRef.current !== runId)
                return;
            setActiveSentenceId(sentence.id);
            setActiveWordIndex(0);
            setActivePhraseText(sentence.text);
            setSpeechStatus(nativeVoice ? `Speaking sentence with ${nativeVoice.name}.` : "Speaking sentence with browser voice.");
            setIsSpeaking(true);
        };
        utterance.onboundary = (event) => {
            if (speechRunRef.current !== runId)
                return;
            const boundaryIndex = ranges.findIndex((range) => event.charIndex >= range.start && event.charIndex < range.end);
            if (boundaryIndex >= 0) {
                setActiveWordIndex(boundaryIndex);
            }
        };
        utterance.onend = () => {
            if (speechRunRef.current === runId)
                resetActiveSpeech();
        };
        utterance.onerror = () => {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus("Browser speech synthesis failed.");
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    };
    const speakSentenceWithSupertonic = async (sentence: TranscriptSentence, runId: number) => {
        try {
            const { synthesizeSupertonicSpeech } = await import("./supertonicTts");
            const voiceId = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId)
                ? (selectedVoiceId as SupertonicVoiceId)
                : appSettings.tts.supertonic.defaultVoiceId;
            setActiveSentenceId(sentence.id);
            setActiveWordIndex(0);
            setActivePhraseText(sentence.text);
            setIsSpeaking(true);
            setSpeechStatus(`Generating sentence with Supertonic ${selectedVoiceId}.`);
            const blob = await synthesizeSupertonicSpeech(sentence.text, voiceId);
            if (speechRunRef.current !== runId)
                return;
            const url = URL.createObjectURL(blob);
            mediaUrlRef.current = url;
            const audio = new Audio(url);
            audio.volume = settings.volume;
            mediaRef.current = audio;
            const wordWeights = sentence.words.map((word) => Math.max(1, word.text.trim().length));
            const totalWeight = wordWeights.reduce((sum, value) => sum + value, 0);
            const tick = () => {
                if (speechRunRef.current !== runId || mediaRef.current !== audio || !Number.isFinite(audio.duration)) {
                    return;
                }
                const progress = audio.currentTime / Math.max(0.001, audio.duration);
                let running = 0;
                let nextIndex = 0;
                for (let index = 0; index < wordWeights.length; index += 1) {
                    running += wordWeights[index] / Math.max(1, totalWeight);
                    if (progress <= running) {
                        nextIndex = index;
                        break;
                    }
                    nextIndex = index;
                }
                setActiveWordIndex(nextIndex);
                wordFrameRef.current = window.requestAnimationFrame(tick);
            };
            audio.onplay = () => {
                setSpeechStatus(`Speaking sentence with Supertonic ${selectedVoiceId}.`);
                wordFrameRef.current = window.requestAnimationFrame(tick);
            };
            audio.onended = () => resetActiveSpeech();
            audio.onerror = () => {
                resetActiveSpeech();
                setSpeechStatus("Supertonic audio playback failed.");
            };
            await audio.play();
        }
        catch (error) {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
        }
    };
    const playSentence = (sentence: TranscriptSentence, sourceMedia: SourceMediaPlayback | null, mode: RuntimeTtsSettings["sentencePlaybackMode"], sourceMode: SourceMediaPlaybackMode = "original") => {
        if (state.activeSentenceId === sentence.id && (machine.value === "playing")) {
            stopSpeaking();
            return;
        }
        stopSpeaking();
        const runId = speechRunRef.current;
        if (mode === "source-audio") {
            if (sourceMedia && sentence.endMs > sentence.startMs) {
                playSourceSentence({ sentence, sourceMedia, sourceMode }, runId);
            }
            else {
                setSpeechStatus("Original audio is unavailable for this sentence.");
            }
            return;
        }
        if (provider === "web-speech") {
            speakSentenceWithWebSpeech(sentence, runId);
        }
        else {
            void speakSentenceWithSupertonic(sentence, runId);
        }
    };
    let browserVoiceOptions: SubtitleVoiceOption[] = state.webSpeechVoices.map((voice) => ({
        id: voice.voiceURI,
        name: `${voice.name} (${voice.lang})`,
        provider: "web-speech",
        lang: voice.lang
    }));
    let modelVoiceOptions: SubtitleVoiceOption[] = appSettings.tts.supertonic.voices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        provider: "supertonic-web",
        lang: appSettings.tts.supertonic.language
    }));
    let voiceOptions: SubtitleVoiceOption[] = provider === "web-speech" ? browserVoiceOptions : modelVoiceOptions;
    const snapshot = () => ({
        isSpeechEnabled,
        isSpeechSupported: isSelectedProviderSupported,
        isSpeaking: (machine.value === "playing"),
        activePhraseIndex: state.activePhraseIndex,
        activePhraseText: state.activePhraseText,
        activeSentenceId: state.activeSentenceId,
        activeWordIndex: state.activeWordIndex,
        provider,
        selectedVoiceId,
        speechStatus: state.speechStatus,
        voiceOptions,
        browserVoiceOptions,
        modelVoiceOptions,
        setProvider,
        setIsSpeechEnabled,
        setSelectedVoiceId,
        speakSubtitle: () => speak(text, { force: true }),
        speakText: (value: string) => speak(value, { force: true }),
        playSourceMedia,
        playSentence,
        stopSpeaking
    });
    const listeners = new Set<() => void>();
    function refresh() {
        isSpeechEnabled = settings.enabled;
        provider = settings.provider;
        selectedVoiceId = settings.selectedVoiceId;
        isSpeechSupported = typeof window !== "undefined" &&
            "speechSynthesis" in window &&
            "SpeechSynthesisUtterance" in window;
        isSupertonicSupported = typeof window !== "undefined" && "gpu" in navigator;
        isSelectedProviderSupported = provider === "web-speech" ? isSpeechSupported : isSupertonicSupported;
        browserVoiceOptions = state.webSpeechVoices.map((voice) => ({
            id: voice.voiceURI,
            name: `${voice.name} (${voice.lang})`,
            provider: "web-speech",
            lang: voice.lang
        }));
        modelVoiceOptions = appSettings.tts.supertonic.voices.map((voice) => ({
            id: voice.id,
            name: voice.name,
            provider: "supertonic-web",
            lang: appSettings.tts.supertonic.language
        }));
        voiceOptions = provider === "web-speech" ? browserVoiceOptions : modelVoiceOptions;
        scope.watch("browser-voices", [isSpeechSupported], () => {
            if (!isSpeechSupported)
                return;
            const updateVoices = () => setWebSpeechVoices(window.speechSynthesis.getVoices());
            updateVoices();
            window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
            return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
        });
        scope.watch("selected-voice", [provider, selectedVoiceId, setSelectedVoiceId, state.webSpeechVoices], () => {
            if (provider === "supertonic-web") {
                const hasSupertonicVoice = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId);
                if (!hasSupertonicVoice) {
                    setSelectedVoiceId(appSettings.tts.supertonic.defaultVoiceId);
                }
                return;
            }
            const defaultNativeVoice = state.webSpeechVoices.find((voice) => voice.default) ?? state.webSpeechVoices[0];
            const hasNativeVoice = state.webSpeechVoices.some((voice) => voice.voiceURI === selectedVoiceId);
            if (!hasNativeVoice) {
                setSelectedVoiceId(defaultNativeVoice?.voiceURI ?? appSettings.tts.supertonic.defaultVoiceId);
            }
        });
        scope.watch("automatic-speech", [isSpeechEnabled, speak, text], () => {
            if (isSpeechEnabled) {
                speak(text);
            }
        });
        scope.watch("speech-enabled", [isSpeechEnabled, stopSpeaking], () => {
            if (!isSpeechEnabled) {
                stopSpeaking();
            }
        });
        scope.watch("playback-lifetime", [stopSpeaking], () => {
            return () => stopSpeaking();
        });
        scope.flush();
        for (const listener of listeners)
            listener();
    }
    scope.setRefresh(refresh);
    refresh();
    let previousInputs: readonly unknown[] = initialInputs;
    return {
        get isSpeechEnabled() { return snapshot().isSpeechEnabled; },
        get isSpeechSupported() { return snapshot().isSpeechSupported; },
        get isSpeaking() { return snapshot().isSpeaking; },
        get activePhraseIndex() { return snapshot().activePhraseIndex; },
        get activePhraseText() { return snapshot().activePhraseText; },
        get activeSentenceId() { return snapshot().activeSentenceId; },
        get activeWordIndex() { return snapshot().activeWordIndex; },
        get provider() { return snapshot().provider; },
        get selectedVoiceId() { return snapshot().selectedVoiceId; },
        get speechStatus() { return snapshot().speechStatus; },
        get voiceOptions() { return snapshot().voiceOptions; },
        get browserVoiceOptions() { return snapshot().browserVoiceOptions; },
        get modelVoiceOptions() { return snapshot().modelVoiceOptions; },
        get setProvider() { return snapshot().setProvider; },
        get setIsSpeechEnabled() { return snapshot().setIsSpeechEnabled; },
        get setSelectedVoiceId() { return snapshot().setSelectedVoiceId; },
        get speakSubtitle() { return snapshot().speakSubtitle; },
        get speakText() { return snapshot().speakText; },
        get playSourceMedia() { return snapshot().playSourceMedia; },
        get playSentence() { return snapshot().playSentence; },
        get stopSpeaking() { return snapshot().stopSpeaking; },
        get machine() { return machine; },
        update(...inputs: [
            text: string,
            transcriptSentences: TranscriptSentence[],
            settings: RuntimeTtsSettings,
            setSettingsValue: (update: Partial<RuntimeTtsSettings>) => void
        ]) { if (sameInputs(previousInputs, inputs))
            return; previousInputs = inputs; [text, transcriptSentences, settings, setSettingsValue] = inputs; refresh(); },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { scope.dispose(); listeners.clear(); }
    };
}
export function getActiveTranscriptPosition(sentences: TranscriptSentence[], currentMs: number): ActiveTranscriptPosition | null {
    if (sentences.length === 0 || !Number.isFinite(currentMs) || currentMs < 0) {
        return null;
    }
    const activeSentence = sentences.find((sentence) => currentMs >= sentence.startMs && currentMs < sentence.endMs) ??
        sentences.find((sentence) => sentence.words.length > 0 && currentMs < sentence.words[0].startMs) ??
        null;
    if (!activeSentence) {
        return null;
    }
    if (activeSentence.words.length === 0) {
        return {
            sentenceId: activeSentence.id,
            sentenceText: activeSentence.text,
            wordIndex: -1
        };
    }
    const activeWordIndex = activeSentence.words.findIndex((word) => currentMs >= word.startMs && currentMs < word.endMs);
    const fallbackWordIndex = currentMs < activeSentence.words[0].startMs ? 0 : activeSentence.words.length - 1;
    return {
        sentenceId: activeSentence.id,
        sentenceText: activeSentence.text,
        wordIndex: activeWordIndex === -1 ? fallbackWordIndex : activeWordIndex
    };
}
function getWordCharRanges(sentence: TranscriptSentence) {
    let offset = 0;
    return sentence.words.map((word, index) => {
        const value = index === 0 ? word.text.trimStart() : word.text;
        const range = { start: offset, end: offset + value.length };
        offset = range.end;
        return range;
    });
}
