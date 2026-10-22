import { useEffect, useRef } from 'react';
import { languageName } from '@parley/shared';
import type { Utterance } from './transcripts';

export function TranscriptPanel({
  utterances,
  selfId,
  names,
  translationAvailable,
}: {
  utterances: Utterance[];
  selfId: string;
  names: Record<string, string>;
  translationAvailable: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [utterances]);

  return (
    <section aria-label="Live captions" className="flex h-full min-h-0 flex-col">
      <h2 className="sr-only">Live captions</h2>
      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {utterances.length === 0 && (
          <p className="pt-6 text-center text-sm text-white/50">
            {translationAvailable
              ? 'Captions appear here as you talk.'
              : 'Captions are unavailable because translation is off.'}
          </p>
        )}
        {utterances.map((u) => {
          const mine = u.speakerId === selfId;
          return (
            <article
              key={u.id}
              className={`max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm ${mine ? 'ml-auto bg-teal-900/50' : 'bg-white/8'}`}
            >
              <header className="mb-1 flex items-center gap-2 text-[11px] text-white/55">
                <span className="font-medium text-white/75">
                  {mine ? 'You' : (names[u.speakerId] ?? 'Them')}
                </span>
                <span>{languageName(u.sourceLanguage)}</span>
                {u.latencyMs !== undefined && (
                  <span className="ml-auto tabular-nums">{(u.latencyMs / 1000).toFixed(1)} s</span>
                )}
              </header>
              <p className={u.final ? 'text-white' : 'text-white/60 italic'}>{u.sourceText}</p>
              {u.translation && u.translation.text !== u.sourceText && (
                <p
                  className="mt-1.5 border-t border-white/10 pt-1.5 text-teal-100"
                  lang={u.translation.language}
                >
                  <span className="sr-only">
                    Translation into {languageName(u.translation.language)}:{' '}
                  </span>
                  {u.translation.text}
                </p>
              )}
            </article>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}
