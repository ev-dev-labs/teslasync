import { useCallback, useMemo } from 'react'
import { useUnits, type UnitFormatter } from './useUnits'
import { convertPressureFromSI, type PressureUnitPref } from '@/lib/unitConversion'

export interface UsePressureFormatResult {
  /** Pressure unit pref ('bar' | 'psi'). */
  pressureUnit: PressureUnitPref
  /**
   * Convert a Pascals-source value to the user's preferred pressure unit
   * as a NUMBER. Use this in chart-axis tickFormatters / reference-line
   * positions / data-mappers where Recharts needs a numeric value rather
   * than a formatted string.
   */
  toPressureValue: (pa: number | null | undefined) => number | null
  /**
   * Format a Pascals-source value as a localized string with the
   * user-preferred unit suffix already appended (e.g. `"2.4 bar"`).
   * Equivalent to `useUnits().formatPressure`, surfaced here for
   * symmetry with `toPressureValue` so widgets that need both can take
   * a single hook dependency.
   */
  formatPressureValue: UnitFormatter
}

/**
 * Reusable bridge for surfaces that need BOTH a numeric converted
 * pressure value (e.g. for plotting on a Recharts axis) AND a
 * formatted display string (e.g. for the legend / tooltip / summary
 * tile). Built on top of `useUnits()` so a single source of truth
 * governs both projections.
 *
 * Without this hook, widgets historically duplicated the conversion in
 * two places (one for the chart datum, one for the formatted display
 * string), which was the original source of `decimal_precision`-pref
 * drift and inconsistent unit suffixes between tooltips and chips.
 */
export function usePressureFormat(): UsePressureFormatResult {
  const { unitPrefs, formatPressure } = useUnits()

  const toPressureValue = useCallback(
    (pa: number | null | undefined): number | null => {
      if (pa == null || !Number.isFinite(pa)) return null
      return convertPressureFromSI(pa, unitPrefs.pressure)
    },
    [unitPrefs.pressure],
  )

  return useMemo(
    () => ({
      pressureUnit: unitPrefs.pressure,
      toPressureValue,
      formatPressureValue: formatPressure,
    }),
    [unitPrefs.pressure, toPressureValue, formatPressure],
  )
}
