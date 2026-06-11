// Pure, framework-free model + projection for the Supercharger History dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx): the newest-first 10-session slice,
// the `entry.usage_wh ?? 0` / `entry.total_due ?? 0` null-coalescing, the ranked-by-energy ordering +
// background bars the shared `WidgetRankedList` computes, the per-row cost badge (web
// `cost > 0 ? formatCurrency(cost) : undefined`), the 30-day totals row, and the compact 30-day-spend
// hero. No Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. The history feed
// arrives as raw SI JSON (`/tesla/charging/history`), so this file owns the decode (web optional-chaining
// → null-safe reads) plus the display-boundary energy + currency formatting (Phase-48 SI-canonical rule;
// web `useUnits`/`useFormatting`), both injected so the projection stays locale-stable and JVM-testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SuperchargerHistoryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.superchargerhistory

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val DEFAULT_CURRENCY = "$"

/** Default currency fraction digits (web `useFormatting` `decimal_precision ?? 2`). */
private const val DEFAULT_PRECISION = 2

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test that swaps the ranked-list + totals
 * standard layout for the single 30-day-spend hero.
 */
data class SuperchargerHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact 30-day-spend hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`supercharger-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object SuperchargerHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "supercharger-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "SuperchargerHistoryWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION = "Tesla Supercharger sessions: location, energy, cost from Tesla account"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = SuperchargerHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = SuperchargerHistorySize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = SuperchargerHistorySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: SuperchargerHistorySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SuperchargerHistorySize): SuperchargerHistorySize =
        SuperchargerHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded Supercharger session — the native analogue of a web `TeslaChargingHistoryEntry`, reduced to
 * the five fields the component reads: the [id] (row key), the [siteLocationName] (web
 * `site_location_name`, the ranked-row label), the [startMillis] (epoch-ms parse of `charge_start_datetime`,
 * the newest-first sort key — `null` when unparseable so it sorts last), the [usageWh] (web `usage_wh`,
 * the SI energy bar value) and the [totalDue] (web `total_due`, the cost badge). All numerics are SI/raw on
 * the wire; conversion to display units happens in [SuperchargerHistoryProjection].
 */
data class SuperchargerEntry(
    val id: Long,
    val siteLocationName: String?,
    val startMillis: Long?,
    val usageWh: Double?,
    val totalDue: Double?,
)

/**
 * The decoded 30-day rollup — the native analogue of the web `TeslaChargingHistorySummary` fields the
 * totals row reads (`total_wh`, `total_spend`). Both are SI/raw on the wire; missing/JSON-null collapses to
 * zero, exactly like the web optional-chaining (`summary?.total_wh ?? 0`).
 */
data class SuperchargerSummary(
    val totalWh: Double,
    val totalSpend: Double,
) {
    companion object {
        /** The all-zero rollup, surfaced when the payload carries no summary. */
        val EMPTY = SuperchargerSummary(0.0, 0.0)
    }
}

/**
 * The decoded `/tesla/charging/history` payload — the native analogue of the web
 * `TeslaChargingHistoryResponse` (`entries`, `summary`). [hasEntries] drives the web
 * `entries.length > 0 ? … : <EmptyState/>` gate (the empty test is on the entry list, never the summary).
 */
data class SuperchargerHistoryData(
    val entries: List<SuperchargerEntry>,
    val summary: SuperchargerSummary,
) {
    /** Web `entries.length > 0` — drives the empty-state gate in both the compact and standard branches. */
    val hasEntries: Boolean get() = entries.isNotEmpty()

    companion object {
        /** The no-session snapshot, surfaced for a null/empty payload. */
        val EMPTY = SuperchargerHistoryData(emptyList(), SuperchargerSummary.EMPTY)
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` +
 * `useFormatting` reads from the `/settings` document: the [unitPref] (for the SI-watt-hours → kWh energy
 * conversion + locale), the [currencySymbol] (blank → "$") and the currency [precision] (web
 * `decimal_precision`, floored & non-negative, else 2).
 */
data class SuperchargerHistoryDisplayPrefs(
    val unitPref: UnitPref,
    val currencySymbol: String,
    val precision: Int,
) {
    companion object {
        /** Metric + `$` + 2dp defaults used before settings load (matches the web defaults). */
        val METRIC_DEFAULT =
            SuperchargerHistoryDisplayPrefs(
                unitPref = UnitPreferences.fromSettings(null),
                currencySymbol = DEFAULT_CURRENCY,
                precision = DEFAULT_PRECISION,
            )

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): SuperchargerHistoryDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
            val symbol = rawSymbol?.contentOrNull?.trim()
            return SuperchargerHistoryDisplayPrefs(
                unitPref = unit,
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
            )
        }
    }
}

