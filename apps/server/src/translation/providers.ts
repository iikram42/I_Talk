/** Provider-neutral interfaces for the speech pipeline. Implementations live in sibling folders. */

export interface RecognitionResult {
  text: string;
  isFinal: boolean;
  /** Offset of the end of this result within the audio stream, if the provider reports it. */
  endOffsetMs?: number;
}

export interface RecognitionHandlers {
  onResult(result: RecognitionResult): void;
  /** Fatal stream error. The pipeline decides whether to restart. */
  onError(error: Error): void;
  /** The provider closed the stream (e.g. stream time limit or idle timeout). */
  onClose(): void;
}

export interface RecognitionStream {
  write(pcm16: Buffer): void;
  /** Half-closes the stream; remaining results still arrive before `onClose`. */
  end(): void;
  /** Tears the stream down immediately. */
  destroy(): void;
}

export interface SpeechToTextProvider {
  /** Opens a streaming session for 16-bit little-endian mono PCM. */
  openStream(
    options: { languageCode: string; sampleRateHertz: number },
    handlers: RecognitionHandlers,
  ): RecognitionStream;
}

export interface TranslationProvider {
  translate(text: string, from: string, to: string, signal: AbortSignal): Promise<string>;
}

export interface SynthesizedAudio {
  audio: Buffer;
  mimeType: string;
}

export interface TextToSpeechProvider {
  synthesize(text: string, languageCode: string, voiceName: string, signal: AbortSignal): Promise<SynthesizedAudio>;
}

export interface ProviderCapabilities {
  /** Translation language codes (ISO-639) the account can use. */
  translationLanguages: Set<string>;
  /** Voice names the account can use. */
  voices: Set<string>;
}

export interface SpeechProviders {
  name: string;
  stt: SpeechToTextProvider;
  translation: TranslationProvider;
  tts: TextToSpeechProvider;
  /** Queries the live provider for supported languages and voices. */
  capabilities(): Promise<ProviderCapabilities>;
  close(): Promise<void>;
}
