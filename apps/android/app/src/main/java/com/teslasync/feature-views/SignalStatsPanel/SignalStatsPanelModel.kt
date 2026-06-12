// Pure, framework-free model + projection for the SignalStatsPanel feature view — the native analogue of every
// value the web component derives before returning JSX (web/src/features/telemetry/components/SignalStatsPanel.tsx).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// SignalStatsPanel is a presentational telemetry panel — the web component takes its `stats` (a `SignalStat[]`,
// computed by the owning Workspace/Explorer page from the live SSE stream) as a prop, so this surface binds no data
// hook of its own (its only web hook is `useTranslation`). As in the sibling AcDcStatsPanel / EntriesTable ports, the
// cache-then-network lifecycle (loading / error / stale / offline) is supplied by the owning host through the shared
// P1/S8 state-holder layer as a [UiState]; the composable renders every state that layer can carry without ever
// fetching. This pure file owns the parts the web render derives from `stats` + `selectedSignals`:
//   • the display rows — the web `displayStats` memo: when `selectedSignals` is provided, one row per selected
//     signal (gaps filled with a `count: 0` stand-in row), else `stats` passed through unchanged;
//   • the per-row color index — the web `signalIndex?.[signal] ?? displayStats.indexOf(s)`, clamped at 0
//     (web `Math.max(0, idx)`); the Compose boundary resolves the actual palette color from it;
//   • the empty-row predicate — the web `isEmptyStat` (`count === 0`) and the `emptyCount` reduce;
//   • the hide-empty filter — the web `visibleStats` (`hideEmpty ? displayStats.filter(!isEmpty) : displayStats`);
//   • the numeric formatters — the web `fmtNumber` (min/max/avg) and `fmtInt` (count), incl. the `—` blank a
//     non-finite stat renders.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalStatsPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AcDcStatsPanel / LiveSignalsTable surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalstatspanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * One per-signal statistics bucket — the native mirror of the web `SignalStat`
 * (web/src/features/telemetry/hooks/useLiveSignalStream.ts). [min]/[max]/[avg] default to `NaN` and [count] to `0`
 * so a stand-in row for a selected-but-empty signal is a valid value (the composable renders `NaN`/non-finite
 * figures as the `—` em dash, exactly as the web `renderNumeric` ternary does).
 *
 * @property signal the signal name (web `stat.signal`); also the row key + the color-index lookup key.
 * @property min the minimum sample in range (web `stat.min`); `NaN` ⇒ no numeric sample ⇒ `—`.
 * @property max the maximum sample in range (web `stat.max`); `NaN` ⇒ `—`.
 * @property avg the mean sample in range (web `stat.avg`); `NaN` ⇒ `—`.
 * @property count the sample count in range (web `stat.count`); `0` marks an empty/stand-in row.
 */
data class SignalStat(
    val signal: String,
    val min: Double = Double.NaN,
    val max: Double = Double.NaN,
    val avg: Double = Double.NaN,
    val count: Int = 0,
)

/**
 * The render input the panel reads — the native mirror of the web component's props that carry data (`stats`,
 * `selectedSignals`, `signalIndex`). This is the `T` the host hands over through the shared [UiState] feed; the
 * panel never fetches it. Every field defaults so a still-loading host can supply an empty input without error.
 *
 * @property stats the per-signal buckets the live/historical query produced (web `stats`).
 * @property selectedSignals when non-null/non-empty, the panel emits one row per selected signal — filling gaps
 *   with stand-in rows — so it stops silently dropping selected signals the chart also has to show
 *   (web `selectedSignals`). When omitted, only signals present in [stats] render.
 * @property signalIndex an optional signal → color-index map so a row keeps the same series color as the chart
 *   (web `signalIndex`); when a signal is absent the row falls back to its position.
 */
data class SignalStatsInput(
    val stats: List<SignalStat> = emptyList(),
    val selectedSignals: List<String>? = null,
    val signalIndex: Map<String, Int>? = null,
)

