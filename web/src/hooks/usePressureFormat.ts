import { useCallback, useMemo } from 'react'
import { useUnits, type UnitFormatter } from './useUnits'
import { convertPressureFromSI, type PressureUnitPref } from '@/lib/unitConversion'

/**
 * Pascals per kilopascal. The Tesla telemetry pipeline persists pressure
 * in Pascals (SI on disk) and the API returns it verbatim, but the
 * `@/lib/unitConversion` converters operate on the kilopascal SI-floor.
 * This factor bridges the API wire unit to the lib's expected input so a
 * single source of truth governs both the numeric and formatted output.
 */
const PA_PER_KPA = 1000

export interface UsePressureFormatResult {
  /** Pressure unit pref ('bar' | 'psi'). */
  pressureUnit: PressureUnitPref
  /**
   * Convert a Pascals-source value — the SI unit the Tesla telemetry
   * pipeline persists and the API returns verbatim (e.g. `220000` for
   * 2.2 bar) — to the user's preferred pressure unit as a NUMBER. Use
   * this in chart-axis tickFormatters / reference-line positions /
   * data-mappers where Recharts needs a numeric value rather than a
   * formatted string. Returns `null` for null / undefined / non-finite
   * input.
   */
  toPressureValue: (pa: number | null | undefined) => number | null
  /**
   * Format a Pascals-source value as a localized string with the
   * user-preferred unit suffix already appended (e.g. `"2.2 bar"`).
   * Wraps `useUnits().formatPressure` with the SAME Pascals→kilopascals
   * bridge that `toPressureValue` applies, so the numeric datum and the
   * formatted display string are guaranteed to agree on the same source
   * value — that consistency is the whole reason this hook exists.
   * Non-finite input yields the empty-display fallback (`"—"`).
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
 *
 * It also owns the one unit-system impedance mismatch on the pressure
 * path: the API returns pressure in Pascals (SI on disk), while the
 * `@/lib/unitConversion` converters operate on the kilopascal SI-floor
 * (`SI.pressure === 'kPa'`). Both projections apply the identical
 * `PA_PER_KPA` bridge, so callers hand it raw API Pascals and never
 * re-derive the factor themselves.
 */
export function usePressureFormat(): UsePressureFormatResult {
  const { unitPrefs, formatPressure } = useUnits()

  const toPressureValue = useCallback(
    (pa: number | null | undefined): number | null => {
      if (pa == null || !Number.isFinite(pa)) return null
      return convertPressureFromSI(pa / PA_PER_KPA, unitPrefs.pressure)
    },
    [unitPrefs.pressure],
  )

  const formatPressureValue = useCallback<UnitFormatter>(
    (pa, options) =>
      formatPressure(
        typeof pa === 'number' && Number.isFinite(pa) ? pa / PA_PER_KPA : pa,
        options,
      ),
    [formatPressure],
  )

  return useMemo(
    () => ({
      pressureUnit: unitPrefs.pressure,
      toPressureValue,
      formatPressureValue,
    }),
    [unitPrefs.pressure, toPressureValue, formatPressureValue],
  )
}
