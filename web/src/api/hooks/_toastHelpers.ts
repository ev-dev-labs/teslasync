import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOptionalToast } from '@/components/feedback/Toast';

/**
 * Extracts a human-readable detail line from an arbitrary thrown value.
 *
 * TanStack Query types mutation errors as `unknown`, so `error()` may be handed
 * an `Error`, a string, a bare status code, `null`, or a duck-typed
 * `{ message }` object. Returns `undefined` when there is nothing meaningful to
 * show so the toast renders its translated title alone rather than an empty
 * secondary line or the useless `"[object Object]"` that a naive `String(err)`
 * would produce for a message-less object.
 *
 *   - `Error` / duck-typed `{ message: string }` → the trimmed message.
 *   - `string` / `number` / `boolean` / `bigint`  → its string form.
 *   - `null` / `undefined` / message-less object   → `undefined` (title only).
 *
 * Whitespace-only messages collapse to `undefined` for the same reason.
 */
function errorDetail(err: unknown): string | undefined {
  if (err == null) return undefined;
  let msg: string | undefined;
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === 'string') {
    msg = err;
  } else if (typeof err === 'object') {
    const maybe = (err as { message?: unknown }).message;
    msg = typeof maybe === 'string' ? maybe : undefined;
  } else {
    msg = String(err);
  }
  const trimmed = msg?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * useMutationToast — i18n-aware bridge between TanStack Query mutations and
 * the in-house Toast system.
 *
 * Mutation toast convention:
 *   - Every user-initiated mutation MUST emit either a success or error toast.
 *   - `console.error` alone is not enough — the user must see feedback.
 *   - Background / poll-driven mutations may rely on the Toast queue's natural
 *     FIFO + 4-toast cap to avoid spam, but should still call `error()` so
 *     repeated failures surface.
 *
 * Usage:
 *
 *   const { success, error } = useMutationToast();
 *   return useMutation({
 *     mutationFn: (id) => request(`/foo/${id}`, { method: 'DELETE' }),
 *     onSuccess: () => {
 *       qc.invalidateQueries({ queryKey: ['foo'] });
 *       success('toast.foo.delete.success', 'Item deleted');
 *     },
 *     onError: (e) => error(e, 'toast.foo.delete.error', 'Failed to delete item'),
 *   });
 *
 * The `success` and `warning` helpers take an i18n key + English fallback,
 * plus an optional interpolation map for `{{count}}`-style placeholders. The `error` helper
 * takes the raw error (any shape — Error, string, unknown), an i18n key, and
 * a fallback. The error's `message` is shown as a secondary line beneath the
 * translated title so users see both "Failed to save settings" and the
 * underlying "HTTP 500: …" detail.
 */
function useMutationToastInternal(requireProviderOnRender: boolean) {
  const toast = useOptionalToast();
  const { t } = useTranslation();
  if (requireProviderOnRender && !toast) {
    throw new Error('useToast must be used within ToastProvider');
  }

  // The toast dispatcher and translator can change identity between renders:
  // the ToastProvider rebuilds its context value whenever a toast is added or
  // removed, and `t` rebinds on a language switch. Hold the latest pair in a
  // ref so the returned `success` / `error` keep a STABLE identity across
  // renders — callers can safely spread them into dependency arrays or hand
  // them to memoised children without triggering needless re-runs — while
  // still dispatching through the current providers.
  const latest = useRef({ toast, t });
  latest.current = { toast, t };

  return useMemo(
    () => ({
      success(key: string, fallback: string, vars?: Record<string, unknown>) {
        const { toast, t } = latest.current;
        if (!toast) throw new Error('useToast must be used within ToastProvider');
        toast.success(t(key, { defaultValue: fallback, ...(vars ?? {}) }));
      },
      warning(key: string, fallback: string, vars?: Record<string, unknown>) {
        const { toast, t } = latest.current;
        if (!toast) throw new Error('useToast must be used within ToastProvider');
        toast.warning(t(key, { defaultValue: fallback, ...(vars ?? {}) }));
      },
      error(
        err: unknown,
        key = 'toast.common.error',
        fallback = 'Something went wrong',
      ) {
        const { toast, t } = latest.current;
        if (!toast) throw new Error('useToast must be used within ToastProvider');
        toast.error(t(key, { defaultValue: fallback }), errorDetail(err));
      },
    }),
    [],
  );
}

export function useMutationToast() {
  return useMutationToastInternal(true);
}

/**
 * Defers the ToastProvider contract check until feedback is dispatched.
 * Passive primitives may initialize dormant mutation hooks without forcing
 * every read-only render tree to mount the provider; an attempted mutation
 * still fails loudly if the application provider is missing.
 */
export function useDeferredMutationToast() {
  return useMutationToastInternal(false);
}
