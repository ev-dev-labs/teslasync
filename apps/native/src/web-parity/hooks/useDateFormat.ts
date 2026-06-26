/**
 * Native web-parity port of `web/src/hooks/useDateFormat.ts`.
 *
 * Returns locale + tz-aware date formatters bound to the user's settings.
 *
 * Use this hook in callback contexts where a React component (e.g.
 * `<DateTime>`) cannot be inserted — chart `tickFormatter`/`labelFormatter`/
 * `tooltipFormatter`, table cell renderers that produce raw strings, or
 * file-export builders that need a string label.
 *
 * The default `mode` mirrors `settings.tz_display_default` (which is
 * `'vehicle'` out of the box). Pass an explicit `TzMode` to override for a
 * specific surface — e.g. an audit page that wants UTC regardless of the
 * user's preference. Each formatter accepts an optional per-call `override`
 * object so a single timestamp can render in a different zone without
 * spinning up a second hook instance.
 *
 * Returned formatters are `useCallback`-memoized over `locale + tz`, so
 * passing them straight to memoized child props is safe.
 *
 * Native adaptations (the formatter contract itself is unchanged):
 *   - The web hook imported its eight formatters + `FormatOptions` from
 *     `@/lib/dateFormat` and its `TzMode` + `useTimezone` from
 *     `@/lib/timezone`. Neither lib exists in the native web-parity layer, so
 *     — following the established self-contained idiom the converted pages use
 *     (DrivetrainHealthPage / EnergyFlowPage / TripListPage all inline these
 *     `@/lib` helpers) — the eight formatters and the pure `resolveTimezone`/
 *     `browserTimezone` helpers are ported verbatim into this file. They rely
 *     only on `Intl.*`, which the native runtime provides (the converted pages
 *     already call `toLocaleDateString`/`toLocaleTimeString`); `ymdInTz` keeps
 *     the web try/catch so an Intl engine without `timeZone`/`formatToParts`
 *     support degrades to the device-local day instead of throwing.
 *   - The web app-level `@/hooks/useSettings` wrapper (which resolved the
 *     BCP-47 `locale` and exposed the `tz_display_default`/`timezone_user`
 *     prefs) has no native equivalent, so the same `['settings']` query is
 *     read through the native `../api/hooks/useSettings` hook and the locale is
 *     normalised here exactly as the web wrapper did (empty/whitespace ->
 *     'en-US').
 *   - `@/lib/timezone`'s `useTimezone` sourced the vehicle's IANA zone from
 *     `useSelectedVehicle()` (URL > store > first vehicle). The native layer
 *     has no global selected-vehicle context, so — matching the page-parity
 *     precedent — the vehicle zone is taken from the first vehicle of
 *     `useVehicles()`. `resolveTimezone` already falls back to the user zone
 *     when the vehicle has no usable tz, so the 'vehicle' default still works.
 */

import { useCallback, useMemo } from 'react';

import { useSettings } from '../api/hooks/useSettings';
import { useVehicles } from '../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  Ported from web `@/lib/dateFormat` — the eight formatters that      */
/*  `useDateFormat` binds, plus the helpers they transitively need.     */
/*  All timestamps from the backend are ISO 8601 UTC; these helpers     */
/*  render them in the user's locale + timezone while keeping UTC as     */
/*  the source of truth. Every formatter accepts `null | undefined` and  */
/*  invalid input and returns the universal "\u2014" placeholder rather  */
/*  than throwing or producing "Invalid Date" / "NaN:NaN".               */
/* ------------------------------------------------------------------ */

/** Optional locale + timezone overrides for the shared formatters. */
export interface FormatOptions {
  /** IANA timezone name, e.g. 'America/Los_Angeles'. Defaults to browser. */
  tz?: string;
  /** BCP-47 locale, e.g. 'en-US'. Defaults to browser locale. */
  locale?: string;
}

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  if (opts?.tz) {
    return { ...base, timeZone: opts.tz };
  }
  return base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  // Empty / whitespace-only strings would throw RangeError if handed to
  // `Intl.*`. Treat them as "no override" so the runtime falls back to the
  // host's default locale.
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  return undefined;
}

