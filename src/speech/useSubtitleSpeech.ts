import { useCallback, useEffect, useRef, useState } from "react";
import { appSettings, type SupertonicVoiceId, type TtsProvider } from "../config/settings";
import type { RuntimeTtsSettings } from "../config/settingsOptions";

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
  const speechRunRef = useRef(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
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
    if (isSpeechSupported) {
      window.speechSynthesis.cancel();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setSpeechStatus("");
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
    (normalized: string) => {
      if (!isSpeechSupported) return;

      const nativeVoice = webSpeechVoices.find((voice) => voice.voiceURI === selectedVoiceId);
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(normalized);
      utterance.lang = nativeVoice?.lang ?? appSettings.tts.lang;
      utterance.voice = nativeVoice ?? null;
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;
      utterance.onstart = () => {
        setSpeechStatus(nativeVoice ? `Speaking with ${nativeVoice.name}.` : "Speaking with browser voice.");
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        setSpeechStatus("");
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setSpeechStatus("Browser speech synthesis failed.");
      };
      window.speechSynthesis.speak(utterance);
    },
    [isSpeechSupported, selectedVoiceId, settings.pitch, settings.rate, settings.volume, webSpeechVoices]
  );

  const speakWithSupertonic = useCallback(
    async (normalized: string, runId: number) => {
      try {
        setIsSpeaking(true);
        setSpeechStatus(`Generating ${selectedVoiceId} with Supertonic WebGPU TTS.`);
        const { synthesizeSupertonicSpeech } = await import("./supertonicTts");
        const voiceId = appSettings.tts.supertonic.voices.some((voice) => voice.id === selectedVoiceId)
          ? (selectedVoiceId as SupertonicVoiceId)
          : appSettings.tts.supertonic.defaultVoiceId;
        const blob = await synthesizeSupertonicSpeech(normalized, voiceId);
        if (speechRunRef.current !== runId) return;

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onplay = () => setSpeechStatus(`Speaking with Supertonic ${selectedVoiceId}.`);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          setIsSpeaking(false);
          setSpeechStatus("");
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setIsSpeaking(false);
          setSpeechStatus("Supertonic audio playback failed.");
        };
        await audio.play();
      } catch (error) {
        if (speechRunRef.current !== runId) return;
        setIsSpeaking(false);
        setSpeechStatus(error instanceof Error ? error.message : "Supertonic speech synthesis failed.");
      }
    },
    [selectedVoiceId]
  );

  const speak = useCallback(
    (value: string) => {
      const normalized = value.trim();
      if (!isSpeechEnabled || !isSelectedProviderSupported || !normalized) return;
      if (normalized === spokenTextRef.current) return;

      spokenTextRef.current = normalized;
      stopSpeaking();
      const runId = speechRunRef.current;

      if (provider === "web-speech") {
        speakWithWebSpeech(normalized);
      } else {
        void speakWithSupertonic(normalized, runId);
      }
    },
    [
      isSelectedProviderSupported,
      isSpeechEnabled,
      provider,
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
    provider,
    selectedVoiceId,
    speechStatus,
    voiceOptions,
    setProvider,
    setIsSpeechEnabled,
    setSelectedVoiceId,
    speakSubtitle: () => speak(text),
    stopSpeaking
  };
}
