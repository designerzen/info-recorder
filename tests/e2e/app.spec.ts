import { expect, test } from "@playwright/test";

test.describe("info-recorder app", () => {
  test("renders the empty state and settings dialog", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the transcript aloud" })).toBeDisabled();
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
    await page.goto("/?vad=fixed-rms&recordingFormat=mp3&transcriptScrollSpeed=9");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Detection method")).toHaveValue("fixed-rms");
    await expect(page.getByLabel("Saved recording format")).toHaveValue("mp3");
    await expect(page.getByRole("slider", { name: "Transcript scroll speed" })).toHaveValue("9");
  });
});
