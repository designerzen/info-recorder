import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createTranslationMachine, createStateMachine } from "../state/machine";
import { getTranslatorApi, getTranslationTargets, type BrowserTranslator } from "./browserTranslator";
export function createBrowserTranslation(...initialInputs: [
    sentences: Array<{
        id: string;
        text: string;
    }>,
    sourceLanguage: string,
    targetLanguage: string
]) {
    let sentences = initialInputs[0];
    let sourceLanguage = initialInputs[1];
    let targetLanguage = initialInputs[2];
    const scope = createLifecycle();
    const machine = createTranslationMachine();
    scope.own(machine.subscribe(scope.invalidate));
    scope.own(machine.dispose);
    const contextStore = createStateMachine({ targets: ([]) as Awaited<ReturnType<typeof getTranslationTargets>>,
        checking: false,
        status: "",
        translations: ({}) as Record<string, {
            source: string;
            text: string;
        }> }, () => "ready");
    let state = contextStore.context;
    scope.own(contextStore.subscribe(() => { state = contextStore.context; scope.invalidate(); }));
    scope.own(contextStore.dispose);
    const setTargets = (value: typeof state.targets | ((previous: typeof state.targets) => typeof state.targets)) => contextStore.send({ type: "targets", value });
    const setChecking = (value: typeof state.checking | ((previous: typeof state.checking) => typeof state.checking)) => contextStore.send({ type: "checking", value });
    const setStatus = (value: typeof state.status | ((previous: typeof state.status) => typeof state.status)) => contextStore.send({ type: "status", value });
    const setTranslations = (value: typeof state.translations | ((previous: typeof state.translations) => typeof state.translations)) => contextStore.send({ type: "translations", value });
    const translator: {
        current: BrowserTranslator | null;
    } = { current: null };
    const controller: {
        current: AbortController | null;
    } = { current: null };
    const generation = { current: 0 };
    const cache = { current: new Map<string, string>() };
    let supported = Boolean(getTranslatorApi());
    const disable = () => {
        generation.current++;
        controller.current?.abort();
        translator.current?.destroy();
        translator.current = null;
        cache.current.clear();
        machine.send("DISABLE");
        setTranslations({});
        setStatus("");
    };
    const enable = async () => {
        const api = getTranslatorApi();
        if (!api)
            return;
        disable();
        const current = generation.current;
        const abort = new AbortController();
        controller.current = abort;
        machine.send("LOAD");
        setStatus("Preparing local translation…");
        try {
            const instance = await api.create({
                sourceLanguage, targetLanguage, signal: abort.signal,
                monitor(monitor) {
                    monitor.addEventListener("downloadprogress", (event) => {
                        if (current === generation.current)
                            setStatus(`Downloading language pack: ${Math.round(event.loaded * 100)}%`);
                    });
                }
            });
            if (current !== generation.current) {
                instance.destroy();
                return;
            }
            translator.current = instance;
            machine.send("READY");
            setStatus("Translation runs on this device.");
        }
        catch (error) {
            if (current !== generation.current)
                return;
            machine.send("FAIL");
            setStatus(`Translation could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const snapshot = () => ({ supported, targets: state.targets, checking: state.checking, enabled: (machine.value === "enabled"), loading: (machine.value === "loading"), status: state.status, translations: state.translations, enable, disable });
    const listeners = new Set<() => void>();
    function refresh() {
        supported = Boolean(getTranslatorApi());
        scope.watch("translation-targets", [sourceLanguage], () => {
            let cancelled = false;
            const api = getTranslatorApi();
            setTargets([]);
            if (!api)
                return;
            setChecking(true);
            void getTranslationTargets(api, sourceLanguage).then((next) => {
                if (!cancelled) {
                    setTargets(next);
                    setChecking(false);
                }
            });
            return () => { cancelled = true; };
        });
        scope.watch("translation-languages", [sourceLanguage, targetLanguage, disable], () => {
            disable();
            return () => {
                generation.current++;
                controller.current?.abort();
                translator.current?.destroy();
                translator.current = null;
            };
        });
        scope.watch("sentence-translation", [sentences, (machine.value === "enabled")], () => {
            const instance = translator.current;
            if (!(machine.value === "enabled") || !instance)
                return;
            let cancelled = false;
            const abort = new AbortController();
            const current = generation.current;
            void (async () => {
                for (const sentence of sentences) {
                    if (cancelled)
                        return;
                    const key = `${sentence.id}\u0000${sentence.text}`;
                    let text = cache.current.get(key);
                    if (text === undefined) {
                        try {
                            text = await instance.translate(sentence.text, { signal: abort.signal });
                        }
                        catch (error) {
                            if (!cancelled && current === generation.current) {
                                setStatus(`Translation failed: ${error instanceof Error ? error.message : String(error)}. Disable and enable translation to retry.`);
                            }
                            return;
                        }
                        if (cancelled || current !== generation.current)
                            return;
                        cache.current.set(key, text);
                    }
                    setTranslations((previous) => previous[sentence.id]?.source === sentence.text
                        ? previous : { ...previous, [sentence.id]: { source: sentence.text, text } });
                }
            })();
            return () => { cancelled = true; abort.abort(); };
        });
        scope.flush();
        for (const listener of listeners)
            listener();
    }
    scope.setRefresh(refresh);
    refresh();
    let previousInputs: readonly unknown[] = initialInputs;
    return {
        get supported() { return snapshot().supported; },
        get targets() { return snapshot().targets; },
        get checking() { return snapshot().checking; },
        get enabled() { return snapshot().enabled; },
        get loading() { return snapshot().loading; },
        get status() { return snapshot().status; },
        get translations() { return snapshot().translations; },
        get enable() { return snapshot().enable; },
        get disable() { return snapshot().disable; },
        get machine() { return machine; },
        update(...inputs: [
            sentences: Array<{
                id: string;
                text: string;
            }>,
            sourceLanguage: string,
            targetLanguage: string
        ]) { if (sameInputs(previousInputs, inputs))
            return; previousInputs = inputs; [sentences, sourceLanguage, targetLanguage] = inputs; refresh(); },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { scope.dispose(); listeners.clear(); }
    };
}
