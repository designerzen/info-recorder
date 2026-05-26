class MediaChunkProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    const source = input?.[0];
    const left = output?.[0];

    if (!source || !left) {
      return true;
    }

    left.set(source);
    const right = output[1];
    if (right) {
      right.set(source);
    }

    const copy = new Float32Array(source.length);
    copy.set(source);
    this.port.postMessage({ type: "samples", samples: copy }, [copy.buffer]);
    return true;
  }
}

registerProcessor("media-chunk-processor", MediaChunkProcessor);
