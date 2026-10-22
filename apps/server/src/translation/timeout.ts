export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
  }
}

/** Runs `fn` with an AbortSignal that fires after `ms`; rejects with TimeoutError when it does. */
export async function withTimeout<T>(label: string, ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, ms));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
