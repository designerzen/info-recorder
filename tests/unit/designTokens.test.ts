import { describe, expect, it } from "vitest";
import { defaultPageStyle, pageStylePresets } from "../../src/config/pageStyle";
import { colorContrast, contrastRatio, hexToOklch, hexToRgb, luminance, oklchToRgb } from "../../src/design/color";
import { createDesignTokens, paletteSteps } from "../../src/design/tokens";

describe("OKLCH colour science", () => {
  it("uses WCAG linear-sRGB contrast, including the 21:1 endpoints", () => {
    expect(contrastRatio(hexToRgb("#ffffff"), hexToRgb("#000000"))).toBe(21);
    expect(contrastRatio(hexToRgb("#777777"), hexToRgb("#ffffff"))).toBeCloseTo(4.478, 3);
    expect(luminance(hexToRgb("#ff0000"))).toBeCloseTo(0.2126, 6);
  });
  it("round-trips sRGB through OKLCH without silently clipping", () => {
    for (const hex of ["#ffffff", "#000000", "#a44732", "#00d5ff", "#171717"]) {
      const original = hexToRgb(hex), result = oklchToRgb(hexToOklch(hex));
      result.forEach((channel, index) => expect(channel).toBeCloseTo(original[index], 5));
    }
  });
  it("rejects impossible shared contrast rather than returning a failing colour", () => {
    const black = hexToOklch("#000000"), white = hexToOklch("#ffffff");
    expect(() => colorContrast([black, white], [black, white], 7)).toThrow("No palette colour");
  });
});

for (const settings of [defaultPageStyle, ...pageStylePresets.map((preset) => preset.settings),
  ...["#777777", "#ffff00", "#0000ff", "#ff00ff", "#00ff00"].map((seed) =>
    ({ ...defaultPageStyle, backgroundColor: seed, accentColor: seed }))]) {
  it(`builds in-gamut, monotonically ordered ramps for ${settings.preset} / ${settings.backgroundColor}`, () => {
    const { neutral, brand, dark } = createDesignTokens(settings);
    for (const palette of [neutral, brand]) {
      let previous = Infinity;
      for (const [level] of paletteSteps) {
        const rgb = oklchToRgb(palette[level]);
        expect(rgb.every((channel) => channel >= -0.000001 && channel <= 1.000001)).toBe(true);
        expect(luminance(rgb)).toBeLessThan(previous);
        previous = luminance(rgb);
      }
    }
    const ink = neutral[dark ? 1000 : 0];
    for (const level of dark ? [200, 100, 50] as const : [700, 800, 900] as const) {
      expect(contrastRatio(oklchToRgb(ink), oklchToRgb(brand[level]))).toBeGreaterThanOrEqual(7);
    }
  });
}
