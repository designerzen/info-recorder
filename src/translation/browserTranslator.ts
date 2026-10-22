// Chrome currently has no API to enumerate languages. Probe its documented list
// for each selected source language rather than assuming every pair is supported.
export const translationLanguages = [
  ["ar", "Arabic"], ["bg", "Bulgarian"], ["bn", "Bengali"], ["zh", "Chinese"],
  ["zh-Hant", "Chinese (Traditional)"], ["hr", "Croatian"], ["cs", "Czech"],
  ["da", "Danish"], ["nl", "Dutch"], ["en", "English"], ["fi", "Finnish"],
  ["fr", "French"], ["de", "German"], ["el", "Greek"], ["he", "Hebrew"],
  ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"], ["it", "Italian"],
  ["ja", "Japanese"], ["kn", "Kannada"], ["ko", "Korean"], ["lt", "Lithuanian"],
  ["mr", "Marathi"], ["no", "Norwegian"], ["pl", "Polish"], ["pt", "Portuguese"],
  ["ro", "Romanian"], ["ru", "Russian"], ["sk", "Slovak"], ["sl", "Slovenian"],
  ["es", "Spanish"], ["sv", "Swedish"], ["ta", "Tamil"], ["te", "Telugu"],
  ["th", "Thai"], ["tr", "Turkish"], ["uk", "Ukrainian"], ["vi", "Vietnamese"]
].map(([value, label]) => ({ value, label }));

export type TranslationAvailability = "unavailable" | "downloadable" | "downloading" | "available";
export type BrowserTranslator = {
  translate: (text: string, options?: { signal?: AbortSignal }) => Promise<string>;
  destroy: () => void;
};
export type TranslatorApi = {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<TranslationAvailability>;
  create: (options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (monitor: { addEventListener: (type: "downloadprogress", listener: (event: { loaded: number }) => void) => void }) => void;
  }) => Promise<BrowserTranslator>;
};

export function getTranslatorApi(): TranslatorApi | undefined {
  return (globalThis as typeof globalThis & { Translator?: TranslatorApi }).Translator;
}

export async function getTranslationTargets(api: TranslatorApi, sourceLanguage: string) {
  const results = await Promise.all(translationLanguages.map(async (language) => {
    if (language.value === sourceLanguage) return null;
    try {
      const availability = await api.availability({ sourceLanguage, targetLanguage: language.value });
      return availability === "unavailable" ? null : { ...language, availability };
    } catch {
      return null;
    }
  }));
  return results.filter((result): result is NonNullable<typeof result> => result !== null);
}
