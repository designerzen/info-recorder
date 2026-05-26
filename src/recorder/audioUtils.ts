export type MonoAudioBufferLike = {
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
};

export function toMono(buffer: MonoAudioBufferLike) {
  const channelCount = buffer.numberOfChannels;
  const output = new Float32Array(buffer.length);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) {
      output[index] += input[index] / channelCount;
    }
  }

  return output;
}

export function concatAudio(left: Float32Array, right: Float32Array) {
  const output = new Float32Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

export function getRms(audio: Float32Array) {
  let sum = 0;
  for (let index = 0; index < audio.length; index += 1) {
    const sample = audio[index];
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, audio.length));
}

export function resampleLinear(audio: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return audio;
  if (sourceRate <= 0 || targetRate <= 0) {
    throw new Error("Sample rates must be greater than zero.");
  }

  const nextLength = Math.max(1, Math.ceil((audio.length * targetRate) / sourceRate));
  const output = new Float32Array(nextLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < nextLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(audio.length - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    const left = audio[leftIndex] ?? 0;
    const right = audio[rightIndex] ?? left;
    output[index] = left + (right - left) * fraction;
  }

  return output;
}
