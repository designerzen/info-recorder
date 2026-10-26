import JASSUB from "jassub";
import workerUrl from "jassub/dist/worker/worker.js?worker&url";
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url";
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import type { AppSettings } from "../config/settings";
import { subtitleFontAssets } from "./subtitleTypefaceAssets";
import { createLiveAssSubtitle } from "./subtitleAss";
/** The native canvas owns the renderer; changing subtitle text keeps it alive. */
export function createJassubSubtitles(initialText: string, initialSettings: AppSettings["subtitles"], onError: (error: unknown) => void = console.error) {
    let text = initialText;
    let settings = initialSettings;
    let canvas: HTMLCanvasElement | null = null;
    let instance: InstanceType<typeof JASSUB> | null = null;
    let frame: number | null = null;
    let startedAt = performance.now();
    let revision = 0;
    let loadedFontFamily = initialSettings.fontFamily;
    let pendingTrack = Promise.resolve();
    const track = () => createLiveAssSubtitle(text, {
        durationSeconds: settings.assDurationSeconds,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        marginV: settings.marginV
    });
    const release = () => {
        if (frame !== null)
            cancelAnimationFrame(frame);
        frame = null;
        const previous = instance;
        instance = null;
        // JASSUB removes its canvas synchronously. Let the owning DOM patch
        // detach it first, then release the worker and its offscreen context.
        if (previous) queueMicrotask(() => { void previous.destroy().catch(onError); });
    };
    const renderFrame = async (renderer: InstanceType<typeof JASSUB>) => {
        if (!canvas || instance !== renderer)
            return;
        const rect = canvas.getBoundingClientRect();
        await pendingTrack;
        if (instance !== renderer) return;
        await renderer.manualRender({
            expectedDisplayTime: performance.now(),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
            // Each track is the current spoken phrase, held until speech advances.
            mediaTime: Math.min((performance.now() - startedAt) / 1000, Math.max(0, settings.assDurationSeconds - 0.02))
        });
        if (instance === renderer)
            frame = requestAnimationFrame(() => { void renderFrame(renderer).catch(onError); });
    };
    return {
        setCanvas(next: HTMLCanvasElement | null) {
            if (next === canvas)
                return;
            release();
            canvas = next;
            if (!canvas)
                return;
            const family = settings.fontFamily.toLowerCase();
            const renderer = new JASSUB({
                canvas, subContent: track(), workerUrl, wasmUrl, modernWasmUrl,
                availableFonts: subtitleFontAssets,
                fonts: [subtitleFontAssets[family] ?? Object.values(subtitleFontAssets)[0]],
                defaultFont: subtitleFontAssets[family] ? family : Object.keys(subtitleFontAssets)[0],
                queryFonts: false
            });
            instance = renderer;
            loadedFontFamily = settings.fontFamily;
            startedAt = performance.now();
            pendingTrack = renderer.ready.then(() => {}).catch(onError);
            void renderer.ready.then(() => renderFrame(renderer)).catch(onError);
        },
        update(nextText: string, nextSettings: AppSettings["subtitles"]) {
            if (text === nextText && settings === nextSettings)
                return;
            text = nextText;
            settings = nextSettings;
            const currentRevision = ++revision;
            const content = track();
            const renderer = instance;
            if (renderer)
                pendingTrack = pendingTrack.then(async () => {
                    if (instance !== renderer || revision !== currentRevision) return;
                    if (nextSettings.fontFamily !== loadedFontFamily) {
                        await renderer.renderer.addFonts([subtitleFontAssets[nextSettings.fontFamily.toLowerCase()] ?? Object.values(subtitleFontAssets)[0]]);
                        if (instance !== renderer) return;
                        loadedFontFamily = nextSettings.fontFamily;
                    }
                    await renderer.renderer.setTrack(content);
                    startedAt = performance.now();
                }).catch(onError);
        },
        dispose() { canvas = null; release(); }
    };
}
