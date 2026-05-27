import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SimpleSettings } from "../../src/components/SimpleSettings";
import {
  cloneRuntimeSettings,
  defaultRuntimeSettings,
  settingsOptions,
  type SettingsOption
} from "../../src/config/settingsOptions";

function renderSettings(
  overrides: Partial<ComponentProps<typeof SimpleSettings>> = {}
) {
  const settings = cloneRuntimeSettings(defaultRuntimeSettings);
  const props: ComponentProps<typeof SimpleSettings> = {
    disabled: false,
    isOpen: true,
    isOpfsAvailable: true,
    isSpeaking: false,
    microphoneDevices: [],
    selectedVoiceId: settings.tts.selectedVoiceId,
    settings,
    voiceOptions: [{ id: settings.tts.selectedVoiceId, name: "Default Voice" }],
    onClose: vi.fn(),
    onReset: vi.fn(),
    onSetPageStyle: vi.fn(),
    onSetMicrophone: vi.fn(),
    onSetVoice: vi.fn(),
    onUpdate: vi.fn(),
    ...overrides
  };

  return {
    ...render(<SimpleSettings {...props} />),
    props
  };
}

describe("SimpleSettings regressions", () => {
  it("does not render when closed", () => {
    renderSettings({ isOpen: false });

    expect(screen.queryByRole("dialog", { name: "User settings" })).not.toBeInTheDocument();
  });

  it("shows the VAD-specific silence control for the active mode", async () => {
    const user = userEvent.setup();
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    const onUpdate = vi.fn();
    renderSettings({ settings, onUpdate });

    expect(screen.getByText("Adaptive silence floor")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Detection method"), "fixed-rms");

    const vadOption = settingsOptions.find((option) => option.key === "vad") as SettingsOption;
    expect(onUpdate).toHaveBeenCalledWith(vadOption, "fixed-rms");
  });

  it("shows the Whisper model cards and forwards changes", async () => {
    const user = userEvent.setup();
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    const onUpdate = vi.fn();
    renderSettings({ settings, onUpdate });

    expect(screen.getByText("Each option includes its language coverage and why you would pick it.")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Whisper Base.*English only/i }));

    const modelOption = settingsOptions.find(
      (option) => option.key === "transcriptionModel"
    ) as SettingsOption;
    expect(onUpdate).toHaveBeenCalledWith(modelOption, "onnx-community/whisper-base.en");
  });

  it("disables OPFS recording controls when storage is unavailable", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.recording.shouldRecordToOpfs = true;
    renderSettings({ settings, isOpfsAvailable: false });

    expect(screen.getByLabelText("Save audio chunks")).toBeDisabled();
    expect(screen.getByLabelText("Save audio chunks")).not.toBeChecked();
  });

  it("disables voice changes while speech playback is active", () => {
    renderSettings({ isSpeaking: true });

    expect(screen.getByLabelText("Voice engine")).toBeDisabled();
    expect(screen.getByLabelText("Voice")).toBeDisabled();
  });

  it("switches to the appearance tab and exposes page style controls", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("tab", { name: "Appearance" }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByLabelText("Presets")).toBeInTheDocument();
    expect(within(panel).getByLabelText("ARIA role verbosity")).toBeInTheDocument();
  });

  it("forwards reset clicks to the parent", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    renderSettings({ onReset });

    await user.click(screen.getByRole("button", { name: "Reset settings" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
