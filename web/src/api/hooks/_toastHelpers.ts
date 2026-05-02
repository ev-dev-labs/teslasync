import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/Toast';

/**
 * useMutationToast — i18n-aware bridge between TanStack Query mutations and
 * the in-house Toast system.
 *
 * Convention (Phase-40 Prompt 11):
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
 * The `success` helper takes an i18n key + English fallback, plus an optional
 * interpolation map for `{{count}}`-style placeholders. The `error` helper
 * takes the raw error (any shape — Error, string, unknown), an i18n key, and
 * a fallback. The error's `message` is shown as a secondary line beneath the
 * translated title so users see both "Failed to save settings" and the
 * underlying "HTTP 500: …" detail.
 */
export function useMutationToast() {
  const toast = useToast();
  const { t } = useTranslation();

  return {
    success(key: string, fallback: string, vars?: Record<string, unknown>) {
      toast.success(t(key, { defaultValue: fallback, ...(vars ?? {}) }));
    },
    error(
      err: unknown,
      key = 'toast.common.error',
      fallback = 'Something went wrong',
    ) {
      const detail = err instanceof Error ? err.message : err == null ? undefined : String(err);
      toast.error(t(key, { defaultValue: fallback }), detail);
    },
  };
}