/**
 * Localized labels the surface folds into its output (the five web `t('widget.superchargerHistory.…')`
 * keys). The pure [SuperchargerHistoryProjection] reads these to assemble every visible string + TalkBack
 * content description; the composable builds this from `stringResource`, while tests pass a deterministic
 * instance.
 */
data class SuperchargerHistoryStrings(
    val title: String,
    val currencyUnit: String,
    val compactLabel: String,
    val noData: String,
    val totals: String,
)

/**
 * One projected, render-ready ranked-session row — the native analogue of a web `RankedItem`. Carries the
 * resolved [label] (web `site_location_name ?? '—'`), the already-formatted energy [energyText] (web
 * `formatEnergy(wh, { precision: 1 })`), the optional currency [costBadge] (web
 * `total_due > 0 ? formatCurrency(total_due) : undefined`), the background-[barFraction] (0..1, energy ÷
 * visible-max — the web `WidgetRankedList` bar), and a TalkBack [contentDescription] folding rank + label +
 * energy + cost into one phrase.
 */
data class RankedSessionRow(
    val id: Long,
    val label: String,
    val energyText: String,
    val costBadge: String?,
    val barFraction: Float,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the Supercharger history for one footprint — the native
 * analogue of everything the web component computes before returning JSX. Pure data (no Compose types) so
 * the projection is unit-tested without a UI host. Carries both the compact-hero fields and the
 * standard-layout fields; the composable renders one set per [SuperchargerHistorySize.isCompact].
 */
data class SuperchargerHistoryDisplay(
    val hasEntries: Boolean,
    val rankedRows: List<RankedSessionRow>,
    val totalsLabel: String,
    val totalsEnergyText: String,
    val totalsCostText: String,
    val totalsContentDescription: String,
    val compactSpendValue: Double,
    val compactSpendDecimals: Int,
    val compactUnit: String,
    val compactLabel: String,
    val compactContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/tesla/charging/history` [json] (SI, snake_case on the wire) into a
 * [SuperchargerHistoryData]. A non-object input, a missing `entries` array, missing fields, or JSON-null
 * fields all collapse to empty / zero — reproducing the web optional-chaining (`data?.entries ?? []`,
 * `entry.usage_wh ?? 0`, `summary?.total_wh ?? 0`). A malformed entry element is skipped rather than
 * throwing.
 */
fun parseSuperchargerHistory(json: JsonElement?): SuperchargerHistoryData {
    val obj = json as? JsonObject ?: return SuperchargerHistoryData.EMPTY
    val entries =
        (obj["entries"] as? JsonArray)
            ?.mapIndexedNotNull { index, element -> (element as? JsonObject)?.toEntry(index) }
            ?: emptyList()
    val summary = (obj["summary"] as? JsonObject)?.toSummary() ?: SuperchargerSummary.EMPTY
    return SuperchargerHistoryData(entries = entries, summary = summary)
}

private fun JsonObject.toEntry(index: Int): SuperchargerEntry =
    SuperchargerEntry(
        id = (this["id"] as? JsonPrimitive)?.longOrNull ?: index.toLong(),
        siteLocationName = (this["site_location_name"] as? JsonPrimitive)?.contentOrNull,
        startMillis = parseStartMillis((this["charge_start_datetime"] as? JsonPrimitive)?.contentOrNull),
        usageWh = (this["usage_wh"] as? JsonPrimitive)?.doubleOrNull,
        totalDue = (this["total_due"] as? JsonPrimitive)?.doubleOrNull,
    )

private fun JsonObject.toSummary(): SuperchargerSummary =
    SuperchargerSummary(
        totalWh = (this["total_wh"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
        totalSpend = (this["total_spend"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
    )

/**
 * Parses an ISO-8601 `charge_start_datetime` to epoch milliseconds for the newest-first sort — the native
 * analogue of the web `new Date(entry.charge_start_datetime).getTime()`. Tries an instant (`…Z`), then an
 * offset date-time, then a zone-less local date-time (assumed UTC); an unparseable/blank value yields
 * `null` so the entry sorts last instead of throwing.
 */
private fun parseStartMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { Instant.parse(raw).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .getOrNull()
}

/**
 * Pure projection from a decoded [SuperchargerHistoryData] to the render-ready [SuperchargerHistoryDisplay]
 * — the native port of the inline `useMemo` derivation + the shared `WidgetRankedList` sort/slice/bar math
 * in the web source. [formatEnergy] converts an SI-watt-hours value to the user's energy unit + token at
 * the Compose boundary (web `formatEnergy(wh, { precision: 1 })`), and [formatCurrency] renders a cost the
 * web `useFormatting` way (`currencySymbol + fmtNumber`). Both are injected so the projection stays
 * locale-stable and JVM-testable. [locale] drives the compact-hero number grouping (tests pin [Locale.US]).
 */
object SuperchargerHistoryProjection {
    /** Web `.slice(0, 10)` — the newest-first session window the widget memoizes. */
    const val RECENT_LIMIT = 10

    /** Web `<WidgetRankedList maxItems={10} />` — the energy-sorted cap the shared list renders. */
    const val MAX_RANKED_ITEMS = 10

    /** Web `WidgetBigNumber value={totalSpend}` renders through `AnimatedNumber` (default `decimals=0`). */
    const val COMPACT_SPEND_DECIMALS = 0

    private const val PART_SEPARATOR = ", "

    /** Project [data] for [size] using the localized [strings] and the injected display formatters. */
    fun project(
        data: SuperchargerHistoryData,
        strings: SuperchargerHistoryStrings,
        formatEnergy: (Double) -> String,
        formatCurrency: (Double) -> String,
        locale: Locale = Locale.US,
    ): SuperchargerHistoryDisplay {
        val totalsEnergy = formatEnergy(data.summary.totalWh)
        val totalsCost = formatCurrency(data.summary.totalSpend)
        val compactSpend = ChartFormat.number(data.summary.totalSpend, COMPACT_SPEND_DECIMALS, locale)
        return SuperchargerHistoryDisplay(
            hasEntries = data.hasEntries,
            rankedRows = rankedRows(data.entries, formatEnergy, formatCurrency),
            totalsLabel = strings.totals,
            totalsEnergyText = totalsEnergy,
            totalsCostText = totalsCost,
            totalsContentDescription = "${strings.totals} $totalsEnergy $totalsCost",
            compactSpendValue = data.summary.totalSpend,
            compactSpendDecimals = COMPACT_SPEND_DECIMALS,
            compactUnit = strings.currencyUnit,
            compactLabel = strings.compactLabel,
            compactContentDescription = "${strings.compactLabel} $compactSpend ${strings.currencyUnit}",
            emptyMessage = strings.noData,
        )
    }

    /**
     * Formats a currency [amount] the web `formatCurrency` way — the user's [symbol] (blank → "$") followed
     * by a [decimals]-digit grouped number — via the shared [ChartFormat.number] (the same locale-aware
     * formatter every native cost surface uses).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale = Locale.US,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${ChartFormat.number(amount, decimals.coerceAtLeast(0), locale)}"

    /**
     * The render-ready ranked rows — the native composition of the web widget's `useMemo` (newest-first
     * slice to [RECENT_LIMIT], `usage_wh ?? 0` / `total_due ?? 0` reads) AND the shared `WidgetRankedList`
     * (re-sort by energy descending, cap at [MAX_RANKED_ITEMS], background bar = value ÷ visible-max). A
     * non-positive cost yields no badge (web `cost > 0 ? … : undefined`).
     */
    private fun rankedRows(
        entries: List<SuperchargerEntry>,
        formatEnergy: (Double) -> String,
        formatCurrency: (Double) -> String,
    ): List<RankedSessionRow> {
        val recent = entries.sortedByDescending { it.startMillis ?: Long.MIN_VALUE }.take(RECENT_LIMIT)
        val ranked = recent.sortedByDescending { it.usageWh ?: 0.0 }.take(MAX_RANKED_ITEMS)
        val maxEnergy = ranked.maxOfOrNull { it.usageWh ?: 0.0 } ?: 0.0
        return ranked.mapIndexed { index, entry ->
            val wh = entry.usageWh ?: 0.0
            val cost = entry.totalDue ?: 0.0
            val label = entry.siteLocationName ?: EM_DASH
            val energyText = formatEnergy(wh)
            val badge = if (cost > 0.0) formatCurrency(cost) else null
            RankedSessionRow(
                id = entry.id,
                label = label,
                energyText = energyText,
                costBadge = badge,
                barFraction = if (maxEnergy > 0.0) (wh / maxEnergy).toFloat() else 0f,
                contentDescription = buildRowDescription(index + 1, label, energyText, badge),
            )
        }
    }

    private fun buildRowDescription(
        rank: Int,
        label: String,
        energyText: String,
        costBadge: String?,
    ): String {
        val parts = mutableListOf("$rank. $label", energyText)
        costBadge?.let { parts += it }
        return parts.joinToString(PART_SEPARATOR)
    }
}
