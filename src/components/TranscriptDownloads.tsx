import { h, Fragment, defineElement, patch } from "../ui/dom";
import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createStateMachine } from "../state/machine";
import { Download, FileText, Film } from "../ui/icons";
import { appSettings, type SupertonicVoiceId } from "../config/settings";
import type { TranscriptSentence } from "../transcript/timedTranscript";
import { buildOriginalCaptions, downloadTranscriptBlob, exportTranscriptMedia, synthesizeTranscriptAudio, type DownloadAudioFormat } from "../transcript/transcriptExport";
import "./TranscriptDownloads.css";
type SourceMedia = {
    url: string;
    fileName?: string;
};
type Props = {
    textOnly?: boolean;
    text: string;
    sentences: TranscriptSentence[];
    hasSourceAudio: boolean;
    getSourceMedia: () => Promise<SourceMedia | null>;
    busy: boolean;
};
export const TranscriptDownloads = defineElement<Props>("wt-transcript-downloads", (initialProps, host) => {
    let { text, sentences, hasSourceAudio, getSourceMedia, busy, textOnly = false } = initialProps;
    const scope = createLifecycle();
    const machine = createStateMachine({ source: "original",
        format: ("mp3") as DownloadAudioFormat,
        speed: 1,
        pitch: 0,
        exporting: false,
        status: "",
        error: "" }, (context) => context.exporting ? "exporting" : context.error ? "error" : "ready");
    let state = machine.context;
    scope.own(machine.subscribe(() => { state = machine.context; scope.invalidate(); }));
    scope.own(machine.dispose);
    const setSource = (value: typeof state.source | ((previous: typeof state.source) => typeof state.source)) => machine.send({ type: "source", value });
    const setFormat = (value: typeof state.format | ((previous: typeof state.format) => typeof state.format)) => machine.send({ type: "format", value });
    const setSpeed = (value: typeof state.speed | ((previous: typeof state.speed) => typeof state.speed)) => machine.send({ type: "speed", value });
    const setPitch = (value: typeof state.pitch | ((previous: typeof state.pitch) => typeof state.pitch)) => machine.send({ type: "pitch", value });
    const setExporting = (value: typeof state.exporting | ((previous: typeof state.exporting) => typeof state.exporting)) => machine.send({ type: "exporting", value });
    const setStatus = (value: typeof state.status | ((previous: typeof state.status) => typeof state.status)) => machine.send({ type: "status", value });
    const setError = (value: typeof state.error | ((previous: typeof state.error) => typeof state.error)) => machine.send({ type: "error", value });
    const exportLock = { current: false };
    let hasText = Boolean(text.trim());
    let selectedSource = state.source === "original" && !hasSourceAudio ? appSettings.tts.supertonic.defaultVoiceId : state.source;
    let isTts = selectedSource !== "original";
    let supportsTts = typeof navigator !== "undefined" && Boolean(navigator.gpu);
    let disabled = busy || state.exporting || !hasText || (isTts && !supportsTts);
    const calculateoriginalCaptions = () => buildOriginalCaptions(sentences);
    let originalCaptions = calculateoriginalCaptions();
    let calculateoriginalCaptionsInputs: readonly unknown[] | undefined;
    let hasCaptions = isTts || originalCaptions.length > 0;
    const downloadMedia = async (video: boolean) => {
        if (disabled || exportLock.current)
            return;
        exportLock.current = true;
        setExporting(true);
        setError("");
        setStatus("Preparing download…");
        try {
            let blob: Blob;
            let captions = originalCaptions;
            let name = "transcript";
            if (isTts) {
                const generated = await synthesizeTranscriptAudio(text, selectedSource as SupertonicVoiceId, setStatus);
                blob = generated.blob;
                captions = generated.captions;
            }
            else {
                const media = await getSourceMedia();
                if (!media)
                    throw new Error("The original audio is unavailable. Choose a TTS voice instead.");
                const response = await fetch(media.url);
                if (!response.ok)
                    throw new Error("Unable to read the original audio. Please try again.");
                blob = await response.blob();
                name = (media.fileName ?? name).replace(/\.[a-z0-9]{2,5}$/i, "");
            }
            const result = await exportTranscriptMedia(blob, { format: video ? "mp4" : state.format, speed: state.speed, pitch: state.pitch, captions }, setStatus);
            const stem = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
            const voice = isTts ? `tts-${selectedSource}` : "original";
            downloadTranscriptBlob(result.blob, `${stem}-${voice}-${state.speed}x-pitch${state.pitch >= 0 ? "+" : ""}${state.pitch}.${result.extension}`);
            setStatus(`${video ? "Captioned video" : "Audio"} download ready.`);
        }
        catch (cause) {
            setStatus("");
            setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Unable to prepare the download. Please try again.");
        }
        finally {
            exportLock.current = false;
            setExporting(false);
        }
    };
    function render() {
        if (!hasText)
            return null;
        const showMediaOptions = !textOnly && !busy && (hasSourceAudio || supportsTts);
        return (<section className="transcript-downloads" aria-label="Transcript downloads" aria-busy={state.exporting}>
      <div className="download-heading">
        <button type="button" onClick={() => downloadTranscriptBlob(new Blob([`${text.trim()}\n`], { type: "text/plain;charset=utf-8" }), "transcript.txt")}>
          <FileText size={17} aria-hidden="true"/> Download text
        </button>
      </div>
      {showMediaOptions ? <><fieldset className="download-options" disabled={state.exporting}>
        <legend>Audio download options</legend>
        <label className="download-source">Audio source
          <select value={selectedSource} onChange={(event) => { setSource(event.target.value); setError(""); setStatus(""); }}>
            {hasSourceAudio ? <option value="original">Original recording</option> : null}
            {supportsTts ? <optgroup label="TTS · local model voices">
              {appSettings.tts.supertonic.voices.map((voice) => <option key={voice.id} value={voice.id} disabled={!supportsTts}>{voice.name}</option>)}
            </optgroup> : null}
          </select>
        </label>
        <label>Audio format
          <select value={state.format} onChange={(event) => setFormat(event.target.value as DownloadAudioFormat)}>
            <option value="mp3">MP3</option><option value="wav">WAV</option><option value="flac">FLAC</option>
            <option value="ogg-opus">Ogg Opus</option><option value="ogg-vorbis">Ogg Vorbis</option>
          </select>
        </label>
        <label>Speed · {state.speed}×
          <input aria-label="Download speed" type="range" min="0.5" max="2" step="0.05" value={state.speed} onChange={(event) => setSpeed(Number(event.target.value))}/>
        </label>
        <label>Pitch · {state.pitch > 0 ? "+" : ""}{state.pitch} semitones
          <input aria-label="Download pitch" type="range" min="-12" max="12" step="1" value={state.pitch} onChange={(event) => setPitch(Number(event.target.value))}/>
        </label>
      </fieldset>
      <div className="download-actions">
        <button type="button" disabled={disabled} onClick={() => void downloadMedia(false)}><Download size={17} aria-hidden="true"/> Download audio</button>
        {hasCaptions ? <button type="button" disabled={disabled} onClick={() => void downloadMedia(true)}><Film size={17} aria-hidden="true"/> Download captioned video</button> : null}
      </div>
      </> : null}
      <p className="download-status" role="status">{state.status}</p>
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
    </section>);
    }
    function refresh() {
        hasText = Boolean(text.trim());
        selectedSource = state.source === "original" && !hasSourceAudio ? appSettings.tts.supertonic.defaultVoiceId : state.source;
        isTts = selectedSource !== "original";
        supportsTts = typeof navigator !== "undefined" && Boolean(navigator.gpu);
        disabled = busy || state.exporting || !hasText || (isTts && !supportsTts);
        {
            const inputs = [sentences];
            if (!sameInputs(calculateoriginalCaptionsInputs, inputs)) {
                originalCaptions = calculateoriginalCaptions();
                calculateoriginalCaptionsInputs = inputs;
            }
        }
        hasCaptions = isTts || originalCaptions.length > 0;
        patch(host, render());
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) { ({ text, sentences, hasSourceAudio, getSourceMedia, busy, textOnly = false } = props); refresh(); }, dispose: scope.dispose };
});
