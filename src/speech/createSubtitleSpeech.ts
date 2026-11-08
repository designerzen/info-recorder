import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createPlaybackMachine, createStateMachine } from "../state/machine";
import { appSettings, type SupertonicVoiceId, type TtsProvider, type WoofVoiceId } from "../config/settings";
import type { RuntimeTtsSettings } from "../config/settingsOptions";
import type { TranscriptSentence, TranscriptWord } from "../transcript/timedTranscript";
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
const ESTIMATED_SPEECH_CHARS_PER_SECOND = 14;
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
        isPlaybackPaused: false,
        webSpeechVoices: ([]) as SpeechSynthesisVoice[]
    }, () => "ready");
    let state = contextStore.context;
    scope.own(contextStore.subscribe(() => { state = contextStore.context; scope.invalidate(); }));
    scope.own(contextStore.dispose);
    const setIsSpeaking = (value: boolean) => machine.send(value ? "PLAY" : "STOP");
    const setSpeechStatus = (value: typeof state.speechStatus | ((previous: typeof state.speechStatus) => typeof state.speechStatus)) => contextStore.send({ type: "speechStatus", value });
    // The playing position changes many times a second, so it is published to position
    // listeners instead of state; re-rendering a long transcript per word is far too slow.
    let activePhraseIndex = -1;
    let activePhraseText = "";
    let activeSentenceId: string | null = null;
    let activeWordIndex = -1;
    const positionListeners = new Set<() => void>();
    const notifyPosition = () => { for (const listener of positionListeners) listener(); };
    const setActivePhraseIndex = (value: number) => { activePhraseIndex = value; };
    const setActivePhraseText = (value: string) => { if (activePhraseText !== value) { activePhraseText = value; notifyPosition(); } };
    const setActiveSentenceId = (value: string | null) => { if (activeSentenceId !== value) { activeSentenceId = value; notifyPosition(); } };
    const setActiveWordIndex = (value: number) => { if (activeWordIndex !== value) { activeWordIndex = value; notifyPosition(); } };
    const setIsPlaybackPaused = (value: boolean) => contextStore.send({ type: "isPlaybackPaused", value });
    const sentenceQueueRef: {
        current: { sentences: TranscriptSentence[]; index: number } | null;
    } = { current: null };
    const isFullMediaPlaybackRef = { current: false };
    let playbackRate = 1;
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
    // Woof runs on the CPU in WebAssembly, so it needs no GPU.
    const isWoofSupported = typeof Worker !== "undefined" && typeof WebAssembly === "object";
    const isProviderSupported = (value: TtsProvider) => value === "web-speech" ? isSpeechSupported : value === "woof" ? isWoofSupported : isSupertonicSupported;
    let isSelectedProviderSupported = isProviderSupported(provider);
    // Cancels model voice requests that have not started when playback stops or moves on.
    const modelAbortRef = { current: new AbortController() };
    const setProvider = (value: TtsProvider) => setSettingsValue({ provider: value });
    const setIsSpeechEnabled = (value: boolean) => setSettingsValue({ enabled: value });
    const setSelectedVoiceId = (value: string) => setSettingsValue({ selectedVoiceId: value });
    const resetActiveSpeech = () => {
        sentenceQueueRef.current = null;
        isFullMediaPlaybackRef.current = false;
        setIsPlaybackPaused(false);
        setIsSpeaking(false);
        setSpeechStatus("");
        setActivePhraseIndex(-1);
        setActivePhraseText("");
        setActiveSentenceId(null);
        setActiveWordIndex(-1);
    };
    const interruptCurrentOutput = () => {
        speechRunRef.current += 1;
        modelAbortRef.current.abort();
        modelAbortRef.current = new AbortController();
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
    };
    const stopSpeaking = () => {
        interruptCurrentOutput();
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
        isFullMediaPlaybackRef.current = true;
        const element = document.createElement(sourceMedia.kind === "video" ? "video" : "audio");
        element.volume = settings.volume;
        element.preload = "auto";
        element.src = sourceMedia.url;
        element.playbackRate = playbackRate;
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
            if (sentences.length > 0 && wordFrameRef.current === null) {
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
    const modelVoiceName = () => {
        if (provider === "woof")
            return `${appSettings.tts.woof.voices.find((voice) => voice.id === selectedVoiceId)?.name ?? "Juno"} (Underdog Woof)`;
        return `Supertonic ${selectedVoiceId}`;
    };
    const woofVoiceId = () => appSettings.tts.woof.voices.some((voice) => voice.id === selectedVoiceId)
        ? (selectedVoiceId as WoofVoiceId)
        : appSettings.tts.woof.defaultVoiceId;
    /** Audio for `value` from the selected local model voice. */
    const synthesizeModelVoice = async (value: string) => {
        if (provider === "woof") {
            const { synthesizeWoofSpeech } = await import("./woofTts");
            return synthesizeWoofSpeech(value, woofVoiceId(), { signal: modelAbortRef.current.signal, onStatus: setSpeechStatus });
        }
        const { synthesizeSupertonicSpeech } = await import("./supertonicTts");
        const voiceId = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId)
            ? (selectedVoiceId as SupertonicVoiceId)
            : appSettings.tts.supertonic.defaultVoiceId;
        return synthesizeSupertonicSpeech(value, voiceId);
    };
    /** Woof makes the next sentence while this one plays. */
    const prefetchModelVoice = (value: string) => {
        if (provider !== "woof")
            return;
        const voiceId = woofVoiceId();
        const signal = modelAbortRef.current.signal;
        void import("./woofTts").then(({ prefetchWoofSpeech }) => prefetchWoofSpeech(value, voiceId, signal));
    };
    const speakWithModelVoice = async (phrases: string[], runId: number) => {
        try {
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
                setSpeechStatus(`Generating phrase ${phraseIndex + 1}/${phrases.length} with ${modelVoiceName()}.`);
                const blob = await synthesizeModelVoice(phrase.trim());
                if (phrases[phraseIndex + 1])
                    prefetchModelVoice(phrases[phraseIndex + 1].trim());
                if (speechRunRef.current !== runId)
                    return;
                const url = URL.createObjectURL(blob);
                mediaUrlRef.current = url;
                const audio = new Audio(url);
                audio.volume = settings.volume;
                mediaRef.current = audio;
                audio.onplay = () => setSpeechStatus(`Speaking phrase ${phraseIndex + 1}/${phrases.length} with ${modelVoiceName()}.`);
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
                    setSpeechStatus("Voice playback failed.");
                };
                await audio.play();
            };
            await playPhrase(0);
        }
        catch (error) {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus(error instanceof Error ? error.message : "Speech synthesis failed.");
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
            void speakWithModelVoice(phrases, runId);
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
        element.playbackRate = playbackRate;
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
            setActiveWordIndex(getActiveWordIndex(sentence.words, element.currentTime * 1000));
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
            if (wordFrameRef.current === null)
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
    const speakSentenceWithWebSpeech = (sentence: TranscriptSentence, runId: number, onDone: () => void = resetActiveSpeech) => {
        if (!isSpeechSupported)
            return;
        const nativeVoice = state.webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
        const utterance = new SpeechSynthesisUtterance(sentence.text);
        const ranges = getWordCharRanges(sentence);
        utterance.lang = nativeVoice?.lang ?? appSettings.tts.lang;
        utterance.voice = nativeVoice ?? null;
        utterance.rate = Math.min(10, settings.rate * playbackRate);
        utterance.pitch = settings.pitch;
        utterance.volume = settings.volume;
        // Many voices never report word boundaries, so estimate until one proves otherwise.
        let hasBoundaries = false;
        let estimatedElapsedMs = 0;
        let lastFrameAt = 0;
        const estimatedDurationMs = sentence.text.length / (ESTIMATED_SPEECH_CHARS_PER_SECOND * utterance.rate) * 1000;
        const estimateWord = (now: number) => {
            if (speechRunRef.current !== runId || hasBoundaries)
                return;
            if (!state.isPlaybackPaused)
                estimatedElapsedMs += now - lastFrameAt;
            lastFrameAt = now;
            setActiveWordIndex(getWordIndexAtProgress(sentence.words, estimatedElapsedMs / estimatedDurationMs));
            wordFrameRef.current = window.requestAnimationFrame(estimateWord);
        };
        utterance.onstart = () => {
            if (speechRunRef.current !== runId)
                return;
            lastFrameAt = performance.now();
            wordFrameRef.current = window.requestAnimationFrame(estimateWord);
            setActiveSentenceId(sentence.id);
            setActiveWordIndex(0);
            setActivePhraseText(sentence.text);
            setSpeechStatus(nativeVoice ? `Speaking sentence with ${nativeVoice.name}.` : "Speaking sentence with browser voice.");
            setIsSpeaking(true);
        };
        utterance.onboundary = (event) => {
            if (speechRunRef.current !== runId)
                return;
            hasBoundaries = true;
            const boundaryIndex = ranges.findIndex((range) => event.charIndex >= range.start && event.charIndex < range.end);
            if (boundaryIndex >= 0) {
                setActiveWordIndex(boundaryIndex);
            }
        };
        utterance.onend = () => {
            if (speechRunRef.current === runId) {
                hasBoundaries = true;
                onDone();
            }
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
    const speakSentenceWithModelVoice = async (sentence: TranscriptSentence, runId: number, onDone: () => void = resetActiveSpeech) => {
        try {
            setActiveSentenceId(sentence.id);
            setActiveWordIndex(0);
            setActivePhraseText(sentence.text);
            setIsSpeaking(true);
            setSpeechStatus(`Generating sentence with ${modelVoiceName()}.`);
            const blob = await synthesizeModelVoice(sentence.text);
            if (speechRunRef.current !== runId)
                return;
            const queue = sentenceQueueRef.current;
            const upcoming = queue?.sentences[queue.index + 1];
            if (upcoming)
                prefetchModelVoice(upcoming.text);
            const url = URL.createObjectURL(blob);
            mediaUrlRef.current = url;
            const audio = new Audio(url);
            audio.volume = settings.volume;
            audio.playbackRate = playbackRate;
            mediaRef.current = audio;
            const tick = () => {
                if (speechRunRef.current !== runId || mediaRef.current !== audio)
                    return;
                if (Number.isFinite(audio.duration))
                    setActiveWordIndex(getWordIndexAtProgress(sentence.words, audio.currentTime / Math.max(0.001, audio.duration)));
                wordFrameRef.current = window.requestAnimationFrame(tick);
            };
            audio.onplay = () => {
                setSpeechStatus(`Speaking sentence with ${modelVoiceName()}.`);
                if (wordFrameRef.current === null)
                    wordFrameRef.current = window.requestAnimationFrame(tick);
            };
            audio.onended = () => {
                if (speechRunRef.current !== runId)
                    return;
                if (wordFrameRef.current !== null) {
                    window.cancelAnimationFrame(wordFrameRef.current);
                    wordFrameRef.current = null;
                }
                URL.revokeObjectURL(url);
                if (mediaUrlRef.current === url)
                    mediaUrlRef.current = null;
                mediaRef.current = null;
                onDone();
            };
            audio.onerror = () => {
                resetActiveSpeech();
                setSpeechStatus("Voice playback failed.");
            };
            if (!state.isPlaybackPaused)
                await audio.play();
        }
        catch (error) {
            if (speechRunRef.current !== runId)
                return;
            resetActiveSpeech();
            setSpeechStatus(error instanceof Error ? error.message : "Speech synthesis failed.");
        }
    };
    const speakQueuedSentence = (runId: number) => {
        const queue = sentenceQueueRef.current;
        if (!queue || speechRunRef.current !== runId)
            return;
        const sentence = queue.sentences[queue.index];
        if (!sentence) {
            resetActiveSpeech();
            return;
        }
        const speakNext = () => {
            queue.index += 1;
            speakQueuedSentence(runId);
        };
        if (provider === "web-speech")
            speakSentenceWithWebSpeech(sentence, runId, speakNext);
        else
            void speakSentenceWithModelVoice(sentence, runId, speakNext);
    };
    /** Read sentences in order with the selected voice, highlighting each word. */
    const playAll = (sentences: TranscriptSentence[]) => {
        if (!isSelectedProviderSupported || sentences.length === 0)
            return;
        stopSpeaking();
        sentenceQueueRef.current = { sentences, index: 0 };
        speakQueuedSentence(speechRunRef.current);
    };
    /** During whole-transcript playback, pressing a sentence continues from there. */
    const seekToSentence = (sentence: TranscriptSentence) => {
        if (isFullMediaPlaybackRef.current && mediaRef.current && sentence.endMs > sentence.startMs) {
            mediaRef.current.currentTime = sentence.startMs / 1000;
            if (state.isPlaybackPaused)
                resumePlayback();
            return true;
        }
        const queue = sentenceQueueRef.current;
        const index = queue?.sentences.findIndex((item) => item.id === sentence.id) ?? -1;
        if (!queue || index < 0)
            return false;
        interruptCurrentOutput();
        queue.index = index;
        setIsPlaybackPaused(false);
        speakQueuedSentence(speechRunRef.current);
        return true;
    };
    const pausePlayback = () => {
        if (machine.value !== "playing" || state.isPlaybackPaused)
            return;
        setIsPlaybackPaused(true);
        if (mediaRef.current)
            mediaRef.current.pause();
        else if (isSpeechSupported)
            window.speechSynthesis.pause();
    };
    const resumePlayback = () => {
        if (!state.isPlaybackPaused)
            return;
        setIsPlaybackPaused(false);
        if (mediaRef.current)
            void mediaRef.current.play();
        else if (isSpeechSupported)
            window.speechSynthesis.resume();
    };
    const setPlaybackRate = (rate: number) => {
        // Browser voices cannot change mid-utterance, so they pick this up from the next sentence.
        playbackRate = rate;
        if (mediaRef.current)
            mediaRef.current.playbackRate = rate;
    };
    const playSentence = (sentence: TranscriptSentence, sourceMedia: SourceMediaPlayback | null, mode: RuntimeTtsSettings["sentencePlaybackMode"], sourceMode: SourceMediaPlaybackMode = "original") => {
        if (activeSentenceId === sentence.id && (machine.value === "playing")) {
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
            void speakSentenceWithModelVoice(sentence, runId);
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
    const woofVoiceOptions: SubtitleVoiceOption[] = appSettings.tts.woof.voices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        provider: "woof",
        lang: "en"
    }));
    const getVoiceOptions = () => provider === "web-speech" ? browserVoiceOptions : provider === "woof" ? woofVoiceOptions : modelVoiceOptions;
    let voiceOptions: SubtitleVoiceOption[] = getVoiceOptions();
    const snapshot = () => ({
        isSpeechEnabled,
        isSpeechSupported: isSelectedProviderSupported,
        isSpeaking: (machine.value === "playing"),
        activePhraseIndex,
        activePhraseText,
        activeSentenceId,
        activeWordIndex,
        isPlaybackPaused: state.isPlaybackPaused,
        isPlayingAll: sentenceQueueRef.current !== null || isFullMediaPlaybackRef.current,
        provider,
        selectedVoiceId,
        speechStatus: state.speechStatus,
        voiceOptions,
        browserVoiceOptions,
        modelVoiceOptions,
        woofVoiceOptions,
        setProvider,
        setIsSpeechEnabled,
        setSelectedVoiceId,
        speakSubtitle: () => speak(text, { force: true }),
        speakText: (value: string) => speak(value, { force: true }),
        playSourceMedia,
        playSentence,
        playAll,
        seekToSentence,
        pausePlayback,
        resumePlayback,
        setPlaybackRate,
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
        isSelectedProviderSupported = isProviderSupported(provider);
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
        voiceOptions = getVoiceOptions();
        scope.watch("browser-voices", [isSpeechSupported], () => {
            if (!isSpeechSupported)
                return;
            const updateVoices = () => setWebSpeechVoices(window.speechSynthesis.getVoices());
            updateVoices();
            window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
            return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
        });
        scope.watch("selected-voice", [provider, selectedVoiceId, setSelectedVoiceId, state.webSpeechVoices], () => {
            if (provider === "woof") {
                if (!appSettings.tts.woof.voices.some((voice) => voice.id === selectedVoiceId)) {
                    setSelectedVoiceId(appSettings.tts.woof.defaultVoiceId);
                }
                return;
            }
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
        get woofVoiceOptions() { return snapshot().woofVoiceOptions; },
        get setProvider() { return snapshot().setProvider; },
        get setIsSpeechEnabled() { return snapshot().setIsSpeechEnabled; },
        get setSelectedVoiceId() { return snapshot().setSelectedVoiceId; },
        get speakSubtitle() { return snapshot().speakSubtitle; },
        get speakText() { return snapshot().speakText; },
        get playSourceMedia() { return snapshot().playSourceMedia; },
        get playSentence() { return snapshot().playSentence; },
        get isPlaybackPaused() { return snapshot().isPlaybackPaused; },
        get isPlayingAll() { return snapshot().isPlayingAll; },
        get playAll() { return snapshot().playAll; },
        get seekToSentence() { return snapshot().seekToSentence; },
        get pausePlayback() { return snapshot().pausePlayback; },
        get resumePlayback() { return snapshot().resumePlayback; },
        get setPlaybackRate() { return snapshot().setPlaybackRate; },
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
        subscribePosition(listener: () => void) { positionListeners.add(listener); return () => { positionListeners.delete(listener); }; },
        dispose() { scope.dispose(); listeners.clear(); positionListeners.clear(); }
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
    return {
        sentenceId: activeSentence.id,
        sentenceText: activeSentence.text,
        wordIndex: getActiveWordIndex(activeSentence.words, currentMs)
    };
}
/** The last word to have started, so the highlight rests on it through any following gap. */
export function getActiveWordIndex(words: TranscriptWord[], currentMs: number) {
    if (words.length === 0)
        return -1;
    let index = 0;
    while (index + 1 < words.length && words[index + 1].startMs <= currentMs)
        index += 1;
    return index;
}
/** Map 0-1 progress through a sentence onto its words, weighted by word length. */
export function getWordIndexAtProgress(words: TranscriptWord[], progress: number) {
    const weights = words.map((word) => Math.max(1, word.text.trim().length));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let running = 0;
    for (let index = 0; index < weights.length; index += 1) {
        running += weights[index] / total;
        if (progress <= running)
            return index;
    }
    return words.length - 1;
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
