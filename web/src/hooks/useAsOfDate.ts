import { useCallback } from 'react'
import { useUrlState } from './useUrlState'

/**
 * Phase-46 / Prompt 64 — global as-of timestamp URL state.
 *
 * `useAsOfDate` mirrors the canonical `?as_of=` query parameter used by the
 * read-only point-in-time time-machine view. When set, SignalStore-backed
 * data hooks (useVehicleState, useBatteryHealth, …) include `as_of` in
 * their request URL so the backend reroutes the read through `signal_log`
 * instead of live state.
 *
 * The parameter is intentionally URL-mounted (not React-state-mounted) so:
 *   • a deep-linked time-machine URL renders the same historical view on
 *     a fresh tab, share, or browser back/forward;
 *   • route changes that drop the query string (eg. logging out and back
 *     in) implicitly return the SPA to live state without dangling state;
 *   • cross-tab sync is automatic via the URL — no broadcast channel.
 *
 * Format: RFC 3339 (eg. `2024-11-12T14:30:00Z`). Anything else is treated
 * as absent — the underlying parser drops malformed values rather than
 * propagating garbage to the wire. Backend bounds (now / now-90d) are
 * enforced in `signal.ParseAsOf`; this hook intentionally does NOT
 * pre-validate so the SPA matches whatever lookback the server allows
 * even if the frontend bundle is older than the API.
 */

export const AS_OF_QUERY_PARAM = 'as_of'

const ISO_RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

/** Strict RFC 3339 sniff used to drop pasted garbage before sending to the wire. */
function looksLikeIso(value: string): boolean {
  if (!ISO_RFC3339_RE.test(value)) return false
  // Reject hand-edited URLs whose Z/offset is well-formed but whose
  // year-month-day combination is invalid (eg. 2024-02-31). Date.parse
  // catches the second class because RFC 3339 is a subset of the JS
  // Date string parser.
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
}

export interface UseAsOfDateResult {
  /** Current as-of timestamp as RFC 3339 string, or null when in live mode. */
  asOf: string | null
  /** Replace the as-of timestamp. Pass null to return to live state. */
  setAsOf: (iso: string | null) => void
  /** Convenience alias for setAsOf(null) — returns to live state. */
  clear: () => void
}

export function useAsOfDate(): UseAsOfDateResult {
  const [value, set] = useUrlState<string>({
    key: AS_OF_QUERY_PARAM,
    defaultValue: '',
    parse: (raw) => (looksLikeIso(raw) ? raw : undefined),
    serialize: (v) => v,
  })

  const setAsOf = useCallback(
    (iso: string | null) => {
      if (iso === null || iso === '') {
        set('')
        return
      }
      if (!looksLikeIso(iso)) {
        // Refuse to write malformed values into the URL. Callers should
        // present a date-time picker that emits well-formed RFC 3339.
        return
      }
      set(iso)
    },
    [set],
  )

  const clear = useCallback(() => set(''), [set])

  return {
    asOf: value === '' ? null : value,
    setAsOf,
    clear,
  }
}
