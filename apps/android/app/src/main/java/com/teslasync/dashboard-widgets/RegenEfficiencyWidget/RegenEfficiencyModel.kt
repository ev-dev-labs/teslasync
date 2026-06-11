// Pure, framework-free model + projection for the Regen Braking dashboard widget — the native
// analogue of everything the web component derives (via `useMemo`) before returning JSX
// (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The regen feed arrives as raw SI JSON (`/analytics/regen`), so this
// file owns the decode (web optional-chaining → null-safe reads) plus the display-boundary energy +
// power formatting (Phase-48 SI-canonical rule; web `useUnits`). The recovery percentage, the
// `regenColor` band heuristic, and the en-US integer formatting are reproduced verbatim from the web
// source — including the web `regenPct = regenRatio * 100` derivation (parity, not "corrected").
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RegenEfficiencyWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.regenefficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatPower
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.roundToLong

/** Energy + power stat precision (web `formatEnergy(…, { precision: 1 })` / `formatPower(…, { precision: 1 })`). */
private const val STAT_PRECISION = 1

/** Free-charges integer precision (web `fmtInt(...)` ⇒ zero fraction digits). */
private const val FREE_CHARGES_DECIMALS = 0

/**
 * One decoded `GET /analytics/regen?vehicle_id=` card — the native mirror of the web
 * `RegenEfficiencyData` type (web/src/types/driving.ts) restricted to the fields this widget renders.
 * Field names mirror the Go API's snake_case JSON tags (internal/api/regen/handler.go): `total_regen_wh`,
 * `monthly_avg_regen`, `free_charges`, `regen_ratio`. Parsing is null-tolerant so a partial body never
 * throws.
 *
 * [totalRegenWh] and [monthlyAvgRegen] are nullable because the web passes `data?.totalRegenWh` /
 * `data?.monthlyAvgRegen` straight into `formatEnergy`/`formatPower` (no `?? 0`), so an absent field
 * must surface the em-dash fallback rather than a formatted `0`. [freeCharges] and [regenRatio] mirror
 * the web `?? 0` reads and default to `0`.
 */
