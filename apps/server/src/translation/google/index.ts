import { v2 as speechV2 } from '@google-cloud/speech';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { v2 as translateV2 } from '@google-cloud/translate';
import type { Config } from '../../config.js';
import type {
  ProviderCapabilities,
  RecognitionHandlers,
  RecognitionStream,
  SpeechProviders,
} from '../providers.js';

interface ClientOptions {
  [key: string]: string | object | undefined;
  projectId?: string;
  credentials?: { client_email: string; private_key: string };
}

function clientOptions(config: Config): ClientOptions {
  const options: ClientOptions = {};
  if (config.GOOGLE_CLOUD_PROJECT) options.projectId = config.GOOGLE_CLOUD_PROJECT;
  if (config.GOOGLE_CREDENTIALS_JSON) {
    const key = JSON.parse(config.GOOGLE_CREDENTIALS_JSON) as {
      client_email: string;
      private_key: string;
      project_id?: string;
    };
    options.credentials = { client_email: key.client_email, private_key: key.private_key };
    options.projectId ??= key.project_id;
  }
  return options;
}

function durationToMs(
  d: { seconds?: number | string | Long | null; nanos?: number | null } | null | undefined,
) {
  if (!d) return undefined;
  return Number(d.seconds ?? 0) * 1000 + Math.round((d.nanos ?? 0) / 1e6);
}
type Long = { toString(): string };

/** Google Cloud Speech-to-Text v2 (streaming), Cloud Translation (basic), and Text-to-Speech. */
export function createGoogleProviders(config: Config): SpeechProviders {
  const options = clientOptions(config);
  const location = config.GOOGLE_STT_LOCATION;
  const speech = new speechV2.SpeechClient({
    ...options,
    ...(location === 'global' ? {} : { apiEndpoint: `${location}-speech.googleapis.com` }),
  });
  const translate = new translateV2.Translate(options);
  const tts = new TextToSpeechClient(options);

  async function recognizerPath(): Promise<string> {
    const projectId = options.projectId ?? (await speech.getProjectId());
    return `projects/${projectId}/locations/${location}/recognizers/_`;
  }
  const recognizer = recognizerPath();

  return {
    name: 'google',
    stt: {
      openStream(
        { languageCode, sampleRateHertz },
        handlers: RecognitionHandlers,
      ): RecognitionStream {
        const stream = speech._streamingRecognize();
        let closed = false;
        const pending: Buffer[] = [];
        let configured = false;

        stream.on(
          'data',
          (response: {
            results?: Array<{
              alternatives?: Array<{ transcript?: string | null }> | null;
              isFinal?: boolean | null;
              resultEndOffset?: {
                seconds?: number | string | Long | null;
                nanos?: number | null;
              } | null;
            }> | null;
          }) => {
            for (const result of response.results ?? []) {
              const text = result.alternatives?.[0]?.transcript ?? '';
              if (!text.trim()) continue;
              handlers.onResult({
                text,
                isFinal: Boolean(result.isFinal),
                endOffsetMs: durationToMs(result.resultEndOffset),
              });
            }
          },
        );
        stream.on('error', (err: Error) => {
          if (!closed) handlers.onError(err);
        });
        stream.on('end', () => {
          closed = true;
          handlers.onClose();
        });

        recognizer.then(
          (path) => {
            if (closed) return;
            stream.write({
              recognizer: path,
              streamingConfig: {
                config: {
                  explicitDecodingConfig: {
                    encoding: 'LINEAR16',
                    sampleRateHertz,
                    audioChannelCount: 1,
                  },
                  languageCodes: [languageCode],
                  model: config.GOOGLE_STT_MODEL,
                  features: { enableAutomaticPunctuation: true },
                },
                streamingFeatures: { interimResults: true },
              },
            });
            configured = true;
            for (const chunk of pending.splice(0)) stream.write({ audio: chunk });
          },
          (err: unknown) => handlers.onError(err instanceof Error ? err : new Error(String(err))),
        );

        return {
          write(pcm16) {
            if (closed) return;
            if (configured) stream.write({ audio: pcm16 });
            else pending.push(pcm16);
          },
          end() {
            if (!closed) stream.end();
          },
          destroy() {
            closed = true;
            stream.cancel();
            stream.destroy();
          },
        };
      },
    },
    translation: {
      async translate(text, from, to, signal) {
        signal.throwIfAborted();
        const [translated] = await translate.translate(text, { from, to, format: 'text' });
        signal.throwIfAborted();
        return translated;
      },
    },
    tts: {
      async synthesize(text, languageCode, voiceName, signal) {
        signal.throwIfAborted();
        const [response] = await tts.synthesizeSpeech(
          {
            input: { text },
            voice: { languageCode, name: voiceName },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 },
          },
          { timeout: 10_000 },
        );
        signal.throwIfAborted();
        if (!response.audioContent) throw new Error('Text-to-Speech returned no audio');
        return { audio: Buffer.from(response.audioContent as Uint8Array), mimeType: 'audio/mpeg' };
      },
    },
    async capabilities(): Promise<ProviderCapabilities> {
      const [[languages], [voices]] = await Promise.all([
        translate.getLanguages(),
        tts.listVoices({}),
      ]);
      return {
        translationLanguages: new Set(languages.map((l) => l.code)),
        voices: new Set((voices.voices ?? []).map((v) => v.name ?? '').filter(Boolean)),
      };
    },
    async close() {
      await Promise.allSettled([speech.close(), tts.close()]);
    },
  };
}
