import { useCallback, useEffect, useRef } from "react";
import JASSUB from "jassub";
import workerUrl from "jassub/dist/worker/worker.js?worker&url";
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url";
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import defaultFontUrl from "jassub/dist/default.woff2?url";
import { createLiveAssSubtitle } from "./subtitleAss";

type JassubInstance = InstanceType<typeof JASSUB>;

export function useJassubSubtitles(text: string) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<JassubInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(performance.now());
  const textRef = useRef(text);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const instance = instanceRef.current;
    if (!canvas || !instance) return;

    const rect = canvas.getBoundingClientRect();
    const mediaTime = (performance.now() - startTimeRef.current) / 1000;
    instance.manualRender({
      expectedDisplayTime: performance.now(),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      mediaTime
    });
    rafRef.current = window.requestAnimationFrame(renderFrame);
  }, []);

  const setSubtitleCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      if (!canvas || instanceRef.current) return;

      const instance = new JASSUB({
        canvas,
        subContent: createLiveAssSubtitle(textRef.current),
        workerUrl,
        wasmUrl,
        modernWasmUrl,
        availableFonts: {
          "liberation sans": defaultFontUrl
        },
        defaultFont: "liberation sans",
        queryFonts: false
      });

      instanceRef.current = instance;
      void instance.ready.then(() => {
        renderFrame();
      });
    },
    [renderFrame]
  );

  useEffect(() => {
    textRef.current = text;
    const instance = instanceRef.current;
    if (!instance) return;

    void instance.ready.then(() =>
      instance.renderer.setTrack(createLiveAssSubtitle(textRef.current))
    );
  }, [text]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      void instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  return setSubtitleCanvas;
}
