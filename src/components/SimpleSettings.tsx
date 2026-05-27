import { RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { PageSettingsControls } from "./PageSettingsDialog";
import type { PageStyleSettings } from "../config/pageStyle";
import {
  settingsOptions,
  transcriptionModelOptions,
  type RuntimeSettings,
  type SettingsOption
} from "../config/settingsOptions";

type SimpleSettingsProps = {
  disabled: boolean;
  isOpen: boolean;
  isOpfsAvailable: boolean;
  isSpeaking: boolean;
  microphoneDevices: MediaDeviceInfo[];
  selectedVoiceId: string;
  settings: RuntimeSettings;
  voiceOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onReset: () => void;
  onSetPageStyle: (value: PageStyleSettings) => void;
  onSetMicrophone: (deviceId: string) => void;
  onSetVoice: (value: string) => void;
  onUpdate: (option: SettingsOption, value: boolean | number | string) => void;
};

export function SimpleSettings({
  disabled,
  isOpen,
  isOpfsAvailable,
  isSpeaking,
  microphoneDevices,
  selectedVoiceId,
  settings,
  voiceOptions,
  onClose,
  onReset,
  onSetPageStyle,
  onSetMicrophone,
  onSetVoice,
  onUpdate
}: SimpleSettingsProps) {
  const echoCancellationOption = getOption("echoCancellation");
  const noiseSuppressionOption = getOption("noiseSuppression");
  const autoGainControlOption = getOption("autoGainControl");
  const detectionOption = getOption("vad");
  const silenceOption = getActiveSilenceOption(settings);
  const recordOption = getOption("recordOpfs");
  const recordingFormatOption = getOption("recordingFormat");
  const transcriptionModelOption = getOption("transcriptionModel");
  const transcriptScrollOption = getOption("transcriptScrollSpeed");
  const voiceEngineOption = getOption("voiceEngine");
  const [activeTab, setActiveTab] = useState<"app" | "appearance">("app");

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" role="presentation">
      <section
        aria-label="User settings"
        aria-modal="true"
        className="settings-dialog"
        role="dialog"
      >
        <header className="settings-dialog-header">
          <div>
            <h2>Settings</h2>
            <p>Microphone, activity detection, recording, and speech options.</p>
          </div>
          <button type="button" onClick={onClose} title="Close settings" aria-label="Close settings">
            <X size={18} />
          </button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "app"}
            className={activeTab === "app" ? "active" : ""}
            onClick={() => setActiveTab("app")}
          >
            App
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "appearance"}
            className={activeTab === "appearance" ? "active" : ""}
            onClick={() => setActiveTab("appearance")}
          >
            Appearance
          </button>
        </div>
        {activeTab === "app" ? (
          <div className="settings-body" role="tabpanel">
        <label className="settings-control">
          <span>Microphone</span>
          <select
            value={settings.microphone.deviceId}
            disabled={disabled}
            onChange={(event) => onSetMicrophone(event.target.value)}
          >
            <option value="">System default</option>
            {microphoneDevices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <SettingControl
          disabled={disabled}
          option={echoCancellationOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={noiseSuppressionOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={autoGainControlOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={detectionOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={silenceOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <label className="settings-control checkbox-control">
          <input
            type="checkbox"
            checked={settings.recording.shouldRecordToOpfs && isOpfsAvailable}
            disabled={disabled || !isOpfsAvailable}
            onChange={(event) => onUpdate(recordOption, event.target.checked)}
          />
          <span>Save audio chunks</span>
        </label>
        <SettingControl
          disabled={disabled}
          option={recordingFormatOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={transcriptionModelOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={disabled}
          option={transcriptScrollOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <SettingControl
          disabled={isSpeaking}
          option={voiceEngineOption}
          settings={settings}
          onUpdate={onUpdate}
        />
        <label className="settings-control">
          <span>Voice</span>
          <select
            value={selectedVoiceId}
            disabled={isSpeaking || voiceOptions.length === 0}
            onChange={(event) => onSetVoice(event.target.value)}
          >
            {voiceOptions.length > 0 ? (
              voiceOptions.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))
            ) : (
              <option value={selectedVoiceId}>Default</option>
            )}
          </select>
        </label>
        <details className="advanced-settings">
          <summary>Advanced</summary>
          <div className="advanced-grid">
            {settingsOptions
              .filter(
                (option) =>
                  ![
                    detectionOption.key,
                    silenceOption.key,
                    echoCancellationOption.key,
                    noiseSuppressionOption.key,
                    autoGainControlOption.key,
                    recordOption.key,
                    recordingFormatOption.key,
                    transcriptionModelOption.key,
                    transcriptScrollOption.key,
                    voiceEngineOption.key
                  ].includes(option.key)
              )
              .map((option) => (
                <SettingControl
                  disabled={disabled}
                  key={option.key}
                  option={option}
                  settings={settings}
                  onUpdate={onUpdate}
                />
              ))}
          </div>
        </details>
        <button type="button" onClick={onReset} disabled={disabled} title="Reset settings">
          <RotateCcw size={18} />
          <span>Reset settings</span>
        </button>
          </div>
        ) : (
          <div className="settings-body page-settings-main" role="tabpanel">
            <PageSettingsControls settings={settings.pageStyle} onChange={onSetPageStyle} />
          </div>
        )}
      </section>
    </div>
  );
}

function SettingControl({
  disabled,
  option,
  settings,
  onUpdate
}: {
  disabled: boolean;
  option: SettingsOption;
  settings: RuntimeSettings;
  onUpdate: (option: SettingsOption, value: boolean | number | string) => void;
}) {
  if (option.kind === "checkbox") {
    return (
      <label className="settings-control checkbox-control">
        <input
          type="checkbox"
          checked={option.getValue(settings)}
          disabled={disabled}
          onChange={(event) => onUpdate(option, event.target.checked)}
        />
        <span>{option.label}</span>
      </label>
    );
  }

  if (option.kind === "select") {
    if (option.key === "transcriptionModel") {
      return (
        <fieldset className="model-picker">
          <legend>{option.label}</legend>
          <p className="model-picker-intro">
            Each option includes its language coverage and why you would pick it.
          </p>
          <div className="model-picker-grid" role="radiogroup" aria-label={option.label}>
            {transcriptionModelOptions.map((item) => {
              const checked = option.getValue(settings) === item.value;
              return (
                <label
                  key={item.value}
                  className="model-card"
                  data-checked={checked}
                  data-language-support={item.languageSupport}
                >
                  <input
                    type="radio"
                    name={option.key}
                    value={item.value}
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onUpdate(option, event.target.value)}
                  />
                  <span className="model-card-topline">
                    <strong>{item.label}</strong>
                    <em>{item.languageSupport}</em>
                  </span>
                  <span className="model-card-meta">
                    <span>{item.parameters}</span>
                    <code>{item.repo}</code>
                  </span>
                  <span className="model-card-summary">{item.summary}</span>
                  <span className="model-card-why">{item.whyChoose}</span>
                  {item.caution ? <span className="model-card-caution">{item.caution}</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }

    return (
      <label className="settings-control">
        <span>{option.label}</span>
        <select
          value={option.getValue(settings)}
          disabled={disabled}
          onChange={(event) => onUpdate(option, event.target.value)}
        >
          {option.options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (option.kind === "slider") {
    const value = option.getValue(settings);
    return (
      <label className="settings-control slider-control">
        <span>{option.label}</span>
        <input
          type="range"
          min={option.min}
          max={option.max}
          step={option.step}
          value={value}
          disabled={disabled}
          onInput={(event) => onUpdate(option, Number(event.currentTarget.value))}
          onChange={(event) => onUpdate(option, Number(event.target.value))}
        />
        <output>{option.valueLabel ? option.valueLabel(value) : value}</output>
      </label>
    );
  }

  return (
    <label className="settings-control">
      <span>{option.label}</span>
      <input
        type="number"
        min={option.min}
        max={option.max}
        step={option.step}
        value={option.getValue(settings)}
        disabled={disabled}
        onChange={(event) => onUpdate(option, Number(event.target.value))}
      />
    </label>
  );
}

function getActiveSilenceOption(settings: RuntimeSettings) {
  if (settings.vad.mode === "fixed-rms") return getOption("fixedSilence");
  if (settings.vad.mode === "rms-zcr") return getOption("zcrSilence");
  if (settings.vad.mode === "transformers-audio-classification") {
    return getOption("mlSpeechThreshold");
  }
  return getOption("adaptiveSilence");
}

function getOption(key: string) {
  const option = settingsOptions.find((item) => item.key === key);
  if (!option) throw new Error(`Missing setting option: ${key}`);
  return option;
}
