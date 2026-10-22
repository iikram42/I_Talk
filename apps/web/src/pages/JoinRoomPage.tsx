import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type InvitePreviewResponse, languageName } from '@parley/shared';
import { LanguageSelect } from '../components/LanguageSelect';
import { CenteredState, PageShell } from '../components/PageShell';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, inputClass } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';
import { ApiError, api } from '../lib/api';
import { loadRoomSession, saveRoomSession } from '../lib/session';
import { useLanguages } from '../lib/useLanguages';

const INVITE_KEY = (roomId: string) => `parley:invite:${roomId}`;

/** Reads the invitation secret from the URL fragment, then removes it from the address bar. */
function useInviteToken(roomId: string): string | null {
  const [token] = useState(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) {
      try {
        sessionStorage.setItem(INVITE_KEY(roomId), fromHash);
      } catch {
        // Without storage, a reload just needs the original link again.
      }
      return fromHash;
    }
    try {
      return sessionStorage.getItem(INVITE_KEY(roomId));
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

const INVITE_ERRORS: Record<string, { title: string; body: string }> = {
  invite_invalid: {
    title: 'This link isn’t valid',
    body: 'Check that you copied the whole invitation link, or ask for a new one.',
  },
  invite_expired: {
    title: 'This invitation has expired',
    body: 'Ask the host to create a new room and send you a fresh link.',
  },
  invite_revoked: {
    title: 'This invitation was revoked',
    body: 'The host cancelled this link. Ask them for a new one.',
  },
  room_full: {
    title: 'This call is full',
    body: 'Someone else has already joined. Rooms are limited to two people.',
  },
  room_ended: {
    title: 'This call has ended',
    body: 'The host ended this call. Ask them for a new link to talk again.',
  },
};

export function JoinRoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const inviteToken = useInviteToken(roomId);
  const languages = useLanguages();
  const [preview, setPreview] = useState<InvitePreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [name, setName] = useState('');
  const [spoken, setSpoken] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const existing = loadRoomSession(roomId) !== null;

  useEffect(() => {
    if (!inviteToken || existing) return;
    let cancelled = false;
    api.previewInvite(roomId, inviteToken).then(
      (p) => !cancelled && setPreview(p),
      (err: ApiError) => !cancelled && setPreviewError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [roomId, inviteToken, existing]);

  if (existing) {
    return (
      <PageShell>
        <CenteredState>
          <p className="text-muted">You’ve already joined this call in this tab.</p>
          <Button onClick={() => navigate(`/room/${roomId}`)}>Return to the call</Button>
        </CenteredState>
      </PageShell>
    );
  }

  const failure = !inviteToken ? new ApiError('invite_invalid', '', 404) : previewError;
  if (failure) {
    const copy = INVITE_ERRORS[failure.code] ?? {
      title: 'Couldn’t open this invitation',
      body: failure.message,
    };
    return (
      <PageShell>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted">{copy.body}</p>
          <Link
            to="/"
            className="mt-6 inline-block text-sm font-medium text-accent hover:underline"
          >
            Start your own call
          </Link>
        </Card>
      </PageShell>
    );
  }

  if (!preview || languages.status === 'loading') {
    return (
      <PageShell>
        <CenteredState>
          <Spinner label="Checking invitation…" />
        </CenteredState>
      </PageShell>
    );
  }
  if (languages.status === 'error') {
    return (
      <PageShell>
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
      </PageShell>
    );
  }

  const spokenValue = spoken ?? preview.room.expectedGuestLanguage;
  const outputValue = output ?? spoken ?? preview.room.expectedGuestOutputLanguage;
  const isVideo = preview.room.callType === 'video';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Enter the name the host will see');
      return;
    }
    setNameError(undefined);
    setJoining(true);
    setJoinError(null);
    try {
      const result = await api.joinRoom(roomId, {
        inviteToken: inviteToken!,
        displayName: name.trim(),
        spokenLanguage: spokenValue,
        outputLanguage: outputValue,
      });
      saveRoomSession(roomId, { participantToken: result.participantToken });
      try {
        sessionStorage.removeItem(INVITE_KEY(roomId));
      } catch {
        // Nothing stored.
      }
      navigate(`/room/${roomId}`);
    } catch (err) {
      const apiErr = err as ApiError;
      if (INVITE_ERRORS[apiErr.code]) setPreviewError(apiErr);
      else setJoinError(apiErr.message);
      setJoining(false);
    }
  }

  return (
    <PageShell>
      <p className="text-sm font-medium text-accent">You're invited</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {preview.host.displayName} invited you to a {isVideo ? 'video' : 'voice'} call
      </h1>
      {preview.room.title && <p className="mt-1 text-muted">“{preview.room.title}”</p>}

      <Card className="mt-6 grid grid-cols-2 gap-4 p-5 text-sm">
        <div>
          <p className="text-muted">{preview.host.displayName} speaks</p>
          <p className="font-medium">{languageName(preview.host.spokenLanguage)}</p>
        </div>
        <div>
          <p className="text-muted">You'll hear them in</p>
          <p className="font-medium">{languageName(outputValue)}</p>
        </div>
      </Card>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
        <Field label="Your name" error={nameError}>
          {(p) => (
            <input
              {...p}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="nickname"
              autoFocus
            />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="I speak">
            {(p) => (
              <LanguageSelect
                {...p}
                value={spokenValue}
                onChange={setSpoken}
                options={languages.data.languages}
              />
            )}
          </Field>
          <Field label="I want to hear">
            {(p) => (
              <LanguageSelect
                {...p}
                value={outputValue}
                onChange={setOutput}
                options={languages.data.languages}
              />
            )}
          </Field>
        </div>

        <Notice tone="info" title={isVideo ? 'Camera and microphone' : 'Microphone'}>
          Your browser will ask for {isVideo ? 'camera and microphone' : 'microphone'} access when
          you join. To translate what you say, your microphone audio is processed by an external AI
          provider during the call. Nothing is recorded.
        </Notice>

        {joinError && (
          <Notice tone="error" title="Couldn't join">
            {joinError}
          </Notice>
        )}
        <Button type="submit" size="lg" loading={joining}>
          Join call
        </Button>
      </form>
    </PageShell>
  );
}
