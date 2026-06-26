// Native parity port of web/src/hooks/useUrlState.ts.
//
// The web hook is a `useState`-compatible family that mirrors a single piece of
// UI state into the browser URL query string, backed by react-router-dom v6's
// `useSearchParams`/`URLSearchParams` (web L1-2). React Native ships no URL bar,
// no query string, and no react-router-dom, and apps/native installs no routing
// dependency, so this port keeps EVERY exported name + type + semantic verbatim
// (UrlStateOptions, UrlStateSetOptions, UrlStateSetter, useUrlState, useUrlString,
// useUrlBoolean, useUrlNumber, useUrlEnum, useUrlArray, UrlBatchUpdate,
// UrlBatchSetOptions, useUrlBatch) and swaps only the browser backing store:
//
//   - react-router-dom `useSearchParams` (web L2) -> a native-safe in-process
//     `useSearchParams` (defined below) backed by a module-level singleton
//     `NativeSearchParams` store + React `useSyncExternalStore`. On the web a
//     single URL is shared by the whole document and react-router re-renders
//     every consumer on navigation; here a single module-level store is shared
//     by the whole app process and `useSyncExternalStore` re-renders every
//     mounted consumer on write, so cross-component reads/writes still see one
//     another (e.g. a `useUrlState` write is observed by a sibling `useUrlBatch`)
//     exactly as on the web. This is the established `useSidebarStyle` /
//     ThemeProvider in-process-store precedent for browser-only persistence.
//   - global `URLSearchParams` (web L2, used at L103 & L276) -> a self-contained
//     `NativeSearchParams` class implementing exactly the subset the hook uses
//     (copy-construct, get/set/delete, plus toString for change detection). RN's
//     device `URLSearchParams` polyfill is incomplete, so a local shim guarantees
//     identical behavior across Jest (Node) and on-device runtimes.
//   - the setter's `{ replace }` / `{ push }` history option (web L17, L53-55,
//     L128, L233-234, L286): browser history is unavailable on React Native, so
//     the option is accepted for call-site parity but is a no-op (no history
//     entry is added and there is no back-navigation). The functional updater
//     still receives the params snapshot from the CURRENT render (mirroring
//     react-router v6's `searchParams` closure), so two single-key setters fired
//     in one synchronous tick still race and `useUrlBatch` remains THE safe
//     multi-key path — the web contract documented at L57-67 & L237-265 is
//     preserved unchanged, not silently "fixed".
//
// Native-unavailable state (contract rule 7): the mirrored value lives only in
// the in-process store. It is NOT reflected in any URL, is NOT shareable /
// bookmarkable / restored-on-reload, and does NOT survive an app restart; within
// a session every read/write/default-omission/parse/serialize behaves exactly
// like the web hook. See URL_STATE_NATIVE_UNAVAILABLE_REASON.
//
// No DOM, window, react-router-dom, URL bar, Recharts, Leaflet, or web-UI
// imports reach the native output — only react's
// useCallback/useMemo/useRef/useSyncExternalStore.

import {useCallback, useMemo, useRef, useSyncExternalStore} from 'react';

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
 *     from the store by default (`omitDefault`). This keeps URLs clean and
 *     means "fresh page" looks like the canonical version of that page.
 *
 * Why not store everything in the URL?
 *   - User preferences ("default sort = newest") belong in Settings.
 *   - Per-device chrome ("sidebar collapsed") belongs in localStorage.
 *   - Sensitive data must never be in the URL.
 *   See `docs/URL_STATE_GUIDELINES.md`.
 *
 * Native adaptation: React Native has no URL query string or react-router-dom,
 * so the state is mirrored into a per-process in-memory search-params store
 * instead of the address bar — it is not shareable / bookmarkable / restored on
 * reload, and `{ push }` is a no-op (no browser history). See the file header
 * and {@link URL_STATE_NATIVE_UNAVAILABLE_REASON}.
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
 * call ≥ 2 of these setters in the same synchronous handler — like
 * react-router-dom v6, the second update will discard the first because both
 * callbacks read the SAME params snapshot from the current render.
 * Use {@link useUrlBatch} for multi-key updates.
 */
export type UrlStateSetter<T> = (
  value: T | ((prev: T) => T),
  options?: UrlStateSetOptions,
) => void;

/* ------------------------------------------------------------------ */
/*  Native-safe search-params backing store (web react-router-dom)     */
/* ------------------------------------------------------------------ */

/**
 * Why useUrlState mirrors into an in-process store rather than the URL on
 * React Native.
 */
