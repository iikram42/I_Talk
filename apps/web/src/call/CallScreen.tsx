import { useState } from 'react';
import { APP_NAME, type SessionResponse, languageName } from '@parley/shared';
import { Button } from '../components/ui/Button';
import { CallControls, type AudioSettings } from './CallControls';
import { InvitePanel } from './InvitePanel';
import { MediaTile } from './MediaTile';
import { RemoteAudio } from './RemoteAudio';
import { TranscriptPanel } from './TranscriptPanel';
import type { CallControls as Controls, CallState } from './useCall';
import type { LocalMedia } from './useLocalMedia';

const QUALITY_LABEL = { good: 'Good connection', fair: 'Fair connection', poor: 'Poor connection', unknown: '' } as const;

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'muted'; children: string }) {
  const colors = {
    ok: 'bg-emerald-400/15 text-emerald-200',
    warn: 'bg-amber-400/15 text-amber-200',
    error: 'bg-red-400/15 text-red-200',
    muted: 'bg-white/10 text-white/70',
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${colors}`}>{children}</span>;
}

export function CallScreen({
  session,
  media,
  call,
  inviteToken,
  onRevoke,
  onEnd,
}: {
  session: SessionResponse;
  media: LocalMedia;
  call: CallState & Controls;
  inviteToken: string | undefined;
  onRevoke: () => Promise<void>;
  onEnd: () => void;
}) {
  const [captionsOn, setCaptionsOn] = useState(true);
  const [audio, setAudio] = useState<AudioSettings>({ originalVolume: 0.25, sinkId: '' });
  const self = call.participants.find((p) => p.id === call.selfId) ?? session.self;
  const peer = call.peer;
  const isVideo = call.room.callType === 'video';
  const isHost = self.role === 'host';
  const waitingForGuest = !peer;
  const mediaConnected = call.connectionState === 'connected';
  const translationAvailable = session.translation.available;
  const names = Object.fromEntries(call.participants.map((p) => [p.id, p.displayName]));
  const myTranslation = call.translationStatus[self.id];

  let connection: { tone: 'ok' | 'warn' | 'error' | 'muted'; text: string };
  if (call.socketStatus === 'reconnecting') connection = { tone: 'warn', text: 'Reconnecting…' };
  else if (waitingForGuest) connection = { tone: 'muted', text: 'Waiting for guest' };
  else if (!peer.connected) connection = { tone: 'warn', text: `${peer.displayName} disconnected` };
  else if (call.connectionState === 'connected') {
    connection = { tone: call.quality === 'poor' ? 'warn' : 'ok', text: QUALITY_LABEL[call.quality] || 'Connected' };
  } else if (call.connectionState === 'failed') connection = { tone: 'error', text: 'Connection failed, retrying' };
  else if (call.connectionState === 'disconnected') connection = { tone: 'warn', text: 'Connection unstable' };
  else connection = { tone: 'muted', text: 'Connecting…' };

  let translation: { tone: 'ok' | 'warn' | 'error' | 'muted'; text: string };
  if (!translationAvailable) translation = { tone: 'warn', text: 'Translation unavailable' };
  else if (!call.translationEnabled) translation = { tone: 'muted', text: 'Your translation paused' };
  else if (myTranslation?.state === 'error') translation = { tone: 'error', text: 'Translation error' };
  else if (myTranslation?.state === 'unavailable') translation = { tone: 'warn', text: 'Translation unavailable' };
  else if (call.receivingTranslation) translation = { tone: 'ok', text: 'Playing translation' };
  else if (call.sendingTranslation) translation = { tone: 'ok', text: `Speaking your words to ${peer?.displayName ?? 'them'}` };
  else translation = { tone: 'ok', text: mediaConnected ? 'Translating' : 'Translation ready' };

  const translationMessage = myTranslation?.message ?? (!translationAvailable ? session.translation.reason : undefined);

  return (
    <div className="flex h-dvh flex-col bg-stage text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{call.room.title || `${APP_NAME} ${isVideo ? 'video' : 'voice'} call`}</p>
          <p className="truncate text-xs text-white/60">
            You speak {languageName(self.spokenLanguage)} · hear {languageName(self.outputLanguage)}
            {peer && ` · ${peer.displayName} speaks ${languageName(peer.spokenLanguage)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <StatusPill tone={connection.tone}>{connection.text}</StatusPill>
          <StatusPill tone={translation.tone}>{translation.text}</StatusPill>
        </div>
      </header>

      {(translationMessage || call.audioBlocked || media.cameraUnavailable) && (
        <div className="space-y-2 px-4 pt-3">
          {translationMessage && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100">{translationMessage}</p>}
          {media.cameraUnavailable && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-100">Your camera isn't available, so you're joining with audio only.</p>}
          {call.audioBlocked && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2 text-sm">
              <span>Your browser paused audio until you interact with the page.</span>
              <Button size="md" variant="secondary" onClick={call.resumeAudio}>
                Enable audio
              </Button>
            </div>
          )}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
          <div className={`relative min-h-0 flex-1 ${isVideo ? '' : 'sm:basis-1/2'}`}>
            <MediaTile
              name={peer?.displayName ?? 'Waiting…'}
              subtitle={peer ? languageName(peer.spokenLanguage) : ''}
              stream={call.remote?.original ?? null}
              showVideo={isVideo && !call.peerMedia.cameraOff && mediaConnected}
              muted={call.peerMedia.micMuted}
              speaking={call.receivingTranslation}
            />
            {call.receivingTranslation && (
              <span className="absolute top-3 left-3 rounded-full bg-teal-500/90 px-2.5 py-1 text-xs font-medium">Translated voice playing</span>
            )}
          </div>
          <div className={isVideo ? 'absolute right-3 bottom-3 h-32 w-24 sm:h-40 sm:w-56' : 'min-h-0 flex-1 sm:basis-1/2'}>
            <MediaTile
              name={`${self.displayName} (you)`}
              subtitle={languageName(self.spokenLanguage)}
              stream={media.stream}
              showVideo={isVideo && !call.cameraOff && Boolean(media.video)}
              mirrored
              muted={call.micMuted}
              compact={isVideo}
            />
          </div>

          {waitingForGuest && isHost && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-stage/70 p-4 backdrop-blur-sm">
              <InvitePanel room={call.room} inviteToken={inviteToken} onRevoke={onRevoke} onCancel={onEnd} />
            </div>
          )}
        </div>

        {captionsOn && (
          <aside className="flex h-56 min-h-0 flex-col rounded-2xl bg-stage-raised lg:h-auto lg:w-96">
            <TranscriptPanel utterances={call.utterances} selfId={call.selfId} names={names} translationAvailable={translationAvailable} />
          </aside>
        )}
      </main>

      <footer className="border-t border-white/10 px-4 py-4">
        <CallControls
          isVideo={isVideo}
          micMuted={call.micMuted}
          cameraOff={call.cameraOff}
          cameraAvailable={Boolean(media.video)}
          captionsOn={captionsOn}
          translationEnabled={call.translationEnabled}
          audio={audio}
          onMic={() => call.setMicMuted(!call.micMuted)}
          onCamera={() => call.setCameraOff(!call.cameraOff)}
          onCaptions={() => setCaptionsOn((c) => !c)}
          onTranslation={() => call.setTranslationEnabled(!call.translationEnabled)}
          onAudio={setAudio}
          onEnd={onEnd}
        />
      </footer>

      <RemoteAudio stream={call.remote?.original ?? null} volume={translationAvailable ? audio.originalVolume : 1} sinkId={audio.sinkId} label="Other person's voice" />
      <RemoteAudio stream={call.remote?.translation ?? null} volume={1} sinkId={audio.sinkId} label="Translated voice" />
    </div>
  );
}
