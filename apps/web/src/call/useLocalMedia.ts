import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallType } from '@parley/shared';

export type MediaError =
  | { kind: 'denied' }
  | { kind: 'not-found' }
  | { kind: 'in-use' }
  | { kind: 'unsupported' }
  | { kind: 'disconnected'; device: 'microphone' | 'camera' }
  | { kind: 'unknown'; message: string };

export interface LocalMedia {
  status: 'requesting' | 'ready' | 'error';
  stream: MediaStream | null;
  mic: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  error: MediaError | null;
  /** True when a video call had to continue without a camera. */
  cameraUnavailable: boolean;
  retry: () => void;
}

// Echo cancellation keeps the other person's voice and translated speech out of our microphone.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
};

function classify(err: unknown): MediaError {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { kind: 'not-found' };
  if (name === 'NotReadableError' || name === 'AbortError') return { kind: 'in-use' };
  return { kind: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

/** Requests microphone (and camera for video calls) and releases them when the component unmounts. */
export function useLocalMedia(callType: CallType): LocalMedia {
  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const [state, setState] = useState<Omit<LocalMedia, 'retry'>>({
    status: 'requesting',
    stream: null,
    mic: null,
    video: null,
    error: null,
    cameraUnavailable: false,
  });
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    (async () => {
      let stream: MediaStream;
      let cameraUnavailable = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: AUDIO_CONSTRAINTS,
          video: callType === 'video' ? VIDEO_CONSTRAINTS : false,
        });
      } catch (err) {
        // A video call can continue as voice-only if only the camera is missing or busy.
        const error = classify(err);
        if (callType !== 'video' || error.kind === 'denied') throw err;
        stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
        cameraUnavailable = true;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mic = stream.getAudioTracks()[0] ?? null;
      const video = stream.getVideoTracks()[0] ?? null;
      const onEnded = (device: 'microphone' | 'camera') => () => {
        if (!cancelled)
          setState((s) => ({ ...s, status: 'error', error: { kind: 'disconnected', device } }));
      };
      mic?.addEventListener('ended', onEnded('microphone'));
      video?.addEventListener('ended', onEnded('camera'));
      setState({ status: 'ready', stream, mic, video, error: null, cameraUnavailable });
    })().catch((err: unknown) => {
      if (!cancelled) setState((s) => ({ ...s, status: 'error', error: classify(err) }));
    });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [callType, attempt, supported]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'requesting', error: null }));
    setAttempt((n) => n + 1);
  }, []);
  if (!supported) return { ...state, status: 'error', error: { kind: 'unsupported' }, retry };
  return { ...state, retry };
}
