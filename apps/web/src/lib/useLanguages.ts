import { useEffect, useState } from 'react';
import type { LanguagesResponse } from '@parley/shared';
import { api } from './api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LanguagesResponse };

export function useLanguages(): State & { retry: () => void } {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.languages().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (err: Error) => !cancelled && setState({ status: 'error', message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };
  return { ...state, retry };
}
