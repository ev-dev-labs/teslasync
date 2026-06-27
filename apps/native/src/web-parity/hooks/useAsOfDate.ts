// Native parity port of web/src/hooks/useAsOfDate.ts.
//
// `useAsOfDate` mirrors the canonical `?as_of=` query parameter used by the
// read-only point-in-time time-machine view: SignalStore-backed data hooks
// include `as_of` in their request URL so the backend reroutes the read
// through `signal_log` instead of live state.
//
// On the web the value is URL-mounted via `useUrlState` (web/src/hooks/
// useUrlState.ts), which is built on react-router-dom's `useSearchParams`.
// That is DOM-only and absent from the native deps. React Native has no
// shared document URL, so the URL-mounted affordances the web doc block
// describes — deep-linking the same historical view on a fresh tab/share,
// implicit return-to-live on a query-dropping navigation, and automatic
// cross-tab sync via the URL (contract rule 7) — are UNAVAILABLE on native.
//
// The behavior that IS meaningful — a validated as-of timestamp held as
// state, with live mode represented as `null` — is preserved 1:1. Following
// the established native parity convention (the in-file `useUrlEnum` shim in
// features/maps/pages/MapOverviewPage.tsx), `useUrlState` is replaced by a
// local native-safe shim that holds the value in component state instead of
// the URL while preserving the exact call shape, the same default, the same
// `parse`/`serialize` validation, and the same omit-default / empty-string
// deletion semantics. `looksLikeIso`, `AS_OF_QUERY_PARAM`, the public
// `UseAsOfDateResult` contract, and every `useAsOfDate` code path (live mode
// as `null`, malformed-value rejection, `clear`) are ported verbatim.
//
// No DOM modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only `react`.

import { useCallback, useMemo, useState } from 'react';

/* ── useUrlState shim (native-safe; in-state value, no URL persistence) ── */
// Mirrors the object-options overload of web/src/hooks/useUrlState.ts that
// `useAsOfDate` uses. The web hook syncs a single piece of state to a URL
// query param so the view can be shared/deep-linked; native has no DOM URL,
// so URL persistence/sharing/cross-tab sync is UNAVAILABLE. The shim instead
// holds the serialized param value in component state (`null` === param
// absent, so reads fall back to `defaultValue`, exactly like a missing
// `useSearchParams` key) and applies the identical write semantics:
// function-updater support, `serialize`, and the omit-default / empty-string
// deletion rule. `key` is part of the web call shape but unused natively
// because there is no URL namespace to scope the value under.
interface UrlStateOptions<T> {
  /** Query param name on the web; accepted for parity but unused on native. */
  key: string;
  /** Default value when the param is absent or fails to parse. */
  defaultValue: T;
  /** Convert the raw stored string into `T`; `undefined` falls back to default. */
  parse?: (raw: string) => T | undefined;
  /** Convert `T` back into the stored string. Defaults to `String(value)`. */
  serialize?: (value: T) => string;
  /** When the new value === the default, drop it (back to absent). Default true. */
  omitDefault?: boolean;
}

interface UrlStateSetOptions {
  /** History-entry hint on the web; no-op on native (no browser history). */
  push?: boolean;
}

type UrlStateSetter<T> = (
  value: T | ((prev: T) => T),
  options?: UrlStateSetOptions,
) => void;

