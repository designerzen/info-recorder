import { Download, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import {
  defaultPageStyle,
  fontFamilyOptions,
  normalizePageStyle,
  pageStyleOptions,
  pageStylePresets,
  presetToPageStyle,
  roleVerbosityOptions,
  type PageStyleSettings
} from "../config/pageStyle";

type PageSettingsDialogProps = {
  isOpen: boolean;
  settings: PageStyleSettings;
  onChange: (settings: PageStyleSettings) => void;
  onClose: () => void;
};

type PageSettingsControlsProps = {
  settings: PageStyleSettings;
  onChange: (settings: PageStyleSettings) => void;
};

type SelectField = {
  key: keyof PageStyleSettings;
  label: string;
  options: string[];
};

const storageKey = "info-recorder-page-style-default";

export function PageSettingsDialog({
  isOpen,
  settings,
  onChange,
  onClose
}: PageSettingsDialogProps) {
  const importRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const update = (patch: Partial<PageStyleSettings>) => {
    onChange({ ...settings, ...patch, preset: patch.preset ?? "custom" });
  };

  const exportPreset = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "info-recorder-page-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPreset = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = normalizePageStyle(JSON.parse(await file.text()));
      onChange({ ...imported, preset: "custom" });
    } catch {
      window.alert("That preset file could not be imported.");
    }
  };

  return (
    <div className="page-settings-overlay" role="presentation">
      <section
        aria-label="Color controls"
        aria-modal="true"
        className="page-settings-dialog"
        role="dialog"
      >
        <header className="page-settings-header">
          <div>
            <h2>Colors & Fonts</h2>
            <p>Preset and accessibility appearance controls.</p>
          </div>
          <button type="button" onClick={onClose} title="Close page settings" aria-label="Close page settings">
            <X size={18} />
          </button>
        </header>

        <div className="page-settings-main">
          <PageSettingsControls settings={settings} onChange={onChange} />
        </div>

        <footer className="page-settings-footer">
          <button type="button" onClick={() => onChange(defaultPageStyle)}>
            <RotateCcw size={18} />
            <span>Reset to defaults</span>
          </button>
          <button type="button" onClick={exportPreset}>
            <Download size={18} />
            <span>Export Presets</span>
          </button>
          <button type="button" onClick={() => importRef.current?.click()}>
            <Upload size={18} />
            <span>Import Presets</span>
          </button>
          <input
            ref={importRef}
            className="media-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importPreset(event.target.files?.[0])}
          />
          <button type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}

