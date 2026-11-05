const SENTENCE_PAUSE_MS = 1200;
const MIN_WORDS_BEFORE_PAUSE_SPLIT = 3;
const MAX_SENTENCE_WORDS = 32;
const MIN_ESTIMATED_WORD_MS = 120;
const TITLE_ABBREVIATIONS = new Set(["dr.", "mr.", "mrs.", "ms.", "prof.", "st.", "vs.", "sr.", "jr."]);
const AMBIGUOUS_ABBREVIATIONS = /^(?:\p{L}\.){2,}$/u;

export type TranscriptWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type TranscriptParagraph = {
  id: string;
  text: string;
  words: TranscriptWord[];
};

export type TranscriptSentence = {
  id: string;
  paragraphId: string;
  text: string;
  words: TranscriptWord[];
  startMs: number;
  endMs: number;
};

export function buildTranscriptSentences(paragraphs: TranscriptParagraph[]) {
  return paragraphs.flatMap(splitParagraphIntoSentences);
}

export function splitParagraphIntoSentences(paragraph: TranscriptParagraph): TranscriptSentence[] {
  if (paragraph.words.length === 0) {
    const text = paragraph.text.trim();
    return text
      ? [
          {
            id: `${paragraph.id}-s0`,
            paragraphId: paragraph.id,
            text,
            words: [],
            startMs: 0,
            endMs: 0
          }
        ]
      : [];
  }

  const sentences: TranscriptSentence[] = [];
  let currentWords: TranscriptWord[] = [];

  const flush = () => {
    if (currentWords.length === 0) return;
    const sentenceWords = currentWords;
    currentWords = [];
    const text = joinTranscriptWords(sentenceWords);
    if (!text) return;
    sentences.push({
      id: `${paragraph.id}-s${sentences.length}`,
      paragraphId: paragraph.id,
      text,
      words: sentenceWords,
      startMs: sentenceWords[0]?.startMs ?? 0,
      endMs: sentenceWords[sentenceWords.length - 1]?.endMs ?? sentenceWords[0]?.startMs ?? 0
    });
  };

  paragraph.words.forEach((word, index) => {
    const next = paragraph.words[index + 1];
    const hasLongPause = next !== undefined && next.startMs - word.endMs >= SENTENCE_PAUSE_MS;
    currentWords.push(word);
    if (isSentenceBoundaryWord(word.text, next?.text) ||
      (hasLongPause && currentWords.length >= MIN_WORDS_BEFORE_PAUSE_SPLIT) ||
      currentWords.length >= MAX_SENTENCE_WORDS) {
      flush();
    }
  });

  flush();
  return sentences;
}

export function joinTranscriptWords(words: TranscriptWord[]) {
  return words
    .map((word, index) => (index === 0 ? word.text.trimStart() : word.text))
    .join("")
    .trim();
}

function isSentenceBoundaryWord(text: string, nextText?: string) {
  const word = text.trim();
  if (!/[.!?\u3002\uFF01\uFF1F]["')\]\u300D\u300F]*$/.test(word)) return false;
  const bare = word.replace(/^["'(\[]+/, "").toLowerCase();
  if (TITLE_ABBREVIATIONS.has(bare)) return false;
  // "U.S." or "p.m." only end a sentence when a capitalised word follows.
  if (AMBIGUOUS_ABBREVIATIONS.test(bare)) return nextText === undefined || /^\s*\p{Lu}/u.test(nextText);
  return true;
}

/** Spread words across a time window by length, for engines without word timestamps. */
export function estimateWordTimings(text: string, startMs: number, endMs: number, minWordMs = MIN_ESTIMATED_WORD_MS): TranscriptWord[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const totalWeight = tokens.reduce((sum, token) => sum + token.trim().length, 0);
  const durationMs = Math.max(endMs - startMs, tokens.length * minWordMs);
  let elapsedWeight = 0;
  return tokens.map((token) => {
    const wordStartMs = startMs + durationMs * elapsedWeight / totalWeight;
    elapsedWeight += token.trim().length;
    return { text: token, startMs: wordStartMs, endMs: startMs + durationMs * elapsedWeight / totalWeight };
  });
}

/** Replace one sentence's words in its paragraph, keeping the sentence's place on the timeline. */
export function replaceSentenceText(paragraph: TranscriptParagraph, sentence: TranscriptSentence, text: string): TranscriptParagraph {
  const first = paragraph.words.indexOf(sentence.words[0]);
  if (first < 0) {
    return { ...paragraph, text: text.trim() };
  }
  const separator = paragraph.words[first + sentence.words.length] ? " " : "";
  const replacement = estimateWordTimings(`${text.trim()}${separator}`, sentence.startMs, sentence.endMs, 0);
  const words = [...paragraph.words.slice(0, first), ...replacement, ...paragraph.words.slice(first + sentence.words.length)];
  return { ...paragraph, words, text: joinTranscriptWords(words) };
}
