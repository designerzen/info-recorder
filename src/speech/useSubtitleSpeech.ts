import { useCallback, useEffect, useRef, useState } from "react";
import { appSettings, type SupertonicVoiceId, type TtsProvider } from "../config/settings";
import type { RuntimeTtsSettings } from "../config/settingsOptions";
import { splitSpeechPhrases } from "./subtitlePhrases";

export type SubtitleVoiceOption = {
  id: string;
  name: string;
  provider: TtsProvider;
  lang?: string;
};

export function useSubtitleSpeech(
  text: string,
  settings: RuntimeTtsSettings,
  setSettingsValue: (update: Partial<RuntimeTtsSettings>) => void
) {
  const spokenTextRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechRunRef = useRef(0);
  const pendingTimeoutRef = useRef<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const [activePhraseIndex, setActivePhraseIndex] = useState(-1);
  const [activePhraseText, setActivePhraseText] = useState("");
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

  const stopSpeaking = useCallback(() => {
    speechRunRef.current += 1;
    if (pendingTimeoutRef.current !== null) {
      window.clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    if (isSpeechSupported) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsSpeaking(false);
    setSpeechStatus("");
    setActivePhraseIndex(-1);
    setActivePhraseText("");
  }, [isSpeechSupported]);

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
          setIsSpeaking(false);
          setSpeechStatus("");
          setActivePhraseIndex(-1);
          setActivePhraseText("");
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
          setIsSpeaking(false);
          setSpeechStatus("Browser speech synthesis failed.");
          setActivePhraseIndex(-1);
          setActivePhraseText("");
        };
        window.speechSynthesis.speak(utterance);
      };

      speakNext();
    },
    [isSpeechSupported, selectedVoiceId, settings.pitch, settings.rate, settings.volume, webSpeechVoices]
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
            setIsSpeaking(false);
            setSpeechStatus("");
            setActivePhraseIndex(-1);
            setActivePhraseText("");
            return;
          }

          setActivePhraseIndex(phraseIndex);
          setActivePhraseText(phrase.trim());
          setIsSpeaking(true);
          setSpeechStatus(`Generating phrase ${phraseIndex + 1}/${phrases.length} with Supertonic ${selectedVoiceId}.`);
          const blob = await synthesizeSupertonicSpeech(phrase.trim(), voiceId);
          if (speechRunRef.current !== runId) return;

          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onplay = () => setSpeechStatus(`Speaking phrase ${phraseIndex + 1}/${phrases.length} with Supertonic ${selectedVoiceId}.`);
          audio.onended = () => {
            if (audioUrlRef.current) {
              URL.revokeObjectURL(audioUrlRef.current);
              audioUrlRef.current = null;
            }
            if (audioRef.current === audio) {
              audioRef.current = null;
            }
            void playPhrase(phraseIndex + 1);
          };
          audio.onerror = () => {
            if (audioUrlRef.current) {
              URL.revokeObjectURL(audioUrlRef.current);
              audioUrlRef.current = null;
            }
            setIsSpeaking(false);
            setSpeechStatus("Supertonic audio playback failed.");
            setActivePhraseIndex(-1);
            setActivePhraseText("");
          };
          await audio.play();
        };

        await playPhrase(0);
      } catch (error) {
        if (speechRunRef.current !== runId) return;
        setIsSpeaking(false);
        setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
        setActivePhraseIndex(-1);
        setActivePhraseText("");
      }
    },
    [selectedVoiceId]
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

  const voiceOptions: SubtitleVoiceOption[] =
    provider === "web-speech"
      ? webSpeechVoices.map((voice) => ({
          id: voice.voiceURI,
          name: `${voice.name} (${voice.lang})`,
          provider: "web-speech",
          lang: voice.lang
        }))
      : appSettings.tts.supertonic.voices.map((voice) => ({
          id: voice.id,
          name: voice.name,
          provider: "supertonic-web",
          lang: appSettings.tts.supertonic.language
        }));

  return {
    isSpeechEnabled,
    isSpeechSupported: isSelectedProviderSupported,
    isSpeaking,
    activePhraseIndex,
    activePhraseText,
    provider,
    selectedVoiceId,
    speechStatus,
    voiceOptions,
    setProvider,
    setIsSpeechEnabled,
    setSelectedVoiceId,
    speakSubtitle: () => speak(text, { force: true }),
    speakText: (value: string) => speak(value, { force: true }),
    stopSpeaking
  };
}
