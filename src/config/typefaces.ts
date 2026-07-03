export type TypefaceOption = {
  label: string;
  value: string;
  assFamily: string;
};

export const typefaceOptions: TypefaceOption[] = [
  {
    label: "Atkinson Hyperlegible",
    value: "'Atkinson Hyperlegible', sans-serif",
    assFamily: "Atkinson Hyperlegible"
  },
  {
    label: "IBM Plex Sans",
    value: "'IBM Plex Sans', sans-serif",
    assFamily: "IBM Plex Sans"
  },
  {
    label: "Literata",
    value: "'Literata', serif",
    assFamily: "Literata"
  },
  {
    label: "Public Sans",
    value: "'Public Sans', sans-serif",
    assFamily: "Public Sans"
  },
  {
    label: "Space Mono",
    value: "'Space Mono', monospace",
    assFamily: "Space Mono"
  },
  {
    label: "OpenDyslexic",
    value: "'OpenDyslexic', sans-serif",
    assFamily: "OpenDyslexic"
  }
];

export const defaultTypeface = typefaceOptions[0];

export function getTypeface(value: string) {
  return typefaceOptions.find((option) => option.value === value) ?? defaultTypeface;
}

export function getTypefaceAssFamily(value: string) {
  return getTypeface(value).assFamily;
}
