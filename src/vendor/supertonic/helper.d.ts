export type SupertonicStyle = {
  ttl: { dims: number[] };
  dp: { dims: number[] };
};

export type SupertonicTextToSpeech = {
  sampleRate: number;
  call(
    text: string,
    lang: string,
    style: SupertonicStyle,
    totalStep: number,
    speed?: number,
    silenceDuration?: number,
    progressCallback?: (step: number, total: number) => void
  ): Promise<{ wav: number[]; duration: number[] }>;
};

export function loadTextToSpeech(
  onnxDir: string,
  sessionOptions?: Record<string, unknown>,
  progressCallback?: (modelName: string, current: number, total: number) => void
): Promise<{ textToSpeech: SupertonicTextToSpeech; cfgs: unknown }>;

export function loadVoiceStyle(
  voiceStylePaths: string[],
  verbose?: boolean
): Promise<SupertonicStyle>;

export function writeWavFile(audioData: number[] | Float32Array, sampleRate: number): ArrayBuffer;
