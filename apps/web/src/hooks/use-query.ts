import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { GraphQLError, UNAUTHENTICATED } from '@/api';
import { useSession } from '@/session';

export const errorMessage = (error: unknown): string =>
  error instanceof GraphQLError ? error.message : 'request failed';

interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads view data, retiring the session instead of showing an error when the
 * server says the caller isn't authenticated. `load` is deliberately not a
 * dependency — callers pass an inline closure, so `deps` is the honest list.
 */
export function useQuery<T>(load: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const { expire } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof GraphQLError && cause.code === UNAUTHENTICATED) {
          expire('session expired — sign in again');
          return;
        }
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

interface ActionState {
  /** Last outcome, for the view's status line. */
  status: { text: string; failed: boolean } | null;
  pending: boolean;
  run(action: () => Promise<unknown>, options?: { onDone?: () => void; success?: string }): void;
}

/**
 * Runs a mutation: server-side validation errors (an invalid regex, a name
 * collision) land in the status line rather than blowing up the view, and an
 * expired session ends the session exactly as a query would.
 */
export function useAction(): ActionState {
  const { expire } = useSession();
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const run: ActionState['run'] = useCallback(
    (action, options) => {
      setPending(true);
      action()
        .then(() => {
          setStatus(options?.success ? { text: options.success, failed: false } : null);
          options?.onDone?.();
        })
        .catch((cause: unknown) => {
          if (cause instanceof GraphQLError && cause.code === UNAUTHENTICATED) {
            expire('session expired — sign in again');
            return;
          }
          setStatus({ text: errorMessage(cause), failed: true });
        })
        .finally(() => setPending(false));
    },
    [expire],
  );

  return { status, pending, run };
}
