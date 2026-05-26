class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "enqueue") {
        this.queue.push(event.data.audio);
      }

      if (event.data?.type === "clear") {
        this.queue = [];
        this.current = null;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? left;

    for (let frame = 0; frame < left.length; frame += 1) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() ?? null;
        this.offset = 0;
      }

      const sample = this.current ? this.current[this.offset] : 0;
      left[frame] = sample;
      right[frame] = sample;
      this.offset += 1;
    }

    return true;
  }
}

registerProcessor("pcm-playback-processor", PcmPlaybackProcessor);
