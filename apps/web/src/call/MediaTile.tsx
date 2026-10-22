import { useEffect, useRef } from 'react';
import { MicOffIcon } from '../components/icons';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Shows a participant's camera, or an avatar when there is no video. Never plays audio. */
export function MediaTile({
  name,
  subtitle,
  stream,
  showVideo,
  mirrored = false,
  muted = false,
  speaking = false,
  compact = false,
}: {
  name: string;
  subtitle: string;
  stream: MediaStream | null;
  showVideo: boolean;
  mirrored?: boolean;
  muted?: boolean;
  speaking?: boolean;
  compact?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = showVideo ? stream : null;
    return () => {
      el.srcObject = null;
    };
  }, [stream, showVideo]);

  return (
    <figure
      className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-stage-raised ${
        speaking ? 'ring-2 ring-teal-300' : ''
      }`}
    >
      {showVideo && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div
          className={`flex items-center justify-center rounded-full bg-white/10 font-semibold text-white ${compact ? 'size-14 text-lg' : 'size-24 text-3xl'}`}
        >
          {initials(name) || '?'}
        </div>
      )}
      <figcaption className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg bg-black/55 px-2.5 py-1.5 text-xs text-white backdrop-blur">
        {muted && <MicOffIcon className="size-4 text-red-300" aria-label="Muted" />}
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-white/70">{subtitle}</span>
      </figcaption>
    </figure>
  );
}
