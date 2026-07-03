import type { PageStyleSettings } from "../config/pageStyle";

type PageStyleSheetProps = {
  settings: PageStyleSettings;
};

export function PageStyleSheet({ settings }: PageStyleSheetProps) {
  const shadow = settings.pageShadow === "on" ? "0 16px 40px rgba(0, 0, 0, 0.18)" : "none";
  const pageText = getAccessibleSharedColor(settings.textColor, [settings.backgroundColor, settings.surfaceColor], 4.5);
  const pageTextMuted = getAccessibleSecondaryColor(pageText, [settings.backgroundColor, settings.surfaceColor], 4.5);
  const pageBorder = getAccessibleSharedColor(settings.borderColor, [settings.backgroundColor, settings.surfaceColor], 3);
  const pageButtonText = getAccessibleSharedColor(
    settings.buttonTextColor,
    [settings.buttonColor, settings.accentColor],
    4.5
  );
  const focusColor = getAccessibleSharedColor(settings.focusColor, [settings.backgroundColor, settings.surfaceColor], 3);
  const subtitleHighlightText = getReadableTextColor(focusColor);
  const css = `
    :root {
      --page-text: ${pageText};
      --page-text-muted: ${pageTextMuted};
      --page-bg: ${settings.backgroundColor};
      --page-surface: ${settings.surfaceColor};
      --page-button: ${settings.buttonColor};
      --page-button-text: ${pageButtonText};
      --page-accent: ${settings.accentColor};
      --page-border: ${pageBorder};
      --focus-color: ${focusColor};
      --page-border-width: ${settings.borderWidth};
      --page-border-style: ${settings.borderStyle};
      --page-radius: ${settings.borderRadius};
      --button-radius: ${settings.buttonRadius};
      --menu-radius: ${settings.menuRadius};
      --label-radius: ${settings.labelRadius};
      --popup-radius: ${settings.popupRadius};
      --page-shadow: ${shadow};
      --focus-width: ${settings.focusWidth};
      --subtitle-highlight-bg: ${focusColor};
      --subtitle-highlight-text: ${subtitleHighlightText};
    }

    body,
    .app-shell {
      background: var(--page-bg);
      color: var(--page-text);
      font-family: ${settings.fontFamily};
      font-size: ${settings.fontSizePt};
      font-style: ${settings.fontStyle};
      font-variant: ${settings.fontVariant};
      font-weight: ${settings.fontWeight};
      letter-spacing: ${settings.letterSpacing};
      line-height: ${settings.lineHeight};
      text-decoration: ${settings.textDecoration};
      text-transform: ${settings.textTransform};
      word-spacing: ${settings.wordSpacing};
    }

    .recorder-panel,
    .secondary-panel,
    .page-settings-dialog,
    .model-dialog {
      background: var(--page-surface);
      border-color: var(--page-border);
      border-radius: var(--page-radius);
      border-style: var(--page-border-style);
      border-width: var(--page-border-width);
      box-shadow: var(--page-shadow);
      color: var(--page-text);
    }

    button,
    .main-toggle {
      background: var(--page-button);
      border-color: var(--page-border);
      border-radius: var(--button-radius);
      color: var(--page-button-text);
    }

    button.primary {
      background: var(--page-accent);
      border-color: var(--page-accent);
      color: var(--page-button-text);
    }

    select,
    input[type="number"] {
      background: var(--page-surface);
      border-color: var(--page-border);
      border-radius: var(--menu-radius);
      color: var(--page-text);
    }

    .settings-control span,
    .page-settings-group legend,
    .activity-level-heading {
      border-radius: var(--label-radius);
    }

    .page-settings-dialog,
    .model-dialog {
      border-radius: var(--popup-radius);
    }

    input[type="checkbox"],
    input[type="range"],
    progress {
      accent-color: var(--page-accent);
    }

    :focus-visible {
      outline-color: var(--focus-color);
      outline-width: var(--focus-width);
    }
  `;

  return <style data-page-style>{css}</style>;
}

function getReadableTextColor(backgroundColor: string) {
  const rgb = parseHexColor(backgroundColor);
  if (!rgb) return "#000000";
  const luminance = getRelativeLuminance(rgb);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff";
}

function getAccessibleSharedColor(preferredColor: string, backgroundColors: string[], minContrast: number) {
  const validBackgrounds = backgroundColors
    .map(parseHexColor)
    .filter((background): background is { red: number; green: number; blue: number } => background !== null);
  if (validBackgrounds.length === 0) {
    return preferredColor;
  }

  const preferred = parseHexColor(preferredColor);
  const candidates: string[] = [];

  if (preferred) {
    candidates.push(preferredColor.toLowerCase());
    candidates.push(...buildColorRamp(preferredColor, "#000000"));
    candidates.push(...buildColorRamp(preferredColor, "#ffffff"));
  }

  candidates.push("#000000", "#111111", "#f5f5f5", "#ffffff");

  let bestColor = candidates[0] ?? preferredColor;
  let bestScore = -1;

  for (const candidate of dedupeColors(candidates)) {
    const contrastScore = Math.min(
      ...validBackgrounds.map((background) => getContrastRatio(candidate, rgbToHex(background)))
    );
    if (contrastScore >= minContrast) {
      return candidate;
    }
    if (contrastScore > bestScore) {
      bestScore = contrastScore;
      bestColor = candidate;
    }
  }

  return bestColor;
}

function getAccessibleSecondaryColor(baseTextColor: string, backgroundColors: string[], minContrast: number) {
  const background = backgroundColors[0];
  const softCandidates = buildColorRamp(baseTextColor, background).reverse();

  for (const candidate of softCandidates) {
    const contrastScore = Math.min(...backgroundColors.map((surface) => getContrastRatio(candidate, surface)));
    if (contrastScore >= minContrast) {
      return candidate;
    }
  }

  return baseTextColor;
}

function buildColorRamp(sourceColor: string, targetColor: string) {
  const source = parseHexColor(sourceColor);
  const target = parseHexColor(targetColor);
  if (!source || !target) return [];

  const steps = [0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88];
  return steps.map((amount) => mixHexColors(source, target, amount));
}

function mixHexColors(
  source: { red: number; green: number; blue: number },
  target: { red: number; green: number; blue: number },
  amount: number
) {
  const mixChannel = (start: number, end: number) => start + (end - start) * amount;
  return rgbToHex({
    red: mixChannel(source.red, target.red),
    green: mixChannel(source.green, target.green),
    blue: mixChannel(source.blue, target.blue)
  });
}

function dedupeColors(colors: string[]) {
  return [...new Set(colors.map((color) => color.toLowerCase()))];
}

function parseHexColor(value: string) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match) return null;
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16) / 255,
    green: Number.parseInt(hex.slice(2, 4), 16) / 255,
    blue: Number.parseInt(hex.slice(4, 6), 16) / 255
  };
}

function rgbToHex({ red, green, blue }: { red: number; green: number; blue: number }) {
  const encode = (channel: number) => {
    const bounded = Math.max(0, Math.min(255, Math.round(channel * 255)));
    return bounded.toString(16).padStart(2, "0");
  };

  return `#${encode(red)}${encode(green)}${encode(blue)}`;
}

function getContrastRatio(foregroundColor: string, backgroundColor: string) {
  const foreground = parseHexColor(foregroundColor);
  const background = parseHexColor(backgroundColor);
  if (!foreground || !background) return 1;

  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance({ red, green, blue }: { red: number; green: number; blue: number }) {
  const [r, g, b] = [red, green, blue].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
