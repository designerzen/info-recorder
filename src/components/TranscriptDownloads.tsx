import { useMemo, useRef, useState } from "react";
import { Download, FileText, Film } from "lucide-react";
import { appSettings, type SupertonicVoiceId } from "../config/settings";
import type { TranscriptSentence } from "../transcript/timedTranscript";
import {
  buildOriginalCaptions,
  downloadTranscriptBlob,
  exportTranscriptMedia,
  synthesizeTranscriptAudio,
  type DownloadAudioFormat
} from "../transcript/transcriptExport";
import "./TranscriptDownloads.css";

type SourceMedia = { url: string; fileName?: string };
type Props = {
  text: string;
  sentences: TranscriptSentence[];
  hasSourceAudio: boolean;
  getSourceMedia: () => Promise<SourceMedia | null>;
  busy: boolean;
};

export function TranscriptDownloads({ text, sentences, hasSourceAudio, getSourceMedia, busy }: Props) {
  const [source, setSource] = useState("original");
  const [format, setFormat] = useState<DownloadAudioFormat>("mp3");
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const hasText = Boolean(text.trim());
  const selectedSource = source === "original" && !hasSourceAudio ? appSettings.tts.supertonic.defaultVoiceId : source;
  const isTts = selectedSource !== "original";
  const supportsTts = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  const disabled = busy || exporting || !hasText || (isTts && !supportsTts);
  const originalCaptions = useMemo(() => buildOriginalCaptions(sentences), [sentences]);
  const hasCaptions = isTts || originalCaptions.length > 0;

  const downloadMedia = async (video: boolean) => {
    if (disabled || exportLock.current) return;
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
      } else {
        const media = await getSourceMedia();
        if (!media) throw new Error("The original audio is unavailable. Choose a TTS voice instead.");
        const response = await fetch(media.url);
        if (!response.ok) throw new Error("Unable to read the original audio. Please try again.");
        blob = await response.blob();
        name = (media.fileName ?? name).replace(/\.[a-z0-9]{2,5}$/i, "");
      }
      const result = await exportTranscriptMedia(blob, { format: video ? "mp4" : format, speed, pitch, captions }, setStatus);
      const stem = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
      const voice = isTts ? `tts-${selectedSource}` : "original";
      downloadTranscriptBlob(result.blob, `${stem}-${voice}-${speed}x-pitch${pitch >= 0 ? "+" : ""}${pitch}.${result.extension}`);
      setStatus(`${video ? "Captioned video" : "Audio"} download ready.`);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Unable to prepare the download. Please try again.");
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  };

  if (!hasText) return null;
  return (
    <section className="transcript-downloads" aria-label="Transcript downloads" aria-busy={exporting}>
      <div className="download-heading">
        <strong>Take your words with you</strong>
        <button type="button" onClick={() => downloadTranscriptBlob(new Blob([`${text.trim()}\n`], { type: "text/plain;charset=utf-8" }), "transcript.txt")}>
          <FileText size={17} aria-hidden="true" /> Download text
        </button>
      </div>
      <fieldset className="download-options" disabled={busy || exporting}>
        <legend>Audio download options</legend>
        <label className="download-source">Audio source
          <select value={selectedSource} onChange={(event) => { setSource(event.target.value); setError(""); setStatus(""); }}>
            <option value="original" disabled={!hasSourceAudio}>Original recording</option>
            <optgroup label="TTS · local model voices">
              {appSettings.tts.supertonic.voices.map((voice) => <option key={voice.id} value={voice.id} disabled={!supportsTts}>{voice.name}</option>)}
            </optgroup>
          </select>
        </label>
        <label>Audio format
          <select value={format} onChange={(event) => setFormat(event.target.value as DownloadAudioFormat)}>
            <option value="mp3">MP3</option><option value="wav">WAV</option><option value="flac">FLAC</option>
            <option value="ogg-opus">Ogg Opus</option><option value="ogg-vorbis">Ogg Vorbis</option>
          </select>
        </label>
        <label>Speed · {speed}×
          <input aria-label="Download speed" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
        </label>
        <label>Pitch · {pitch > 0 ? "+" : ""}{pitch} semitones
          <input aria-label="Download pitch" type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} />
        </label>
      </fieldset>
      <div className="download-actions">
        <button type="button" disabled={disabled} onClick={() => void downloadMedia(false)}><Download size={17} aria-hidden="true" /> Download audio</button>
        <button type="button" disabled={disabled || !hasCaptions} onClick={() => void downloadMedia(true)} aria-describedby="caption-download-hint"><Film size={17} aria-hidden="true" /> Download captioned video</button>
      </div>
      <p id="caption-download-hint" className="download-hint">MP4 combines the selected audio with a plain background and synchronized, switchable closed captions. Turn on captions in your player.</p>
      {busy ? <p className="download-hint">Audio downloads are available when recording and transcription finish. You can save the text so far.</p> : null}
      {!hasCaptions ? <p className="download-hint">Original audio has no usable caption timestamps. Select a TTS voice to create timed captions.</p> : null}
      <p className="download-hint">TTS downloads use local model voices and require WebGPU. Browser system voices are available for playback. Voice models and the media encoder download on first use.</p>
      {!supportsTts ? <p className="download-hint">TTS downloads are unavailable in this browser because WebGPU is not available.</p> : null}
      <p className="download-status" role="status">{status}</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
