import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useUrlState — small `useState`-compatible hook that mirrors a single piece
 * of UI state into the URL query string. Designed for filters, tabs and
 * expansion state that the user might share, bookmark or want to restore on
 * reload.
 *
 * Sister convenience hooks (`useUrlBoolean`, `useUrlString`, `useUrlNumber`,
 * `useUrlEnum`, `useUrlArray`) are exported below for the common cases.
 *
 * Semantics:
 *   - Reads are synchronous from `useSearchParams`.
 *   - Writes default to `replace: true` so filter toggles don't pollute the
 *     browser history. Pages that want a real history entry (changing the
 *     primary tab, switching the active vehicle) should call `setX(value, { push: true })`.
 *   - When the new value equals the supplied default, the param is removed
 *     from the URL by default (`omitDefault`). This keeps URLs clean and
 *     means "fresh page" looks like the canonical version of that page.
 *
 * Why not store everything in the URL?
 *   - User preferences ("default sort = newest") belong in Settings.
 *   - Per-device chrome ("sidebar collapsed") belongs in localStorage.
 *   - Sensitive data must never be in the URL.
 *   See `docs/URL_STATE_GUIDELINES.md`.
 */

export interface UrlStateOptions<T> {
  /** Query param name (the bit before `=` in the URL). */
  key: string;
  /** Default value when the param is absent or fails to parse. */
  defaultValue: T;
  /**
   * Convert the raw URL string into `T`. Returning `undefined` falls back to
   * `defaultValue` (use this for validation, e.g. an enum guard).
   */
  parse?: (raw: string) => T | undefined;
  /**
   * Convert `T` back into a URL string. Defaults to `String(value)`.
   * Return `''` to delete the param regardless of `omitDefault`.
   */
  serialize?: (value: T) => string;
  /**
   * When the new value === the default, drop the param from the URL.
   * Defaults to `true`. Set to `false` to keep `?key=default` in the URL
   * (rare — useful when a different default should "win" elsewhere).
   */
  omitDefault?: boolean;
}

export interface UrlStateSetOptions {
  /** Use `pushState` (adds a history entry) instead of the default `replaceState`. */
  push?: boolean;
}

/**
 * Setter for a single URL-mirrored value. Safe in isolation, but DO NOT
 * call ≥ 2 of these setters in the same synchronous handler — under
 * react-router-dom v6 the second `navigate(replace)` will discard the
 * first because both callbacks read the SAME `searchParamsRef` snapshot.
 * Use {@link useUrlBatch} for multi-key updates.
 */
export type UrlStateSetter<T> = (
  value: T | ((prev: T) => T),
  options?: UrlStateSetOptions,
) => void;

/**
 * Hook overload for arbitrary `T` — supply `parse` and `serialize`.
 */
export function useUrlState<T>(opts: UrlStateOptions<T>): [T, UrlStateSetter<T>] {
  const [params, setParams] = useSearchParams();

  const raw = params.get(opts.key);

  // Memoize the parsed value keyed by `raw` so callers receive stable
  // references across renders when the URL hasn't changed. Without this,
  // hooks that return arrays/objects (parse: raw.split(',')) would produce
  // a new reference every render, blowing up downstream `useEffect` deps.
  const lastRaw = useRef<string | null | undefined>(undefined);
  const lastValue = useRef<T>(opts.defaultValue);
  const parsed = useMemo<T>(() => {
    if (lastRaw.current === raw) return lastValue.current;
    let next: T;
    if (raw == null) {
      next = opts.defaultValue;
    } else if (opts.parse) {
      const r = opts.parse(raw);
      next = r === undefined ? opts.defaultValue : r;
    } else {
      next = raw as unknown as T;
    }
    lastRaw.current = raw;
    lastValue.current = next;
    return next;
  }, [raw]);

  const set = useCallback<UrlStateSetter<T>>(
    (value, setOpts) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const resolved =
            typeof value === 'function'
              ? (value as (prev: T) => T)(
                  next.get(opts.key) == null
                    ? opts.defaultValue
                    : opts.parse
                      ? (opts.parse(next.get(opts.key)!) ?? opts.defaultValue)
                      : (next.get(opts.key)! as unknown as T),
                )
              : value;

          const serialized = opts.serialize ? opts.serialize(resolved) : String(resolved);
          const omit = opts.omitDefault !== false;
          const defaultSerialized = opts.serialize
            ? opts.serialize(opts.defaultValue)
            : String(opts.defaultValue);

          if (serialized === '' || (omit && serialized === defaultSerialized)) {
            next.delete(opts.key);
          } else {
            next.set(opts.key, serialized);
          }
          return next;
        },
        { replace: !setOpts?.push },
      );
    },
    [opts.key, opts.defaultValue, opts.parse, opts.serialize, opts.omitDefault, setParams],
  );

  return [parsed, set];
}

