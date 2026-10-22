import { LANGUAGES, type TranslationAvailability, findLanguage } from '@parley/shared';
import type { Config } from '../config.js';
import { createFakeProviders } from './fake.js';
import { createGoogleProviders } from './google/index.js';
import type { Logger } from './pipeline.js';
import type { ProviderCapabilities, SpeechProviders } from './providers.js';
import { withTimeout } from './timeout.js';

/**
 * Owns the configured AI providers and what they can actually do.
 * Calls still work when translation is unavailable; the UI says so.
 */
export class TranslationService {
  private capabilities: ProviderCapabilities | null = null;
  private lastError: string | undefined;
  private retryTimer: NodeJS.Timeout | undefined;

  private constructor(
    readonly providers: SpeechProviders | null,
    private readonly log: Logger,
    private readonly unavailableReason?: string,
  ) {}

  static create(config: Config, log: Logger, override?: SpeechProviders): TranslationService {
    if (override) return new TranslationService(override, log);
    if (config.AI_PROVIDER === 'fake') return new TranslationService(createFakeProviders(), log);
    if (config.AI_PROVIDER === 'none') {
      return new TranslationService(null, log, 'Translation is turned off on this server.');
    }
    const hasCredentials = Boolean(config.GOOGLE_CREDENTIALS_JSON || config.GOOGLE_APPLICATION_CREDENTIALS);
    if (!hasCredentials) {
      return new TranslationService(null, log, 'No AI provider credentials are configured on this server.');
    }
    return new TranslationService(createGoogleProviders(config), log);
  }

  /** Verifies provider access and supported languages, retrying in the background on failure. */
  async init(): Promise<void> {
    if (!this.providers) return;
    try {
      this.capabilities = await withTimeout('capability check', 15_000, () => this.providers!.capabilities());
      this.lastError = undefined;
      const unsupported = LANGUAGES.filter((l) => !this.supports(l.code)).map((l) => l.code);
      this.log.info({ provider: this.providers.name, unsupported }, 'AI provider ready');
    } catch (err) {
      this.lastError = 'The AI provider could not be reached.';
      this.log.error({ err: (err as Error).message }, 'AI provider capability check failed; retrying in 60s');
      this.retryTimer = setTimeout(() => void this.init(), 60_000);
      this.retryTimer.unref();
    }
  }

  get ready(): boolean {
    return this.providers !== null && this.capabilities !== null;
  }

  availability(): TranslationAvailability {
    if (!this.providers) return { available: false, provider: 'none', reason: this.unavailableReason ?? 'Unavailable' };
    if (!this.capabilities) {
      return { available: false, provider: this.providers.name, reason: this.lastError ?? 'Connecting to the AI provider…' };
    }
    return { available: true, provider: this.providers.name };
  }

  /** Whether the provider can recognize, translate and speak this language. */
  supports(code: string): boolean {
    const lang = findLanguage(code);
    if (!lang) return false;
    // Until the provider has confirmed its capabilities, trust the documented list.
    if (!this.capabilities) return true;
    return this.capabilities.translationLanguages.has(lang.translationCode) && this.capabilities.voices.has(lang.ttsVoice);
  }

  async close(): Promise<void> {
    clearTimeout(this.retryTimer);
    await this.providers?.close();
  }
}