function useUrlState<T>(opts: UrlStateOptions<T>): [T, UrlStateSetter<T>] {
  // `key` is intentionally not destructured: it scopes the value under a URL
  // namespace on the web, which has no native analog (one value per hook
  // instance). Destructuring only the used fields keeps the hook-dep lists
  // stable for react-hooks/exhaustive-deps.
  const { defaultValue, parse, serialize, omitDefault } = opts;
  // `raw` mirrors the URL query param's serialized string; `null` means the
  // param is absent, so reads fall back to `defaultValue`.
  const [raw, setRaw] = useState<string | null>(null);

  const parsed = useMemo<T>(() => {
    if (raw == null) {
      return defaultValue;
    }
    if (!parse) {
      return raw as unknown as T;
    }
    const r = parse(raw);
    return r === undefined ? defaultValue : r;
  }, [raw, defaultValue, parse]);

  const set = useCallback<UrlStateSetter<T>>(
    value => {
      setRaw(prevRaw => {
        let prev: T;
        if (prevRaw == null) {
          prev = defaultValue;
        } else if (parse) {
          prev = parse(prevRaw) ?? defaultValue;
        } else {
          prev = prevRaw as unknown as T;
        }
        const resolved =
          typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
        const serialized = serialize ? serialize(resolved) : String(resolved);
        const omit = omitDefault !== false;
        const defaultSerialized = serialize
          ? serialize(defaultValue)
          : String(defaultValue);
        if (serialized === '' || (omit && serialized === defaultSerialized)) {
          return null;
        }
        return serialized;
      });
    },
    [defaultValue, parse, serialize, omitDefault],
  );

  return [parsed, set];
}

/**
 * Global as-of timestamp state.
 *
 * `useAsOfDate` mirrors the canonical `?as_of=` query parameter used by the
 * read-only point-in-time time-machine view. When set, SignalStore-backed
 * data hooks (useVehicleState, useBatteryHealth, …) include `as_of` in
 * their request URL so the backend reroutes the read through `signal_log`
 * instead of live state.
 *
 * On the web the parameter is intentionally URL-mounted (not React-state-
 * mounted) so:
 *   • a deep-linked time-machine URL renders the same historical view on
 *     a fresh tab, share, or browser back/forward;
 *   • route changes that drop the query string (eg. logging out and back
 *     in) implicitly return the SPA to live state without dangling state;
 *   • cross-tab sync is automatic via the URL — no broadcast channel.
 * Native has no shared document URL, so these URL-mounted affordances are
 * unavailable; the value lives in component state instead (see file header).
 *
 * Format: RFC 3339 (eg. `2024-11-12T14:30:00Z`). Anything else is treated
 * as absent — the underlying parser drops malformed values rather than
 * propagating garbage to the wire. Backend bounds (now / now-90d) are
 * enforced in `signal.ParseAsOf`; this hook intentionally does NOT
 * pre-validate so the SPA matches whatever lookback the server allows
 * even if the frontend bundle is older than the API.
 */

export const AS_OF_QUERY_PARAM = 'as_of';

const ISO_RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Strict RFC 3339 sniff used to drop pasted garbage before sending to the wire. */
function looksLikeIso(value: string): boolean {
  if (!ISO_RFC3339_RE.test(value)) {
    return false;
  }
  // Reject hand-edited URLs whose Z/offset is well-formed but whose
  // year-month-day combination is invalid (eg. 2024-02-31). Date.parse
  // catches the second class because RFC 3339 is a subset of the JS
  // Date string parser.
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export interface UseAsOfDateResult {
  /** Current as-of timestamp as RFC 3339 string, or null when in live mode. */
  asOf: string | null;
  /** Replace the as-of timestamp. Pass null to return to live state. */
  setAsOf: (iso: string | null) => void;
  /** Convenience alias for setAsOf(null) — returns to live state. */
  clear: () => void;
}

export function useAsOfDate(): UseAsOfDateResult {
  const [value, set] = useUrlState<string>({
    key: AS_OF_QUERY_PARAM,
    defaultValue: '',
    parse: raw => (looksLikeIso(raw) ? raw : undefined),
    serialize: v => v,
  });

  const setAsOf = useCallback(
    (iso: string | null) => {
      if (iso === null || iso === '') {
        set('');
        return;
      }
      if (!looksLikeIso(iso)) {
        // Refuse to write malformed values into the as-of state. Callers
        // should present a date-time picker that emits well-formed RFC 3339.
        return;
      }
      set(iso);
    },
    [set],
  );

  const clear = useCallback(() => set(''), [set]);

  return {
    asOf: value === '' ? null : value,
    setAsOf,
    clear,
  };
}
