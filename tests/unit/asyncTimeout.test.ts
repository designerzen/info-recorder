import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "../../src/recorder/asyncTimeout";

describe("withTimeout", () => {
  it("resolves when the wrapped promise finishes before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ready"), 100)).resolves.toBe("ready");
  });

  it("rejects with a clear timeout message when the wrapped promise hangs", async () => {
    vi.useFakeTimers();
    const pending = new Promise<string>(() => undefined);
    const result = withTimeout(pending, 250, "Worker did not become idle.");
    const expectation = expect(result).rejects.toThrow("Worker did not become idle.");

    await vi.advanceTimersByTimeAsync(250);

    await expectation;
    vi.useRealTimers();
  });
});