data class RegenEfficiencySnapshot(
    val totalRegenWh: Double?,
    val monthlyAvgRegen: Double?,
    val freeCharges: Double,
    val regenRatio: Double,
) {
    companion object {
        /**
         * Project a `GET /analytics/regen` body into a tolerant snapshot, or `null` when the body is
         * absent / not an object (web parity: the `data ?` falsy gate renders the "No regen data" empty
         * state). A present object — including the all-zero card the backend returns when there are no
         * drives — decodes to a snapshot so the gauge renders, mirroring the web `data` truthiness check.
         */
        fun fromJson(element: JsonElement): RegenEfficiencySnapshot? {
            val obj = element as? JsonObject ?: return null
            return RegenEfficiencySnapshot(
                totalRegenWh = obj.numberOrNull("total_regen_wh"),
                monthlyAvgRegen = obj.numberOrNull("monthly_avg_regen"),
                freeCharges = obj.numberOrNull("free_charges") ?: 0.0,
                regenRatio = obj.numberOrNull("regen_ratio") ?: 0.0,
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size` plus
 * the `isCompact` branch in the web source: a footprint one column wide hides the title/icon and the
 * stat row (the compact gauge), exactly as the web `isCompact = size.cols <= 1` test does.
 */
data class RegenEfficiencySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at one column or narrower (web `isCompact = size.cols <= 1`): render the compact gauge. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val DEFAULT_COLS = 1
        private const val DEFAULT_ROWS = 2
        private const val MAX_COLS = 3
        private const val MAX_ROWS = 40

        /** Registry default footprint (1×2). */
        val Default: RegenEfficiencySize = RegenEfficiencySize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry minimum footprint (1×2). */
        val MinSize: RegenEfficiencySize = RegenEfficiencySize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry maximum footprint (3×40). */
        val MaxSize: RegenEfficiencySize = RegenEfficiencySize(cols = MAX_COLS, rows = MAX_ROWS)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: RegenEfficiencySize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: RegenEfficiencySize): RegenEfficiencySize =
            RegenEfficiencySize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`regen-efficiency`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object RegenEfficiencyRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "regen-efficiency"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RegenEfficiencyWidget"

    /** Default footprint: 1 column × 2 rows. */
    val defaultSize: RegenEfficiencySize get() = RegenEfficiencySize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: RegenEfficiencySize get() = RegenEfficiencySize.MinSize

    /** Maximum footprint: 3 columns × 40 rows. */
    val maxSize: RegenEfficiencySize get() = RegenEfficiencySize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: RegenEfficiencySize): Boolean = RegenEfficiencySize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RegenEfficiencySize): RegenEfficiencySize = RegenEfficiencySize.clamp(size)
}

/**
 * The recovery band a percentage falls into — the native analogue of the web `regenColor` buckets.
 * Mapped to a concrete semantic color at the render boundary (high → success, medium → warning, low →
 * danger) so no hex literal leaks into the view.
 */
enum class RegenBand { High, Medium, Low }

/**
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [RegenEfficiencyProjection.project] stays
 * pure and JVM-testable. Keys mirror the web `t('widget.regenEfficiency.*')` calls verbatim. The title
 * + "No regen data" strings are render-only chrome (the projection never needs them) and are resolved
 * directly in the composable.
 */
data class RegenEfficiencyLabels(
    val totalRecovered: String,
    val monthlyAvg: String,
    val freeCharges: String,
    val recovery: String,
)

/**
 * One projected, render-ready stat — the native analogue of a web `GaugeHeroStat`. Carries the
 * resolved [label] and the already-formatted [value] (the unit is baked into [value] for energy/power,
 * as `formatEnergy`/`formatPower` do, and absent for the integer free-charges count).
 */
data class RegenStatItem(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view of one regen card for a footprint — the native analogue of
 * everything the web component computes before returning JSX (the `regenPct` / `color` / `stats` /
 * `gaugeConfig` `useMemo`s). Pure data (no Compose types) so the projection is unit-tested without a UI
 * host. The composable renders the gauge in every footprint and the [stats] row only when not
 * [isCompact].
 */
data class RegenEfficiencyDisplay(
    val isCompact: Boolean,
    val gaugeValue: Double,
    val gaugeLabel: String,
    val gaugeUnit: String,
    val band: RegenBand,
    val stats: List<RegenStatItem>,
)

/**
 * Pure projection from a decoded [RegenEfficiencySnapshot] to the render-ready [RegenEfficiencyDisplay]
 * — the native port of the `regenPct` / `color` / `stats` / `gaugeConfig` `useMemo`s in the web source.
 * SI energy + power are formatted via the shared [formatEnergy] / [formatPower] (web
 * `useUnits().formatEnergy` / `.formatPower`) at this display boundary; the free-charges count uses
 * en-US integer grouping (web `fmtInt`). [locale] drives the grouping/separators (tests pin
 * [Locale.US]).
 */
object RegenEfficiencyProjection {
    /** The fixed gauge scale (web `max: 100`). */
    const val GAUGE_MAX: Double = 100.0

    /** A regen ratio above this percentage is the high band (web `regenColor`: `pct > 30`). */
    const val HIGH_MIN: Double = 30.0

    /** A regen ratio above this percentage (and ≤ [HIGH_MIN]) is the medium band (web `pct > 15`). */
    const val MEDIUM_MIN: Double = 15.0

    /** Ratio → percentage scale (web `regenPct = (data?.regenRatio ?? 0) * 100`). */
    private const val RATIO_TO_PCT: Double = 100.0

    /**
     * Project [snapshot] for [size] using the localized [labels], the user's display [prefs] (energy +
     * power unit + locale), and [locale] for the free-charges grouping. The gauge value is the recovery
     * percentage rounded the way the web `Math.round` does (ties → positive infinity) and clamped to the
     * `0..100` gauge scale (the web `RadialGauge` clamps its displayed value); the label keeps the raw
     * rounded percentage with a `%` suffix (web `${Math.round(regenPct)}%`); the band is computed from
     * the unrounded percentage (web `regenColor(regenPct)`).
     */
    fun project(
        snapshot: RegenEfficiencySnapshot,
        size: RegenEfficiencySize,
        labels: RegenEfficiencyLabels,
        prefs: UnitPref,
        locale: Locale = Locale.US,
    ): RegenEfficiencyDisplay {
        val regenPct = recoveryPercent(snapshot.regenRatio)
        val rounded = regenPct.roundToLong()
        // Long → Double for the gauge scale, clamped to [0, max] exactly as the web RadialGauge does.
        val gaugeValue = rounded.toDouble().coerceIn(0.0, GAUGE_MAX) // parity:allow Long-to-Double gauge value conversion
        return RegenEfficiencyDisplay(
            isCompact = size.isCompact,
            gaugeValue = gaugeValue,
            gaugeLabel = "$rounded%",
            gaugeUnit = labels.recovery,
            band = bandFor(regenPct),
            stats = stats(snapshot, labels, prefs, locale),
        )
    }

    /** The recovery percentage (web `regenPct = (data?.regenRatio ?? 0) * 100`); non-finite ⇒ 0. */
    fun recoveryPercent(regenRatio: Double): Double {
        val pct = regenRatio * RATIO_TO_PCT
        return if (pct.isFinite()) pct else 0.0
    }

    /** The recovery band for [pct] (web `regenColor` thresholds: 30 / 15). */
    fun bandFor(pct: Double): RegenBand =
        when {
            pct > HIGH_MIN -> RegenBand.High
            pct > MEDIUM_MIN -> RegenBand.Medium
            else -> RegenBand.Low
        }

    private fun stats(
        snapshot: RegenEfficiencySnapshot,
        labels: RegenEfficiencyLabels,
        prefs: UnitPref,
        locale: Locale,
    ): List<RegenStatItem> =
        listOf(
            RegenStatItem(labels.totalRecovered, formatEnergy(snapshot.totalRegenWh, prefs, STAT_PRECISION)),
            RegenStatItem(labels.monthlyAvg, formatPower(snapshot.monthlyAvgRegen, prefs, STAT_PRECISION)),
            RegenStatItem(labels.freeCharges, ChartFormat.number(snapshot.freeCharges, FREE_CHARGES_DECIMALS, locale)),
        )
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric / JSON null. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
