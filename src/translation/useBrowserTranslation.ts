import { useCallback, useEffect, useRef, useState } from "react";
import { getTranslatorApi, getTranslationTargets, type BrowserTranslator } from "./browserTranslator";

export function useBrowserTranslation(
  sentences: Array<{ id: string; text: string }>, sourceLanguage: string, targetLanguage: string
) {
  const supported = Boolean(getTranslatorApi());
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof getTranslationTargets>>>([]);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [translations, setTranslations] = useState<Record<string, { source: string; text: string }>>({});
  const translator = useRef<BrowserTranslator | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const cache = useRef(new Map<string, string>());

  const disable = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    translator.current?.destroy();
    translator.current = null;
    cache.current.clear();
    setEnabled(false);
    setLoading(false);
    setTranslations({});
    setStatus("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const api = getTranslatorApi();
    setTargets([]);
    if (!api) return;
    setChecking(true);
    void getTranslationTargets(api, sourceLanguage).then((next) => {
      if (!cancelled) { setTargets(next); setChecking(false); }
    });
    return () => { cancelled = true; };
  }, [sourceLanguage]);

  useEffect(() => {
    disable();
    return () => {
      generation.current++;
      controller.current?.abort();
      translator.current?.destroy();
      translator.current = null;
    };
  }, [sourceLanguage, targetLanguage, disable]);

  // Called directly by the checkbox click: create() needs user activation.
  const enable = useCallback(async () => {
    const api = getTranslatorApi();
    if (!api) return;
    disable();
    const current = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setStatus("Preparing local translation…");
    try {
      const instance = await api.create({
        sourceLanguage, targetLanguage, signal: abort.signal,
        monitor(monitor) {
          monitor.addEventListener("downloadprogress", (event) => {
            if (current === generation.current) setStatus(`Downloading language pack: ${Math.round(event.loaded * 100)}%`);
          });
        }
      });
      if (current !== generation.current) { instance.destroy(); return; }
      translator.current = instance;
      setLoading(false);
      setEnabled(true);
      setStatus("Translation runs on this device.");
    } catch (error) {
      if (current !== generation.current) return;
      setLoading(false);
      setStatus(`Translation could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [sourceLanguage, targetLanguage, disable]);

  useEffect(() => {
    const instance = translator.current;
    if (!enabled || !instance) return;
    let cancelled = false;
    const abort = new AbortController();
    const current = generation.current;
    void (async () => {
      for (const sentence of sentences) {
        if (cancelled) return;
        const key = `${sentence.id}\u0000${sentence.text}`;
        let text = cache.current.get(key);
        if (text === undefined) {
          try {
            text = await instance.translate(sentence.text, { signal: abort.signal });
          } catch (error) {
            if (!cancelled && current === generation.current) {
              setStatus(`Translation failed: ${error instanceof Error ? error.message : String(error)}. Disable and enable translation to retry.`);
            }
            return;
          }
          if (cancelled || current !== generation.current) return;
          cache.current.set(key, text);
        }
        setTranslations((previous) => previous[sentence.id]?.source === sentence.text
          ? previous : { ...previous, [sentence.id]: { source: sentence.text, text } });
      }
    })();
    return () => { cancelled = true; abort.abort(); };
  }, [sentences, enabled]);

  return { supported, targets, checking, enabled, loading, status, translations, enable, disable };
}
