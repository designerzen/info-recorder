import { describe, expect, it } from "vitest";
import { getTypefaceAssFamily, typefaceGroups, typefaceOptions } from "../../src/config/typefaces";
import { defaultPageStyle, decodePageStyle, encodePageStyle, normalizePageStyle } from "../../src/config/pageStyle";
import { subtitleFontAssets } from "../../src/subtitles/subtitleTypefaceAssets";

describe("bundled typeface choices", () => {
  it("includes the requested reading fonts and multiple monospace options", () => {
    expect(typefaceOptions.map((font) => font.label)).toEqual(expect.arrayContaining([
      "OpenDyslexic", "Readex Pro", "Lexend", "Andika", "Atkinson Hyperlegible Next"
    ]));
    expect(typefaceOptions.filter((font) => font.group === "Monospace").length).toBeGreaterThanOrEqual(4);
    expect(new Set(typefaceOptions.map((font) => font.value)).size).toBe(typefaceOptions.length);
  });
  for (const font of typefaceOptions) {
    it(`preserves ${font.label} in settings and supplies its matching subtitle face`, () => {
      const settings = { ...defaultPageStyle, fontFamily: font.value };
      expect(normalizePageStyle(settings).fontFamily).toBe(font.value);
      expect(decodePageStyle(encodePageStyle(settings)).fontFamily).toBe(font.value);
      expect(getTypefaceAssFamily(font.value)).toBe(font.assFamily);
      expect(subtitleFontAssets[font.assFamily.toLowerCase()]).toMatch(/\.(ttf|woff2)/);
      expect(typefaceGroups).toContain(font.group);
      expect(font.description).not.toBe("");
    });
  }
});
