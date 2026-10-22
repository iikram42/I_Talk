import { APP_NAME } from '@parley/shared';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Notice } from '../components/ui/Notice';
import { CaptionsIcon, MicIcon, ShieldIcon, TranslateIcon, VideoIcon } from '../components/icons';
import { SiteHeader } from '../components/SiteHeader';
import { useLanguages } from '../lib/useLanguages';

const STEPS = [
  {
    title: 'Create a private room',
    body: 'Pick voice or video and choose which language each of you speaks and wants to hear.',
  },
  {
    title: 'Share the invitation',
    body: 'Send the one-time link. Only one guest can join, and you can revoke it at any time.',
  },
  {
    title: 'Talk naturally',
    body: 'Each person speaks their own language. The other hears a translated voice and sees live captions.',
  },
];

function LanguagePreview() {
  const languages = useLanguages();
  if (languages.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading languages" className="flex flex-wrap gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="h-8 w-24 animate-pulse rounded-full bg-line" />
        ))}
      </div>
    );
  }
  if (languages.status === 'error') {
    return (
      <Notice
        tone="error"
        title="Couldn't load languages"
        action={
          <Button variant="secondary" onClick={languages.retry}>
            Retry
          </Button>
        }
      >
        {languages.message}
      </Notice>
    );
  }
  const { data } = languages;
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-2" aria-label="Supported languages">
        {data.languages.map((l) => (
          <li
            key={l.code}
            className={`rounded-full border px-3 py-1.5 text-sm ${l.available ? 'border-line bg-surface text-ink' : 'border-dashed border-line text-muted'}`}
            title={l.available ? l.code : `${l.code} is not available on this server`}
          >
            {l.nativeName}
            {l.nativeName !== l.name && <span className="ml-1.5 text-muted">{l.name}</span>}
          </li>
        ))}
      </ul>
      {!data.translation.available && (
        <Notice tone="warning" title="Live translation is currently unavailable">
          {data.translation.reason} Calls still connect, but without translated speech or captions.
        </Notice>
      )}
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent-strong">
              <TranslateIcon className="size-4" /> Live speech translation
            </p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
              Real conversations, even when you don't share a language.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              {APP_NAME} connects two people on a private voice or video call. Each of you speaks
              naturally, and the other hears a translated voice with live captions.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" icon={<MicIcon />} onClick={() => navigate('/new?type=voice')}>
                Start a Voice Call
              </Button>
              <Button
                size="lg"
                variant="secondary"
                icon={<VideoIcon />}
                onClick={() => navigate('/new?type=video')}
              >
                Start a Video Call
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted">
              No account needed. Works in current Chrome, Edge, Firefox and Safari.
            </p>
          </div>

          <Card className="p-6">
            <h2 className="text-base font-semibold">Languages</h2>
            <p className="mt-1 mb-5 text-sm text-muted">
              Speech recognition, translation and voices are checked against the AI provider this
              server uses.
            </p>
            <LanguagePreview />
          </Card>
        </section>

        <section id="how-it-works" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className="rounded-[var(--radius-card)] border border-line p-6"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex items-start gap-3 rounded-lg bg-canvas p-4 text-sm text-muted">
              <CaptionsIcon className="mt-0.5 size-5 shrink-0 text-accent" />
              <p>
                Translation is not instantaneous. Expect a short delay after each sentence while it
                is recognized, translated and spoken. Quality and delay depend on the languages,
                background noise, your network and the AI provider.
              </p>
            </div>
          </div>
        </section>

        <section id="privacy" className="border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[auto_1fr]">
            <ShieldIcon className="size-10 text-accent" />
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Privacy and security</h2>
              <ul className="mt-5 grid gap-4 text-sm text-muted sm:grid-cols-2">
                <li>
                  <strong className="block text-ink">Private rooms</strong>
                  Rooms use unguessable links, allow exactly two people, and the server checks every
                  request.
                </li>
                <li>
                  <strong className="block text-ink">Encrypted media</strong>
                  Audio and video travel between you over encrypted WebRTC connections, directly or
                  through a relay.
                </li>
                <li>
                  <strong className="block text-ink">AI processing</strong>
                  To translate, your microphone audio is sent through our server to an external AI
                  provider (Google Cloud). This is not end-to-end encrypted.
                </li>
                <li>
                  <strong className="block text-ink">No recordings</strong>
                  We do not record or store audio, video, transcripts or translations. Room details
                  are deleted a few days after a call ends.
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        {APP_NAME} · Peer-to-peer connections can reveal your network address to the other
        participant.
      </footer>
    </div>
  );
}
