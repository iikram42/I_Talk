import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ParticipantView,
  RoomView,
  ServerMessage,
  SessionResponse,
  TranslationState,
} from '@parley/shared';
import { MicStreamer } from './micStreamer';
import { type ConnectionQuality, PeerCall, type RemoteMedia } from './peer';
import { RoomSocket, type SocketStatus } from './signaling';
import { TranslationPlayer } from './translationPlayer';
import { transcriptReducer } from './transcripts';
import type { LocalMedia } from './useLocalMedia';

/** Enables or disables a media track (a muted track sends silence / black frames). */
function setTrackEnabled(track: MediaStreamTrack | null, enabled: boolean) {
  if (track) track.enabled = enabled;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface CallState {
  socketStatus: SocketStatus;
  closeCode?: number;
  room: RoomView;
  participants: ParticipantView[];
  selfId: string;
  peer: ParticipantView | undefined;
  endedReason: string | null;
  connectionState: RTCPeerConnectionState | 'idle';
  quality: ConnectionQuality;
  remote: RemoteMedia | null;
  peerMedia: { micMuted: boolean; cameraOff: boolean };
  translationStatus: Record<string, { state: TranslationState; message?: string }>;
  /** We are sending translated speech to the other person right now. */
  sendingTranslation: boolean;
  /** The other person's translated speech is playing for us right now. */
  receivingTranslation: boolean;
  utterances: ReturnType<typeof transcriptReducer>;
  audioBlocked: boolean;
}

export interface CallControls {
  micMuted: boolean;
  cameraOff: boolean;
  translationEnabled: boolean;
  setMicMuted: (muted: boolean) => void;
  setCameraOff: (off: boolean) => void;
  setTranslationEnabled: (enabled: boolean) => void;
  resumeAudio: () => void;
}

export function useCall(
  roomId: string,
  token: string,
  session: SessionResponse,
  media: LocalMedia,
): CallState & CallControls {
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [closeCode, setCloseCode] = useState<number>();
  const [room, setRoom] = useState(session.room);
  const [participants, setParticipants] = useState(session.participants);
  const [endedReason, setEndedReason] = useState<string | null>(
    session.room.status === 'ended' ? (session.room.endReason ?? 'ended') : null,
  );
  const [connectionState, setConnectionState] = useState<CallState['connectionState']>('idle');
  const [quality, setQuality] = useState<ConnectionQuality>('unknown');
  const [remote, setRemote] = useState<RemoteMedia | null>(null);
  const [peerMedia, setPeerMedia] = useState({ micMuted: false, cameraOff: false });
  const [translationStatus, setTranslationStatus] = useState<CallState['translationStatus']>({});
  const [sendingTranslation, setSendingTranslation] = useState(false);
  const [receivingTranslation, setReceivingTranslation] = useState(false);
  const [utterances, dispatchTranscript] = useReducer(transcriptReducer, []);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micMuted, setMicMutedState] = useState(false);
  const [cameraOff, setCameraOffState] = useState(false);
  const [translationEnabled, setTranslationEnabledState] = useState(true);

  const selfId = session.self.id;
  const isHost = session.self.role === 'host';
  const peer = participants.find((p) => p.id !== selfId);
  const peerConnected = Boolean(peer?.connected) && socketStatus === 'open';

  const socketRef = useRef<RoomSocket | null>(null);
  const peerRef = useRef<PeerCall | null>(null);
  const audioRef = useRef<{
    context: AudioContext;
    player: TranslationPlayer;
    mic: MicStreamer;
  } | null>(null);
  const micMutedRef = useRef(false);
  const translationEnabledRef = useRef(true);
  /** Bumped whenever the peer connection must be rebuilt (presence changes, our own reconnect). */
  const [peerGeneration, setPeerGeneration] = useState(0);

  // Audio graph: one context for both mic capture and translated speech output.
  useEffect(() => {
    const context = new AudioContext();
    const player = new TranslationPlayer(context, (utteranceId, state) => {
      setSendingTranslation(player.busy);
      socketRef.current?.send({ type: 'playback', utteranceId, state });
    });
    const mic = new MicStreamer(context, (pcm) => {
      if (!micMutedRef.current && translationEnabledRef.current) socketRef.current?.sendAudio(pcm);
    });
    audioRef.current = { context, player, mic };
    const sync = () => setAudioBlocked(context.state === 'suspended');
    context.onstatechange = sync;
    void context.resume().finally(sync);
    return () => {
      mic.stop();
      player.dispose();
      context.onstatechange = null;
      void context.close();
      audioRef.current = null;
    };
  }, []);

  const onMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'ready':
      case 'room-update':
        setRoom(msg.room);
        setParticipants(msg.participants);
        break;
      case 'room-ended':
        setEndedReason(msg.reason);
        break;
      case 'signal':
        void peerRef.current?.handleSignal(msg);
        break;
      case 'peer-media-state':
        setPeerMedia({ micMuted: msg.micMuted, cameraOff: msg.cameraOff });
        break;
      case 'transcript':
      case 'translation':
        dispatchTranscript(msg);
        break;
      case 'translated-audio':
        dispatchTranscript(msg);
        audioRef.current?.player.enqueue({
          utteranceId: msg.utteranceId,
          audio: base64ToArrayBuffer(msg.audioBase64),
          receivedAt: performance.now(),
        });
        break;
      case 'peer-ready':
        // The guest built a fresh connection: start over with a new one and offer to it.
        setPeerGeneration((g) => g + 1);
        break;
      case 'peer-playback':
        setReceivingTranslation(msg.state === 'started');
        break;
      case 'translation-status':
        setTranslationStatus((s) => ({
          ...s,
          [msg.participantId]: {
            state: msg.state,
            ...(msg.message ? { message: msg.message } : {}),
          },
        }));
        break;
      case 'error':
      case 'pong':
        break;
    }
  }, []);

  // Signaling socket for the lifetime of the page.
  useEffect(() => {
    const socket = new RoomSocket(roomId, token, {
      onMessage,
      onStatus: (status, code) => {
        setSocketStatus(status);
        setCloseCode(code);
      },
    });
    socketRef.current = socket;
    return () => {
      socket.dispose();
      socketRef.current = null;
    };
  }, [roomId, token, onMessage]);

  // Rebuild the peer connection when the other person (re)connects.
  const prevPeerConnected = useRef(false);
  useEffect(() => {
    if (peerConnected && !prevPeerConnected.current) setPeerGeneration((g) => g + 1);
    prevPeerConnected.current = peerConnected;
  }, [peerConnected]);

  // Start streaming the microphone to speech recognition once media is ready.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !media.mic) return;
    let active = true;
    audio.mic.start(media.mic).catch((err: unknown) => {
      if (active) console.warn('Could not start microphone streaming', err);
    });
    return () => {
      active = false;
      audio.mic.stop();
    };
  }, [media.mic]);

  // WebRTC connection.
  useEffect(() => {
    const audio = audioRef.current;
    if (!peerConnected || !media.mic || !media.stream || !audio || endedReason) return;
    const call = new PeerCall({
      iceServers: session.iceServers,
      isOfferer: isHost,
      callType: room.callType,
      local: {
        mic: media.mic,
        micStream: media.stream,
        video: media.video,
        translation: audio.player.track,
        translationStream: audio.player.destination.stream,
      },
      sendSignal: (signal) => socketRef.current?.send({ type: 'signal', ...signal }),
      onRemoteMedia: setRemote,
      onConnectionState: setConnectionState,
      onQuality: setQuality,
    });
    peerRef.current = call;
    // The host offers to every new connection. If the guest had no connection yet, it asks
    // again with `peer-ready` once it does; offers to a replaced connection are ignored by id.
    if (isHost) call.offer();
    else socketRef.current?.send({ type: 'peer-ready' });
    setConnectionState('new');
    return () => {
      call.close();
      if (peerRef.current === call) peerRef.current = null;
      setRemote(null);
      setConnectionState('idle');
      setQuality('unknown');
    };
    // peerGeneration intentionally forces a fresh connection.
  }, [
    peerConnected,
    peerGeneration,
    media.mic,
    media.stream,
    media.video,
    endedReason,
    isHost,
    room.callType,
    session.iceServers,
  ]);

  const sendMediaState = useCallback((muted: boolean, camOff: boolean) => {
    socketRef.current?.send({ type: 'media-state', micMuted: muted, cameraOff: camOff });
  }, []);

  useEffect(() => {
    if (socketStatus === 'open') sendMediaState(micMuted, cameraOff);
  }, [socketStatus, peerConnected, micMuted, cameraOff, sendMediaState]);

  // Apply mute and camera state to the live tracks, including tracks re-acquired later.
  useEffect(() => {
    micMutedRef.current = micMuted;
    setTrackEnabled(media.mic, !micMuted);
  }, [micMuted, media.mic]);

  useEffect(() => {
    setTrackEnabled(media.video, !cameraOff);
  }, [cameraOff, media.video]);

  const setTranslationEnabled = useCallback((enabled: boolean) => {
    translationEnabledRef.current = enabled;
    setTranslationEnabledState(enabled);
    socketRef.current?.send({ type: 'translation-control', enabled });
    if (!enabled) audioRef.current?.player.clear();
  }, []);

  const resumeAudio = useCallback(() => {
    void audioRef.current?.context.resume();
  }, []);

  return {
    socketStatus,
    closeCode,
    room,
    participants,
    selfId,
    peer,
    endedReason,
    connectionState,
    quality,
    remote,
    peerMedia,
    translationStatus,
    sendingTranslation,
    receivingTranslation,
    utterances,
    audioBlocked,
    micMuted,
    cameraOff,
    translationEnabled,
    setMicMuted: setMicMutedState,
    setCameraOff: setCameraOffState,
    setTranslationEnabled,
    resumeAudio,
  };
}
