/** WCAG relative luminance is measured in linear sRGB, never OKLCH lightness. */
export type Rgb = readonly [number, number, number];
export type Oklch = { l: number; c: number; h: number };

const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encoded = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as unknown as Rgb;
}

export function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const axisB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, axisB), h: (Math.atan2(axisB, a) * 180 / Math.PI + 360) % 360 };
}

/** Unclipped conversion lets palette generation detect out-of-gamut colours. */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const z = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [encoded(4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z),
    encoded(-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z),
    encoded(-0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z)];
}

export function oklchCss({ l, c, h }: Oklch) {
  return `oklch(${l.toFixed(6)} ${c.toFixed(6)} ${h.toFixed(4)})`;
}

/** Equivalent to color-mix(in oklch, source, achromatic endpoint percentage). */
export function mixEndpoint(source: Oklch, endpoint: "white" | "black", percentage: number): Oklch {
  const amount = percentage / 100;
  return { l: source.l * (1 - amount) + (endpoint === "white" ? amount : 0), c: source.c * (1 - amount), h: source.h };
}

/** Select a candidate only if it passes against EVERY supplied surface. */
export function colorContrast(backgrounds: Oklch[], candidates: Oklch[], minimum = 7): Oklch {
  const result = candidates.find((candidate) => backgrounds.every((background) =>
    contrastRatio(oklchToRgb(candidate), oklchToRgb(background)) >= minimum));
  if (!result) throw new Error(`No palette colour meets ${minimum}:1 contrast on every surface.`);
  return result;
}
