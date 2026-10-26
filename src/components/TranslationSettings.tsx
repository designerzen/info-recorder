import { h, Fragment } from "../ui/dom";
import type { RuntimeSettings, SettingsOption } from "../config/settingsOptions";
import { settingsOptions } from "../config/settingsOptions";
import { translationLanguages } from "../translation/browserTranslator";
import type { createBrowserTranslation } from "../translation/createBrowserTranslation";
export function TranslationSettings({ settings, translation, onUpdate }: {
    settings: RuntimeSettings;
    translation: ReturnType<typeof createBrowserTranslation>;
    onUpdate: (option: SettingsOption, value: string) => void;
}) {
    const update = (key: string, value: string) => {
        translation.disable();
        onUpdate(settingsOptions.find((option) => option.key === key)!, value);
    };
    return (<fieldset className="settings-group">
      <legend>Translation</legend>
      <p className="settings-group-description">Read your transcript in another language using browser translation.</p>
      <div className="settings-group-grid">
        <label className="settings-control checkbox-control">
          <input type="checkbox" checked={translation.enabled || translation.loading} disabled={!translation.supported || (!translation.enabled && !translation.loading &&
            (translation.checking || !translation.targets.some((item) => item.value === settings.translation.targetLanguage)))} onChange={(event) => event.target.checked ? void translation.enable() : translation.disable()}/>
          <span>Enable browser translation</span>
        </label>
        {translation.supported ? <>
          <label className="settings-control">
            <span>Transcript language</span>
            <select aria-label="Transcript language" value={settings.translation.sourceLanguage} onChange={(event) => update("translationSource", event.target.value)}>
              {translationLanguages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select>
          </label>
          <label className="settings-control">
            <span>Translate into</span>
            <select aria-label="Translate into" value={settings.translation.targetLanguage} disabled={translation.checking || translation.targets.length === 0} onChange={(event) => update("translationTarget", event.target.value)}>
              {!translation.targets.some((item) => item.value === settings.translation.targetLanguage)
                ? <option value={settings.translation.targetLanguage}>{translation.checking ? "Checking languages…" : "Choose a supported language"}</option> : null}
              {translation.targets.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select>
          </label>
          <p className="settings-hint">Choose the language of the transcript text. This does not change speech recognition. Language packs may download on first use. Enable translation again after changing languages or reloading.</p>
          {!translation.checking && translation.targets.length === 0 ? <p className="settings-hint">No translation languages are available for this transcript language.</p> : null}
        </> : <p className="settings-hint">The browser Translator API is not available in this browser.</p>}
        {translation.status ? <p className="settings-hint" role="status">{translation.status}</p> : null}
      </div>
    </fieldset>);
}
