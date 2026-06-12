// Pure, framework-free model + projection for the SignalChartPanel feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/telemetry/components/SignalChartPanel.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parents (SignalExplorerPage / SignalsWorkspacePage) pass
// the time-ordered `data` rows, the `selectedSignals`, and the per-signal `stats` down. From those props the
// web derives three things this file owns: the dual-axis decision (`useRightAxis` — the second series moves to
// a right axis when the first two stats' ranges differ by more than 10×), the overlay/grid/auto layout
// resolution (`effectiveMode`), and the per-signal series projection that feeds the line chart / small-
// multiples grid. The composable only resolves localized strings, palette colors, and the freshness chrome.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalChartPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalchartpanel

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's live state.
 */
const val SIGNAL_CHART_PANEL_SLUG: String = "SignalChartPanel"

/** The web default `gridAutoThreshold = 8` — overlay flips to the small-multiples grid above this count. */
const val DEFAULT_GRID_AUTO_THRESHOLD: Int = 8

/**
 * The web dual-axis ratio gate: the second series moves to a right axis when the first two stats' ranges
 * differ by more than this factor (web `ranges[0] / ranges[1] > 10 || ranges[1] / ranges[0] > 10`).
 */
internal const val DUAL_AXIS_RATIO: Double = 10.0

/** Fallback range for a flat signal so the ratio math never divides by zero — web `Math.abs(max-min) || 1`. */
private const val FLAT_RANGE_FALLBACK: Double = 1.0

/** Minimum series needed for the grid to be meaningful — one cell is not "small multiples" (web `>= 2`). */
private const val MIN_GRID_SERIES: Int = 2

/** The wall-clock time-of-day label pattern used by the default tick formatter (web `formatTime`). */
private const val TIME_LABEL_PATTERN: String = "HH:mm:ss"

/** The resolved layout the panel body renders — the web `effectiveMode` after `'auto'` is resolved. */
enum class ResolvedChartMode { Overlay, Grid }

/**
 * The display-mode prop — the native mirror of the web `SignalChartMode` (`'overlay' | 'grid' | 'auto'`).
 * [Auto] renders [ResolvedChartMode.Overlay] until `selectedSignals.size` exceeds the grid-auto threshold,
 * then flips to [ResolvedChartMode.Grid]; [Grid] needs at least two signals to be meaningful.
 */
enum class SignalChartMode { Overlay, Grid, Auto }

/**
 * Per-signal summary statistics — the native mirror of the web `SignalStat`
 * (`{ signal, min, max, avg, count }`). Drives the [SignalChartPanelProjection.useRightAxis] dual-axis
 * decision; the panel never mutates it.
 */
data class SignalStat(
    val signal: String,
    val min: Double,
    val max: Double,
    val avg: Double,
    val count: Int,
)

/**
 * One time-ordered chart row — the native mirror of the web `Record<string, unknown>` row. [timestamp] is the
 * row's ISO-8601 x value (web `dataKey="timestamp"`); [values] maps each charted signal name to its numeric
 * sample for this instant, or `null` for a gap (the Android `connectNulls` — a `null` is skipped and the line
 * bridges it). Rows are expected ascending by [timestamp], as the web contract requires.
 */
data class SignalChartRow(
    val timestamp: String,
    val values: Map<String, Double?>,
)

/**
 * The presentational payload the host passes down — the native bundle of the web component's
 * `selectedSignals` / `data` / `stats` / counter props. The view performs no fetching; a host page supplies
 * this (typically from the shared live-signal stream, P1/S8) wrapped in a
 * [io.teslasync.android.data.UiState] so the panel can render every lifecycle state.
 *
 * @property selectedSignals the signal keys to plot, in legend/series order (web `selectedSignals`).
 * @property rows the time-ordered samples (web `data`).
 * @property stats the per-signal stats driving the dual-axis decision (web `stats`).
 * @property pointsLoaded total historical points loaded — the non-live header annotation (web `pointsLoaded`).
 * @property liveEventCount live event count since reset — the live header annotation (web `liveEventCount`).
 */
