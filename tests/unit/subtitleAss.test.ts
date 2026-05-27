import { describe, expect, it } from "vitest";
import { createLiveAssSubtitle } from "../../src/subtitles/subtitleAss";

describe("subtitleAss", () => {
  it("creates a dialogue line with the configured duration", () => {
    const ass = createLiveAssSubtitle("Hello world", 12.34);

    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:12.34,Live,,0,0,0,,Hello world");
  });

  it("escapes ASS-sensitive characters and newlines", () => {
    const ass = createLiveAssSubtitle("Hello {team}\\nLine two\nBackslash \\");

    expect(ass).toContain("Hello \\{team\\}\\\\nLine two\\NBackslash \\\\");
  });

  it("falls back to a blank subtitle when text is empty", () => {
    const ass = createLiveAssSubtitle("   ");

    expect(ass).toContain(",, ");
  });
});
