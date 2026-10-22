import type { ReactNode } from 'react';

type Tone = 'info' | 'warning' | 'error';
const TONES: Record<Tone, string> = {
  info: 'bg-accent-soft text-accent-strong border-accent/20',
  warning: 'bg-warn-soft text-warn border-warn/20',
  error: 'bg-danger-soft text-danger border-danger/20',
};

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}
