import { describe, expect, it } from "vitest";
import {
  clonePageStyle,
  decodePageStyle,
  defaultPageStyle,
  encodePageStyle,
  normalizePageStyle,
  presetToPageStyle
} from "../../src/config/pageStyle";

describe("pageStyle", () => {
  it("round-trips a valid page style through URL encoding", () => {
    const encoded = encodePageStyle(defaultPageStyle);

    expect(decodePageStyle(encoded)).toEqual(defaultPageStyle);
  });

  it("falls back to defaults for invalid encoded data", () => {
    expect(decodePageStyle("%E0%A4%A")).toEqual(defaultPageStyle);
    expect(decodePageStyle(null)).toEqual(defaultPageStyle);
  });

  it("sanitizes invalid option and color values", () => {
    const normalized = normalizePageStyle({
      preset: "unknown",
      fontFamily: "Papyrus",
      textColor: "red",
      backgroundColor: "#abcdef",
      roleVerbosity: "detailed"
    });

    expect(normalized.preset).toBe("custom");
    expect(normalized.fontFamily).toBe(defaultPageStyle.fontFamily);
    expect(normalized.textColor).toBe(defaultPageStyle.textColor);
    expect(normalized.backgroundColor).toBe("#abcdef");
    expect(normalized.roleVerbosity).toBe("detailed");
  });

  it("returns cloned presets so tests and UI updates do not mutate the source", () => {
    const preset = presetToPageStyle("dark-mode");
    const clone = clonePageStyle(preset);
    clone.textColor = "#123456";

    expect(preset.textColor).not.toBe("#123456");
  });
});
