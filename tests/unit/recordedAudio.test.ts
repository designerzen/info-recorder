import { Blob } from "node:buffer";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordedAudio } from "../../src/recorder/recordedAudio";

describe("seekable recording snapshots", () => {
  beforeEach(() => { vi.stubGlobal("Blob", Blob); vi.stubGlobal("URL", NodeURL); });
  afterEach(() => vi.unstubAllGlobals());
  it("encodes captured PCM in order with a finite WAV duration and reuses unchanged snapshots", async () => {
    const recording = new RecordedAudio();
    expect(recording.getSourceMedia()).toBeNull();
    recording.append(new Float32Array([-2, -0.5, 0, 0.5, 2]), 16000);
    const source = recording.getSourceMedia()!;
    expect(recording.getSourceMedia()).toEqual(source);
    const bytes = await (await fetch(source.url)).arrayBuffer();
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(10);
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767]);
    recording.clear();
    expect(recording.hasAudio).toBe(false);
    expect(recording.getSourceMedia()).toBeNull();
  });
  it("releases replaced and cleared object URLs", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const recording = new RecordedAudio();
    recording.append(new Float32Array([0.2]), 16000);
    const first = recording.getSourceMedia()!;
    recording.append(new Float32Array([0.3]), 16000);
    const second = recording.getSourceMedia()!;
    expect(second.url).not.toBe(first.url);
    expect(revoke).toHaveBeenCalledWith(first.url);
    recording.clear();
    expect(revoke).toHaveBeenCalledWith(second.url);
  });
});