export const URL_STATE_NATIVE_UNAVAILABLE_REASON =
  'React Native has no URL query string and apps/native ships no react-router-dom, so useUrlState mirrors UI state into a per-process in-memory search-params store instead of the browser address bar. Within a session reads, writes, default omission, parse and serialize behave exactly like the web hook and every mounted consumer re-renders on change via useSyncExternalStore, but the value is NOT reflected in any URL, is NOT shareable / bookmarkable / restored-on-reload, the { push } history option is a no-op (there is no browser history or back-navigation), and the value does not survive an app restart.';

/**
 * Native-safe replacement for the global `URLSearchParams` used by the web
 * hook (web L103, L276). Implements exactly the subset useUrlState/useUrlBatch
 * rely on — copy-construction, `get`/`set`/`delete`, and `toString` (used only
 * for change detection) — with the same single-value-per-key contract the hook
 * exercises (`set` replaces, `get` returns the value or `null`). A local shim
 * is used rather than the device `URLSearchParams` polyfill (which is
 * incomplete on React Native) so behavior is identical under Jest and on-device.
 */
class NativeSearchParams {
  private readonly store: Map<string, string>;

  constructor(init?: NativeSearchParams) {
    this.store = init ? new Map(init.store) : new Map();
  }

  get(name: string): string | null {
    const value = this.store.get(name);
    return value === undefined ? null : value;
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }

  delete(name: string): void {
    this.store.delete(name);
  }

  has(name: string): boolean {
    return this.store.has(name);
  }

  /** Stable serialization, used only to detect no-op writes (never displayed). */
  toString(): string {
    const parts: string[] = [];
    for (const [name, value] of this.store) {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
    return parts.join('&');
  }
}

interface NativeNavigateOptions {
  /** Browser history control on the web; a no-op on React Native. */
  replace?: boolean;
}

type NativeSearchParamsInit =
  | NativeSearchParams
  | ((prev: NativeSearchParams) => NativeSearchParams);

type SetNativeSearchParams = (
  nextInit: NativeSearchParamsInit,
  navigateOpts?: NativeNavigateOptions,
) => void;

// Module-level singleton: the whole app process shares one search-params store,
// mirroring the single shared URL the web hook reads from react-router-dom.
let currentSearchParams = new NativeSearchParams();
const searchParamsListeners = new Set<() => void>();

function getSearchParamsSnapshot(): NativeSearchParams {
  return currentSearchParams;
}

function subscribeSearchParams(onStoreChange: () => void): () => void {
  searchParamsListeners.add(onStoreChange);
  return () => {
    searchParamsListeners.delete(onStoreChange);
  };
}

function commitSearchParams(next: NativeSearchParams): void {
  // Keep the snapshot referentially stable when nothing actually changed so
  // useSyncExternalStore doesn't loop, and skip notifying for no-op writes
  // (navigating to the same params is a no-op on the web too).
  if (next.toString() === currentSearchParams.toString()) {
    return;
  }
  currentSearchParams = next;
  for (const cb of searchParamsListeners) {
    cb();
  }
}

/**
 * Native-safe analogue of react-router-dom v6's `useSearchParams`. Returns the
 * current params snapshot plus a setter whose functional updater receives the
 * params from THIS render (like react-router's `searchParams` closure), so the
 * documented multi-setter race is preserved and {@link useUrlBatch} stays the
 * safe multi-key path. The `{ replace }` history option is accepted for parity
 * but is a no-op on React Native.
 */
function useSearchParams(): [NativeSearchParams, SetNativeSearchParams] {
  const params = useSyncExternalStore(
    subscribeSearchParams,
    getSearchParamsSnapshot,
    getSearchParamsSnapshot,
  );

  const setParams = useCallback<SetNativeSearchParams>(
    (nextInit, _navigateOpts) => {
      const next =
        typeof nextInit === 'function'
          ? nextInit(params)
          : new NativeSearchParams(nextInit);
      commitSearchParams(next);
    },
    [params],
  );

  return [params, setParams];
}

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `raw` only, matching the web hook's intentional stable-reference memo
  }, [raw]);

  const set = useCallback<UrlStateSetter<T>>(
    (value, setOpts) => {
      setParams(
        (prev) => {
          const next = new NativeSearchParams(prev);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listing the individual opts fields (not the `opts` object) is intentional, matching the web hook
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the joined string so the array reference stays stable, matching the web hook
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
 * Why: like react-router-dom v6's `useSearchParams`, the setter's functional
 * updater reads the params snapshot from the current render. Two synchronous
 * setter calls within the same tick both see the SAME `prev` snapshot, and the
 * second update discards the first.
 *
 * ```ts
 * // ❌ Race — only `to` survives:
 * setFromStr('2025-01-15');
 * setToStr('2025-01-22');
 *
 * // ✅ Atomic — both keys land in one update:
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
          const next = new NativeSearchParams(prev);
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
