package io.teslasync.android.widgets

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlin.math.abs
import kotlin.math.roundToLong

/** The em-dash shown by widgets wherever a value is unknown (matches the shared formatter fallback). */
internal const val WIDGET_EM_DASH: String = "\u2014"

private const val METERS_PER_KM: Double = 1000.0
private const val METERS_PER_MILE: Double = 1609.344
private const val CENTS_PER_UNIT: Int = 100
private const val MIN_PERCENT: Int = 0
private const val MAX_PERCENT: Int = 100

/*
 * Widget-local display formatting for the few figures the shared UnitFormatter does not cover
 * (battery percent, integer counts, a cost in minor units, and lifetime efficiency). SI->unit
 * conversion for distance / energy / power / duration / temperature still goes through the shared
 * formatter; these helpers only handle the dimensionless / derived values, and are pure so the gate
 * tests them exactly.
 */

/** Clamps a raw battery level to a 0..100 percent, or `null` when absent. */
fun socPercentOf(batteryLevel: Long?): Int? {
    if (batteryLevel == null) return null
    return batteryLevel.toInt().coerceIn(MIN_PERCENT, MAX_PERCENT)
}

/** Renders an integer [percent] as `"82%"`, or the em-dash when `null`. */
fun formatPercent(percent: Int?): String = percent?.let { "$it%" } ?: WIDGET_EM_DASH

/** Renders a non-negative [count] for a counter chip. */
fun formatCount(count: Int): String = count.coerceAtLeast(0).toString()

/**
 * Renders a cost held in integer minor units (cents) as a plain major-unit decimal (`"12.34"`),
 * or the em-dash when `null`. No currency symbol is fabricated: the backend summary carries no
 * currency code, so the widget shows the localizable amount under a "Cost" label rather than
 * guessing a symbol.
 */
fun formatCostFromCents(cents: Int?): String {
    if (cents == null) return WIDGET_EM_DASH
    val magnitude = abs(cents)
    val body = "${magnitude / CENTS_PER_UNIT}.${(magnitude % CENTS_PER_UNIT).toString().padStart(2, '0')}"
    return if (cents < 0) "-$body" else body
}

/**
 * Lifetime energy efficiency as watt-hours per display distance unit, derived from the SI totals
 * ([energyWh] over [distanceM]) so it is independent of any single backend efficiency field's unit.
 * Returns `null` when there is no distance to divide by (or a non-finite input).
 */
fun efficiencyWhPerDistanceUnit(
    energyWh: Double,
    distanceM: Double,
    distance: DistanceUnitPref,
): Double? {
    if (distanceM <= 0.0 || !energyWh.isFinite() || !distanceM.isFinite()) return null
    val metersPerUnit = if (distance == DistanceUnitPref.MI) METERS_PER_MILE else METERS_PER_KM
    return energyWh / distanceM * metersPerUnit
}

/** Renders lifetime efficiency as `"234 Wh/km"` (per the user's distance unit), or the em-dash. */
fun formatEfficiency(
    energyWh: Double,
    distanceM: Double,
    formatter: UnitFormatter,
): String {
    val whPerUnit = efficiencyWhPerDistanceUnit(energyWh, distanceM, formatter.prefs.distance) ?: return WIDGET_EM_DASH
    return "${whPerUnit.roundToLong()} Wh/${formatter.prefs.distance.label}"
}
