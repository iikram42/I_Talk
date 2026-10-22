import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { LANGUAGES } from '@parley/shared';
import { ToastProvider } from '../src/components/ui/Toast';

export function renderAt(path: string, routes: { path: string; element: ReactElement }[]) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<p>other page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

export function languagesBody(unavailable: string[] = [], translationAvailable = true) {
  return {
    languages: LANGUAGES.map((l) => ({
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
      available: !unavailable.includes(l.code),
    })),
    translation: translationAvailable
      ? { available: true, provider: 'google' }
      : {
          available: false,
          provider: 'none',
          reason: 'No AI provider credentials are configured on this server.',
        },
  };
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

/** Routes fetch calls to `handler`; unmatched requests fail the test loudly. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const result = handler(url, init);
    if (!result) throw new Error(`Unexpected fetch ${url}`);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
