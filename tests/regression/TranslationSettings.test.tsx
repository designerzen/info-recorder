import { h, Fragment } from "../../src/ui/dom";
import { fireEvent, render, screen, within } from "../dom";
import { describe, expect, it, vi } from "vitest";
import { TranslationSettings } from "../../src/components/TranslationSettings";
import { cloneRuntimeSettings, defaultRuntimeSettings } from "../../src/config/settingsOptions";
import type { createBrowserTranslation } from "../../src/translation/createBrowserTranslation";

function renderSettings(overrides: Partial<ReturnType<typeof createBrowserTranslation>> = {}) {
  const translation = {
    supported: true, checking: false, enabled: false, loading: false, status: "",
    targets: [{ value: "fr", label: "French", availability: "downloadable" as const }],
    translations: {}, enable: vi.fn(), disable: vi.fn(), ...overrides
  };
  const onUpdate = vi.fn();
  render(<TranslationSettings settings={cloneRuntimeSettings(defaultRuntimeSettings)} translation={translation} onUpdate={onUpdate} />);
  return { translation, onUpdate };
}

describe("translation settings", () => {
  it("explains unsupported browsers and disables enabling", () => {
    renderSettings({ supported: false, targets: [] });
    expect(screen.getByRole("checkbox", { name: "Enable browser translation" })).toBeDisabled();
    expect(screen.getByText(/Translator API is not available/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("offers checked target languages and enables directly on user interaction", () => {
    const { translation, onUpdate } = renderSettings();
    const target = screen.getByRole("combobox", { name: "Translate into" });
    expect(within(target).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(translation.enable).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("combobox", { name: "Transcript language" }), { target: { value: "es" } });
    expect(translation.disable).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ key: "translationSource" }), "es");
  });

  it("prevents enabling when the selected pair is unavailable", () => {
    renderSettings({ targets: [] });
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Translate into" })).toBeDisabled();
  });
});