data class SignalChartData(
    val selectedSignals: List<String>,
    val rows: List<SignalChartRow>,
    val stats: List<SignalStat>,
    val pointsLoaded: Int? = null,
    val liveEventCount: Int? = null,
) {
    companion object {
        /** The pre-resolution payload: nothing selected, no rows, no stats (web `enabled:false` parent). */
        val EMPTY: SignalChartData =
            SignalChartData(selectedSignals = emptyList(), rows = emptyList(), stats = emptyList())
    }
}

/**
 * One projected series ready for the chart layer — a signal key, its per-row values (gaps as `null`), and
 * whether the web would have placed it on the right axis. [onRightAxis] preserves the web dual-axis decision
 * for parity + tests; the shared Vico chart layer exposes a single value axis, so the magnitude-separation
 * intent is realized natively through [ResolvedChartMode.Grid] (one independent y-scale per cell) rather than
 * a second axis — a documented platform rendering difference, not data/composition drift.
 */
data class SignalChartSeries(
    val signal: String,
    val values: List<Double?>,
    val onRightAxis: Boolean,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's `useMemo`
 * outputs plus its series map. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host: the composable wraps [series] into `ChartSeries`, feeds [xLabels] to the bottom axis, and switches on
 * [resolvedMode].
 *
 * @property xLabels the raw ISO timestamps (web `dataKey="timestamp"`); formatted at the render boundary.
 * @property series one entry per selected signal, in order.
 * @property resolvedMode overlay or grid after `'auto'` is resolved.
 * @property useRightAxis the web dual-axis decision (preserved for parity; see [SignalChartSeries]).
 * @property isEmpty whether there are no rows to plot (web `data.length > 0` is the inverse).
 */
data class SignalChartProjectionResult(
    val xLabels: List<String>,
    val series: List<SignalChartSeries>,
    val resolvedMode: ResolvedChartMode,
    val useRightAxis: Boolean,
    val isEmpty: Boolean,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). The web component
 * reads each via `t(...)`; on Android they arrive through the i18n facade (`stringResource`) at the Compose
 * boundary and are passed in, keeping the projection locale-stable and free of any English literal.
 *
 * i18n mapping (the web `t('...')` keys are bare English phrases the catalog does not contain, so web falls
 * back to the key text; the closest existing P1/S10 keys are used here and any divergence is documented —
 * the allowed-files scope forbids adding new catalog entries):
 *  - [titleLive] ← `translation_widget_liveSignals` "Live Signals" (web "Live Signal Stream"; no "Stream" atom)
 *  - [titleHistorical] ← `translation_liveMonitor_signal` + `translation_Chart` → "Signal Chart" (exact, composed)
 *  - [events] ← `translation_events` "events" (exact); [points] ← `translation_points` "points" (exact)
 *  - [pointsLoadedNoun] ← `translation_points` "points" (web "points loaded"; no "loaded" atom)
 *  - [liveWaiting] ← `translation_liveMonitor_waiting` "Waiting for signals…" (web "Waiting for signal data…")
 *  - [noData] ← `translation_chart_noData` "No data available" (web "No data for this time range")
 */
data class SignalChartPanelStrings(
    val titleLive: String,
    val titleHistorical: String,
    val events: String,
    val points: String,
    val pointsLoadedNoun: String,
    val liveWaiting: String,
    val noData: String,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's `useMemo` derivations and
 * its chart bindings. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SignalChartPanelProjection {
    /**
     * The web `useRightAxis` memo: with at least two stats, the second series moves to a right axis when the
     * first two ranges differ by more than [DUAL_AXIS_RATIO]×. Each range is `|max - min|`, or
     * [FLAT_RANGE_FALLBACK] when flat (web `Math.abs(s.max - s.min) || 1`). Fewer than two stats → false.
     */
    fun useRightAxis(stats: List<SignalStat>): Boolean {
        if (stats.size < MIN_GRID_SERIES) return false
        val first = rangeOf(stats[0])
        val second = rangeOf(stats[1])
        return first / second > DUAL_AXIS_RATIO || second / first > DUAL_AXIS_RATIO
    }

    /**
     * The web `effectiveMode` memo: `'overlay'` stays overlay; `'grid'` needs at least two signals to be
     * meaningful (else overlay); `'auto'` flips to grid only once the signal count exceeds [gridAutoThreshold].
     */
    fun effectiveMode(
        mode: SignalChartMode,
        selectedSignalCount: Int,
        gridAutoThreshold: Int,
    ): ResolvedChartMode =
        when (mode) {
            SignalChartMode.Overlay -> ResolvedChartMode.Overlay
            SignalChartMode.Grid ->
                if (selectedSignalCount >= MIN_GRID_SERIES) ResolvedChartMode.Grid else ResolvedChartMode.Overlay
            SignalChartMode.Auto ->
                if (selectedSignalCount > gridAutoThreshold) ResolvedChartMode.Grid else ResolvedChartMode.Overlay
        }

    /**
     * One signal's per-row values in row order — the web `<Line dataKey={sig} />` projection. A row missing
     * the signal (or carrying a non-finite value) contributes `null` so the line bridges the gap
     * (`connectNulls`).
     */
    fun seriesValues(
        rows: List<SignalChartRow>,
        signal: String,
    ): List<Double?> = rows.map { row -> row.values[signal]?.takeIf { it.isFinite() } }

    /**
     * Projects [data] into render-ready chart inputs — the web component's full derivation. [xLabels] are the
     * raw timestamps (formatted at render), each selected signal becomes one [SignalChartSeries] (the second
     * flagged [SignalChartSeries.onRightAxis] when [useRightAxis] holds, mirroring the web
     * `yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}`), and [resolvedMode] selects overlay vs grid.
     */
    fun project(
        data: SignalChartData,
        mode: SignalChartMode,
        gridAutoThreshold: Int,
    ): SignalChartProjectionResult {
        val rightAxis = useRightAxis(data.stats)
        val series =
            data.selectedSignals.mapIndexed { index, signal ->
                SignalChartSeries(
                    signal = signal,
                    values = seriesValues(data.rows, signal),
                    onRightAxis = rightAxis && index == 1,
                )
            }
        return SignalChartProjectionResult(
            xLabels = data.rows.map { it.timestamp },
            series = series,
            resolvedMode = effectiveMode(mode, data.selectedSignals.size, gridAutoThreshold),
            useRightAxis = rightAxis,
            isEmpty = data.rows.isEmpty(),
        )
    }

    /**
     * Locale-grouped integer rendering (e.g. `1,234`) — the native analogue of the web `fmtInt`
     * (`fmtNumber(v, 0)`): zero fraction digits with the locale's grouping separator. Drives the live
     * event/point counters and the historical "points loaded" annotation.
     */
    fun fmtInt(
        value: Int,
        locale: Locale = Locale.getDefault(),
    ): String =
        java.text.NumberFormat
            .getIntegerInstance(locale)
            .format(value.toLong())

    /**
     * Default time-of-day tick label (`HH:mm:ss` in the device zone) — the standalone analogue of the web
     * `useDateFormat().formatTime`. The host owns the real locale/timezone-aware formatter and may inject it
     * at the render boundary (the same host-owns-the-time-label split the sibling chart surfaces document);
     * an unparseable timestamp degrades to its raw text rather than throwing.
     */
    fun defaultTimeLabel(timestamp: String): String =
        runCatching { TIME_LABEL_FORMATTER.format(Instant.parse(timestamp)) }.getOrDefault(timestamp)

    /** `|max - min|`, or [FLAT_RANGE_FALLBACK] when the signal is flat — web `Math.abs(s.max - s.min) || 1`. */
    private fun rangeOf(stat: SignalStat): Double {
        val range = abs(stat.max - stat.min)
        return if (range == 0.0) FLAT_RANGE_FALLBACK else range
    }

    private val TIME_LABEL_FORMATTER: DateTimeFormatter =
        DateTimeFormatter.ofPattern(TIME_LABEL_PATTERN).withZone(ZoneId.systemDefault())
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_CHART_PANEL_SLUG] (P1/S11). Carries
 * only the slug — never a signal name, value, or count — so a diagnostics line can never leak the vehicle's
 * live state. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordSignalChartPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_CHART_PANEL_SLUG))
}
