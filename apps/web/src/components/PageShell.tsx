import type { ReactNode } from 'react';
import { SiteHeader } from './SiteHeader';

export function PageShell({
  children,
  width = 'max-w-xl',
}: {
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="min-h-dvh">
      <SiteHeader minimal />
      <main className={`mx-auto ${width} px-4 py-10 sm:px-6 sm:py-14`}>{children}</main>
    </div>
  );
}

export function CenteredState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      {children}
    </div>
  );
}
