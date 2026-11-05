// Keep the experimental Web Speech API isolated from the worker-based fallback.
import { withTimeout } from "./asyncTimeout";

// A stalled pack download must not block the Moonshine fallback; the browser keeps installing.
const LANGUAGE_PACK_INSTALL_TIMEOUT_MS = 60_000;

type LocalSpeechOptions = { langs: string[]; processLocally: true };
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
export type LocalRecognition = {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  start(track: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = {
  new(): LocalRecognition;
  available?: (options: LocalSpeechOptions) => Promise<string>;
  install?: (options: LocalSpeechOptions) => Promise<boolean>;
};

function getConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function supportsLocalSpeechRecognition() {
  const Recognition = getConstructor();
  if (!Recognition || typeof Recognition.available !== "function") return false;
  try {
    return "processLocally" in new Recognition();
  } catch {
    return false;
  }
}

export async function prepareLocalSpeechRecognition(language: string): Promise<LocalRecognition | null> {
  if (!supportsLocalSpeechRecognition()) return null;
  const Recognition = getConstructor()!;
  try {
    // Browser language packs use BCP 47 tags rather than model language names.
    const lang = language === "en" ? "en-US" : language;
    const options: LocalSpeechOptions = { langs: [lang], processLocally: true };
    const availability = await Recognition.available!(options);
    if (availability !== "available") {
      if (availability !== "downloadable" && availability !== "downloading") return null;
      if (!Recognition.install || !await withTimeout(Recognition.install(options), LANGUAGE_PACK_INSTALL_TIMEOUT_MS)) return null;
      if (await Recognition.available!(options) !== "available") return null;
    }
    const recognition = new Recognition();
    recognition.processLocally = true;
    if (recognition.processLocally !== true) return null;
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    return recognition;
  } catch {
    // Missing packs, blocked permissions policy, and partial implementations
    // all leave transcription to our existing on-device model.
    return null;
  }
}

export function createLocalSpeechSession(recognition: LocalRecognition, initialTrack: MediaStreamTrack, callbacks: {
  onFinal: (text: string) => void;
  onPartial: (text: string) => void;
  onError: (message: string) => void;
}) {
  let track = initialTrack;
  let running = false;
  let active = false;
  let disposed = false;
  let pendingStart: { resolve: () => void; reject: (error: Error) => void } | null = null;
  let pendingStop: (() => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const fail = (message: string) => {
    running = false;
    clearTimeout(startTimer);
    const pending = pendingStart;
    pendingStart = null;
    if (pending) pending.reject(new Error(message));
    else if (!disposed) callbacks.onError(message);
  };
  recognition.onstart = () => {
    active = true;
    clearTimeout(startTimer);
    pendingStart?.resolve();
    pendingStart = null;
  };
  recognition.onresult = (event) => {
    if (disposed) return;
    const partial: string[] = [];
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (result.isFinal) {
        if (text) callbacks.onFinal(text);
      } else partial.push(text);
    }
    callbacks.onPartial(partial.join(" "));
  };
  recognition.onerror = ({ error }) => {
    if (error === "no-speech") return;
    fail(`On-device browser transcription failed (${error}).`);
  };
  recognition.onend = () => {
    active = false;
    clearTimeout(stopTimer);
    pendingStop?.();
    pendingStop = null;
    if (pendingStart) fail("On-device browser transcription could not start.");
    if (running && !disposed) {
      try { recognition.start(track); }
      catch { fail("Unable to restart on-device browser transcription."); }
    }
  };
  return {
    /** Pausing releases the microphone, so resuming passes the replacement track. */
    start(nextTrack = track) {
      track = nextTrack;
      running = true;
      return new Promise<void>((resolve, reject) => {
        pendingStart = { resolve, reject };
        startTimer = setTimeout(() => {
          fail("On-device browser transcription did not start.");
          recognition.abort();
        }, 5000);
        try { recognition.start(track); }
        catch { fail("On-device browser transcription could not start."); }
      });
    },
    stop() {
      running = false;
      if (!active) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pendingStop = resolve;
        stopTimer = setTimeout(() => {
          recognition.abort();
          active = false;
          pendingStop?.();
          pendingStop = null;
        }, 2000);
        recognition.stop();
      });
    },
    dispose() {
      disposed = true;
      running = false;
      clearTimeout(startTimer);
      clearTimeout(stopTimer);
      pendingStop?.();
      pendingStop = null;
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
      recognition.abort();
    }
  };
}
