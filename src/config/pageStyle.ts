export type RoleVerbosity = "minimal" | "standard" | "detailed";

import { defaultTypeface, typefaceOptions } from "./typefaces";

export type PageStyleSettings = {
  preset: string;
  fontFamily: string;
  fontSizePt: string;
  fontWeight: string;
  fontStyle: string;
  fontVariant: string;
  textDecoration: string;
  letterSpacing: string;
  wordSpacing: string;
  lineHeight: string;
  textTransform: string;
  pageShadow: string;
  borderRadius: string;
  borderWidth: string;
  focusWidth: string;
  borderStyle: string;
  buttonRadius: string;
  menuRadius: string;
  labelRadius: string;
  popupRadius: string;
  textColor: string;
  backgroundColor: string;
  surfaceColor: string;
  buttonColor: string;
  buttonTextColor: string;
  accentColor: string;
  borderColor: string;
  focusColor: string;
  roleVerbosity: RoleVerbosity;
};

export type PageStylePreset = {
  label: string;
  value: string;
  settings: PageStyleSettings;
};

type Option = {
  label: string;
  value: string;
};

export const fontFamilyOptions: Option[] = typefaceOptions.map(({ label, value }) => ({ label, value }));

export const roleVerbosityOptions: Array<{ label: string; value: RoleVerbosity }> = [
  { value: "minimal", label: "Minimal" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" }
];

export const pageStyleOptions = {
  fontSizePt: ["10pt", "12pt", "14pt", "16pt", "18pt", "20pt", "22pt", "24pt"],
  fontWeight: ["normal", "bold"],
  fontStyle: ["normal", "italic", "oblique"],
  fontVariant: ["normal", "small-caps", "all-small-caps"],
  textDecoration: ["none", "underline", "underline dashed", "underline dotted", "underline double"],
  letterSpacing: ["normal", "1px", "2px", "3px", "4px", "5px", "6px", "7px", "8px"],
  wordSpacing: ["normal", "1px", "2px", "4px", "6px", "8px", "10px", "12px", "14px"],
  lineHeight: ["1.2", "1.35", "1.5", "1.65", "1.8", "2"],
  textTransform: ["none", "uppercase", "lowercase", "capitalize"],
  pageShadow: ["off", "on"],
  borderRadius: ["1px", "2px", "3px", "4px", "5px", "6px", "8px", "10px"],
  borderWidth: ["1px", "2px", "3px", "4px", "5px", "6px", "8px", "10px"],
  focusWidth: ["1px", "2px", "3px", "4px", "5px", "6px"],
  borderStyle: ["dotted", "solid", "dashed", "double", "groove", "ridge", "hidden"],
  componentRadius: ["2px", "4px", "6px", "8px", "10px"]
};

export const defaultPageStyle: PageStyleSettings = {
  preset: "light-mode",
  fontFamily: defaultTypeface.value,
  fontSizePt: "12pt",
  fontWeight: "normal",
  fontStyle: "normal",
  fontVariant: "normal",
  textDecoration: "none",
  letterSpacing: "normal",
  wordSpacing: "normal",
  lineHeight: "1.35",
  textTransform: "none",
  pageShadow: "off",
  borderRadius: "6px",
  borderWidth: "2px",
  focusWidth: "3px",
  borderStyle: "solid",
  buttonRadius: "10px",
  menuRadius: "4px",
  labelRadius: "8px",
  popupRadius: "8px",
  textColor: "#13211b",
  backgroundColor: "#f2f4ee",
  surfaceColor: "#ffffff",
  buttonColor: "#ffffff",
  buttonTextColor: "#13211b",
  accentColor: "#15655a",
  borderColor: "#cdd5c8",
  focusColor: "#0f4a76",
  roleVerbosity: "standard"
};

export const pageStylePresets: PageStylePreset[] = [
  makePreset("Artic Mist", "artic-mist", {
    backgroundColor: "#edf6f8",
    surfaceColor: "#ffffff",
    accentColor: "#176c7c",
    focusColor: "#004f7a"
  }),
  makePreset("Bold Mint", "bold-mint", {
    backgroundColor: "#e9fff0",
    surfaceColor: "#ffffff",
    accentColor: "#006b46",
    buttonColor: "#006b46",
    buttonTextColor: "#ffffff",
    fontWeight: "bold"
  }),
  makePreset("Dark Flat", "dark-flat", {
    backgroundColor: "#171717",
    surfaceColor: "#242424",
    textColor: "#f5f5f5",
    buttonColor: "#333333",
    buttonTextColor: "#ffffff",
    borderColor: "#707070",
    accentColor: "#77d7c3",
    focusColor: "#ffde59"
  }),
  makePreset("Dark Mode", "dark-mode", {
    backgroundColor: "#101826",
    surfaceColor: "#172235",
    textColor: "#f2f7ff",
    buttonColor: "#203047",
    buttonTextColor: "#f2f7ff",
    borderColor: "#6e7f98",
    accentColor: "#8fd5ff",
    focusColor: "#ffd166"
  }),
  makePreset("Graphite", "graphite", {
    backgroundColor: "#e6e6e6",
    surfaceColor: "#fafafa",
    textColor: "#202020",
    accentColor: "#454545",
    focusColor: "#111111"
  }),
  makePreset("High Vis Black/Yellow", "high-vis-black-yellow", {
    backgroundColor: "#000000",
    surfaceColor: "#101010",
    textColor: "#fff400",
    buttonColor: "#fff400",
    buttonTextColor: "#000000",
    borderColor: "#fff400",
    accentColor: "#fff400",
    focusColor: "#ffffff",
    fontWeight: "bold",
    borderWidth: "3px"
  }),
  makePreset("High Vis Yellow/Black", "high-vis-yellow-black", {
    backgroundColor: "#fff400",
    surfaceColor: "#fff9a0",
    textColor: "#000000",
    buttonColor: "#000000",
    buttonTextColor: "#fff400",
    borderColor: "#000000",
    accentColor: "#000000",
    focusColor: "#005fcc",
    fontWeight: "bold",
    borderWidth: "3px"
  }),
  makePreset("Large Font Light", "large-font-light", {
    fontSizePt: "18pt",
    lineHeight: "1.5",
    backgroundColor: "#ffffff",
    surfaceColor: "#ffffff",
    textColor: "#111111"
  }),
  makePreset("Large Font Mono", "large-font-mono", {
    fontFamily: "'Space Mono', monospace",
    fontSizePt: "18pt",
    lineHeight: "1.5",
    letterSpacing: "1px"
  }),
  makePreset("Light Caps", "light-caps", {
    textTransform: "uppercase",
    letterSpacing: "1px",
    fontWeight: "bold"
  }),
  makePreset("Light Mode", "light-mode", {}),
  makePreset("Monochrome", "monochrome", {
    backgroundColor: "#ffffff",
    surfaceColor: "#f5f5f5",
    textColor: "#000000",
    buttonColor: "#ffffff",
    buttonTextColor: "#000000",
    accentColor: "#000000",
    borderColor: "#000000",
    focusColor: "#000000"
  }),
  makePreset("Neon Nights", "neon-nights", {
    backgroundColor: "#0b1020",
    surfaceColor: "#151b2e",
    textColor: "#f5fbff",
    buttonColor: "#1f2540",
    buttonTextColor: "#ffffff",
    borderColor: "#4f5ed9",
    accentColor: "#00d5ff",
    focusColor: "#ff4fd8"
  }),
  makePreset("Open Dyslexic", "open-dyslexic", {
    fontFamily: "'OpenDyslexic', sans-serif",
    fontSizePt: "14pt",
    lineHeight: "1.5",
    wordSpacing: "4px"
  }),
  makePreset("Pale Sage", "pale-sage", {
    backgroundColor: "#edf4e7",
    surfaceColor: "#fbfff8",
    accentColor: "#476f50"
  }),
  makePreset("Slate Large Font", "slate-large-font", {
    backgroundColor: "#e9edf2",
    surfaceColor: "#ffffff",
    textColor: "#17202a",
    accentColor: "#42556f",
    fontSizePt: "18pt",
    lineHeight: "1.5"
  })
];

export function encodePageStyle(settings: PageStyleSettings) {
  return encodeURIComponent(JSON.stringify(settings));
}

export function decodePageStyle(value: string | null) {
  if (!value) return clonePageStyle(defaultPageStyle);

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<PageStyleSettings>;
    return normalizePageStyle(parsed);
  } catch {
    return clonePageStyle(defaultPageStyle);
  }
}

