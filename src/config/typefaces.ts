export type TypefaceOption = {
  label: string;
  value: string;
  assFamily: string;
  group: TypefaceGroup;
  description: string;
};

export const typefaceGroups = ["Reading support", "Sans-serif", "Serif", "Monospace"] as const;
export type TypefaceGroup = typeof typefaceGroups[number];

function face(label: string, fallback: string, group: TypefaceGroup, description: string): TypefaceOption {
  return { label, value: `'${label}', ${fallback}`, assFamily: label, group, description };
}

export const typefaceOptions: TypefaceOption[] = [
  face("Atkinson Hyperlegible", "sans-serif", "Reading support", "Distinct letter and number shapes, designed with low-vision readers in mind."),
  face("Atkinson Hyperlegible Next", "sans-serif", "Reading support", "The updated Hyperlegible family, with more weights and broader language support."),
  face("OpenDyslexic", "sans-serif", "Reading support", "Distinctive letter shapes with heavier bases. Compare the preview to find your preference."),
  face("Readex Pro", "sans-serif", "Reading support", "Open, rounded letterforms with generous spacing. Upright styles."),
  face("Lexend", "sans-serif", "Reading support", "Spacious, open letterforms for reading. Upright styles."),
  face("Andika", "sans-serif", "Reading support", "Simple letterforms designed for literacy and beginning readers."),
  face("Public Sans", "sans-serif", "Sans-serif", "A straightforward sans-serif for interface text and everyday reading."),
  face("IBM Plex Sans", "sans-serif", "Sans-serif", "Clear, familiar shapes with a broad range of characters."),
  face("Noto Sans", "sans-serif", "Sans-serif", "A versatile sans-serif with broad language and character coverage."),
  face("Source Sans 3", "sans-serif", "Sans-serif", "Open shapes designed for readable interface text."),
  face("Literata", "serif", "Serif", "A reading-focused serif for a book-like page."),
  face("Atkinson Hyperlegible Mono", "monospace", "Monospace", "Distinct Hyperlegible letterforms with equal-width characters."),
  face("IBM Plex Mono", "monospace", "Monospace", "Equal-width characters for aligned text and clearly separated symbols."),
  face("JetBrains Mono", "monospace", "Monospace", "A coding typeface with distinct symbols and equal-width characters."),
  face("Space Mono", "monospace", "Monospace", "A geometric monospace with distinctive shapes and equal-width characters.")
];

export const defaultTypeface = typefaceOptions[0];

export function getTypeface(value: string) {
  return typefaceOptions.find((option) => option.value === value) ?? defaultTypeface;
}

export function getTypefaceAssFamily(value: string) {
  return getTypeface(value).assFamily;
}
