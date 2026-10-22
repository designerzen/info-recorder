import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhraseLocationMap, type PhraseLocationMapMessage } from "../../src/components/PhraseLocationMap";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

const message: PhraseLocationMapMessage = {
  id: "s1", paragraphId: "p1", sequence: 0, LAT: 51.5, LONG: -0.12,
  text: "This is the full recorded phrase, including all of its text.",
  startMs: 1000, endMs: 2500, words: []
};

describe("map phrase selection", () => {
  it("reveals full text and invokes playback for the exact clicked sentence", () => {
    const onPlay = vi.fn();
    render(<PhraseLocationMap messages={[message]} onPlay={onPlay} onStop={vi.fn()} activeMessageId={null} isPlaying={false} playbackLabel="Original Audio" playbackUnavailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: `Phrase 1: ${message.text}` }));
    expect(screen.getByRole("region", { name: "Selected phrase" })).toHaveTextContent(message.text);
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(message);
    expect(screen.getByRole("button", { name: "Phrase 1: " + message.text })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps every collocated message selectable and allows stop without closing text", () => {
    const messages = Array.from({ length: 9 }, (_, sequence) => ({ ...message, id: `s${sequence}`, sequence }));
    const onPlay = vi.fn();
    const onStop = vi.fn();
    render(<PhraseLocationMap messages={messages} onPlay={onPlay} onStop={onStop} activeMessageId="s8" isPlaying={true} playbackLabel="Browser voice" playbackUnavailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: `Phrase 9: ${message.text}` }));
    expect(onPlay).toHaveBeenCalledWith(messages[8]);
    fireEvent.click(screen.getByRole("button", { name: "Stop playback" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Selected phrase" })).toBeVisible();
  });

  it("still reveals the text when the selected speech engine is unavailable", () => {
    const onPlay = vi.fn();
    render(<PhraseLocationMap messages={[message]} onPlay={onPlay} onStop={vi.fn()} activeMessageId={null} isPlaying={false} playbackLabel="Unavailable voice" playbackUnavailable={true} />);
    fireEvent.click(screen.getByRole("button", { name: `Phrase 1: ${message.text}` }));
    expect(screen.getByRole("region", { name: "Selected phrase" })).toHaveTextContent(message.text);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play phrase" })).toBeDisabled();
  });
});