export function clonePageStyle(settings: PageStyleSettings): PageStyleSettings {
  return { ...settings };
}

export function presetToPageStyle(presetValue: string) {
  const preset = pageStylePresets.find((item) => item.value === presetValue);
  return preset ? clonePageStyle(preset.settings) : clonePageStyle(defaultPageStyle);
}

export function normalizePageStyle(settings: Partial<PageStyleSettings>): PageStyleSettings {
  return {
    preset: sanitizeSelect(settings.preset, pageStylePresets.map((preset) => preset.value), "custom"),
    fontFamily: sanitizeSelect(settings.fontFamily, fontFamilyOptions.map((option) => option.value), defaultPageStyle.fontFamily),
    fontSizePt: sanitizeSelect(settings.fontSizePt, pageStyleOptions.fontSizePt, defaultPageStyle.fontSizePt),
    fontWeight: sanitizeSelect(settings.fontWeight, pageStyleOptions.fontWeight, defaultPageStyle.fontWeight),
    fontStyle: sanitizeSelect(settings.fontStyle, pageStyleOptions.fontStyle, defaultPageStyle.fontStyle),
    fontVariant: sanitizeSelect(settings.fontVariant, pageStyleOptions.fontVariant, defaultPageStyle.fontVariant),
    textDecoration: sanitizeSelect(settings.textDecoration, pageStyleOptions.textDecoration, defaultPageStyle.textDecoration),
    letterSpacing: sanitizeSelect(settings.letterSpacing, pageStyleOptions.letterSpacing, defaultPageStyle.letterSpacing),
    wordSpacing: sanitizeSelect(settings.wordSpacing, pageStyleOptions.wordSpacing, defaultPageStyle.wordSpacing),
    lineHeight: sanitizeSelect(settings.lineHeight, pageStyleOptions.lineHeight, defaultPageStyle.lineHeight),
    textTransform: sanitizeSelect(settings.textTransform, pageStyleOptions.textTransform, defaultPageStyle.textTransform),
    pageShadow: sanitizeSelect(settings.pageShadow, pageStyleOptions.pageShadow, defaultPageStyle.pageShadow),
    borderRadius: sanitizeSelect(settings.borderRadius, pageStyleOptions.borderRadius, defaultPageStyle.borderRadius),
    borderWidth: sanitizeSelect(settings.borderWidth, pageStyleOptions.borderWidth, defaultPageStyle.borderWidth),
    focusWidth: sanitizeSelect(settings.focusWidth, pageStyleOptions.focusWidth, defaultPageStyle.focusWidth),
    borderStyle: sanitizeSelect(settings.borderStyle, pageStyleOptions.borderStyle, defaultPageStyle.borderStyle),
    buttonRadius: sanitizeSelect(settings.buttonRadius, pageStyleOptions.componentRadius, defaultPageStyle.buttonRadius),
    menuRadius: sanitizeSelect(settings.menuRadius, pageStyleOptions.componentRadius, defaultPageStyle.menuRadius),
    labelRadius: sanitizeSelect(settings.labelRadius, pageStyleOptions.componentRadius, defaultPageStyle.labelRadius),
    popupRadius: sanitizeSelect(settings.popupRadius, pageStyleOptions.componentRadius, defaultPageStyle.popupRadius),
    textColor: sanitizeColor(settings.textColor, defaultPageStyle.textColor),
    backgroundColor: sanitizeColor(settings.backgroundColor, defaultPageStyle.backgroundColor),
    surfaceColor: sanitizeColor(settings.surfaceColor, defaultPageStyle.surfaceColor),
    buttonColor: sanitizeColor(settings.buttonColor, defaultPageStyle.buttonColor),
    buttonTextColor: sanitizeColor(settings.buttonTextColor, defaultPageStyle.buttonTextColor),
    accentColor: sanitizeColor(settings.accentColor, defaultPageStyle.accentColor),
    borderColor: sanitizeColor(settings.borderColor, defaultPageStyle.borderColor),
    focusColor: sanitizeColor(settings.focusColor, defaultPageStyle.focusColor),
    roleVerbosity: settings.roleVerbosity && roleVerbosityOptions.some((option) => option.value === settings.roleVerbosity)
      ? settings.roleVerbosity
      : defaultPageStyle.roleVerbosity
  };
}

function makePreset(
  label: string,
  value: string,
  update: Partial<PageStyleSettings>
): PageStylePreset {
  return {
    label,
    value,
    settings: {
      ...defaultPageStyle,
      ...update,
      preset: value
    }
  };
}

function sanitizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function sanitizeSelect(value: unknown, options: string[], fallback: string) {
  return typeof value === "string" && options.includes(value) ? value : fallback;
}
