import { useCallback, useEffect, useRef, useState } from "react";
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
};

export function useSubtitleSpeech(
  text: string,
  settings: RuntimeTtsSettings,
  setSettingsValue: (update: Partial<RuntimeTtsSettings>) => void
) {
  const spokenTextRef = useRef("");
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const mediaAudioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const mediaUrlRef = useRef<string | null>(null);
  const speechRunRef = useRef(0);
  const pendingTimeoutRef = useRef<number | null>(null);
  const wordFrameRef = useRef<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [activePhraseIndex, setActivePhraseIndex] = useState(-1);
  const [activePhraseText, setActivePhraseText] = useState("");
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [webSpeechVoices, setWebSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const isSpeechEnabled = settings.enabled;
  const provider = settings.provider;
  const selectedVoiceId = settings.selectedVoiceId;
  const isSpeechSupported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;
  const isSupertonicSupported = typeof window !== "undefined" && "gpu" in navigator;
  const isSelectedProviderSupported = provider === "web-speech" ? isSpeechSupported : isSupertonicSupported;
  const setProvider = useCallback(
    (value: TtsProvider) => setSettingsValue({ provider: value }),
    [setSettingsValue]
  );
  const setIsSpeechEnabled = useCallback(
    (value: boolean) => setSettingsValue({ enabled: value }),
    [setSettingsValue]
  );
  const setSelectedVoiceId = useCallback(
    (value: string) => setSettingsValue({ selectedVoiceId: value }),
    [setSettingsValue]
  );

  const resetActiveSpeech = useCallback(() => {
    setIsSpeaking(false);
    setSpeechStatus("");
    setActivePhraseIndex(-1);
    setActivePhraseText("");
    setActiveSentenceId(null);
    setActiveWordIndex(-1);
  }, []);

  const stopSpeaking = useCallback(() => {
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
  }, [isSpeechSupported, resetActiveSpeech]);

  const connectNormalizedSourceMedia = useCallback(async (element: HTMLMediaElement) => {
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
  }, []);

  const playSourceMedia = useCallback(
    async (sourceMedia: SourceMediaPlayback | null, mode: SourceMediaPlaybackMode = "original") => {
      if (!sourceMedia) return;

      stopSpeaking();
      const runId = speechRunRef.current;
      const element = document.createElement(sourceMedia.kind === "video" ? "video" : "audio");
      element.preload = "auto";
      element.src = sourceMedia.url;
      mediaRef.current = element;
      setActivePhraseText(mode === "normalized" ? "Normalised audio" : "Original audio");
      setSpeechStatus(
        mode === "normalized"
          ? `Playing normalised ${sourceMedia.kind} audio.`
          : `Playing original ${sourceMedia.kind}.`
      );
      element.onplay = () => setIsSpeaking(true);
      element.onended = () => {
        if (speechRunRef.current === runId) {
          resetActiveSpeech();
        }
      };
      element.onerror = () => {
        if (speechRunRef.current === runId) {
          resetActiveSpeech();
          setSpeechStatus(
            mode === "normalized"
              ? "Normalised audio playback failed."
              : "Original audio playback failed."
          );
        }
      };
      try {
        if (mode === "normalized") {
          await connectNormalizedSourceMedia(element);
        }
        await element.play();
      } catch {
        if (speechRunRef.current === runId) {
          resetActiveSpeech();
          setSpeechStatus(
            mode === "normalized"
              ? "Normalised audio playback failed."
              : "Original audio playback failed."
          );
        }
      }
    },
    [connectNormalizedSourceMedia, resetActiveSpeech, stopSpeaking]
  );

  useEffect(() => {
    if (!isSpeechSupported) return;

    const updateVoices = () => setWebSpeechVoices(window.speechSynthesis.getVoices());
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
  }, [isSpeechSupported]);

  useEffect(() => {
    if (provider === "supertonic-web") {
      const hasSupertonicVoice = appSettings.tts.supertonic.voices.some(
        (voice) => voice.id === selectedVoiceId
      );
      if (!hasSupertonicVoice) {
        setSelectedVoiceId(appSettings.tts.supertonic.defaultVoiceId);
      }
      return;
    }

    const defaultNativeVoice = webSpeechVoices.find((voice) => voice.default) ?? webSpeechVoices[0];
    const hasNativeVoice = webSpeechVoices.some((voice) => voice.voiceURI === selectedVoiceId);
    if (!hasNativeVoice) {
      setSelectedVoiceId(defaultNativeVoice?.voiceURI ?? appSettings.tts.supertonic.defaultVoiceId);
    }
  }, [provider, selectedVoiceId, setSelectedVoiceId, webSpeechVoices]);

  const speakWithWebSpeech = useCallback(
    (phrases: string[], runId: number) => {
      if (!isSpeechSupported) return;

      const nativeVoice = webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
      if (phrases.length === 0) return;

      let phraseIndex = 0;
      const speakNext = () => {
        if (speechRunRef.current !== runId) return;
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
          setSpeechStatus(
            nativeVoice
              ? `Speaking phrase ${phraseIndex + 1}/${phrases.length} with ${nativeVoice.name}.`
              : `Speaking phrase ${phraseIndex + 1}/${phrases.length} with browser voice.`
          );
          setIsSpeaking(true);
        };
        utterance.onend = () => {
          if (speechRunRef.current !== runId) return;
          phraseIndex += 1;
          pendingTimeoutRef.current = window.setTimeout(() => {
            pendingTimeoutRef.current = null;
            speakNext();
          }, 0);
        };
        utterance.onerror = () => {
          if (speechRunRef.current !== runId) return;
          resetActiveSpeech();
          setSpeechStatus("Browser speech synthesis failed.");
        };
        window.speechSynthesis.speak(utterance);
      };

      speakNext();
    },
    [
      isSpeechSupported,
      resetActiveSpeech,
      selectedVoiceId,
      settings.pitch,
      settings.rate,
      settings.volume,
      webSpeechVoices
    ]
  );

  const speakWithSupertonic = useCallback(
    async (phrases: string[], runId: number) => {
      try {
        const { synthesizeSupertonicSpeech } = await import("./supertonicTts");
        const voiceId = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId)
          ? (selectedVoiceId as SupertonicVoiceId)
          : appSettings.tts.supertonic.defaultVoiceId;
        if (phrases.length === 0) return;

        const playPhrase = async (phraseIndex: number): Promise<void> => {
          if (speechRunRef.current !== runId) return;
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
          if (speechRunRef.current !== runId) return;

          const url = URL.createObjectURL(blob);
          mediaUrlRef.current = url;
          const audio = new Audio(url);
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
      } catch (error) {
        if (speechRunRef.current !== runId) return;
        resetActiveSpeech();
        setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
      }
    },
    [resetActiveSpeech, selectedVoiceId]
  );

  const speak = useCallback(
    (value: string, options?: { force?: boolean }) => {
      const normalized = value.trim();
      if (!isSelectedProviderSupported || !normalized) return;
      if (!options?.force && normalized === spokenTextRef.current) return;

      spokenTextRef.current = normalized;
      stopSpeaking();
      const runId = speechRunRef.current;
      const phrases = splitSpeechPhrases(normalized).map((phrase) => phrase.text);

      if (provider === "web-speech") {
        speakWithWebSpeech(phrases, runId);
      } else {
        void speakWithSupertonic(phrases, runId);
      }
    },
    [
      provider,
      isSelectedProviderSupported,
      speakWithSupertonic,
      speakWithWebSpeech,
      stopSpeaking
    ]
  );

  const playSourceSentence = useCallback(
    (target: SentencePlaybackTarget, runId: number) => {
      const { sentence, sourceMedia } = target;
      if (!sourceMedia || sentence.words.length === 0) return;

      const element = document.createElement(sourceMedia.kind === "video" ? "video" : "audio");
      element.preload = "auto";
      element.src = sourceMedia.url;
      mediaRef.current = element;
      setActiveSentenceId(sentence.id);
      setActiveWordIndex(0);
      setActivePhraseText(sentence.text);
      setSpeechStatus(`Playing sentence from original ${sourceMedia.kind}.`);

      const startSeconds = Math.max(0, sentence.startMs / 1000);
      const endSeconds = Math.max(startSeconds, sentence.endMs / 1000);
      const tick = () => {
        if (speechRunRef.current !== runId || mediaRef.current !== element) return;
        const currentMs = element.currentTime * 1000;
        const activeIndex = sentence.words.findIndex(
          (word) => currentMs >= word.startMs && currentMs < word.endMs
        );
        setActiveWordIndex(activeIndex === -1 ? sentence.words.length - 1 : activeIndex);
        if (element.currentTime >= endSeconds) {
          element.pause();
          resetActiveSpeech();
          return;
        }
        wordFrameRef.current = window.requestAnimationFrame(tick);
      };

      element.onplay = () => {
        setIsSpeaking(true);
        wordFrameRef.current = window.requestAnimationFrame(tick);
      };
      element.onpause = () => {
        if (element.currentTime >= endSeconds || speechRunRef.current !== runId) {
          resetActiveSpeech();
        }
      };
      element.onerror = () => {
        resetActiveSpeech();
        setSpeechStatus("Original audio playback failed.");
      };
      element.onloadedmetadata = () => {
        element.currentTime = startSeconds;
        void element.play().catch(() => {
          resetActiveSpeech();
          setSpeechStatus("Original audio playback failed.");
        });
      };
    },
    [resetActiveSpeech]
  );

  const speakSentenceWithWebSpeech = useCallback(
    (sentence: TranscriptSentence, runId: number) => {
      if (!isSpeechSupported) return;
      const nativeVoice = webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
      const utterance = new SpeechSynthesisUtterance(sentence.text);
      const ranges = getWordCharRanges(sentence);
      utterance.lang = nativeVoice?.lang ?? appSettings.tts.lang;
      utterance.voice = nativeVoice ?? null;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;
      utterance.onstart = () => {
        setActiveSentenceId(sentence.id);
        setActiveWordIndex(0);
        setActivePhraseText(sentence.text);
        setSpeechStatus(
          nativeVoice ? `Speaking sentence with ${nativeVoice.name}.` : "Speaking sentence with browser voice."
        );
        setIsSpeaking(true);
      };
      utterance.onboundary = (event) => {
        if (speechRunRef.current !== runId) return;
        const boundaryIndex = ranges.findIndex(
          (range) => event.charIndex >= range.start && event.charIndex < range.end
        );
        if (boundaryIndex >= 0) {
          setActiveWordIndex(boundaryIndex);
        }
      };
      utterance.onend = () => resetActiveSpeech();
      utterance.onerror = () => {
        resetActiveSpeech();
        setSpeechStatus("Browser speech synthesis failed.");
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [
      isSpeechSupported,
      resetActiveSpeech,
      selectedVoiceId,
      settings.pitch,
      settings.rate,
      settings.volume,
      webSpeechVoices
    ]
  );

  const speakSentenceWithSupertonic = useCallback(
    async (sentence: TranscriptSentence, runId: number) => {
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
        if (speechRunRef.current !== runId) return;

        const url = URL.createObjectURL(blob);
        mediaUrlRef.current = url;
        const audio = new Audio(url);
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
      } catch (error) {
        if (speechRunRef.current !== runId) return;
        resetActiveSpeech();
        setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
      }
    },
    [resetActiveSpeech, selectedVoiceId]
  );

  const playSentence = useCallback(
    (sentence: TranscriptSentence, sourceMedia: SourceMediaPlayback | null, mode: RuntimeTtsSettings["sentencePlaybackMode"]) => {
      if (activeSentenceId === sentence.id && isSpeaking) {
        stopSpeaking();
        return;
      }

      stopSpeaking();
      const runId = speechRunRef.current;
      if (mode === "source-audio" && sourceMedia && sentence.words.length > 0) {
        playSourceSentence({ sentence, sourceMedia }, runId);
        return;
      }

      if (provider === "web-speech") {
        speakSentenceWithWebSpeech(sentence, runId);
      } else {
        void speakSentenceWithSupertonic(sentence, runId);
      }
    },
    [
      activeSentenceId,
      isSpeaking,
      playSourceSentence,
      provider,
      speakSentenceWithSupertonic,
      speakSentenceWithWebSpeech,
      stopSpeaking
    ]
  );

  useEffect(() => {
    if (isSpeechEnabled) {
      speak(text);
    }
  }, [isSpeechEnabled, speak, text]);

  useEffect(() => {
    if (!isSpeechEnabled) {
      stopSpeaking();
    }
  }, [isSpeechEnabled, stopSpeaking]);

  useEffect(() => {
    return () => stopSpeaking();
  }, [stopSpeaking]);

  const browserVoiceOptions: SubtitleVoiceOption[] = webSpeechVoices.map((voice) => ({
    id: voice.voiceURI,
    name: `${voice.name} (${voice.lang})`,
    provider: "web-speech",
    lang: voice.lang
  }));
  const modelVoiceOptions: SubtitleVoiceOption[] = appSettings.tts.supertonic.voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    provider: "supertonic-web",
    lang: appSettings.tts.supertonic.language
  }));
  const voiceOptions: SubtitleVoiceOption[] =
    provider === "web-speech" ? browserVoiceOptions : modelVoiceOptions;

  return {
    isSpeechEnabled,
    isSpeechSupported: isSelectedProviderSupported,
    isSpeaking,
    activePhraseIndex,
    activePhraseText,
    activeSentenceId,
    activeWordIndex,
    provider,
    selectedVoiceId,
    speechStatus,
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
