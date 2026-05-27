export type SpeechPhrase = {
  text: string;
};

export type SpeechPhraseBlock = {
  text: string;
  phrases: SpeechPhrase[];
};

const PHRASE_PATTERN = /[^.!?;:\n]+(?:[.!?;:]+)?(?:\s+|$)|\n/g;

export function splitSpeechPhrases(text: string): SpeechPhrase[] {
  const phrases = Array.from(text.matchAll(PHRASE_PATTERN))
    .map((match) => ({ text: match[0] ?? "" }))
    .filter((phrase) => phrase.text.trim().length > 0);

  if (phrases.length > 0) {
    return phrases;
  }

  const fallback = text.trim();
  return fallback ? [{ text: fallback }] : [];
}

export function splitSpeechPhrasesFromBlocks(blocks: string[]): SpeechPhraseBlock[] {
  return blocks.map((text) => ({
    text,
    phrases: splitSpeechPhrases(text)
  }));
}
