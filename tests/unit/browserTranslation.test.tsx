import { h, Fragment } from "../../src/ui/dom";
import { act, mountService, waitFor } from "../dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranslationTargets, type TranslatorApi } from "../../src/translation/browserTranslator";
import { createBrowserTranslation } from "../../src/translation/createBrowserTranslation";

afterEach(() => vi.unstubAllGlobals());

function mockApi() {
  const instance = { translate: vi.fn(async (text: string) => `French: ${text}`), destroy: vi.fn() };
  const api = {
    availability: vi.fn(async ({ targetLanguage }: { targetLanguage: string }) =>
      targetLanguage === "fr" ? "downloadable" as const : "unavailable" as const),
    create: vi.fn(async () => instance)
  };
  vi.stubGlobal("Translator", api);
  return { api, instance };
}

describe("browser translation", () => {
  it("reports an unavailable browser without trying to download a model", () => {
    vi.stubGlobal("Translator", undefined);
    const { result } = mountService(createBrowserTranslation([], "en", "fr"));
    expect(result.current.supported).toBe(false);
    expect(result.current.enabled).toBe(false);
  });

  it("offers only usable pairs, including those needing a download", async () => {
    const { api } = mockApi();
    const targets = await getTranslationTargets(api, "en");
    expect(targets).toEqual([{ value: "fr", label: "French", availability: "downloadable" }]);
    expect(api.availability).not.toHaveBeenCalledWith({ sourceLanguage: "en", targetLanguage: "en" });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("starts only on enable, translates sentences, and cleans up on language change", async () => {
    const { api, instance } = mockApi();
    const sentences = [{ id: "one", text: "Hello." }];
    const { result } = mountService(createBrowserTranslation(sentences, "en", "fr"));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(api.create).not.toHaveBeenCalled();
    await act(() => result.current.enable());
    await waitFor(() => expect(result.current.translations.one?.text).toBe("French: Hello."));
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: "en", targetLanguage: "fr" }));
    result.current.update(sentences, "en", "de");
    expect(instance.destroy).toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
    expect(result.current.translations).toEqual({});
  });

  it("discards a translator whose download completes after cancellation", async () => {
    const { api, instance } = mockApi();
    let finish!: (value: typeof instance) => void;
    api.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = mountService(createBrowserTranslation([], "en", "fr"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.enable(); });
    act(() => result.current.disable());
    await act(async () => { finish(instance); await pending; });
    expect(instance.destroy).toHaveBeenCalledOnce();
    expect(result.current.enabled).toBe(false);
  });

  it("handles pair-check errors and failed model downloads", async () => {
    const api: TranslatorApi = {
      availability: vi.fn().mockRejectedValue(new Error("Denied")),
      create: vi.fn().mockRejectedValue(new Error("Download failed"))
    };
    vi.stubGlobal("Translator", api);
    expect(await getTranslationTargets(api, "en")).toEqual([]);
    const { result } = mountService(createBrowserTranslation([], "en", "fr"));
    await act(() => result.current.enable());
    expect(result.current.loading).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.status).toContain("Download failed");
  });
});
