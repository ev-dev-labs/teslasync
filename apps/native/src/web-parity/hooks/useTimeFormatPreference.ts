/**
 * useTimeFormatPreference — native-safe port of web/src/hooks/useTimeFormatPreference.ts.
 *
 * Web parity source: web/src/hooks/useTimeFormatPreference.ts.
 *
 * Returns the user's globally preferred default format for timestamp rendering
 * (the native analog of the web `<TimeStamp>` component).
 *
 * Reads `time_format_default` from the server-persisted `AppSettings` via the
 * canonical TanStack Query hook (`../api/hooks/useSettings`). On the web a
 * cross-tab broadcast mutates every consumer instantly; React Native has no
 * browser tabs, so that cross-tab fan-out is inherently unavailable here (see
 * `nativeSettingsHookCapabilities.queryBroadcastAvailable === false`). Within the
 * app's single runtime, every consumer of this hook still updates together
 * because they share the same React Query cache entry — preserving the web intent
 * of "one source of truth, instantly reflected everywhere".
 *
 * Falls back to `'relative'` when settings have not yet loaded, when the field is
 * missing, or when the value isn't one of the two known modes.
 *
 * Pure React Query data read — no DOM modules, browser HTML elements, Recharts,
 * Leaflet, localStorage, or old web UI components are imported.
 */
import { useSettings } from '../api/hooks/useSettings';

export function useTimeFormatPreference(): 'relative' | 'absolute' {
  const { data } = useSettings();
  const pref = data?.time_format_default;
  return pref === 'absolute' ? 'absolute' : 'relative';
}