export function PageSettingsControls({ settings, onChange }: PageSettingsControlsProps) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const update = (patch: Partial<PageStyleSettings>) => {
    onChange({ ...settings, ...patch, preset: patch.preset ?? "custom" });
  };

  const exportPreset = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "info-recorder-page-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPreset = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = normalizePageStyle(JSON.parse(await file.text()));
      onChange({ ...imported, preset: "custom" });
    } catch {
      window.alert("That preset file could not be imported.");
    }
  };

  return (
    <>
      <label className="settings-control">
        <span>Presets</span>
        <select value={settings.preset} onChange={(event) => onChange(presetToPageStyle(event.target.value))}>
          <option value="custom">Custom</option>
          {pageStylePresets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <div className="page-settings-actions">
        <button
          type="button"
          onClick={() => {
            const name = window.prompt("Save as", "Custom preset");
            if (name) {
              window.localStorage.setItem(`info-recorder-page-style-${name}`, JSON.stringify(settings));
            }
          }}
        >
          <Save size={18} />
          <span>Save as...</span>
        </button>
        <button type="button" disabled title="Built-in presets cannot be deleted">
          <Trash2 size={18} />
          <span>Delete</span>
        </button>
        <button type="button" onClick={() => window.localStorage.setItem(storageKey, JSON.stringify(settings))}>
          <Save size={18} />
          <span>Set Default</span>
        </button>
        <button type="button" onClick={() => onChange(defaultPageStyle)}>
          <RotateCcw size={18} />
          <span>Reset</span>
        </button>
        <button type="button" onClick={exportPreset}>
          <Download size={18} />
          <span>Export</span>
        </button>
        <button type="button" onClick={() => importRef.current?.click()}>
          <Upload size={18} />
          <span>Import</span>
        </button>
        <input
          ref={importRef}
          className="media-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importPreset(event.target.files?.[0])}
        />
      </div>

      <SettingsGroup title="Fonts">
        <label className="settings-control">
          <span>Font family</span>
          <select value={settings.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
            {fontFamilyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <SelectControl field={{ key: "fontSizePt", label: "Font size", options: pageStyleOptions.fontSizePt }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "fontWeight", label: "Weight", options: pageStyleOptions.fontWeight }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "fontStyle", label: "Style", options: pageStyleOptions.fontStyle }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "fontVariant", label: "Variant", options: pageStyleOptions.fontVariant }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "textDecoration", label: "Decoration", options: pageStyleOptions.textDecoration }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "letterSpacing", label: "Letter spacing", options: pageStyleOptions.letterSpacing }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "wordSpacing", label: "Word spacing", options: pageStyleOptions.wordSpacing }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "lineHeight", label: "Line height", options: pageStyleOptions.lineHeight }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "textTransform", label: "Transform", options: pageStyleOptions.textTransform }} settings={settings} onChange={update} />
        <label className="settings-control">
          <span>ARIA role verbosity</span>
          <select
            value={settings.roleVerbosity}
            onChange={(event) => update({ roleVerbosity: event.target.value as PageStyleSettings["roleVerbosity"] })}
          >
            {roleVerbosityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </SettingsGroup>

      <SettingsGroup title="Page">
        <SelectControl field={{ key: "pageShadow", label: "Shadow", options: pageStyleOptions.pageShadow }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "borderRadius", label: "Radius", options: pageStyleOptions.borderRadius }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "borderWidth", label: "Border width", options: pageStyleOptions.borderWidth }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "focusWidth", label: "Focus width", options: pageStyleOptions.focusWidth }} settings={settings} onChange={update} />
        <SelectControl field={{ key: "borderStyle", label: "Border style", options: pageStyleOptions.borderStyle }} settings={settings} onChange={update} />
        <ColorControl label="Text" value={settings.textColor} onChange={(textColor) => update({ textColor })} />
        <ColorControl label="Background" value={settings.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
        <ColorControl label="Surface" value={settings.surfaceColor} onChange={(surfaceColor) => update({ surfaceColor })} />
        <ColorControl label="Border" value={settings.borderColor} onChange={(borderColor) => update({ borderColor })} />
        <ColorControl label="Focus" value={settings.focusColor} onChange={(focusColor) => update({ focusColor })} />
      </SettingsGroup>

      <SettingsGroup title="Button">
        <SelectControl field={{ key: "buttonRadius", label: "Radius", options: pageStyleOptions.componentRadius }} settings={settings} onChange={update} />
        <ColorControl label="Color" value={settings.buttonColor} onChange={(buttonColor) => update({ buttonColor })} />
        <ColorControl label="Text" value={settings.buttonTextColor} onChange={(buttonTextColor) => update({ buttonTextColor })} />
        <ColorControl label="Accent" value={settings.accentColor} onChange={(accentColor) => update({ accentColor })} />
      </SettingsGroup>

      <SettingsGroup title="Menu">
        <SelectControl field={{ key: "menuRadius", label: "Radius", options: pageStyleOptions.componentRadius }} settings={settings} onChange={update} />
      </SettingsGroup>

      <SettingsGroup title="Label">
        <SelectControl field={{ key: "labelRadius", label: "Radius", options: pageStyleOptions.componentRadius }} settings={settings} onChange={update} />
      </SettingsGroup>

      <SettingsGroup title="Pop Up">
        <SelectControl field={{ key: "popupRadius", label: "Radius", options: pageStyleOptions.componentRadius }} settings={settings} onChange={update} />
      </SettingsGroup>
    </>
  );
}

function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <fieldset className="page-settings-group">
      <legend>{title}</legend>
      <div className="page-settings-grid">{children}</div>
    </fieldset>
  );
}

function SelectControl({
  field,
  settings,
  onChange
}: {
  field: SelectField;
  settings: PageStyleSettings;
  onChange: (patch: Partial<PageStyleSettings>) => void;
}) {
  return (
    <label className="settings-control">
      <span>{field.label}</span>
      <select
        value={String(settings[field.key])}
        onChange={(event) =>
          onChange({ [field.key]: event.target.value } as Partial<PageStyleSettings>)
        }
      >
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorControl({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-control color-control">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
