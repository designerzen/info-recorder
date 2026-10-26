import { h, Fragment, defineElement, patch, type DomContent, type DomEvent } from "../ui/dom";
import { createLifecycle, uniqueId } from "../ui/lifecycle";
import { createStateMachine } from "../state/machine";
import { Mic, Palette, RotateCcw, SlidersHorizontal, Volume2, X } from "../ui/icons";
import { PageSettingsControls } from "./PageSettingsDialog";
import type { PageStyleSettings } from "../config/pageStyle";
import { getTranscriptionModelOption, settingsOptions, transcriptionModelOptions, type RuntimeSettings, type SettingsOption } from "../config/settingsOptions";
import { estimateSecondsRemaining, formatBytes, formatDuration, type ModelInventoryEntry } from "../recorder/modelInventory";
type SimpleSettingsProps = {
    translationControls?: DomContent;
    disabled: boolean;
    isOpen: boolean;
    isOpfsAvailable: boolean;
    isSpeaking: boolean;
    microphoneDevices: MediaDeviceInfo[];
    modelDownloadSpeedBps: number;
    modelInventory: ModelInventoryEntry[];
    modelInventoryMessage: string;
    selectedVoiceId: string;
    settings: RuntimeSettings;
    voiceOptions: Array<{
        id: string;
        name: string;
    }>;
    onClose: () => void;
    onReset: () => void;
    onSetPageStyle: (value: PageStyleSettings) => void;
    onSetMicrophone: (deviceId: string) => void;
    onSetVoice: (value: string) => void;
    onUpdate: (option: SettingsOption, value: boolean | number | string) => void;
};
export const SimpleSettings = defineElement<SimpleSettingsProps>("wt-simple-settings", (initialProps, host) => {
    let { translationControls, disabled, isOpen, isOpfsAvailable, isSpeaking, microphoneDevices, modelDownloadSpeedBps, modelInventory, modelInventoryMessage, selectedVoiceId, settings, voiceOptions, onClose, onReset, onSetPageStyle, onSetMicrophone, onSetVoice, onUpdate } = initialProps;
    const scope = createLifecycle();
    const machine = createStateMachine({ activeTab: ("app") as "app" | "appearance" }, (context) => context.activeTab);
    let state = machine.context;
    scope.own(machine.subscribe(() => { state = machine.context; scope.invalidate(); }));
    scope.own(machine.dispose);
    const setActiveTab = (value: typeof state.activeTab | ((previous: typeof state.activeTab) => typeof state.activeTab)) => machine.send({ type: "activeTab", value });
    const dialogRef: {
        current: HTMLElement | null;
    } = { current: null };
    const bodyRef: {
        current: HTMLDivElement | null;
    } = { current: null };
    let activityDetectionOption = getOption("activityDetection");
    let detectionOption = getOption("vad");
    let silenceOption = getActiveSilenceOption(settings);
    let recordOption = getOption("recordOpfs");
    let transcriptionModelOption = getOption("transcriptionModel");
    let transcriptScrollOption = getOption("transcriptScrollSpeed");
    let voiceEngineOption = getOption("voiceEngine");
    let sentencePlaybackModeOption = getOption("sentencePlaybackMode");
    let volumeOption = getOption("speechVolume");
    const settingsId = uniqueId();
    const handleDialogKeyDown = (event: DomEvent<KeyboardEvent>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
        if (event.key !== "Tab")
            return;
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("*") ?? [])
            .filter((element) => element.matches('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') &&
            element.getAttribute("tabindex") !== "-1" && !element.classList.contains("media-input") &&
            (!element.closest("details:not([open])") || element.tagName === "SUMMARY"));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    };
    function render() {
        if (!isOpen)
            return null;
        return (<div className="settings-overlay" role="presentation">
      <section ref={dialogRef} aria-label="User settings" aria-modal="true" className="settings-dialog" role="dialog" onKeyDown={handleDialogKeyDown}>
        <header className="settings-dialog-header">
          <div>
            <h2>Settings</h2>
          </div>
          <button type="button" onClick={onClose} title="Close settings" aria-label="Close settings">
            <X size={18}/>
          </button>
        </header>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                    return;
                event.preventDefault();
                const next = event.key === "Home" ? "app" : event.key === "End" ? "appearance" : state.activeTab === "app" ? "appearance" : "app";
                setActiveTab(next);
                document.getElementById(`${settingsId}-${next}-tab`)?.focus();
            }}>
          <button type="button" role="tab" id={`${settingsId}-app-tab`} aria-controls={`${settingsId}-app-panel`} aria-label="App" tabIndex={state.activeTab === "app" ? 0 : -1} aria-selected={state.activeTab === "app"} className={state.activeTab === "app" ? "active" : ""} onClick={() => setActiveTab("app")}>
            <SlidersHorizontal size={17} aria-hidden="true"/> App
          </button>
          <button type="button" role="tab" id={`${settingsId}-appearance-tab`} aria-controls={`${settingsId}-appearance-panel`} tabIndex={state.activeTab === "appearance" ? 0 : -1} aria-selected={state.activeTab === "appearance"} className={state.activeTab === "appearance" ? "active" : ""} onClick={() => setActiveTab("appearance")}>
            <Palette size={17} aria-hidden="true"/> Appearance
          </button>
        </div>
        {state.activeTab === "app" ? (<div ref={bodyRef} id={`${settingsId}-app-panel`} aria-labelledby={`${settingsId}-app-tab`} tabIndex={0} className="settings-body settings-app-body" role="tabpanel">
            {disabled ? <p className="settings-notice" role="status">Stop recording or wait for processing to change recording settings.</p> : null}
            <SettingsGroup title="Recording" icon={<Mic size={18} aria-hidden="true"/>}>
              <SettingControl disabled={disabled} modelDownloadSpeedBps={modelDownloadSpeedBps} modelInventory={modelInventory} modelInventoryMessage={modelInventoryMessage} option={transcriptionModelOption} settings={settings} onUpdate={onUpdate}/>
              <label className="settings-control">
                <span>Microphone</span>
                <select aria-label="Microphone" value={settings.microphone.deviceId} disabled={disabled} onChange={(event) => onSetMicrophone(event.target.value)}>
                  <option value="">System default</option>
                  {microphoneDevices.map((device, index) => (<option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>))}
                </select>
              </label>
              <SettingControl disabled={disabled} option={activityDetectionOption} settings={settings} onUpdate={onUpdate}/>
              {settings.vad.enabled ? (<>
                  <SettingControl disabled={disabled} option={detectionOption} settings={settings} onUpdate={onUpdate}/>
                  <SettingControl disabled={disabled} option={silenceOption} settings={settings} onUpdate={onUpdate}/>
                </>) : null}
              <label className="settings-control checkbox-control">
                <input aria-label="Save audio chunks" aria-describedby={`${settingsId}-storage-description`} type="checkbox" checked={settings.recording.shouldRecordToOpfs && isOpfsAvailable} disabled={disabled || !isOpfsAvailable} onChange={(event) => onUpdate(recordOption, event.target.checked)}/>
                <span>Save audio chunks<small id={`${settingsId}-storage-description`}>{isOpfsAvailable ? "Keep a local copy in this browser for playback and download." : "Audio storage is unavailable in this browser."}</small></span>
              </label>
            </SettingsGroup>
            {translationControls}
            <SettingsGroup title="Playback" icon={<Volume2 size={18} aria-hidden="true"/>}>
              {isSpeaking ? <p className="settings-hint settings-wide" role="status">Stop playback to change volume and voice settings.</p> : null}
              <div className="volume-settings">
                <SettingControl disabled={isSpeaking} option={volumeOption} settings={settings} onUpdate={onUpdate}/>
                <div className="volume-presets" role="group" aria-label="Volume presets">
                  {[{ label: "Mute", value: 0 }, { label: "Quiet", value: 0.25 }, { label: "Medium", value: 0.5 }, { label: "Full", value: 1 }].map((preset) => (<button key={preset.label} type="button" aria-pressed={Math.abs(settings.tts.volume - preset.value) < 0.001} disabled={isSpeaking} onClick={() => onUpdate(volumeOption, preset.value)}>
                      {preset.label}
                    </button>))}
                </div>
                <p className="settings-hint">Applies to speech and source audio.</p>
              </div>
              <SettingControl disabled={disabled} option={transcriptScrollOption} settings={settings} onUpdate={onUpdate}/>
              <SettingControl disabled={isSpeaking} option={voiceEngineOption} settings={settings} onUpdate={onUpdate}/>
              <SettingControl disabled={isSpeaking} option={sentencePlaybackModeOption} settings={settings} onUpdate={onUpdate}/>
              <label className="settings-control">
                <span>Voice</span>
                <select aria-label="Voice" value={selectedVoiceId} disabled={isSpeaking || voiceOptions.length === 0} onChange={(event) => onSetVoice(event.target.value)}>
                  {voiceOptions.length > 0 ? (voiceOptions.map((voice) => (<option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>))) : (<option value={selectedVoiceId}>Default</option>)}
                </select>
              </label>
            </SettingsGroup>
            <details className="advanced-settings">
              <summary><span>Advanced settings<small>Fine-tune audio processing, timing, and speech.</small></span></summary>
              <div className="advanced-grid">
                {settingsOptions
                    .filter((option) => ![
                    "translationSource",
                    "translationTarget",
                    detectionOption.key,
                    silenceOption.key,
                    activityDetectionOption.key,
                    recordOption.key,
                    transcriptionModelOption.key,
                    transcriptScrollOption.key,
                    voiceEngineOption.key,
                    sentencePlaybackModeOption.key,
                    volumeOption.key
                ].includes(option.key))
                    .map((option) => (<SettingControl disabled={option.section === "speech" ? isSpeaking : disabled} key={option.key} option={option} settings={settings} onUpdate={onUpdate}/>))}
              </div>
            </details>
          </div>) : (<div ref={bodyRef} id={`${settingsId}-appearance-panel`} aria-labelledby={`${settingsId}-appearance-tab`} tabIndex={0} className="settings-body page-settings-main" role="tabpanel">
            <PageSettingsControls settings={settings.pageStyle} onChange={onSetPageStyle}/>
          </div>)}
        <footer className="settings-footer">
          <button className="settings-reset" type="button" onClick={onReset} disabled={disabled} title="Reset settings">
            <RotateCcw size={16} aria-hidden="true"/>
            <span>Reset settings</span>
          </button>
          <div className="settings-footer-end">
            <button className="settings-done" data-intent="primary" type="button" onClick={onClose}>Done</button>
          </div>
        </footer>
      </section>
    </div>);
    }
    function refresh() {
        activityDetectionOption = getOption("activityDetection");
        detectionOption = getOption("vad");
        silenceOption = getActiveSilenceOption(settings);
        recordOption = getOption("recordOpfs");
        transcriptionModelOption = getOption("transcriptionModel");
        transcriptScrollOption = getOption("transcriptScrollSpeed");
        voiceEngineOption = getOption("voiceEngine");
        sentencePlaybackModeOption = getOption("sentencePlaybackMode");
        volumeOption = getOption("speechVolume");
        patch(host, render());
        scope.watch("dialog-focus", [isOpen], () => {
            if (!isOpen)
                return;
            const previousFocus = document.activeElement as HTMLElement | null;
            const previousOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return () => {
                document.body.style.overflow = previousOverflow;
                // The parent removes inert after the dialog closes in the same DOM update.
                queueMicrotask(() => { if (previousFocus?.isConnected)
                    previousFocus.focus(); });
            };
        });
        scope.watch("tab-scroll", [state.activeTab], () => {
            if (bodyRef.current)
                bodyRef.current.scrollTop = 0;
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) {
            ({
                translationControls,
                disabled,
                isOpen,
                isOpfsAvailable,
                isSpeaking,
                microphoneDevices,
                modelDownloadSpeedBps,
                modelInventory,
                modelInventoryMessage,
                selectedVoiceId,
                settings,
                voiceOptions,
                onClose,
                onReset,
                onSetPageStyle,
                onSetMicrophone,
                onSetVoice,
                onUpdate
            } = props);
            refresh();
        }, dispose: scope.dispose };
});
function SettingsGroup({ title, description, icon, children }: {
    title: string;
    description?: string;
    icon?: DomContent;
    children: DomContent;
}) {
    return (<fieldset className="settings-group">
      <legend>{icon}{title}</legend>
      {description ? <p className="settings-group-description">{description}</p> : null}
      <div className="settings-group-grid">{children}</div>
    </fieldset>);
}
function SettingControl({ disabled, modelDownloadSpeedBps, modelInventory, modelInventoryMessage, option, settings, onUpdate }: {
    disabled: boolean;
    modelDownloadSpeedBps?: number;
    modelInventory?: ModelInventoryEntry[];
    modelInventoryMessage?: string;
    option: SettingsOption;
    settings: RuntimeSettings;
    onUpdate: (option: SettingsOption, value: boolean | number | string) => void;
}) {
    const inventory = modelInventory ?? [];
    const inventoryMessageText = modelInventoryMessage ?? "";
    const speedBps = modelDownloadSpeedBps ?? 0;
    const availableOfflineCount = inventory.filter((entry) => entry.cached).length;
    if (option.kind === "checkbox") {
        return (<label className="settings-control checkbox-control">
        <input type="checkbox" checked={option.getValue(settings)} disabled={disabled} onChange={(event) => onUpdate(option, event.target.checked)}/>
        <span>{option.label}</span>
      </label>);
    }
    if (option.kind === "select") {
        if (option.key === "transcriptionModel") {
            const selectedModel = transcriptionModelOptions.find((item) => item.value === option.getValue(settings));
            return (<div className="settings-control model-select-control">
          <label className="settings-control">
            <span>{option.label}</span>
            <select aria-label={option.label} value={option.getValue(settings)} disabled={disabled} onChange={(event) => onUpdate(option, event.target.value)}>
              {transcriptionModelOptions.map((item) => {
                    const inventoryEntry = inventory.find((entry) => entry.modelId === item.value);
                    return (<option key={item.value} value={item.value}>
                    {formatModelOptionLabel(item.label, item.downloadSizeBytes ?? inventoryEntry?.sizeBytes ?? 0, inventoryEntry, speedBps)}
                  </option>);
                })}
            </select>
          </label>
          {selectedModel ? (<span className="model-select-details">
              <span>
                {availableOfflineCount > 0
                        ? `${availableOfflineCount}/${transcriptionModelOptions.length} models available offline`
                        : "No transcription models are cached offline yet"}
              </span>
              <span>
                {formatSelectedModelStatus(selectedModel, inventory.find((entry) => entry.modelId === selectedModel.value), speedBps, inventoryMessageText)}
              </span>
              <span>{selectedModel.summary}</span>
            </span>) : null}
          {selectedModel ? (<details className="model-technical-details">
              <summary>Model details</summary>
              <div className="model-select-details">
                <span>{selectedModel.parameters} · {selectedModel.runtime} · {selectedModel.timestampSupport}</span>
                <span>{selectedModel.whyChoose}</span>
                {selectedModel.caution ? <span>{selectedModel.caution}</span> : null}
                <code>{selectedModel.repo}</code>
              </div>
            </details>) : null}
        </div>);
        }
        return (<label className="settings-control">
        <span>{option.label}</span>
        <select aria-label={option.label} value={option.getValue(settings)} disabled={disabled} onChange={(event) => onUpdate(option, event.target.value)}>
          {option.options.map((item) => (<option key={item.value} value={item.value}>
              {item.label}
            </option>))}
        </select>
      </label>);
    }
    if (option.kind === "slider") {
        const value = option.getValue(settings);
        return (<label className="settings-control slider-control">
        <span>{option.label}</span>
        <input aria-label={option.label} type="range" min={option.min} max={option.max} step={option.step} value={value} aria-valuetext={option.valueLabel ? option.valueLabel(value) : String(value)} disabled={disabled} onChange={(event) => onUpdate(option, Number(event.target.value))}/>
        <output>{option.valueLabel ? option.valueLabel(value) : value}</output>
      </label>);
    }
    return (<label className="settings-control">
      <span>{option.label}</span>
      <input aria-label={option.label} type="number" min={option.min} max={option.max} step={option.step} value={option.getValue(settings)} disabled={disabled} onChange={(event) => onUpdate(option, Number(event.target.value))}/>
    </label>);
}
function getActiveSilenceOption(settings: RuntimeSettings) {
    if (settings.vad.mode === "fixed-rms")
        return getOption("fixedSilence");
    if (settings.vad.mode === "rms-zcr")
        return getOption("zcrSilence");
    if (settings.vad.mode === "silero-vad") {
        return getOption("sileroSpeechThreshold");
    }
    if (settings.vad.mode === "transformers-audio-classification") {
        return getOption("mlSpeechThreshold");
    }
    return getOption("adaptiveSilence");
}
function getOption(key: string) {
    const option = settingsOptions.find((item) => item.key === key);
    if (!option)
        throw new Error(`Missing setting option: ${key}`);
    return option;
}
function formatModelOptionLabel(label: string, sizeBytes: number, inventory: ModelInventoryEntry | undefined, downloadSpeedBps: number) {
    const parts = [label];
    if (sizeBytes > 0) {
        parts.push(formatBytes(sizeBytes));
    }
    if (inventory?.cached) {
        parts.push("available offline");
    }
    else if (inventory && inventory.cachedFiles > 0 && inventory.totalFiles > 0) {
        parts.push(`${inventory.cachedFiles}/${inventory.totalFiles} offline`);
    }
    const remainingBytes = Math.max(0, (inventory?.sizeBytes ?? sizeBytes) - (inventory?.cachedBytes ?? 0));
    const etaSeconds = estimateSecondsRemaining(remainingBytes, downloadSpeedBps);
    if (!inventory?.cached && etaSeconds) {
        parts.push(`~${formatDuration(etaSeconds)}`);
    }
    return parts.join(" · ");
}
function formatSelectedModelStatus(model: NonNullable<ReturnType<typeof getTranscriptionModelOption>>, inventory: ModelInventoryEntry | undefined, downloadSpeedBps: number, fallbackMessage: string) {
    if (!inventory) {
        return fallbackMessage || "Checking model cache and download size...";
    }
    const totalBytes = inventory.sizeBytes || model.downloadSizeBytes || 0;
    const remainingBytes = Math.max(0, totalBytes - inventory.cachedBytes);
    const etaSeconds = estimateSecondsRemaining(remainingBytes, downloadSpeedBps);
    const cacheLabel = inventory.cached
        ? "Available offline"
        : inventory.cachedFiles > 0
            ? `Partially available offline (${inventory.cachedFiles}/${inventory.totalFiles} files)`
            : "Not cached for offline use yet";
    const details = [cacheLabel];
    if (totalBytes > 0) {
        details.push(`download ${formatBytes(totalBytes)}`);
    }
    if (!inventory.cached && etaSeconds) {
        details.push(`about ${formatDuration(etaSeconds)} at ${formatBytes(downloadSpeedBps)}/s`);
    }
    return details.join(" · ");
}
