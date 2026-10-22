import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { type CallType, EXPIRY_OPTIONS_MINUTES, languageName } from '@parley/shared';
import { LanguageSelect } from '../components/LanguageSelect';
import { CenteredState, PageShell } from '../components/PageShell';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, inputClass } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';
import { MicIcon, VideoIcon } from '../components/icons';
import { api } from '../lib/api';
import { saveRoomSession } from '../lib/session';
import { useLanguages } from '../lib/useLanguages';

const EXPIRY_LABELS: Record<number, string> = { 15: '15 minutes', 60: '1 hour', 240: '4 hours', 1440: '24 hours' };

export function CreateRoomPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const languages = useLanguages();
  const [callType, setCallType] = useState<CallType>(params.get('type') === 'video' ? 'video' : 'voice');
  const [hostLanguage, setHostLanguage] = useState('hi-IN');
  const [guestLanguage, setGuestLanguage] = useState('id-ID');
  // Output languages follow the spoken languages until the user picks something else.
  const [hostOutput, setHostOutput] = useState<string | null>(null);
  const [guestOutput, setGuestOutput] = useState<string | null>(null);
  const [hostName, setHostName] = useState('');
  const [title, setTitle] = useState('');
  const [expiry, setExpiry] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (languages.status === 'loading') {
    return (
      <PageShell>
        <CenteredState>
          <Spinner label="Loading languages…" />
        </CenteredState>
      </PageShell>
    );
  }
  if (languages.status === 'error') {
    return (
      <PageShell>
        <Notice tone="error" title="Couldn't load languages" action={<Button variant="secondary" onClick={languages.retry}>Retry</Button>}>
          {languages.message}
        </Notice>
      </PageShell>
    );
  }

  const options = languages.data.languages;
  const translation = languages.data.translation;
  const hostOutputValue = hostOutput ?? hostLanguage;
  const guestOutputValue = guestOutput ?? guestLanguage;
  const unavailable = [hostLanguage, guestLanguage, hostOutputValue, guestOutputValue].filter(
    (code) => !options.find((o) => o.code === code)?.available,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (unavailable.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createRoom({
        callType,
        hostLanguage,
        hostOutputLanguage: hostOutputValue,
        guestLanguage,
        guestOutputLanguage: guestOutputValue,
        hostName: hostName.trim() || undefined,
        title: title.trim() || undefined,
        expiresInMinutes: expiry,
      });
      saveRoomSession(result.room.id, { participantToken: result.participantToken, inviteToken: result.inviteToken });
      navigate(`/room/${result.room.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <h1 className="text-2xl font-semibold tracking-tight">Create a room</h1>
      <p className="mt-1 text-sm text-muted">You'll get a private link to send to the other person.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-6" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Call type</legend>
          <div className="grid grid-cols-2 gap-3" role="radiogroup">
            {(['voice', 'video'] as const).map((type) => (
              <label
                key={type}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  callType === type ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line bg-surface'
                }`}
              >
                <input type="radio" name="callType" value={type} checked={callType === type} onChange={() => setCallType(type)} className="sr-only" />
                {type === 'voice' ? <MicIcon /> : <VideoIcon />}
                {type === 'voice' ? 'Voice call' : 'Video call'}
              </label>
            ))}
          </div>
        </fieldset>

        <Card className="grid gap-5 p-5 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">You</h2>
          <Field label="I speak">
            {(p) => <LanguageSelect {...p} value={hostLanguage} onChange={setHostLanguage} options={options} />}
          </Field>
          <Field label="I want to hear" hint="Language of the translated voice you hear">
            {(p) => <LanguageSelect {...p} value={hostOutputValue} onChange={setHostOutput} options={options} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Your name (optional)" hint="Shown to the other person">
              {(p) => <input {...p} className={inputClass} value={hostName} onChange={(e) => setHostName(e.target.value)} maxLength={40} autoComplete="nickname" />}
            </Field>
          </div>
        </Card>

        <Card className="grid gap-5 p-5 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">The other person</h2>
          <Field label="They speak">
            {(p) => <LanguageSelect {...p} value={guestLanguage} onChange={setGuestLanguage} options={options} />}
          </Field>
          <Field label="They want to hear" hint="They can confirm or change this when joining">
            {(p) => <LanguageSelect {...p} value={guestOutputValue} onChange={setGuestOutput} options={options} />}
          </Field>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Room title (optional)">
            {(p) => <input {...p} className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />}
          </Field>
          <Field label="Invitation expires after">
            {(p) => (
              <select {...p} className={inputClass} value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
                {EXPIRY_OPTIONS_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {EXPIRY_LABELS[m]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        {!translation.available && (
          <Notice tone="warning" title="Live translation is currently unavailable">
            {translation.reason} You can still create the room; the call will connect without translation.
          </Notice>
        )}
        {unavailable.length > 0 && (
          <Notice tone="error">Not available on this server: {unavailable.map(languageName).join(', ')}.</Notice>
        )}
        {error && <Notice tone="error" title="Couldn't create the room">{error}</Notice>}

        <Button type="submit" size="lg" loading={submitting} disabled={unavailable.length > 0}>
          Create room
        </Button>
      </form>
    </PageShell>
  );
}
