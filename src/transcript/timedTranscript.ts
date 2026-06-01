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

  for (const word of paragraph.words) {
    currentWords.push(word);
    if (isSentenceBoundaryWord(word.text)) {
      flush();
    }
  }

  flush();
  return sentences;
}

export function joinTranscriptWords(words: TranscriptWord[]) {
  return words
    .map((word, index) => (index === 0 ? word.text.trimStart() : word.text))
    .join("")
    .trim();
}

function isSentenceBoundaryWord(text: string) {
  return /[.!?]["')\]]*\s*$/.test(text.trimEnd());
}
