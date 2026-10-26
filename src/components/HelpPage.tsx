import { ArrowLeft } from "lucide-react";

export function HelpPage() {
  return (
    <article className="help-page" aria-labelledby="help-title">
      <header className="help-intro">
        <span className="hero-kicker">A little guidance</span>
        <h1 id="help-title" tabIndex={-1}>Help with <em>Word Trail.</em></h1>
        <p>Turn spoken words into text. Record your microphone or choose an audio or video file, then read, listen to, and download your transcript. Audio transcription runs on your device.</p>
        <a className="help-back" href="#recorder"><ArrowLeft size={18} aria-hidden="true" /> Back to recorder</a>
      </header>

      <div className="help-sections">
        <section aria-labelledby="help-start">
          <span className="section-eyebrow">01 / GET STARTED</span>
          <h2 id="help-start">Record or choose a file</h2>
          <ol>
            <li><strong>Record live speech.</strong> Select <strong>Start recording</strong> and allow microphone access when your browser asks. Speak normally and watch the transcript appear.</li>
            <li><strong>Or use an existing file.</strong> Select <strong>Upload media</strong> and choose an audio or video file from your device. Here, “upload” opens the file locally for transcription.</li>
            <li><strong>Let the app finish.</strong> Select <strong>Stop recording</strong> when you are done speaking. For a file, wait for transcription to finish. The status bar shows progress.</li>
          </ol>
          <p>The first run downloads the selected speech model, which can take a while. Keep the tab open. Cached models can be reused on later visits.</p>
        </section>

        <section aria-labelledby="help-review">
          <span className="section-eyebrow">02 / REVIEW & LISTEN</span>
          <h2 id="help-review">Follow your words</h2>
          <p>Read the text in <strong>Transcript</strong>. Select a completed sentence to hear it, or use <strong>Play transcript</strong> to listen to the passage.</p>
          <p>The <strong>Voice</strong> menu lets you choose original audio, normalised audio, a browser voice, or a local model voice. Local model voices need WebGPU and download their files on first use.</p>
          <p>Use <strong>Map</strong> to see where recorded phrases were captured when location is available. Your browser may ask for location permission; without it, phrases can have an unknown location.</p>
        </section>

        <section aria-labelledby="help-save">
          <span className="section-eyebrow">03 / KEEP A COPY</span>
          <h2 id="help-save">Download your work</h2>
          <p>Once text appears, use <strong>Download text</strong> to save it. After recording and transcription finish, choose an audio source and format, then select <strong>Download audio</strong>. You can also adjust the download speed and pitch.</p>
          <p><strong>Download captioned video</strong> creates an MP4 with the selected audio, a plain background, and switchable captions. Turn captions on in your video player.</p>
          <p>Save anything you want to keep before reloading or closing the page. Browser storage is local to this browser and device, and clearing site data removes cached files.</p>
        </section>

        <section aria-labelledby="help-settings">
          <span className="section-eyebrow">04 / MAKE IT YOURS</span>
          <h2 id="help-settings">Choose your settings</h2>
          <p>Open <strong>Settings</strong> to choose a microphone, transcription model, speech detection, and playback options. The default model is for English speech; choose a multilingual model for other supported languages. Stop recording before changing recording settings.</p>
          <p>Keep <strong>Save audio chunks</strong> enabled if you want a local recording for playback and downloads. Under <strong>Appearance</strong>, adjust the page’s type, colours, and layout.</p>
          <p>Optional <strong>Translation</strong> shows translated sentences below the original text when your browser supports it. Choose the source and target languages and enable translation. Language packs may download on first use; enable translation again after reloading.</p>
        </section>

        <section aria-labelledby="help-privacy">
          <span className="section-eyebrow">05 / ON YOUR DEVICE</span>
          <h2 id="help-privacy">Understand what stays local</h2>
          <p>The app does not send microphone audio or transcript text to an application server for transcription. Recording storage and speech models are kept in browser-managed storage on your device.</p>
          <p>You need an internet connection to download models and other required files the first time. A downloaded model can be used again without downloading it, unless you clear site data, change browser or device, or select a different model.</p>
        </section>

        <section aria-labelledby="help-trouble">
          <span className="section-eyebrow">06 / A HELPING HAND</span>
          <h2 id="help-trouble">If something isn’t working</h2>
          <ul>
            <li><strong>No microphone audio?</strong> Allow microphone access in your browser’s site permissions, check your device’s microphone settings, and choose the right microphone in Settings.</li>
            <li><strong>Waiting for text?</strong> Check the status bar. The model may still be downloading or processing audio. Try a smaller model if processing is slow.</li>
            <li><strong>A browser feature is unavailable?</strong> Try a current Chrome or Edge browser. Whisper ONNX and local model voices require WebGPU; Moonshine and Whisper WASM transcription models do not.</li>
            <li><strong>Words don’t look right?</strong> Reduce background noise, speak clearly, and check that the selected model supports the language you are speaking. Review the transcript before sharing it.</li>
          </ul>
        </section>
      </div>
    </article>
  );
}
