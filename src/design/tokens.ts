import type { PageStyleSettings } from "../config/pageStyle";
import { colorContrast, hexToOklch, hexToRgb, luminance, mixEndpoint, oklchCss, oklchToRgb, type Oklch } from "./color";

// These same mix recipes generate both CSS and the colours used for validation.
export const paletteSteps = [
  [0, "white", 100], [50, "white", 96], [100, "white", 90],
  [200, "white", 78], [300, "white", 60], [400, "white", 36],
  [500, "black", 0], [600, "black", 16], [700, "black", 32],
  [800, "black", 48], [900, "black", 64], [950, "black", 78], [1000, "black", 100]
] as const;
export type PaletteLevel = typeof paletteSteps[number][0];
export const designContract = { textContrast: 7, nonTextContrast: 3, targetSize: 44, focusWidth: 3, focusOffset: 3 } as const;

function palette(source: Oklch) {
  // Reduce source chroma until EVERY generated level is in sRGB. This avoids
  // browser-dependent gamut clipping changing measured contrast.
  const safe = { ...source };
  while (paletteSteps.some(([, endpoint, amount]) => oklchToRgb(mixEndpoint(safe, endpoint, amount))
    .some((channel) => channel < -0.000001 || channel > 1.000001))) {
    safe.c *= 0.9;
    if (safe.c < 0.000001) { safe.c = 0; break; }
  }
  const values = Object.fromEntries(paletteSteps.map(([level, endpoint, amount]) =>
    [level, mixEndpoint(safe, endpoint, amount)])) as Record<PaletteLevel, Oklch>;
  return { source: safe, values };
}

export function createDesignTokens(settings: PageStyleSettings) {
  const background = hexToOklch(settings.backgroundColor);
  const accent = hexToOklch(settings.accentColor);
  const dark = luminance(hexToRgb(settings.backgroundColor)) < 0.18;
  const neutral = palette({ l: 0.55, c: Math.min(background.c, 0.012), h: background.h });
  const brand = palette({ l: 0.55, c: Math.min(accent.c, 0.14), h: accent.h });
  const n = neutral.values, b = brand.values;
  const surfaces = dark ? [n[950], n[900], n[800], b[900]] : [n[50], n[0], n[100], b[50]];
  const ink = colorContrast(surfaces, dark ? [n[50], n[0]] : [n[950], n[1000]]);
  const muted = colorContrast(surfaces, dark ? [n[300], n[200], n[100], n[0]] : [n[700], n[800], n[900], n[1000]]);
  const controlLevels = dark ? [900, 800, 700] as const : [0, 50, 100] as const;
  const primaryLevels = dark ? [200, 100, 50] as const : [700, 800, 900] as const;
  const controlInk = colorContrast(controlLevels.map((level) => n[level]), [ink]);
  // Pure endpoints allow contrast-color() to return the exact same measured ink.
  const primaryInk = colorContrast(primaryLevels.map((level) => b[level]), [n[0], n[1000]]);
  const border = colorContrast(surfaces, dark ? [n[400], n[300], n[100]] : [n[600], n[700], n[900]], 3.2);
  const focus = colorContrast([...surfaces, ...controlLevels.map((level) => n[level])], [ink], 3.2);
  const tokens: Record<string, string> = {};
  for (const [name, ramp] of [["neutral", neutral], ["brand", brand]] as const) {
    tokens[`--ds-${name}-source`] = oklchCss(ramp.source);
    for (const [level, endpoint, amount] of paletteSteps) {
      tokens[`--ds-${name}-${level}`] = `color-mix(in oklch, var(--ds-${name}-source), ${endpoint} ${amount}%)`;
    }
  }
  const use = (family: "neutral" | "brand", level: PaletteLevel) => `var(--ds-${family}-${level})`;
  Object.assign(tokens, {
    "--ds-canvas": use("neutral", dark ? 950 : 50),
    "--ds-surface": use("neutral", dark ? 900 : 0),
    "--ds-raised": use("neutral", dark ? 800 : 0),
    "--ds-tint": use("brand", dark ? 900 : 50),
    "--ds-text": oklchCss(ink), "--ds-muted": oklchCss(muted),
    "--ds-border": oklchCss(border), "--ds-focus": oklchCss(focus),
    "--ds-control-ink": oklchCss(controlInk), "--ds-primary-ink": oklchCss(primaryInk),
    "--ds-selected": use("brand", dark ? 800 : 100),
    "--ds-accent-text": oklchCss(colorContrast(surfaces, dark ? [b[200], b[100], ink] : [b[700], b[800], ink])),
    "--ds-scheme": dark ? "dark" : "light"
  });
  for (const [index, state] of ["rest", "hover", "pressed"].entries()) {
    tokens[`--ds-control-${state}`] = use("neutral", controlLevels[index]);
    tokens[`--ds-primary-${state}`] = use("brand", primaryLevels[index]);
  }
  return { dark, tokens, neutral: n, brand: b };
}
