import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptDownloads } from "../../src/components/TranscriptDownloads";
import { downloadTranscriptBlob, exportTranscriptMedia, synthesizeTranscriptAudio } from "../../src/transcript/transcriptExport";

vi.mock("../../src/transcript/transcriptExport", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/transcript/transcriptExport")>(),
  downloadTranscriptBlob: vi.fn(),
  exportTranscriptMedia: vi.fn(),
  synthesizeTranscriptAudio: vi.fn()
}));

const sentence = { id: "s1", paragraphId: "p1", text: "Hello there.", words: [], startMs: 1000, endMs: 2000 };
const original = new Blob(["original"], { type: "audio/wav" });
const props = { text: "Hello there.", sentences: [sentence], hasSourceAudio: true, getSourceMedia: vi.fn(async () => ({ url: "blob:recording", fileName: "example.wav" })), busy: false };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => original })));
  vi.mocked(exportTranscriptMedia).mockResolvedValue({ blob: new Blob(["encoded"]), extension: "mp3" });
  vi.mocked(synthesizeTranscriptAudio).mockResolvedValue({ blob: new Blob(["speech"]), captions: [{ text: "Hello there.", startMs: 0, endMs: 500 }] });
});

describe("transcript download controls", () => {
  it("saves text while blocking audio during recording or transcription", () => {
    render(<TranscriptDownloads {...props} busy />);
    expect(screen.getByRole("button", { name: "Download audio", exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download captioned video" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Download text" }));
    expect(downloadTranscriptBlob).toHaveBeenCalledWith(expect.any(Blob), "transcript.txt");
  });

  it("exports original audio using the selected independent speed and pitch", async () => {
    render(<TranscriptDownloads {...props} />);
    fireEvent.change(screen.getByLabelText("Download speed"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Download pitch"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Download audio", exact: true }));
    await waitFor(() => expect(downloadTranscriptBlob).toHaveBeenCalled());
    expect(exportTranscriptMedia).toHaveBeenCalledWith(original, { format: "mp3", speed: 1.5, pitch: 3, captions: [sentence] }, expect.any(Function));
    expect(downloadTranscriptBlob).toHaveBeenCalledWith(expect.any(Blob), "example-original-1.5x-pitch+3.mp3");
  });

  it("uses generated TTS timings for a captioned video", async () => {
    render(<TranscriptDownloads {...props} />);
    fireEvent.change(screen.getByLabelText("Audio source"), { target: { value: "F1" } });
    fireEvent.click(screen.getByRole("button", { name: "Download captioned video" }));
    await waitFor(() => expect(exportTranscriptMedia).toHaveBeenCalled());
    expect(synthesizeTranscriptAudio).toHaveBeenCalledWith("Hello there.", "F1", expect.any(Function));
    expect(exportTranscriptMedia).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ format: "mp4", captions: [{ text: "Hello there.", startMs: 0, endMs: 500 }] }), expect.any(Function));
    expect(props.getSourceMedia).not.toHaveBeenCalled();
  });

  it("keeps original downloads available without WebGPU and explains missing timings", () => {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
    render(<TranscriptDownloads {...props} sentences={[]} />);
    expect(screen.getByRole("button", { name: "Download audio", exact: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download captioned video" })).toBeDisabled();
    expect(screen.getByText(/Original audio has no usable caption timestamps/)).toBeVisible();
    expect(screen.getByRole("option", { name: "Supertonic Female 1" })).toBeDisabled();
  });

  it("reports a failed export and allows retry", async () => {
    vi.mocked(exportTranscriptMedia).mockRejectedValueOnce(new Error("Encoder download failed"));
    render(<TranscriptDownloads {...props} />);
    const button = screen.getByRole("button", { name: "Download audio", exact: true });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Encoder download failed"));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(downloadTranscriptBlob).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
