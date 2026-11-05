import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalSpeechSession, prepareLocalSpeechRecognition, supportsLocalSpeechRecognition, type LocalRecognition } from "../../src/recorder/localSpeechRecognition";

class Recognition implements LocalRecognition {
  static available = vi.fn(async () => "available");
  static install = vi.fn(async () => true);
  processLocally = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: LocalRecognition["onstart"] = null;
  onend: LocalRecognition["onend"] = null;
  onerror: LocalRecognition["onerror"] = null;
  onresult: LocalRecognition["onresult"] = null;
  start = vi.fn(() => { this.onstart?.(); });
  stop = vi.fn(() => { this.onend?.(); });
  abort = vi.fn();
}

function expose(value: unknown, name = "SpeechRecognition") {
  Object.defineProperty(window, name, { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
  Recognition.available.mockReset().mockResolvedValue("available");
  Recognition.install.mockReset().mockResolvedValue(true);
});

describe("local-only browser recognition", () => {
  it("falls back when recognition or processLocally is missing without calling remote recognition", async () => {
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
    const start = vi.fn();
    expose(class { start = start; static available = Recognition.available; });
    expect(supportsLocalSpeechRecognition()).toBe(false);
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(Recognition.available).not.toHaveBeenCalled();
  });

  it("requires pack availability support even when the instance exposes processLocally", async () => {
    expose(class { processLocally = false; });
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
  });

  it("enables local processing explicitly for prefixed browsers too", async () => {
    expose(Recognition, "webkitSpeechRecognition");
    expect(await prepareLocalSpeechRecognition("en")).toMatchObject({
      processLocally: true, lang: "en-US", continuous: true, interimResults: true
    });
    expect(Recognition.available).toHaveBeenCalledWith({ langs: ["en-US"], processLocally: true });
    expect(Recognition.install).not.toHaveBeenCalled();
  });

  it.each(["downloadable", "downloading"])("installs a %s pack and rechecks readiness", async (status) => {
    expose(Recognition);
    Recognition.available.mockResolvedValueOnce(status);
    expect(await prepareLocalSpeechRecognition("fr-FR")).not.toBeNull();
    expect(Recognition.install).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
    expect(Recognition.available).toHaveBeenCalledTimes(2);
  });

  it("falls back on unavailable languages, failed installs, or blocked policy", async () => {
    expose(Recognition);
    Recognition.available.mockResolvedValueOnce("unavailable");
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
    Recognition.available.mockResolvedValueOnce("downloadable");
    Recognition.install.mockResolvedValueOnce(false);
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
    Recognition.available.mockRejectedValueOnce(new Error("Permissions policy"));
    expect(await prepareLocalSpeechRecognition("en")).toBeNull();
  });

  it("falls back when a language pack install never settles", async () => {
    vi.useFakeTimers();
    try {
      expose(Recognition);
      Recognition.available.mockResolvedValueOnce("downloadable");
      Recognition.install.mockReturnValueOnce(new Promise(() => {}));
      const prepared = prepareLocalSpeechRecognition("en");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await prepared).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers results, restarts after silence, stops on pause, and detaches on disposal", async () => {
    const recognition = new Recognition();
    const track = {} as MediaStreamTrack;
    const callbacks = { onFinal: vi.fn(), onPartial: vi.fn(), onError: vi.fn() };
    const session = createLocalSpeechSession(recognition, track, callbacks);
    await session.start();
    recognition.onresult?.({ resultIndex: 0, results: [
      { isFinal: true, 0: { transcript: " Hello. " } },
      { isFinal: false, 0: { transcript: " Next " } }
    ] });
    expect(callbacks.onFinal).toHaveBeenCalledWith("Hello.");
    expect(callbacks.onPartial).toHaveBeenCalledWith("Next");
    recognition.onend?.();
    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(recognition.start).toHaveBeenCalledWith(track);
    await session.stop();
    expect(recognition.start).toHaveBeenCalledTimes(2);
    await session.start();
    session.dispose();
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
  });

  it("rejects local startup errors so the caller can select the model fallback", async () => {
    const recognition = new Recognition();
    recognition.start.mockImplementation(() => recognition.onerror?.({ error: "language-not-supported" }));
    const session = createLocalSpeechSession(recognition, {} as MediaStreamTrack, {
      onFinal: vi.fn(), onPartial: vi.fn(), onError: vi.fn()
    });
    await expect(session.start()).rejects.toThrow("language-not-supported");
    session.dispose();
  });
});
