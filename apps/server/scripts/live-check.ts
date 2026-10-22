/**
 * Live provider check: synthesizes a sentence in each language with the real Text-to-Speech
 * service, streams it in real time through the real pipeline (recognition → translation →
 * synthesis) and reports what came out and how long each stage took.
 *
 *   npm run live-check -w @parley/server            # Hindi ↔ Indonesian
 *   npm run live-check -w @parley/server -- en-US es-ES
 *
 * Requires GOOGLE_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS) and GOOGLE_CLOUD_PROJECT.
 */
import { AUDIO_SAMPLE_RATE, type ServerMessage, findLanguage } from '@parley/shared';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { loadConfig } from '../src/config.js';
import { createGoogleProviders } from '../src/translation/google/index.js';
import { LoopGuard } from '../src/translation/loopGuard.js';
import { SpeakerPipeline } from '../src/translation/pipeline.js';

const SAMPLES: Record<string, string> = {
  'hi-IN': 'नमस्ते, आज मौसम बहुत अच्छा है। क्या आप कल मुझसे मिल सकते हैं?',
  'id-ID': 'Halo, apa kabar? Saya ingin memesan dua tiket kereta untuk besok pagi.',
  'en-US': 'Hello, how are you? I would like to book a table for two tonight.',
  'es-ES': 'Hola, ¿qué tal? Me gustaría reservar una mesa para dos esta noche.',
};

const config = loadConfig({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused/unused',
});
const [a = 'hi-IN', b = 'id-ID'] = process.argv.slice(2);
const providers = createGoogleProviders(config);
const log = {
  info: () => {},
  warn: (o: object, m?: string) => console.warn('  warn:', m, o),
  error: (o: object, m?: string) => console.error('  error:', m, o),
};

function pcmFromWav(wav: Buffer): Buffer {
  const dataAt = wav.indexOf('data');
  return dataAt >= 0 ? wav.subarray(dataAt + 8) : wav;
}

async function speak(code: string, text: string): Promise<Buffer> {
  const client = new TextToSpeechClient(
    config.GOOGLE_CREDENTIALS_JSON
      ? {
          credentials: JSON.parse(config.GOOGLE_CREDENTIALS_JSON),
          projectId: config.GOOGLE_CLOUD_PROJECT,
        }
      : {},
  );
  const [res] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: code, name: findLanguage(code)!.ttsVoice },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: AUDIO_SAMPLE_RATE },
  });
  await client.close();
  return pcmFromWav(Buffer.from(res.audioContent as Uint8Array));
}

async function run(from: string, to: string) {
  const text = SAMPLES[from];
  if (!text) throw new Error(`No sample sentence for ${from}`);
  console.log(`\n${from} → ${to}\n  said:        ${text}`);
  const pcm = Buffer.concat([await speak(from, text), Buffer.alloc(AUDIO_SAMPLE_RATE * 2 * 2)]); // + 2 s silence
  const translations: Extract<ServerMessage, { type: 'translation' }>[] = [];
  const audio: Extract<ServerMessage, { type: 'translated-audio' }>[] = [];
  const statuses: string[] = [];
  const pipeline = new SpeakerPipeline({
    speaker: { id: 'speaker', spokenLanguage: from },
    listener: { id: 'listener', outputLanguage: to },
    providers,
    guard: new LoopGuard(),
    sendToSpeaker: (m) => m.type === 'translated-audio' && audio.push(m),
    broadcast: (m) => {
      if (m.type === 'translation') translations.push(m);
      if (m.type === 'translation-status')
        statuses.push(`${m.state}${m.message ? `: ${m.message}` : ''}`);
    },
    log,
  });
  const chunk = AUDIO_SAMPLE_RATE * 2 * 0.1;
  for (let i = 0; i < pcm.length; i += chunk) {
    pipeline.pushAudio(pcm.subarray(i, i + chunk));
    await new Promise((r) => setTimeout(r, 100)); // real-time pacing
  }
  const deadline = Date.now() + 15_000;
  while (audio.length < translations.length || translations.length === 0) {
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  pipeline.stop();
  for (const t of translations)
    console.log(`  recognized:  ${t.sourceText}\n  translated:  ${t.text}`);
  for (const a of audio) {
    const l = a.latency;
    console.log(
      `  audio:       ${(Buffer.from(a.audioBase64, 'base64').length / 1024).toFixed(1)} KB ${a.mimeType}` +
        ` | recognition ${l.recognitionMs} ms, translation ${l.translationMs} ms, synthesis ${l.synthesisMs} ms, total ${l.totalMs} ms`,
    );
  }
  if (statuses.some((s) => s.startsWith('error')))
    console.log(`  status:      ${statuses.join(', ')}`);
  return translations.length > 0 && audio.length === translations.length;
}

const caps = await providers.capabilities();
for (const code of [a, b]) {
  const lang = findLanguage(code)!;
  console.log(
    `${code}: translation ${caps.translationLanguages.has(lang.translationCode) ? 'ok' : 'MISSING'}, voice ${lang.ttsVoice} ${caps.voices.has(lang.ttsVoice) ? 'ok' : 'MISSING'}`,
  );
}
const ok = (await run(a, b)) && (await run(b, a));
await providers.close();
console.log(ok ? '\nLIVE CHECK PASSED' : '\nLIVE CHECK FAILED');
process.exit(ok ? 0 : 1);
