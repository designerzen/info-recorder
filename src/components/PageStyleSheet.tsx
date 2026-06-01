import type { PageStyleSettings } from "../config/pageStyle";

type PageStyleSheetProps = {
  settings: PageStyleSettings;
};

export function PageStyleSheet({ settings }: PageStyleSheetProps) {
  const shadow = settings.pageShadow === "on" ? "0 16px 40px rgba(0, 0, 0, 0.18)" : "none";
  const subtitleHighlightText = getReadableTextColor(settings.focusColor);
  const css = `
    :root {
      --page-text: ${settings.textColor};
      --page-bg: ${settings.backgroundColor};
      --page-surface: ${settings.surfaceColor};
      --page-button: ${settings.buttonColor};
      --page-button-text: ${settings.buttonTextColor};
      --page-accent: ${settings.accentColor};
      --page-border: ${settings.borderColor};
      --focus-color: ${settings.focusColor};
      --page-border-width: ${settings.borderWidth};
      --page-border-style: ${settings.borderStyle};
      --page-radius: ${settings.borderRadius};
      --button-radius: ${settings.buttonRadius};
      --menu-radius: ${settings.menuRadius};
      --label-radius: ${settings.labelRadius};
      --popup-radius: ${settings.popupRadius};
      --page-shadow: ${shadow};
      --focus-width: ${settings.focusWidth};
      --subtitle-highlight-bg: ${settings.focusColor};
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

function getRelativeLuminance({ red, green, blue }: { red: number; green: number; blue: number }) {
  const [r, g, b] = [red, green, blue].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
