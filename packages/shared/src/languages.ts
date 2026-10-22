/**
 * Languages offered in the UI. Every entry was checked against the Google Cloud docs:
 * Speech-to-Text v2 (`long` model, `global` location), Cloud Translation, and the named
 * Text-to-Speech voice. At startup the server re-checks translation and voice support with the
 * live provider and hides anything the configured account cannot serve.
 */
export interface LanguageDefinition {
  /** BCP-47 code used for speech recognition and synthesis. */
  code: string;
  /** English display name. */
  name: string;
  /** Name in the language itself. */
  nativeName: string;
  /** ISO-639 code used by the translation service. */
  translationCode: string;
  /** Text-to-Speech voice used when speaking this language. */
  ttsVoice: string;
}

export const LANGUAGES: readonly LanguageDefinition[] = [
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', translationCode: 'hi', ttsVoice: 'hi-IN-Neural2-A' },
  { code: 'id-ID', name: 'Indonesian', nativeName: 'Bahasa Indonesia', translationCode: 'id', ttsVoice: 'id-ID-Wavenet-A' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English', translationCode: 'en', ttsVoice: 'en-US-Neural2-F' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español', translationCode: 'es', ttsVoice: 'es-ES-Neural2-A' },
  { code: 'fr-FR', name: 'French (France)', nativeName: 'Français', translationCode: 'fr', ttsVoice: 'fr-FR-Neural2-F' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', translationCode: 'de', ttsVoice: 'de-DE-Neural2-G' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português', translationCode: 'pt', ttsVoice: 'pt-BR-Neural2-A' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', translationCode: 'ja', ttsVoice: 'ja-JP-Neural2-B' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어', translationCode: 'ko', ttsVoice: 'ko-KR-Neural2-A' },
  { code: 'vi-VN', name: 'Vietnamese', nativeName: 'Tiếng Việt', translationCode: 'vi', ttsVoice: 'vi-VN-Neural2-A' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்', translationCode: 'ta', ttsVoice: 'ta-IN-Wavenet-A' },
  { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', translationCode: 'tr', ttsVoice: 'tr-TR-Wavenet-A' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export function findLanguage(code: string): LanguageDefinition | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function languageName(code: string): string {
  return findLanguage(code)?.name ?? code;
}
