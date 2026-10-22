import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { SessionResponse } from '@parley/shared';
import { CenteredState, PageShell } from '../components/PageShell';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Notice } from '../components/ui/Notice';
import { Spinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { CallScreen } from '../call/CallScreen';
import { useCall } from '../call/useCall';
import { type MediaError, useLocalMedia } from '../call/useLocalMedia';
import { type ApiError, api } from '../lib/api';
import { clearRoomSession, loadRoomSession } from '../lib/session';

const END_COPY: Record<string, string> = {
  ended: 'The call has ended.',
  cancelled: 'The host cancelled this call before anyone joined.',
  expired: 'This room expired.',
  abandoned: 'This call ended after both people left.',
};

function EndedView({ reason }: { reason: string }) {
  return (
    <PageShell>
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">Call ended</h1>
        <p className="mt-2 text-sm text-muted">{END_COPY[reason] ?? END_COPY.ended}</p>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Start a new call
        </Link>
      </Card>
    </PageShell>
  );
}

function MediaErrorView({
  error,
  isVideo,
  onRetry,
}: {
  error: MediaError;
  isVideo: boolean;
  onRetry: () => void;
}) {
  const device = isVideo ? 'camera and microphone' : 'microphone';
  const copy: Record<MediaError['kind'], { title: string; body: string }> = {
    denied: {
      title: `${isVideo ? 'Camera and microphone' : 'Microphone'} access is blocked`,
      body: `Allow access to your ${device} using the icon in your browser's address bar, then try again.`,
    },
    'not-found': {
      title: 'No microphone found',
      body: 'Connect a microphone or headset, then try again.',
    },
    'in-use': {
      title: 'Your device is busy',
      body: `Another app may be using your ${device}. Close it and try again.`,
    },
    unsupported: {
      title: 'This browser can’t make calls',
      body: 'Use a recent version of Chrome, Edge, Firefox or Safari over HTTPS.',
    },
    disconnected: {
      title: `Your ${error.kind === 'disconnected' ? error.device : 'device'} was disconnected`,
      body: 'Reconnect it, then continue the call.',
    },
    unknown: {
      title: 'Couldn’t start your microphone',
      body: error.kind === 'unknown' ? error.message : '',
    },
  };
  const { title, body } = copy[error.kind];
  return (
    <PageShell>
      <Card className="p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <div className="mt-6 flex gap-3">
          {error.kind !== 'unsupported' && <Button onClick={onRetry}>Try again</Button>}
          <Link
            to="/"
            className="inline-flex h-10 items-center px-2 text-sm text-muted hover:text-ink"
          >
            Leave
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}

function ActiveCall({
  roomId,
  token,
  inviteToken,
  session,
}: {
  roomId: string;
  token: string;
  inviteToken?: string;
  session: SessionResponse;
}) {
  const toast = useToast();
  const media = useLocalMedia(session.room.callType);
  const call = useCall(roomId, token, session, media);
  const [ended, setEnded] = useState<string | null>(null);
  const endedReason = ended ?? call.endedReason;

  useEffect(() => {
    if (endedReason) clearRoomSession(roomId);
  }, [endedReason, roomId]);

  const endCall = useCallback(async () => {
    try {
      const { room } = await api.endRoom(roomId, token);
      setEnded(room.endReason ?? 'ended');
    } catch (err) {
      toast((err as Error).message);
    }
  }, [roomId, token, toast]);

  if (endedReason) return <EndedView reason={endedReason} />;
  if (call.socketStatus === 'closed' && call.closeCode === 4409) {
    return (
      <PageShell>
        <Notice tone="warning" title="This call is open in another tab">
          Close this tab and continue there.
        </Notice>
      </PageShell>
    );
  }
  if (media.status === 'error' && media.error) {
    return (
      <MediaErrorView
        error={media.error}
        isVideo={session.room.callType === 'video'}
        onRetry={media.retry}
      />
    );
  }
  if (media.status !== 'ready') {
    return (
      <PageShell>
        <CenteredState>
          <Spinner
            label={`Waiting for ${session.room.callType === 'video' ? 'camera and microphone' : 'microphone'} permission…`}
          />
          <p className="max-w-sm text-sm text-muted">
            Your browser will ask for access. Your audio is used for the call and for live
            translation; nothing is recorded.
          </p>
        </CenteredState>
      </PageShell>
    );
  }
  return (
    <CallScreen
      session={session}
      media={media}
      call={call}
      inviteToken={inviteToken}
      onRevoke={async () => {
        try {
          await api.revokeInvite(roomId, token);
        } catch (err) {
          toast((err as Error).message);
        }
      }}
      onEnd={() => void endCall()}
    />
  );
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [stored] = useState(() => loadRoomSession(roomId));
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    api.session(roomId, stored.participantToken).then(
      (s) => !cancelled && setSession(s),
      (err: ApiError) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [roomId, stored, attempt]);

  if (!stored || error?.code === 'unauthorized' || error?.code === 'not_found') {
    return (
      <PageShell>
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold">You’re not part of this call</h1>
          <p className="mt-2 text-sm text-muted">
            Open the invitation link you were sent, or start a new call.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block text-sm font-medium text-accent hover:underline"
          >
            Go to the home page
          </Link>
        </Card>
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        <Notice
          tone="error"
          title="Couldn't load the call"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          }
        >
          {error.message}
        </Notice>
      </PageShell>
    );
  }
  if (!session) {
    return (
      <PageShell>
        <CenteredState>
          <Spinner label="Loading call…" />
        </CenteredState>
      </PageShell>
    );
  }
  if (session.room.status === 'ended')
    return <EndedView reason={session.room.endReason ?? 'ended'} />;
  return (
    <ActiveCall
      roomId={roomId}
      token={stored.participantToken}
      inviteToken={stored.inviteToken}
      session={session}
    />
  );
}