/* ------------------------------------------------------------------ */
/*  Convenience overloads                                              */
/* ------------------------------------------------------------------ */

/** String-valued URL param. */
export function useUrlString(
  key: string,
  defaultValue = '',
): [string, UrlStateSetter<string>] {
  return useUrlState<string>({
    key,
    defaultValue,
    parse: (raw) => raw,
    serialize: (v) => v,
  });
}

/** Boolean-valued URL param (encodes as `true` / `false`). */
export function useUrlBoolean(
  key: string,
  defaultValue = false,
): [boolean, UrlStateSetter<boolean>] {
  return useUrlState<boolean>({
    key,
    defaultValue,
    parse: (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined),
    serialize: (v) => (v ? 'true' : 'false'),
  });
}

/** Number-valued URL param. NaN parses fall back to `defaultValue`. */
export function useUrlNumber(
  key: string,
  defaultValue = 0,
): [number, UrlStateSetter<number>] {
  return useUrlState<number>({
    key,
    defaultValue,
    parse: (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    },
    serialize: (v) => String(v),
  });
}

/**
 * Enum-valued URL param. Values not in `allowed` fall back to `defaultValue`,
 * which protects pages from someone hand-editing the URL with an unknown value.
 */
export function useUrlEnum<E extends string>(
  key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, UrlStateSetter<E>] {
  return useUrlState<E>({
    key,
    defaultValue,
    parse: (raw) => (allowed.includes(raw as E) ? (raw as E) : undefined),
    serialize: (v) => v,
  });
}

/**
 * Array-valued URL param, joined with a delimiter (default `,`).
 * Empty arrays drop the param, matching `omitDefault` semantics.
 *
 * The `defaultValue` may be a fresh literal each render — internally we
 * snapshot the joined string so the underlying `useUrlState` sees a stable
 * default identity from one render to the next.
 */
export function useUrlArray(
  key: string,
  defaultValue: readonly string[] = [],
  delimiter = ',',
): [string[], UrlStateSetter<string[]>] {
  // Stabilize the array reference: as long as the joined string hasn't
  // changed, return the same array instance so downstream hooks don't see
  // identity churn from `[].slice()` produced fresh each render.
  const defaultJoined = defaultValue.join(delimiter);
  const stableDefault = useMemo(() => [...defaultValue], [defaultJoined]);
  return useUrlState<string[]>({
    key,
    defaultValue: stableDefault,
    parse: (raw) => (raw === '' ? [] : raw.split(delimiter)),
    serialize: (v) => v.join(delimiter),
  });
}

/* ------------------------------------------------------------------ */
/*  Atomic multi-key updates                                           */
/* ------------------------------------------------------------------ */

export type UrlBatchUpdate = Record<string, string | null | undefined>;

export interface UrlBatchSetOptions {
  /** Use `pushState` (adds a history entry). Defaults to `replaceState`. */
  push?: boolean;
}

/**
 * useUrlBatch — atomically write multiple URL params in a single
 * `setSearchParams` call.
 *
 * Why: react-router-dom v6's `useSearchParams` setter reads from a ref
 * that is only refreshed on the NEXT render. Two synchronous setter
 * calls within the same tick both see the SAME `prev` snapshot, and the
 * second `navigate(..., { replace: true })` discards the first.
 *
 * ```ts
 * // ❌ Race — only `to` survives:
 * setFromStr('2025-01-15');
 * setToStr('2025-01-22');
 *
 * // ✅ Atomic — both keys land in one navigation:
 * setBatch({ from: '2025-01-15', to: '2025-01-22' });
 * ```
 *
 * Deletion semantics:
 *   - value = `null` or `undefined` → delete the key
 *   - value = `''` (empty string) → delete the key (matches existing
 *     `useUrlString` semantics where empty == default)
 *   - value = non-empty string → set the key
 *
 * The single-key `useUrlString / useUrlBoolean / useUrlNumber / useUrlEnum
 * / useUrlArray` setters are still safe in isolation — they're only
 * unsafe when MULTIPLE setters fire in the same synchronous handler.
 * Use this hook whenever you change ≥ 2 URL keys from one user action.
 */
export function useUrlBatch(): (
  updates: UrlBatchUpdate,
  options?: UrlBatchSetOptions,
) => void {
  const [, setParams] = useSearchParams();

  return useCallback(
    (updates, options) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value == null || value === '') {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }
          return next;
        },
        { replace: !options?.push },
      );
    },
    [setParams],
  );
}
