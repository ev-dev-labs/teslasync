import { useCallback, useMemo } from 'react'
import {
  formatMonthDayHour as libFormatMonthDayHour,
  formatMonthName as libFormatMonthName,
  formatMonthYear as libFormatMonthYear,
  formatRelativeDays as libFormatRelativeDays,
  formatWeekdayName as libFormatWeekdayName,
} from '@/lib/dateConvert'
import type { FormatOptions } from '@/lib/dateFormat'
import type { DateFormatter } from './useDateFormat'
import { useSettings } from './useSettings'
import { useTimezone, type TzMode } from '@/lib/timezone'

export interface UseDateLabelsResult {
  /** Resolved `{ locale, tz }` for advanced callers that thread their own helpers. */
  opts: FormatOptions
  /** Effective IANA timezone in use. */
  tz: string
  /** Effective BCP-47 locale in use. */
  locale: string
  /** Month-year label; calendar values stay zone-stable, instants use the zone. */
  formatMonthYear: DateFormatter
  /** Month name; calendar values and 1–12 numbers stay zone-stable. */
  formatMonthName: (
    value: string | number | Date | null | undefined,
    override?: FormatOptions,
  ) => string
  /** Short weekday name in the target zone. */
  formatWeekdayName: DateFormatter
  /** Compact chart-axis label ("Oct 1, 02 AM"); accepts epoch millis. */
  formatMonthDayHour: (
    value: string | Date | number | null | undefined,
    override?: FormatOptions,
  ) => string
  /** Day-precision relative label ("Today", "Yesterday", "3d ago"). */
  formatRelativeDays: DateFormatter
}

/**
 * Narrow an arbitrary runtime value to a {@link TzMode}. Local copy
 * (mirrors the private one in `@/lib/timezone` and the one in
 * `./useDateFormat`): hooks must not gain imports from that widely-mocked
 * module beyond `useTimezone`, or tests with explicit mocks break.
 */
function isTzMode(value: unknown): value is TzMode {
  return value === 'vehicle' || value === 'user' || value === 'utc'
}

/**
 * Route-side calendar-label formatters bound to the user's settings:
 * month-year, month name, weekday name and compact chart-axis labels.
 *
 * Lives apart from `useDateFormat` on purpose: the app shell never needs
 * these labels, so keeping them out of the shell hook keeps their
 * implementations out of the cold-start (startup closure) bundle.
 * Route code that already uses `useDateFormat` for other methods calls
 * this hook alongside it with the same `mode` semantics.
 */
export function useDateLabels(mode?: TzMode): UseDateLabelsResult {
  const { settings, locale } = useSettings()
  const requestedMode = mode ?? settings.tz_display_default
  const effectiveMode: TzMode = isTzMode(requestedMode) ? requestedMode : 'vehicle'
  const tz = useTimezone(effectiveMode)

  const opts = useMemo<FormatOptions>(() => ({ locale, tz }), [locale, tz])

  const formatMonthYear = useCallback<DateFormatter>(
    (value, override) => libFormatMonthYear(value, { ...opts, ...override }),
    [opts],
  )
  const formatMonthName = useCallback<UseDateLabelsResult['formatMonthName']>(
    (value, override) => libFormatMonthName(value, { ...opts, ...override }),
    [opts],
  )
  const formatWeekdayName = useCallback<DateFormatter>(
    (value, override) => libFormatWeekdayName(value, { ...opts, ...override }),
    [opts],
  )
  const formatMonthDayHour = useCallback<UseDateLabelsResult['formatMonthDayHour']>(
    (value, override) => libFormatMonthDayHour(value, { ...opts, ...override }),
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
      formatMonthYear,
      formatMonthName,
      formatWeekdayName,
      formatMonthDayHour,
      formatRelativeDays,
    }),
    [
      opts,
      tz,
      locale,
      formatMonthYear,
      formatMonthName,
      formatWeekdayName,
      formatMonthDayHour,
      formatRelativeDays,
    ],
  )
}
