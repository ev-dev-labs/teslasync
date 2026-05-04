import { useSettings } from '@/api/hooks/useSettings';

/**
 * Returns the user's globally preferred default format for `<TimeStamp>`.
 *
 * Reads `time_format_default` from the server-persisted `AppSettings` via
 * the canonical TanStack Query hook (`@/api/hooks/useSettings`), so cross-tab
 * broadcasts mutate every consumer instantly.
 *
 * Falls back to `'relative'` when settings have not yet loaded, when the
 * field is missing, or when the value isn't one of the two known modes.
 * (Phase-45 / Prompt 22.)
 */
export function useTimeFormatPreference(): 'relative' | 'absolute' {
  const { data } = useSettings();
  const pref = data?.time_format_default;
  return pref === 'absolute' ? 'absolute' : 'relative';
}
