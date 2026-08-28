/**
 * Centralized date/time formatting utilities.
 *
 * All timestamps from the backend are ISO 8601 UTC (ending in "Z").
 * These helpers convert to the user's local timezone for display,
 * keeping the source-of-truth as UTC.
 *
 * Every helper accepts an optional second
 * `FormatOptions` argument carrying an IANA timezone name and a BCP-47
 * locale. When omitted the helper preserves its prior behavior (browser
 * locale + browser timezone) so existing callers stay byte-for-byte
 * identical. When `tz` is supplied the timestamp is rendered in that
 * zone via `Intl.DateTimeFormat`, which is what `<DateTime in="vehicle">`
 * relies on to render drive/charge times in the car's local time.
 *
 * Formatter contract:
 * Every formatter in this file accepts `null | undefined` and any garbage
 * numeric input (a non-finite number such as NaN, Infinity, -Infinity, a
 * negative duration, or a non-number masquerading via a cast) and returns
 * the universal "—" placeholder rather than throwing or producing strings
 * like "NaN:NaN" or "Invalid Date". Callers should NOT pre-guard.
 */

import { isFiniteNumber } from './numberFormat'

/** Universal placeholder returned by every formatter for unrenderable input. */
const FALLBACK = '—'

/** Optional locale + timezone overrides for the shared formatters. */
export interface FormatOptions {
  /** IANA timezone name, e.g. 'America/Los_Angeles'. Defaults to browser. */
  tz?: string
  /** BCP-47 locale, e.g. 'en-US'. Defaults to browser locale. */
  locale?: string
}

function intlOpts(base: Intl.DateTimeFormatOptions, opts?: FormatOptions): Intl.DateTimeFormatOptions {
  if (opts?.tz) {
    return { ...base, timeZone: opts.tz }
  }
  return base
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale
  // Empty / whitespace-only strings would throw RangeError if handed to
  // `Intl.*`. Treat them as "no override" so the runtime falls back to
  // the browser's default locale.
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  return undefined
}

/** Full date + time: "Apr 4, 2026, 2:30 AM" */
export function formatDateTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(intlLocale(opts), intlOpts({
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }, opts))
}

/** Date only: "Apr 4, 2026" */
export function formatDate(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    year: 'numeric', month: 'short', day: 'numeric',
  }, opts))
}

/** Short date: "Apr 4" */
export function formatDateShort(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    month: 'short', day: 'numeric',
  }, opts))
}

/** Time only: "02:30" (24h) or "2:30 AM" (based on locale) */
export function formatTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const localeArg = intlLocale(opts)
  return d.toLocaleTimeString(localeArg ? localeArg : [], intlOpts({ hour: '2-digit', minute: '2-digit' }, opts))
}

/** Relative time: "3 min ago", "2 hours ago", "yesterday" */
export function formatRelative(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso, opts)
}

/**
 * Relative *day*-precision label used by date-grouped feeds. Unlike
 * `formatRelative`, this never falls back to an absolute date — it
 * always returns a relative phrase ("Today", "Yesterday", "3d ago",
 * "2w ago", "5mo ago", "1y ago"). Pair it with a separate absolute
 * date label (e.g. group header showing "Apr 24, 2026 · 18d ago").
 *
 * Day deltas are computed in the *target* timezone (defaults to the
 * browser's local zone). Pass `tz` to anchor day boundaries to a
 * specific zone — e.g. the active vehicle's IANA zone — so a drive
 * recorded at 11pm vehicle-local doesn't get reported as "Yesterday"
 * just because the user's browser already rolled to the next day.
 */
export function formatRelativeDays(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const targetKey = ymdInTz(d, opts?.tz)
  if (!targetKey) return '—'
  return formatRelativeDayKey(targetKey, opts)
}

/**
 * Relative day label for an existing `YYYY-MM-DD` calendar key.
 *
 * Unlike converting the key to a UTC instant, this preserves the calendar day
 * chosen by the caller and compares it with "today" in the same target
 * timezone. Use it for grouped list headers whose keys already came from
 * {@link ymdInTz}.
 */
export function formatRelativeDayKey(dayKey: string, opts?: FormatOptions): string {
  if (parseYmdToUtcMillis(dayKey) == null) return FALLBACK
  const todayKey = ymdInTz(new Date(), opts?.tz)
  if (!todayKey) return FALLBACK
  const diffDays = daysBetweenYmd(dayKey, todayKey)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 0) return `in ${Math.abs(diffDays)}d`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

/* ------------------------------------------------------------------ */
/*  Timezone-aware day primitives                                     */
/* ------------------------------------------------------------------ */

/**
 * Cache of `Intl.DateTimeFormat` instances keyed by `tz|locale|fields`.
 * `Intl.DateTimeFormat` constructors are expensive enough that re-creating
 * one per call (e.g. once per drive in a 10K-row list) is a real cost.
 * Module-level memoization keeps the helpers cheap to call in tight loops.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function getFormatter(opts: Intl.DateTimeFormatOptions, locale?: string): Intl.DateTimeFormat {
  // Empty / whitespace-only locale strings would throw `RangeError: Invalid
  // language tag: ` if passed to `Intl.DateTimeFormat`. Coerce to undefined
  // so the runtime falls back to the host default.
  const safeLocale = typeof locale === 'string' && locale.trim().length > 0 ? locale : undefined
  const key = `${safeLocale ?? ''}|${JSON.stringify(opts)}`
  let fmt = FORMATTER_CACHE.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(safeLocale, opts)
    FORMATTER_CACHE.set(key, fmt)
  }
  return fmt
}

/**
 * Extract a `YYYY-MM-DD` string from a Date in the requested timezone.
 * Falls back to the browser's local zone when `tz` is unset. Used as the
 * shared day-key primitive that `formatRelativeDays` and the per-feature
 * day-grouping helpers (e.g. `localDayKey` in `drivesAggregation`) build
 * on, so every "what day is this drive on?" question gives the same
 * answer across the page.
 */
