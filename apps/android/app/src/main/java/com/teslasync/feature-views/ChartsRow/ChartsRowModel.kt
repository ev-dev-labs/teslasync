// Pure, framework-free model + projection for the charging-list `ChartsRow` feature view — the native
// analogue of everything the web component reads before returning JSX
// (web/src/features/charging/components/charging-list/ChartsRow.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational. Its parent (`ChargingSection`) derives three arrays from the
// loaded `ChargingSession[]` (via helpers.ts `computeEnergyTrend` / `computeChargerBreakdown` /
// `computeCostByType`) and hands them down as props; `ChartsRow` only lays them out into two `GlassPanel`s —
// an "Energy & Cost Trend" area/line chart and a "Charger Breakdown" donut with a per-type cost list. This
// file mirrors those three prop shapes ([EnergyTrendPoint] / [ChargerBreakdownEntry] / [CostByTypeEntry],
// bundled as [ChartsRowData]) and the pure derivations the composable needs from them: the trend series
// ([ChartsRowProjection.project] → [ChartsRowTrend]), the donut sweep fractions + share percents
// ([ChartsRowProjection.segments]), and the formatted cost-by-type rows ([CostRow]).
//
// SI on the wire, display values at the boundary: `ChartsRow` is presentational, so the numbers arrive
// already display-shaped from the parent's helpers (energy/cost/perKwh). This file never re-derives units —
// it formats the values it is given through the injected [ChartsRowFormatters], exactly as the web component
// formats its props with `fmtNumber` / `fmtWithUnit`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChartsRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chartsrow

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Default currency symbol — the native mirror of the web `$` literal the cost-by-type rows hard-code
 * (`${fmtNumber(ct.cost)} total`). Kept as a single named constant (and an injectable formatter input)
 * rather than scattered string literals, matching the sibling `ChargingTab` `CHARGING_DEFAULT_CURRENCY`.
 */
const val CHARTS_ROW_DEFAULT_CURRENCY: String = "$"

/** Percent scale for a share fraction → whole-percent value (web `* 100`). */
private const val PERCENT_SCALE: Double = 100.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChartsRowRegistration {
    /** Stable surface id. */
    const val ID: String = "charts-row"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChartsRow"
}

/**
 * One point of the energy-vs-cost trend — the native mirror of the web `EnergyTrendPoint`
 * (`{ date, energy, cost }`). [date] is the already-formatted x-axis label (web `formatDateShort`),
 * [energy] the display energy value, and [cost] the display cost value for that charging session.
 */
data class EnergyTrendPoint(
    val date: String,
    val energy: Double,
    val cost: Double,
)

/**
 * One donut slice of the charger-type breakdown — the native mirror of the web `ChargerBreakdownEntry`
 * (`{ name, value, fill }`). [name] is the already-localized charger-type label and [value] its session
 * count (the web `dataKey="value"`). The web `fill` is intentionally omitted: feature views must not carry
 * raw hex, so the slice color is resolved positionally from the design-token categorical palette at the
 * render boundary, consistent with the sibling native donut surfaces (ChargingTab, ChargingBreakdownSlide).
 */
data class ChargerBreakdownEntry(
    val name: String,
    val value: Double,
)

/**
 * One row of the per-charger-type cost list — the native mirror of the web `CostByTypeEntry`
 * (`{ name, energy, cost, perKwh }`). [name] is the localized type label, [energy] the display energy,
 * [cost] the display total cost, and [perKwh] the display cost-per-kWh, all rendered exactly as the web
 * `fmtWithUnit(energy,'kWh')` / `${fmtNumber(cost)} total` / `${fmtNumber(perKwh)}/kWh`.
 */
data class CostByTypeEntry(
    val name: String,
    val energy: Double,
    val cost: Double,
    val perKwh: Double,
)

/**
 * The full prop payload `ChartsRow` renders — the native bundle of the web component's three props.
 * Defaulted to empty lists so the loading / empty lifecycle states are expressible without a payload.
 */
