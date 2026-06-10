package io.teslasync.android.components.charts

import java.util.Locale

/**
 * Locale-aware number formatting for axes, tooltips, and the accessible fallback
 * table — the Android counterpart of the web `fmtNumber`/`fmt` helpers. Kept as
 * framework-free logic so it runs in the JVM unit-test gate.
 */
object ChartFormat {
    /** Em dash shown for missing / non-finite values (matches the web empty marker). */
    const val EMPTY: String = "\u2014"

    /**
     * Formats [value] with [decimals] fraction digits and locale grouping. Non-finite
     * or `null` values render as [EMPTY] so a sparse series never shows `NaN`.
     */
    fun number(
        value: Double?,
        decimals: Int = 1,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (value == null || value.isNaN() || value.isInfinite()) return EMPTY
        val safeDecimals = decimals.coerceIn(0, MAX_DECIMALS)
        return String.format(locale, "%,.${safeDecimals}f", value)
    }

    /** [number] with a trailing [unit] (e.g. `"60 km"`); the unit is omitted when blank. */
    fun withUnit(
        value: Double?,
        unit: String?,
        decimals: Int = 1,
        locale: Locale = Locale.getDefault(),
    ): String {
        val base = number(value, decimals, locale)
        if (unit.isNullOrBlank() || base == EMPTY) return base
        return "$base $unit"
    }

    private const val MAX_DECIMALS = 6
}