export function ymdInTz(d: Date, tz?: string): string | null {
  if (isNaN(d.getTime())) return null
  if (!tz) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  // Use formatToParts so we get raw numeric components — toLocaleDateString
  // would inject locale separators we'd then have to parse back out.
  try {
    const fmt = getFormatter({
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }, 'en-US')
    const parts = fmt.formatToParts(d)
    const get = (type: string) => parts.find(p => p.type === type)?.value
    const y = get('year')
    const m = get('month')
    const day = get('day')
    if (!y || !m || !day) return null
    return `${y}-${m}-${day}`
  } catch {
    // Invalid IANA tz — fall back to browser-local rather than throwing.
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}

/**
 * Render a `YYYY-MM-DD` day key as a friendly date label without
 * round-tripping through a `Date` (which would re-introduce timezone
 * shift bugs at midnight boundaries). `style: 'long'` returns
 * "Apr 24, 2026", `style: 'short'` returns "Apr 24". Locale-aware via
 * `opts.locale`.
 */
export function formatDayKey(
  key: string,
  opts?: FormatOptions & { style?: 'short' | 'long' },
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return FALLBACK
  const [, ys, ms, ds] = m
  const year = Number(ys)
  const month = Number(ms)
  const day = Number(ds)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return FALLBACK
  // Anchor at UTC noon of the requested calendar day, then format in UTC
  // so the formatter doesn't shift the wall-clock back into a previous
  // day in negative-offset zones. Noon-anchoring also avoids the
  // `new Date('2026-04-24')` UTC-midnight pitfall.
  const noon = new Date(Date.UTC(year, month - 1, day, 12))
  const style = opts?.style ?? 'long'
  const fmtOpts: Intl.DateTimeFormatOptions = style === 'short'
    ? { timeZone: 'UTC', month: 'short', day: 'numeric' }
    : { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }
  return getFormatter(fmtOpts, opts?.locale).format(noon)
}

/**
 * Compute the inclusive day delta `today - target` from two day keys in
 * `YYYY-MM-DD` form. Used by `formatRelativeDays`. Positive when
 * `target` is earlier than `today`. Returns `0` if either key is malformed.
 */
function daysBetweenYmd(target: string, today: string): number {
  const a = parseYmdToUtcMillis(target)
  const b = parseYmdToUtcMillis(today)
  if (a == null || b == null) return 0
  return Math.round((b - a) / 86_400_000)
}

function parseYmdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [, ys, ms, ds] = m
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds))
}

/** Relative time matching dashboard activity feeds: "Just now", "5m ago", or "Apr 4, 02:30 AM" */
export function formatRelativeTime(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return d.toLocaleDateString(intlLocale(opts), intlOpts({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }, opts))
}

/** Millisecond duration for short activity entries: "250ms", "1.5s", or "—" for nullish/non-finite values. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return FALLBACK
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Millisecond duration with decimal minute rollover: "250ms", "1.5s", "2.5m". */
export function formatDurationMsCompact(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return FALLBACK
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

/** Millisecond duration with minute/second output for longer jobs: "1m 05s". */
export function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) return FALLBACK
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${formatRoundedInt(sec % 60)}s`
}

/** Seconds represented as rounded minutes/hours: "5m", "2h 10m", or "2h". */
export function formatDurationSecondsAsMinutes(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return FALLBACK
  const h = Math.floor(seconds / 3600)
  const m = (seconds % 3600) / 60
  if (h === 0) return `${formatRoundedInt(m)}m`
  return m >= 0.5 ? `${h}h ${formatRoundedInt(m)}m` : `${h}h`
}

/** Minute duration with rounded minute remainder: "5m" or "2h 05m". */
export function formatDurationMinutes(
  minutes: number | null | undefined,
  options: { subMinuteLabel?: string } = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) return FALLBACK
  if (options.subMinuteLabel && minutes < 1) return options.subMinuteLabel
  const h = Math.floor(minutes / 60)
  const m = formatRoundedInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Duration between two timestamps, rounded to whole minutes. */
export function formatDurationRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  if (!start || !end) return FALLBACK
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return FALLBACK
  const ms = e - s
  if (ms <= 0) return FALLBACK
  return formatDurationMinutes(Math.round(ms / 60_000))
}

/** Media/player clock duration: "3:07". Returns "—" for nullish, non-finite, or negative durations. */
export function formatDurationClock(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return FALLBACK
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Local datetime string for `<input type="datetime-local">` value: "2026-04-04T14:30:00" */
export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Weekday + short date: "Fri, Apr 4" */
export function formatDateWithDay(iso: string | Date | null | undefined, opts?: FormatOptions): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(intlLocale(opts), intlOpts({
    weekday: 'short', month: 'short', day: 'numeric',
  }, opts))
}

/**
 * Returns the short timezone abbreviation (e.g. "PST", "EDT") for the
 * given timestamp in the given IANA zone. Date-aware so DST transitions
 * are honored — `tzAbbreviation(jan, 'America/Los_Angeles')` yields
 * "PST" while the same call in July yields "PDT".
 */
export function tzAbbreviation(value: string | Date, tz: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
