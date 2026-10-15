import { useMemo, useSyncExternalStore } from 'react'
import {
  fmtNumber as formatNumber,
  fmtCompact as formatCompact,
  fmtScientificNumber as formatScientificNumber,
  formatBytes,
  getFormatterPreferences,
  subscribeFormatterPreferences,
} from '@/lib/numberFormat'
import {
  formatDurationMs,
  formatDurationMsCompact,
  formatDurationMsLong,
} from '@/lib/dateFormat'

/**
 * Subscribe to the settings bridge so numeric displays and memoized chart
 * formatters update after preferences change, without a reload or data refetch.
 */
export function useNumberFormatting() {
  const preferences = useSyncExternalStore(
    subscribeFormatterPreferences,
    getFormatterPreferences,
    getFormatterPreferences,
  )

  return useMemo(() => {
    const fmtNumber = (value: unknown, decimals?: number, locale?: string) =>
      formatNumber(value, decimals ?? preferences.precision, locale ?? preferences.locale)
    return {
      precision: preferences.precision,
      locale: preferences.locale,
      formatDurationMs: (value: number | null | undefined) => formatDurationMs(value),
      formatDurationMsCompact: (value: number | null | undefined) => formatDurationMsCompact(value),
      formatDurationMsLong: (value: number | null | undefined) => formatDurationMsLong(value),
      fmtNumber,
      fmtPercent: (value: unknown, decimals?: number) => `${fmtNumber(value, decimals)}%`,
      fmtWithUnit: (value: unknown, unit: string, decimals?: number) => `${fmtNumber(value, decimals)} ${unit}`,
      fmtInt: (value: unknown, locale?: string) => fmtNumber(value, 0, locale),
      fmtCompact: (value: unknown, threshold?: number) => formatCompact(value, threshold),
      fmtScientificNumber: (value: unknown, minimumDecimals: number, locale?: string) =>
        formatScientificNumber(value, minimumDecimals, locale ?? preferences.locale),
      formatBytes: (value: number | null | undefined, options?: Parameters<typeof formatBytes>[1]) =>
        formatBytes(value, { precision: preferences.precision, locale: preferences.locale, ...options }),
    }
  }, [preferences])
}