/**
 * One render-ready table row — a [SignalStat] plus the resolved [colorIndex] the Compose boundary maps to a
 * categorical palette color (web `CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length]`). Pure data so the
 * projection is unit-tested without a UI host.
 */
data class SignalStatsRow(
    val signal: String,
    val min: Double,
    val max: Double,
    val avg: Double,
    val count: Int,
    val colorIndex: Int,
) {
    /** True when the row has no numeric samples — web `isEmptyStat` (`count === 0`); renders the `—` blanks. */
    val isEmpty: Boolean get() = count == 0
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property rows the display rows in order (web `displayStats`), stand-in rows included.
 * @property emptyCount the number of empty rows (web `emptyCount`); drives the "Hide empty (N)" toggle's visibility.
 */
data class SignalStatsDisplay(
    val rows: List<SignalStatsRow>,
    val emptyCount: Int,
) {
    /** True when there are no rows at all — the panel renders a friendly empty state, never a blank box. */
    val isEmpty: Boolean get() = rows.isEmpty()

    /** The rows actually shown — web `visibleStats` (`hideEmpty ? rows.filter(!isEmpty) : rows`). */
    fun visibleRows(hideEmpty: Boolean): List<SignalStatsRow> = if (hideEmpty) rows.filterNot { it.isEmpty } else rows
}

/**
 * Pure projection from a [SignalStatsInput] to its render-ready [SignalStatsDisplay] plus the formatters the web
 * component applies inline — a 1:1 port of the derivations the web component performs (the `displayStats` memo, the
 * `signalIndex` color resolution, the `emptyCount` reduce, the `visibleStats` filter, and the `fmtNumber` / `fmtInt`
 * cell formatters). Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SignalStatsProjection {
    /** Fraction digits for the min/max/avg figures — the web `fmtNumber` global precision default. */
    const val DEFAULT_DECIMALS: Int = 2

    /** A stand-in bucket for a selected signal with no data — web `emptyStatRow` (`min/max/avg: NaN, count: 0`). */
    fun emptyStatRow(signal: String): SignalStat = SignalStat(signal = signal)

    /** Web `isEmptyStat`: a row is empty when it has no numeric samples. */
    fun isEmptyStat(stat: SignalStat): Boolean = stat.count == 0

    /**
     * Web `displayStats`: when [SignalStatsInput.selectedSignals] is provided, emit one row per selected signal
     * (filling gaps with stand-in rows); otherwise pass [SignalStatsInput.stats] through unchanged.
     */
    fun displayStats(input: SignalStatsInput): List<SignalStat> {
        val selected = input.selectedSignals
        if (selected.isNullOrEmpty()) return input.stats
        val byName = input.stats.associateBy { it.signal }
        return selected.map { byName[it] ?: emptyStatRow(it) }
    }

    /** Select the render-ready view for [input], resolving each row's color index + the empty-row count. */
    fun project(input: SignalStatsInput): SignalStatsDisplay {
        val display = displayStats(input)
        val rows =
            display.mapIndexed { index, stat ->
                val colorIndex = (input.signalIndex?.get(stat.signal) ?: index).coerceAtLeast(0)
                SignalStatsRow(
                    signal = stat.signal,
                    min = stat.min,
                    max = stat.max,
                    avg = stat.avg,
                    count = stat.count,
                    colorIndex = colorIndex,
                )
            }
        return SignalStatsDisplay(rows = rows, emptyCount = rows.count { it.isEmpty })
    }

    /**
     * The min/max/avg formatter — the native port of the web `fmtNumber(n)` (locale grouping at [decimals]),
     * with the web `Number.isNaN(n) || !Number.isFinite(n) ? '—'` guard handled by [ChartFormat.number] returning
     * its em-dash for any non-finite value.
     */
    fun formatStat(
        value: Double,
        decimals: Int = DEFAULT_DECIMALS,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, decimals, locale)

    /** The count formatter — the native port of the web `fmtInt(count)` (locale grouping, zero fraction digits). */
    fun formatCount(
        count: Int,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", count)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a signal name,
 * value, or count — so a diagnostics line can never leak the vehicle's live telemetry.
 */
object SignalStatsPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalStatsPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
