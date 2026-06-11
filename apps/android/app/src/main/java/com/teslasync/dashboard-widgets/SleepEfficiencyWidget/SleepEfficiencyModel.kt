// Pure, framework-free model + projection for the Sleep Efficiency dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The `/analytics/sleep` feed arrives as raw JSON, so this file owns
// the decode (web optional-chaining → null-safe reads), the `efficiencyColor` band heuristic (the
// gauge tint), and the three gauge-hero stats: average daily drain (the Sentry-off %/hr scaled to
// %/day), total sleep hours (the asleep + offline minutes rolled to hours), and the wake-event count.
// Sleep efficiency, drain and wake counts are unitless figures (percent / hours / count), so there is
// no SI conversion at this boundary — only the web `fmtNumber` formatting is reproduced via the shared
// [ChartFormat].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SleepEfficiencyWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sleepefficiency

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` branch reproduces the web `isCompact = size.cols <= 1` test that hides the title/icon and
 * the stat row, leaving just the small radial gauge.
 */
data class SleepEfficiencySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): render the compact gauge only. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`sleep-efficiency`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object SleepEfficiencyRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "sleep-efficiency"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "SleepEfficiencyWidget"

    /** Default footprint: 1 column × 2 rows (web `defaultSize`). */
    val defaultSize = SleepEfficiencySize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = SleepEfficiencySize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val maxSize = SleepEfficiencySize(cols = 3, rows = 40)

    /** True when [size] lies within the inclusive min/max footprint. */
    fun withinBounds(size: SleepEfficiencySize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SleepEfficiencySize): SleepEfficiencySize =
        SleepEfficiencySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded `state_distribution` bucket — the share of parked time the car spent in a given power
 * state. Only the `asleep` + `offline` buckets feed the "Total Sleep" stat (web `dist.filter(s.state
 * === 'asleep' || s.state === 'offline')`); the rest are decoded but unused here.
 */
data class SleepStateBucket(
    val state: String,
    val totalMinutes: Double,
)

/**
 * The decoded `/analytics/sleep` payload reduced to the four fields the web component reads. The web
 * treats the whole response as nullable (`data?.…`) and each field with a `?? 0` / `?? []` fallback;
 * this decode preserves that — a present body always yields a snapshot (even an all-zero one, so the
 * gauge renders at 0 %), and a non-object body yields `null` so the surface shows its empty state.
 */
data class SleepEfficiencySnapshot(
    val sleepEfficiencyPct: Double,
    val sentryOffDrainRate: Double,
    val stateDistribution: List<SleepStateBucket>,
    val recentEventCount: Int,
) {
    companion object {
        /**
         * Project an `/analytics/sleep` body into a tolerant snapshot, or `null` when the body is
         * absent / not an object (web parity: the `data ?` falsy gate renders the "No sleep efficiency
         * data" empty state). A present object — including an all-zero body — decodes to a snapshot so
         * the gauge renders, mirroring the web `data != null` truthiness check.
         */
        fun fromJson(element: JsonElement): SleepEfficiencySnapshot? {
            val obj = element as? JsonObject ?: return null
            return SleepEfficiencySnapshot(
                sleepEfficiencyPct = obj.numberOrNull("sleep_efficiency_pct") ?: 0.0,
                sentryOffDrainRate = obj.numberOrNull("sentry_off_drain_rate") ?: 0.0,
                stateDistribution = obj.stateDistribution(),
                recentEventCount = obj.arrayOrNull("recent_events")?.size ?: 0,
            )
        }
    }
}

/**
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [SleepEfficiencyProjection.project] stays
 * pure and JVM-testable. Keys mirror the web `t('widget.sleepEfficiency.*')` calls verbatim. The title
 * + "No sleep efficiency data" strings are render-only chrome (the projection never needs them) and are
 * resolved directly in the composable.
 */
data class SleepEfficiencyLabels(
    val efficiency: String,
    val avgDrain: String,
    val totalSleep: String,
    val hours: String,
    val wakeEvents: String,
)

/**
 * The efficiency band a value falls into — the native analogue of the web `efficiencyColor` buckets
 * (> 95 → green, > 85 → amber, else red). Mapped to a concrete semantic color at the render boundary
 * (good → success, fair → warning, poor → danger) so no hex literal leaks into the view.
 */
enum class EfficiencyBand { Good, Fair, Poor }

/**
 * One projected, render-ready gauge-hero stat — the native analogue of a web `stats[]` entry. Carries
 * the [key] (the web React list key), the localized [label], the already-formatted [value] (web
 * `fmtNumber` / raw count), and the optional [unit] the view renders in a smaller style next to it.
 */
data class SleepEfficiencyStat(
    val key: String,
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The fully projected, render-ready view of one sleep-efficiency card — the native analogue of
 * everything the web component computes before returning JSX (the `gauge` / `stats` `useMemo`s). Pure
 * data (no Compose types) so the projection is unit-tested without a UI host. The [stats] are empty at
 * a compact footprint (web `WidgetGaugeHero compact` hides them) and the [efficiencyLabel] is blank
 * there (web `isCompact ? '' : t('…efficiency')`).
 */
data class SleepEfficiencyDisplay(
    val efficiencyValue: Double,
    val efficiencyDecimals: Int,
    val efficiencyLabel: String,
    val efficiencyUnit: String,
    val band: EfficiencyBand,
    val stats: List<SleepEfficiencyStat>,
)

/**
 * Pure projection from a decoded [SleepEfficiencySnapshot] to the render-ready [SleepEfficiencyDisplay]
 * — the native port of the `gauge` / `avgDrainPerDay` / `totalSleepHours` / `wakeEventsCount`
 * derivations in the web source. Numbers are formatted via the shared [ChartFormat] (web `fmtNumber`);
 * [locale] drives the grouping/separators (tests pin [Locale.US]).
 */
object SleepEfficiencyProjection {
    /** The fixed gauge scale (web `max={100}`). */
    const val EFFICIENCY_MAX = 100.0

    /** Efficiency strictly above this is the green/good band (web `efficiencyColor` `pct > 95`). */
    const val GOOD_MIN = 95.0

    /** Efficiency strictly above this (and not [GOOD_MIN]) is the amber/fair band (web `pct > 85`). */
    const val FAIR_MIN = 85.0

    private const val PERCENT_UNIT = "%"
    private const val WHOLE_DECIMALS = 0
    private const val FRACTIONAL_DECIMALS = 2
    private const val DRAIN_DECIMALS = 2
    private const val HOURS_PER_DAY = 24.0
    private const val MINUTES_PER_HOUR = 60.0
    private const val ASLEEP_STATE = "asleep"
    private const val OFFLINE_STATE = "offline"

    /**
     * Project [snapshot] for the given footprint using the localized [labels]: the gauge value/band and
     * — only when not [compact] — the three stats (average daily drain, total sleep, wake events), in
     * the exact web order. The gauge label and the stat row are dropped at a compact footprint, exactly
     * as the web `WidgetGaugeHero` does.
     */
    fun project(
        snapshot: SleepEfficiencySnapshot,
        labels: SleepEfficiencyLabels,
        compact: Boolean,
        locale: Locale = Locale.US,
    ): SleepEfficiencyDisplay {
        val efficiency = snapshot.sleepEfficiencyPct
        return SleepEfficiencyDisplay(
            efficiencyValue = efficiency,
            efficiencyDecimals = if (isWhole(efficiency)) WHOLE_DECIMALS else FRACTIONAL_DECIMALS,
            efficiencyLabel = if (compact) "" else labels.efficiency,
            efficiencyUnit = PERCENT_UNIT,
            band = bandFor(efficiency),
            stats = if (compact) emptyList() else stats(snapshot, labels, locale),
        )
    }

    /** The efficiency band for [pct] (web `efficiencyColor` thresholds: strictly `> 95` / `> 85`). */
    fun bandFor(pct: Double): EfficiencyBand =
        when {
            pct > GOOD_MIN -> EfficiencyBand.Good
            pct > FAIR_MIN -> EfficiencyBand.Fair
            else -> EfficiencyBand.Poor
        }

    /**
     * Total hours the car spent asleep — the sum of the `asleep` + `offline` `state_distribution`
     * minutes divided by 60 (web `sleepMinutes / 60`). Buckets in any other state are ignored.
     */
    fun totalSleepHours(snapshot: SleepEfficiencySnapshot): Double =
        snapshot.stateDistribution
            .filter { it.state == ASLEEP_STATE || it.state == OFFLINE_STATE }
            .sumOf { it.totalMinutes } / MINUTES_PER_HOUR

    private fun stats(
        snapshot: SleepEfficiencySnapshot,
        labels: SleepEfficiencyLabels,
        locale: Locale,
    ): List<SleepEfficiencyStat> {
        val drainPerDay = snapshot.sentryOffDrainRate * HOURS_PER_DAY
        return listOf(
            SleepEfficiencyStat(
                key = "avgDrain",
                label = labels.avgDrain,
                value = ChartFormat.number(drainPerDay, DRAIN_DECIMALS, locale),
                unit = PERCENT_UNIT,
            ),
            SleepEfficiencyStat(
                key = "totalSleep",
                label = labels.totalSleep,
                value = ChartFormat.number(totalSleepHours(snapshot), WHOLE_DECIMALS, locale),
                unit = labels.hours,
            ),
            SleepEfficiencyStat(
                key = "wakeEvents",
                label = labels.wakeEvents,
                value = snapshot.recentEventCount.toString(),
                unit = null,
            ),
        )
    }

    private fun isWhole(value: Double): Boolean = value % 1.0 == 0.0
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** Reads an array property, or `null` when absent / not a JSON array. */
private fun JsonObject.arrayOrNull(key: String): JsonArray? = this[key] as? JsonArray

/**
 * Decodes the `state_distribution` array into [SleepStateBucket]s, tolerating a missing/!array field
 * (web `?? []`) and skipping any element that is not an object or lacks a `state` string; a missing
 * `total_minutes` defaults to zero (web `s.total_minutes ?? 0`).
 */
private fun JsonObject.stateDistribution(): List<SleepStateBucket> =
    arrayOrNull("state_distribution")
        ?.mapNotNull { element ->
            val bucket = element as? JsonObject ?: return@mapNotNull null
            val state = bucket.stringOrNull("state") ?: return@mapNotNull null
            SleepStateBucket(state = state, totalMinutes = bucket.numberOrNull("total_minutes") ?: 0.0)
        }.orEmpty()
