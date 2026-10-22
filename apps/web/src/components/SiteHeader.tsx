import { APP_NAME } from '@parley/shared';
import { Link } from 'react-router';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
      <img src="/favicon.svg" alt="" className="size-7" />
      {APP_NAME}
    </Link>
  );
}

export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        {!minimal && (
          <div className="flex items-center gap-1 text-sm sm:gap-4">
            <a href="/#how-it-works" className="hidden rounded-md px-2 py-1 text-muted hover:text-ink sm:inline">
              How it works
            </a>
            <a href="/#privacy" className="hidden rounded-md px-2 py-1 text-muted hover:text-ink sm:inline">
              Privacy
            </a>
            <Link to="/new?type=voice" className="rounded-lg bg-accent px-3 py-2 font-medium text-white hover:bg-accent-strong">
              Start a call
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}
