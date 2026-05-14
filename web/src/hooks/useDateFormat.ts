import { useCallback, useMemo } from 'react'
import {
  formatDate as libFormatDate,
  formatDateTime as libFormatDateTime,
  formatTime as libFormatTime,
  formatDateShort as libFormatDateShort,
  formatDateWithDay as libFormatDateWithDay,
  formatRelative as libFormatRelative,
  formatRelativeTime as libFormatRelativeTime,
  formatRelativeDays as libFormatRelativeDays,
  type FormatOptions,
} from '@/lib/dateFormat'
import { useSettings } from './useSettings'
import { useTimezone, type TzMode } from '@/lib/timezone'

/**
 * Stable formatter signature shared by every helper returned by
 * `useDateFormat`. Each formatter accepts a value and an optional `opts`
 * override (e.g. to render a single timestamp in a different timezone
 * than the rest of the page).
 */
export type DateFormatter = (
  value: string | Date | null | undefined,
  override?: FormatOptions,
) => string

export interface UseDateFormatResult {
  /** Resolved `{ locale, tz }` for advanced callers that thread their own helpers. */
  opts: FormatOptions
  /** Effective IANA timezone in use. */
  tz: string
  /** Effective BCP-47 locale in use. */
  locale: string
  formatDate: DateFormatter
  formatDateTime: DateFormatter
  formatTime: DateFormatter
  formatDateShort: DateFormatter
  formatDateWithDay: DateFormatter
  formatRelative: DateFormatter
  formatRelativeTime: DateFormatter
  formatRelativeDays: DateFormatter
}

/**
 * Returns locale + tz-aware date formatters bound to the user's settings.
 *
 * Use this hook in callback contexts where a React component (e.g.
 * `<DateTime>`) cannot be inserted — Recharts `tickFormatter`/
 * `labelFormatter`/`tooltipFormatter`, table cell renderers that produce
 * raw strings, file-export builders that need a string label.
 *
 * The default `mode` mirrors `settings.tz_display_default` (which is
 * `'vehicle'` out of the box). Pass an explicit `TzMode` to override
 * for a specific surface — e.g. an audit page that wants UTC regardless
 * of the user's preference. Each formatter accepts an optional per-call
 * `override` object so a single timestamp can render in a different
 * zone without spinning up a second hook instance.
 *
 * Returned formatters are `useCallback`-memoized over `locale + tz`, so
 * passing them straight to memoized child props is safe.
 */
export function useDateFormat(mode?: TzMode): UseDateFormatResult {
  const { settings, locale } = useSettings()
  const effectiveMode = (mode ?? settings.tz_display_default ?? 'vehicle') as TzMode
  const tz = useTimezone(effectiveMode)

  const opts = useMemo<FormatOptions>(() => ({ locale, tz }), [locale, tz])

  const formatDate = useCallback<DateFormatter>(
    (value, override) => libFormatDate(value, { ...opts, ...override }),
    [opts],
  )
  const formatDateTime = useCallback<DateFormatter>(
    (value, override) => libFormatDateTime(value, { ...opts, ...override }),
    [opts],
  )
  const formatTime = useCallback<DateFormatter>(
    (value, override) => libFormatTime(value, { ...opts, ...override }),
    [opts],
  )
  const formatDateShort = useCallback<DateFormatter>(
    (value, override) => libFormatDateShort(value, { ...opts, ...override }),
    [opts],
  )
  const formatDateWithDay = useCallback<DateFormatter>(
    (value, override) => libFormatDateWithDay(value, { ...opts, ...override }),
    [opts],
  )
  const formatRelative = useCallback<DateFormatter>(
    (value, override) => libFormatRelative(value, { ...opts, ...override }),
    [opts],
  )
  const formatRelativeTime = useCallback<DateFormatter>(
    (value, override) => libFormatRelativeTime(value, { ...opts, ...override }),
    [opts],
  )
  const formatRelativeDays = useCallback<DateFormatter>(
    (value, override) => libFormatRelativeDays(value, { ...opts, ...override }),
    [opts],
  )

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
  )
}
