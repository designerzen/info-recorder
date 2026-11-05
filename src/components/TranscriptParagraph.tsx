import { h, Fragment, defineElement, patch } from "../ui/dom";
import { sameInputs } from "../ui/lifecycle";
import type { TranscriptSentence } from "../transcript/timedTranscript";

type Props = {
    sentences: TranscriptSentence[];
    /** Translated text by sentence id, for the translations that apply. */
    translations: Record<string, string> | null;
    translationKey: string;
    translationLanguage: string;
    disabled: boolean;
    editing: boolean;
    onPlay: (sentence: TranscriptSentence) => void;
    onEdit: (sentence: TranscriptSentence, text: string) => void;
};

// One long run of inline text repaints as a whole for every highlighted word, so split it up.
const SENTENCES_PER_RUN = 12;

/**
 * Only re-renders when its own sentences change, however long the rest of the transcript is.
 * Sentences are focusable spans because a native button cannot wrap across lines like subtitles.
 * Unavailable playback leaves them focusable, so their details can still be reached by keyboard.
 */
export const TranscriptParagraph = defineElement<Props>("wt-transcript-paragraph", (initialProps, host) => {
    let props = initialProps;
    let previous: readonly unknown[] | undefined;
    const render = () => {
        const { sentences, translations, translationLanguage, disabled, editing, onPlay, onEdit } = props;
        const runs = Array.from({ length: Math.ceil(sentences.length / SENTENCES_PER_RUN) }, (_, index) => sentences.slice(index * SENTENCES_PER_RUN, (index + 1) * SENTENCES_PER_RUN));
        return (<p className="transcript-paragraph">
          {runs.map((run, runIndex) => <span key={runIndex} className="transcript-run">{run.map((sentence) => <span key={sentence.id} className="translated-sentence">
            {editing ? <textarea className="sentence-editor" aria-label={`Edit sentence: ${sentence.text}`} rows={Math.max(1, Math.ceil(sentence.text.length / 60))} value={sentence.text}
              onChange={(event: Event) => { event.stopPropagation(); }}
              onBlur={(event: FocusEvent) => {
                const text = (event.target as HTMLTextAreaElement).value;
                if (text.trim() !== sentence.text) onEdit(sentence, text);
              }} /> : <span role="button" tabIndex={0} className="sentence-button" data-sentence-id={sentence.id} aria-disabled={disabled ? "true" : undefined}
                onClick={() => {
                  // Selecting text to copy is not a press.
                  if (!disabled && !window.getSelection()?.toString()) onPlay(sentence);
                }}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (!disabled && !event.repeat) onPlay(sentence);
                }}>
              {sentence.words.length ? sentence.words.map((word, wordIndex) => <span key={wordIndex} className="sentence-word">{word.text}</span>) : sentence.text}
            </span>}
            {translations?.[sentence.id] ? <span className="sentence-translation" lang={translationLanguage} dir="auto">{translations[sentence.id]}</span> : null}
            {" "}
          </span>)}</span>)}
        </p>);
    };
    const refresh = () => {
        const inputs = [props.sentences, props.translationKey, props.disabled, props.editing];
        if (sameInputs(previous, inputs))
            return;
        previous = inputs;
        patch(host, render());
        host.dispatchEvent(new CustomEvent("transcript-rendered", { bubbles: true }));
    };
    refresh();
    return { update(next) { props = next; refresh(); }, dispose() { } };
});
