/** Seekable audio for sentence playback, including while MediaRecorder is open. */
export class RecordedAudio {
  private parts: Blob[] = [];
  private samples = 0;
  private sampleRate = 16000;
  private snapshotSamples = 0;
  private url = "";
  private savedParts = 0;

  get hasAudio() { return this.samples > 0; }

  append(samples: Float32Array, sampleRate: number) {
    if (!samples.length) return;
    this.sampleRate = sampleRate;
    const pcm = new DataView(new ArrayBuffer(samples.length * 2));
    for (let i = 0; i < samples.length; i++) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      pcm.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    this.parts.push(new Blob([pcm.buffer]));
    this.samples += samples.length;
  }

  get sampleRateHz() { return this.sampleRate; }

  /** PCM captured since the last call, for incremental saves. */
  takeUnsaved() {
    const parts = this.parts.slice(this.savedParts);
    this.savedParts = this.parts.length;
    return parts.length ? new Blob(parts) : null;
  }

  /** Reopen saved 16-bit PCM without reading it into memory. */
  restore(parts: Blob[], sampleRate: number) {
    this.clear();
    this.parts = parts;
    this.savedParts = parts.length;
    this.sampleRate = sampleRate;
    this.samples = parts.reduce((total, part) => total + part.size, 0) / 2;
  }

  getSourceMedia() {
    if (!this.hasAudio) return null;
    if (this.snapshotSamples !== this.samples) {
      const header = new DataView(new ArrayBuffer(44));
      const tag = (offset: number, value: string) => [...value].forEach((character, i) => header.setUint8(offset + i, character.charCodeAt(0)));
      tag(0, "RIFF"); header.setUint32(4, 36 + this.samples * 2, true); tag(8, "WAVE");
      tag(12, "fmt "); header.setUint32(16, 16, true); header.setUint16(20, 1, true);
      header.setUint16(22, 1, true); header.setUint32(24, this.sampleRate, true);
      header.setUint32(28, this.sampleRate * 2, true); header.setUint16(32, 2, true);
      header.setUint16(34, 16, true); tag(36, "data"); header.setUint32(40, this.samples * 2, true);
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(new Blob([header.buffer, ...this.parts], { type: "audio/wav" }));
      this.snapshotSamples = this.samples;
    }
    return { url: this.url, kind: "audio" as const, fileName: "recording.wav" };
  }

  clear() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.parts = [];
    this.samples = this.snapshotSamples = this.savedParts = 0;
    this.url = "";
  }
}
