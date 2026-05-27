import { describe, expect, it } from "vitest";
import { getRecordingExportExtension } from "../../src/recorder/audioExport";

describe("audioExport", () => {
  it("keeps native extensions aligned with the source MIME type", () => {
    expect(getRecordingExportExtension("native", "video/mp4")).toBe("mp4");
    expect(getRecordingExportExtension("native", "audio/mp4")).toBe("m4a");
    expect(getRecordingExportExtension("native", "audio/webm;codecs=opus")).toBe("webm");
  });

  it("maps transcoded formats to stable download extensions", () => {
    expect(getRecordingExportExtension("ogg-vorbis", "audio/webm")).toBe("ogg");
    expect(getRecordingExportExtension("ogg-opus", "audio/webm")).toBe("opus");
    expect(getRecordingExportExtension("mp3", "audio/webm")).toBe("mp3");
    expect(getRecordingExportExtension("flac", "audio/webm")).toBe("flac");
    expect(getRecordingExportExtension("wav", "audio/webm")).toBe("wav");
  });
});
