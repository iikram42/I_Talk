import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {message && (
          <div className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-lg">{message}</div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
