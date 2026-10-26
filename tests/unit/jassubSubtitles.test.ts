import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSettings } from "../../src/config/settings";

const mock = vi.hoisted(() => ({ instances: [] as any[], ready: Promise.resolve() }));
vi.mock("jassub", () => ({ default: class {
  ready = mock.ready;
  renderer = { setTrack: vi.fn().mockResolvedValue(undefined), addFonts: vi.fn().mockResolvedValue(undefined) };
  manualRender = vi.fn().mockResolvedValue(undefined);
  destroy = vi.fn().mockResolvedValue(undefined);
  constructor(public options: any) { mock.instances.push(this); }
} }));
import { createJassubSubtitles } from "../../src/subtitles/createJassubSubtitles";

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe("native JASSUB canvas lifecycle", () => {
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    mock.instances.length = 0;
    mock.ready = Promise.resolve();
    frames = new Map();
    let id = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++id, callback); return id; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  });
  it("mounts the real library API with ASS and fonts, reuses it for phrase changes, and disposes", async () => {
    const subtitles = createJassubSubtitles("First phrase", appSettings.subtitles);
    const canvas = document.createElement("canvas");
    subtitles.setCanvas(canvas);
    await settle();
    const renderer = mock.instances[0];
    expect(renderer.options.canvas).toBe(canvas);
    expect(renderer.options.subContent).toContain("First phrase");
    expect(Object.keys(renderer.options.availableFonts).length).toBeGreaterThan(1);
    expect(renderer.manualRender).toHaveBeenCalledOnce();
    subtitles.update("Next phrase", appSettings.subtitles);
    await settle();
    expect(mock.instances).toHaveLength(1);
    expect(renderer.renderer.setTrack).toHaveBeenCalledWith(expect.stringContaining("Next phrase"));
    subtitles.dispose();
    await settle();
    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
  it("does not render a canvas detached before WASM becomes ready", async () => {
    let ready!: () => void;
    mock.ready = new Promise(resolve => { ready = resolve; });
    const subtitles = createJassubSubtitles("Phrase", appSettings.subtitles);
    subtitles.setCanvas(document.createElement("canvas"));
    subtitles.setCanvas(null);
    ready();
    await settle();
    expect(mock.instances[0].manualRender).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it("coalesces pending phrases and loads a changed typeface before setting the track", async () => {
    let ready!: () => void;
    mock.ready = new Promise(resolve => { ready = resolve; });
    const subtitles = createJassubSubtitles("Initial", appSettings.subtitles);
    subtitles.setCanvas(document.createElement("canvas"));
    const settings = { ...appSettings.subtitles, fontFamily: "Readex Pro" };
    subtitles.update("Superseded", settings);
    subtitles.update("Latest", settings);
    ready();
    await settle();
    const renderer = mock.instances[0];
    expect(renderer.renderer.addFonts).toHaveBeenCalledOnce();
    expect(renderer.renderer.setTrack).toHaveBeenCalledOnce();
    expect(renderer.renderer.setTrack).toHaveBeenCalledWith(expect.stringContaining("Latest"));
    subtitles.dispose();
  });
  it("waits for each worker render before requesting the next frame", async () => {
    let complete!: () => void;
    mock.ready = new Promise(() => {});
    const subtitles = createJassubSubtitles("Phrase", appSettings.subtitles);
    subtitles.setCanvas(document.createElement("canvas"));
    const renderer = mock.instances[0];
    subtitles.dispose();
    mock.ready = Promise.resolve();
    subtitles.setCanvas(document.createElement("canvas"));
    const current = mock.instances[1];
    current.manualRender.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    await settle();
    expect(frames.size).toBe(0);
    expect(current.manualRender).toHaveBeenCalledOnce();
    complete();
    await settle();
    expect(frames.size).toBe(1);
    expect(renderer.manualRender).not.toHaveBeenCalled();
    subtitles.dispose();
  });
});
