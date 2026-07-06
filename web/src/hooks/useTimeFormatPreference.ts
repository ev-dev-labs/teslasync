import { useSettings } from '@/api/hooks/useSettings';

/**
 * The two visible timestamp formats `<TimeStamp>` can render by default.
 *
 * Exposed as a named type (rather than an inline union) so consumers that
 * read the preference — and the tests that exercise every branch — refer to
 * the exact domain type this hook returns.
 */
export type TimeFormatPreference = 'relative' | 'absolute';

/**
 * Returns the user's globally preferred default format for `<TimeStamp>`.
 *
 * Reads `time_format_default` from the server-persisted `AppSettings` via
 * the canonical TanStack Query hook (`@/api/hooks/useSettings`), so cross-tab
 * broadcasts mutate every consumer instantly.
 *
 * Falls back to `'relative'` when settings have not yet loaded, when the
 * field is missing, or when the value isn't one of the two known modes.
 */
export function useTimeFormatPreference(): TimeFormatPreference {
  const { data } = useSettings();
  const pref = data?.time_format_default;
  return pref === 'absolute' ? 'absolute' : 'relative';
}