data class ChartsRowData(
    val energyTrend: List<EnergyTrendPoint> = emptyList(),
    val chargerBreakdown: List<ChargerBreakdownEntry> = emptyList(),
    val costByType: List<CostByTypeEntry> = emptyList(),
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test
 * (the native analogue of the web `fmtNumber` / `fmtWithUnit` calls). [trendValue] formats the trend axis /
 * tooltip numbers (web `fmtNumber`); [energyText] builds the "{n} kWh" line (web `fmtWithUnit(_, 'kWh')`);
 * [costText] builds the "${n} total" line; [perKwhText] builds the "${n}/kWh" line; [percentText] formats a
 * donut slice's share (web `(pct)%`).
 */
data class ChartsRowFormatters(
    val trendValue: (Double) -> String,
    val energyText: (Double) -> String,
    val costText: (Double) -> String,
    val perKwhText: (Double) -> String,
    val percentText: (Double) -> String,
)

/**
 * One projected donut slice — the native analogue of a web `<Pie>` datum after share math. [name] is the
 * localized type label, [value] the raw session count, [fraction] the slice's share of the whole (0..1, the
 * Canvas sweep input), and [percent] that share as a whole number for the legend.
 */
data class ChargerSegment(
    val name: String,
    val value: Double,
    val fraction: Double,
    val percent: Double,
)

/** A fully formatted per-charger-type cost row — the render-ready strings the side list draws. */
data class CostRow(
    val name: String,
    val energyText: String,
    val costText: String,
    val perKwhText: String,
)

/** The trend chart's render-ready series — parallel lists of x [labels] and the [energy] / [cost] y values. */
data class ChartsRowTrend(
    val labels: List<String>,
    val energy: List<Double>,
    val cost: List<Double>,
)

/**
 * The fully projected, render-ready inputs for both panels — pure data (no Compose types) so the projection
 * is unit-tested without a UI host. The composable feeds [trend] into the energy/cost combo chart, draws
 * [segments] as the donut + legend, lists [costRows] beside it, and shows each panel's empty state from
 * [isTrendEmpty] / [isBreakdownEmpty].
 */
data class ChartsRowProjectionResult(
    val trend: ChartsRowTrend,
    val segments: List<ChargerSegment>,
    val costRows: List<CostRow>,
    val isTrendEmpty: Boolean,
    val isBreakdownEmpty: Boolean,
) {
    /** True when neither panel has anything to draw — the surface-wide empty state. */
    val isEmpty: Boolean get() = isTrendEmpty && isBreakdownEmpty && costRows.isEmpty()
}

/**
 * The pure projection the composable renders — the native mirror of the data `ChartsRow` reads from its
 * props. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ChartsRowProjection {
    /**
     * Share fractions (0..1) for each breakdown slice, preserving order — the native analogue of the web
     * `<Pie>`'s value→angle mapping. A non-positive total (no sessions) yields all-zero fractions so the
     * donut draws nothing rather than dividing by zero.
     */
    fun fractions(entries: List<ChargerBreakdownEntry>): List<Double> {
        val total = entries.sumOf { it.value }
        if (total <= 0.0) return entries.map { 0.0 }
        return entries.map { it.value / total }
    }

    /** A single value's whole-percent share of [total]; 0 when [total] is non-positive. */
    fun percent(
        value: Double,
        total: Double,
    ): Double = if (total <= 0.0) 0.0 else value / total * PERCENT_SCALE

    /**
     * Projects breakdown [entries] into render-ready [ChargerSegment]s (label, raw value, sweep fraction,
     * and legend percent), preserving order. An empty input yields an empty list (the donut empty state).
     */
    fun segments(entries: List<ChargerBreakdownEntry>): List<ChargerSegment> {
        val total = entries.sumOf { it.value }
        return entries.map { entry ->
            ChargerSegment(
                name = entry.name,
                value = entry.value,
                fraction = if (total <= 0.0) 0.0 else entry.value / total,
                percent = percent(entry.value, total),
            )
        }
    }

    /**
     * Projects [data] into the render-ready [ChartsRowProjectionResult] via the injected [formatters],
     * preserving order: the trend series, the donut segments, and the formatted cost-by-type rows. A null
     * payload (first load) projects as fully empty.
     */
    fun project(
        data: ChartsRowData?,
        formatters: ChartsRowFormatters,
    ): ChartsRowProjectionResult {
        val safe = data ?: ChartsRowData()
        val segs = segments(safe.chargerBreakdown)
        val costRows =
            safe.costByType.map { entry ->
                CostRow(
                    name = entry.name,
                    energyText = formatters.energyText(entry.energy),
                    costText = formatters.costText(entry.cost),
                    perKwhText = formatters.perKwhText(entry.perKwh),
                )
            }
        return ChartsRowProjectionResult(
            trend =
                ChartsRowTrend(
                    labels = safe.energyTrend.map { it.date },
                    energy = safe.energyTrend.map { it.energy },
                    cost = safe.energyTrend.map { it.cost },
                ),
            segments = segs,
            costRows = costRows,
            isTrendEmpty = safe.energyTrend.isEmpty(),
            isBreakdownEmpty = segs.isEmpty(),
        )
    }

    /**
     * The donut's combined screen-reader description — "{name} ({pct}%), …" across all [segments], using the
     * injected [percentText] formatter. Mirrors the sibling donut surfaces' merged TalkBack summary so the
     * opaque Canvas reads its breakdown instead of decorative arcs.
     */
    fun donutDescription(
        segments: List<ChargerSegment>,
        percentText: (Double) -> String,
    ): String =
        segments.joinToString(separator = ", ") { segment ->
            "${segment.name} (${percentText(segment.percent)})"
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChartsRowRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordChartsRowOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChartsRowRegistration.SLUG))
}
