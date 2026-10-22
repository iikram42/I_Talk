import { useEffect, useRef } from 'react';

/** Plays a remote WebRTC audio stream through an <audio> element (so echo cancellation applies). */
export function RemoteAudio({ stream, volume, sinkId, label }: { stream: MediaStream | null; volume: number; sinkId: string; label: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (sinkId && supportsOutputSelection() && ref.current) void ref.current.setSinkId(sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay aria-label={label} />;
}

export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}
