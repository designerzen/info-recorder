import { expect, test } from "@playwright/test";

test.describe("info-recorder app", () => {
  test("renders the empty state and settings dialog", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the transcript aloud" })).toBeHidden();
    await expect(page.getByLabel("Transcript playback voice")).toBeHidden();
    await expect(
      page.getByText(
        "Press record for live speech, or upload media to transcribe an existing audio or video file."
      )
    ).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("dialog", { name: "User settings" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "App", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page.getByRole("tab", { name: "Appearance" }).click();
    await expect(page.getByLabel("Presets")).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.getByRole("dialog", { name: "User settings" })).toBeHidden();
  });

  test("hydrates key settings from query parameters", async ({ page }) => {
    await page.goto("/?activityDetection=1&vad=fixed-rms&recordingFormat=mp3&transcriptScrollSpeed=9");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Detection method")).toHaveValue("fixed-rms");
    await expect(page.getByLabel("Saved recording format")).toHaveValue("mp3");
    await expect(page.getByRole("slider", { name: "Transcript scroll speed" })).toHaveValue("9");
  });

  test("explains how to upgrade when WebGPU is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      delete (Navigator.prototype as Navigator & { gpu?: unknown }).gpu;
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: undefined
      });
    });

    await page.goto("/");

    await expect(page.getByRole("alertdialog", { name: "Browser upgrade required" })).toBeVisible();
    await expect(page.getByText(/missing WebGPU/i)).toBeVisible();
    await expect(page.getByText(/Update to the latest Chrome, Edge/i)).toBeVisible();
  });

  test("allows WASM model selection without WebGPU", async ({ page }) => {
    await page.addInitScript(() => {
      delete (Navigator.prototype as Navigator & { gpu?: unknown }).gpu;
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: undefined
      });
    });

    await page.goto("/?transcriptionModel=wasm%3Abase.en-q5_1");

    await expect(page.getByRole("alertdialog", { name: "Browser upgrade required" })).toBeHidden();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Whisper model")).toHaveValue("wasm:base.en-q5_1");
  });

  test("explains how to upgrade when WebAssembly is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "WebAssembly", {
        configurable: true,
        value: undefined
      });
    });

    await page.goto("/");

    await expect(page.getByRole("alertdialog", { name: "Browser upgrade required" })).toBeVisible();
    await expect(page.getByText(/missing WebAssembly/i)).toBeVisible();
    await expect(page.getByText(/WebAssembly must also be enabled/i)).toBeVisible();
  });
});
