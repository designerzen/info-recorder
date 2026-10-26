import { h, Fragment } from "../../src/ui/dom";
import { fireEvent, render, screen, within } from "../dom";
import userEvent from "@testing-library/user-event";
type ComponentProps<T extends (...args: any[]) => unknown> = Parameters<T>[0];
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
    modelDownloadSpeedBps: 0,
    modelInventory: [],
    modelInventoryMessage: "",
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
  it("offers volume presets and a percentage slider outside advanced settings", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    const volumeOption = settingsOptions.find((option) => option.key === "speechVolume");
    const playback = screen.getByRole("group", { name: "Playback" });
    const slider = within(playback).getByRole("slider", { name: "Playback volume" });
    expect(slider).toHaveAttribute("aria-valuetext", "90%");
    for (const [label, value] of [["Mute", 0], ["Quiet", 0.25], ["Medium", 0.5], ["Full", 1]] as const) {
      await user.click(within(playback).getByRole("button", { name: label }));
      expect(props.onUpdate).toHaveBeenLastCalledWith(volumeOption, value);
    }
    fireEvent.change(slider, { target: { value: "0.65" } });
    expect(props.onUpdate).toHaveBeenLastCalledWith(volumeOption, 0.65);
  });

  it("shows mute selection and prevents volume changes during playback", () => {
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.tts.volume = 0;
    renderSettings({ settings, isSpeaking: true });
    expect(screen.getByRole("slider", { name: "Playback volume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
    expect(screen.getByText("Muted")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderSettings({ isOpen: false });

    expect(screen.queryByRole("dialog", { name: "User settings" })).not.toBeInTheDocument();
  });

  it("defaults to raw microphone audio and hides activity-specific controls", () => {
    renderSettings();

    expect(screen.getByLabelText("Use activity detection")).not.toBeChecked();
    expect(screen.queryByLabelText("Detection method")).not.toBeInTheDocument();
    expect(screen.queryByText("Adaptive silence floor")).not.toBeInTheDocument();
  });

  it("shows the VAD-specific silence control when activity detection is enabled", async () => {
    const user = userEvent.setup();
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    settings.vad.enabled = true;
    const onUpdate = vi.fn();
    renderSettings({ settings, onUpdate });

    expect(screen.getByText("Adaptive silence floor")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Detection method"), "fixed-rms");

    const vadOption = settingsOptions.find((option) => option.key === "vad") as SettingsOption;
    expect(onUpdate).toHaveBeenCalledWith(vadOption, "fixed-rms");
  });

  it("shows the transcription model selector and forwards changes", async () => {
    const user = userEvent.setup();
    const settings = cloneRuntimeSettings(defaultRuntimeSettings);
    const onUpdate = vi.fn();
    renderSettings({ settings, onUpdate });

    expect(screen.getByLabelText("Transcription model")).toBeInTheDocument();
    expect(screen.getByText("Default live-speech model, balancing Moonshine's streaming latency and accuracy.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Transcription model"), "onnx-community/whisper-base.en_timestamped");

    const modelOption = settingsOptions.find(
      (option) => option.key === "transcriptionModel"
    ) as SettingsOption;
    expect(onUpdate).toHaveBeenCalledWith(modelOption, "onnx-community/whisper-base.en_timestamped");
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
    expect(screen.getByLabelText("Sentence buttons")).toBeDisabled();
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

  it("keeps Done and reset available on the appearance tab", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    await user.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByRole("button", { name: "Reset settings" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("supports arrow navigation with a labelled tab panel", async () => {
    const user = userEvent.setup();
    renderSettings();
    screen.getByRole("tab", { name: "App" }).focus();
    await user.keyboard("{ArrowRight}");
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Appearance" })).toHaveAttribute("id", appearance.getAttribute("aria-controls"));
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "App" })).toHaveFocus();
  });

  it("contains keyboard focus and closes with Escape", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    const close = screen.getByRole("button", { name: "Close settings" });
    const done = screen.getByRole("button", { name: "Done" });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(done).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
