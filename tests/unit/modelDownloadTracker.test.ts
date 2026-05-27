import { describe, expect, it } from "vitest";
import { ModelDownloadTracker } from "../../src/recorder/modelDownloadTracker";

describe("ModelDownloadTracker", () => {
  it("aggregates progress across the whole package", () => {
    const tracker = new ModelDownloadTracker([
      { url: "https://example.test/a", size: 100, cached: false },
      { url: "https://example.test/b", size: 300, cached: false }
    ]);

    expect(tracker.getProgress()).toBe(0);
    expect(tracker.trackProgress("https://example.test/a", 50, 100)).toBeCloseTo(12.5);
    expect(tracker.trackProgress("https://example.test/b", 150, 300)).toBeCloseTo(50);
    expect(tracker.markDone("https://example.test/a")).toBeCloseTo(62.5);
    expect(tracker.markDone("https://example.test/b")).toBe(99);
  });

  it("starts from cached bytes when the package is partially cached", () => {
    const tracker = new ModelDownloadTracker([
      { url: "https://example.test/a", size: 200, cached: true },
      { url: "https://example.test/b", size: 200, cached: false }
    ]);

    expect(tracker.getProgress()).toBe(50);
    expect(tracker.trackProgress("https://example.test/b", 100, 200)).toBe(75);
  });
});