/**
 * Cache of `Intl.DateTimeFormat` instances keyed by `tz|locale|fields`.
 * `Intl.DateTimeFormat` constructors are expensive enough that re-creating
 * one per call (e.g. once per drive in a 10K-row list) is a real cost.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  opts: Intl.DateTimeFormatOptions,
  locale?: string,
): Intl.DateTimeFormat {
  const safeLocale =
    typeof locale === 'string' && locale.trim().length > 0 ? locale : undefined;
  const key = `${safeLocale ?? ''}|${JSON.stringify(opts)}`;
  let fmt = FORMATTER_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(safeLocale, opts);
    FORMATTER_CACHE.set(key, fmt);
  }
  return fmt;
}

/**
 * Extract a `YYYY-MM-DD` string from a Date in the requested timezone.
 * Falls back to the device-local zone when `tz` is unset or when the Intl
 * engine lacks `timeZone`/`formatToParts` support (the catch below).
 */
function ymdInTz(d: Date, tz?: string): string | null {
  if (isNaN(d.getTime())) return null;
  if (!tz) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  try {
    const fmt = getFormatter(
      { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' },
      'en-US',
    );
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function parseYmdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [, ys, ms, ds] = m;
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds));
}

function daysBetweenYmd(target: string, today: string): number {
  const a = parseYmdToUtcMillis(target);
  const b = parseYmdToUtcMillis(today);
  if (a == null || b == null) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Full date + time: "Apr 4, 2026, 2:30 AM" */
function libFormatDateTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleString(
    intlLocale(opts),
    intlOpts(
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
      opts,
    ),
  );
}

/** Date only: "Apr 4, 2026" */
function libFormatDate(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({ year: 'numeric', month: 'short', day: 'numeric' }, opts),
  );
}

/** Short date: "Apr 4" */
function libFormatDateShort(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({ month: 'short', day: 'numeric' }, opts),
  );
}

/** Time only: "02:30" (24h) or "2:30 AM" (based on locale) */
function libFormatTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  const localeArg = intlLocale(opts);
  return d.toLocaleTimeString(
    localeArg ? localeArg : [],
    intlOpts({ hour: '2-digit', minute: '2-digit' }, opts),
  );
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago", else absolute date. */
function libFormatRelative(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return libFormatDate(iso, opts);
}

/**
 * Relative *day*-precision label used by date-grouped feeds. Unlike
 * `libFormatRelative`, this never falls back to an absolute date — it always
 * returns a relative phrase ("Today", "Yesterday", "3d ago", "2w ago",
 * "5mo ago", "1y ago"). Day deltas are computed in the *target* timezone
 * (defaults to the device-local zone) so a drive recorded at 11pm
 * vehicle-local doesn't get reported as "Yesterday" just because the device
 * already rolled to the next day.
 */
function libFormatRelativeDays(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  const targetKey = ymdInTz(d, opts?.tz);
  const todayKey = ymdInTz(new Date(), opts?.tz);
  if (!targetKey || !todayKey) return '\u2014';
  const diffDays = daysBetweenYmd(targetKey, todayKey);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 0) return `in ${Math.abs(diffDays)}d`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/** Relative time matching dashboard activity feeds: "Just now", "5m ago", or "Apr 4, 02:30 AM". */
function libFormatRelativeTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts(
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
      opts,
    ),
  );
}

/** Weekday + short date: "Fri, Apr 4" */
function libFormatDateWithDay(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString(
    intlLocale(opts),
    intlOpts({ weekday: 'short', month: 'short', day: 'numeric' }, opts),
  );
}

/* ------------------------------------------------------------------ */
/*  Ported verbatim from web `@/lib/timezone` — the pure timezone       */
/*  resolver `useTimezone` wrapped. `browserTimezone` falls back to      */
/*  'UTC' when `Intl` is unavailable.                                    */
/* ------------------------------------------------------------------ */

/**
 * Time-zone display modes for rendering timestamps in vehicle, browser, or
 * UTC time while data remains in UTC.
 */
export type TzMode = 'vehicle' | 'user' | 'utc';

/** Resolves the device's IANA timezone, or `'UTC'` if `Intl` is unavailable. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Pure helper to compute the IANA timezone string from a mode + the vehicle's
 * reported tz + the user's optional override.
 *
 * - `mode === 'utc'` -> `'UTC'`
 * - `mode === 'user'` -> `userOverride` if set, else device tz
 * - `mode === 'vehicle'` -> vehicle's IANA tz, or fall back to user when the
 *   vehicle hasn't been polled yet (empty or `'UTC'`).
 */
function resolveTimezone(
  mode: TzMode,
  vehicleTz?: string | null,
  userOverride?: string | null,
): string {
  if (mode === 'utc') return 'UTC';
  const userTz =
    userOverride && userOverride.trim() ? userOverride : browserTimezone();
  if (mode === 'user') return userTz;
  if (!vehicleTz || vehicleTz === 'UTC') return userTz;
  return vehicleTz;
}

/**
 * Locale normalisation — mirrors web `@/lib/locale` `resolveLocale` plus the
 * app-level `useSettings` empty-string guard. The backend may return
 * `locale: ''` when the column has never been written; `??` does NOT catch
 * empty strings, so normalise once here to a valid BCP-47 tag.
 */
function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale;
  return 'en-US';
}

/**
 * Stable formatter signature shared by every helper returned by
 * `useDateFormat`. Each formatter accepts a value and an optional `opts`
 * override (e.g. to render a single timestamp in a different timezone than the
 * rest of the page).
 */
export type DateFormatter = (
  value: string | Date | null | undefined,
  override?: FormatOptions,
) => string;

export interface UseDateFormatResult {
  /** Resolved `{ locale, tz }` for advanced callers that thread their own helpers. */
  opts: FormatOptions;
  /** Effective IANA timezone in use. */
  tz: string;
  /** Effective BCP-47 locale in use. */
  locale: string;
  formatDate: DateFormatter;
  formatDateTime: DateFormatter;
  formatTime: DateFormatter;
  formatDateShort: DateFormatter;
  formatDateWithDay: DateFormatter;
  formatRelative: DateFormatter;
  formatRelativeTime: DateFormatter;
  formatRelativeDays: DateFormatter;
}

export function useDateFormat(mode?: TzMode): UseDateFormatResult {
  // Web: `const { settings, locale } = useSettings()` (app-level wrapper).
  // Native: read the same `['settings']` query + derive the locale here.
  const { data: settings } = useSettings();
  // Web `useTimezone` sourced the vehicle tz from `useSelectedVehicle()`;
  // native has no global selection context, so use the first fleet vehicle.
  const { data: vehicles } = useVehicles();

  const locale = resolveLocale(settings?.locale);
  const effectiveMode = (mode ??
    settings?.tz_display_default ??
    'vehicle') as TzMode;
  const vehicleTz =
    vehicles && vehicles.length > 0 ? vehicles[0].timezone : undefined;
  const tz = resolveTimezone(effectiveMode, vehicleTz, settings?.timezone_user);

  const opts = useMemo<FormatOptions>(() => ({ locale, tz }), [locale, tz]);

  const formatDate = useCallback<DateFormatter>(
    (value, override) => libFormatDate(value, { ...opts, ...override }),
    [opts],
  );
  const formatDateTime = useCallback<DateFormatter>(
    (value, override) => libFormatDateTime(value, { ...opts, ...override }),
    [opts],
  );
  const formatTime = useCallback<DateFormatter>(
    (value, override) => libFormatTime(value, { ...opts, ...override }),
    [opts],
  );
  const formatDateShort = useCallback<DateFormatter>(
    (value, override) => libFormatDateShort(value, { ...opts, ...override }),
    [opts],
  );
  const formatDateWithDay = useCallback<DateFormatter>(
    (value, override) => libFormatDateWithDay(value, { ...opts, ...override }),
    [opts],
  );
  const formatRelative = useCallback<DateFormatter>(
    (value, override) => libFormatRelative(value, { ...opts, ...override }),
    [opts],
  );
  const formatRelativeTime = useCallback<DateFormatter>(
    (value, override) => libFormatRelativeTime(value, { ...opts, ...override }),
    [opts],
  );
  const formatRelativeDays = useCallback<DateFormatter>(
    (value, override) => libFormatRelativeDays(value, { ...opts, ...override }),
    [opts],
  );

  return useMemo(
    () => ({
      opts,
      tz,
      locale,
      formatDate,
      formatDateTime,
      formatTime,
      formatDateShort,
      formatDateWithDay,
      formatRelative,
      formatRelativeTime,
      formatRelativeDays,
    }),
    [
      opts,
      tz,
      locale,
      formatDate,
      formatDateTime,
      formatTime,
      formatDateShort,
      formatDateWithDay,
      formatRelative,
      formatRelativeTime,
      formatRelativeDays,
    ],
  );
}
