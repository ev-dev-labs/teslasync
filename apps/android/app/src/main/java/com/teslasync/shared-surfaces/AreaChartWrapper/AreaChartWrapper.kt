// The native Jetpack Compose + Material 3 AreaChartWrapper shared surface — a parity port of the web
// presentational area chart (web/src/components/charts/AreaChartWrapper.tsx). The web component wraps a
// Recharts `<AreaChart>` that draws one gradient-filled `<Area type="monotone">` per series over a shared
// X/Y grid, formatting the axes + tooltip through the optional `xFormatter` / `yFormatter`. Its data layer
// (the row → label + nullable-number coercion + accessible-table projection) lives in AreaChartWrapperModel.kt.
//
// This port keeps that contract end to end and performs NO HTTP. It exposes two entry points, mirroring the
// accepted sibling chart surfaces:
//   • a web-parity presentational overload [AreaChartWrapper] that takes the raw `data` / `xKey` / `series`
//     props verbatim and renders the bare gradient area chart (or a localized empty state when there is
//     nothing to plot — never a blank box), exactly like the web component; and
//   • a state-holder-bound overload [AreaChartWrapper] that takes the host feed's [UiState] and renders every
//     lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
//     ("last known") — by framing the same plot in the shared [ChartContainer]. The host owns the feed
//     (P1/S8) and supplies `onRetry`; this view never fetches.
//
// The native [ChartContainer] + atomic gradient-area chart are the faithful counterparts of the web
// `<ResponsiveContainer>` + `<AreaChart>`. Feature/surface code must not import Vico directly, so the chart
// renderer (and its palette-by-position color fallback for a `null` series color) is the shared chart layer's
// concern; this surface only resolves localized chrome, freshness state, and the ARGB → Compose `Color` map.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AreaChartWrapper — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.areachartwrapper

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartDefaults
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.charts.AreaChartWrapper as GradientAreaChart

/** The web `height={300}` default plot height. */
private val DEFAULT_AREA_HEIGHT: Dp = 300.dp

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val FRESHNESS_EM_DASH: String = "\u2014"

/** The default value-axis / tooltip / table formatter — the web `yFormatter ?? (v => v)` (locale grouped). */
private fun defaultAreaValue(value: Double): String = ChartFormat.number(value, ChartDefaults.DECIMALS)

/**
 * Web-parity presentational overload — the faithful 1:1 port of the web `<AreaChartWrapper>` props. Renders
 * the bare gradient area chart for [data], or a localized empty state when there is nothing to plot (no rows
 * or no [series]); it adds no panel chrome, mirroring the web component's bare `<div>`. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11). There is no feed behind it, so it offers no retry affordance —
 * hosts that need the loading / error / offline lifecycle use the [UiState] overload.
 *
 * @param data the rows to plot (web `data: Record<string, unknown>[]`), in render order.
 * @param xKey the field naming each row's category label (web `xKey`).
 * @param series the configured gradient series (web `series: SeriesConfig[]`).
 * @param xFormatter the bottom-axis / tooltip-label formatter (web `xFormatter`); identity by default.
 * @param yFormatter the value-axis / tooltip-value formatter (web `yFormatter`); locale-grouped by default.
 */
@Composable
fun AreaChartWrapper(
    data: List<AreaChartRow>,
    xKey: String,
    series: List<AreaSeries>,
    modifier: Modifier = Modifier,
    height: Dp = DEFAULT_AREA_HEIGHT,
    xFormatter: (String) -> String = { it },
    yFormatter: (Double) -> String = ::defaultAreaValue,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AreaChartWrapperDiagnostics.recordViewOpened(logger) }

    val projection =
        remember(data, xKey, series) {
            AreaChartWrapperProjection.project(rows = data, xKey = xKey, series = series, xFormatter = xFormatter)
        }

    AreaPlot(
        projection = projection,
        modifier = modifier,
        height = height,
        xFormatter = xFormatter,
        yFormatter = yFormatter,
        emptyMessage = stringResource(R.string.translation_chart_noData),
    )
}

/**
 * State-holder-bound overload — records the one-shot `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the host feed can carry through the shared [ChartContainer]. The host owns the feed
 * (P1/S8) and supplies [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the rows to plot (web `data`).
 * @param title the panel title — the host names the otherwise-anonymous web chart (its parent's context).
 * @param xAxisLabel the category-column header for the accessible fallback table (host-supplied context).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 */
@Composable
fun AreaChartWrapper(
    state: UiState<List<AreaChartRow>>,
    xKey: String,
    series: List<AreaSeries>,
    title: String,
    xAxisLabel: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    height: Dp = DEFAULT_AREA_HEIGHT,
    xFormatter: (String) -> String = { it },
    yFormatter: (Double) -> String = ::defaultAreaValue,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AreaChartWrapperDiagnostics.recordViewOpened(logger) }
    AreaChartWrapperContent(
        state = state,
        xKey = xKey,
        series = series,
        title = title,
        xAxisLabel = xAxisLabel,
        onRetry = onRetry,
        modifier = modifier,
        subtitle = subtitle,
        height = height,
        xFormatter = xFormatter,
        yFormatter = yFormatter,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [state]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the gradient area
 * plot in the ready state, with the accessible fallback table (category column + one column per series) and a
 * freshness chip when the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the freshness contract of the sibling chart surfaces.
 */
@Composable
fun AreaChartWrapperContent(
    state: UiState<List<AreaChartRow>>,
    xKey: String,
    series: List<AreaSeries>,
    title: String,
    xAxisLabel: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    height: Dp = DEFAULT_AREA_HEIGHT,
    xFormatter: (String) -> String = { it },
    yFormatter: (Double) -> String = ::defaultAreaValue,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val projection =
        remember(state.data, xKey, series) {
            AreaChartWrapperProjection.project(
                rows = state.data ?: emptyList(),
                xKey = xKey,
                series = series,
                xFormatter = xFormatter,
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            projection.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val tableHeader = remember(xAxisLabel, projection) { AreaChartWrapperProjection.tableHeader(xAxisLabel, projection) }
    val tableRows = remember(projection) { AreaChartWrapperProjection.tableRows(projection, ::defaultAreaValue) }
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = title,
        modifier = modifier,
        subtitle = subtitle,
        status = status,
        height = height,
        action =
            if (showFreshness) {
                { AreaFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = stringResource(R.string.translation_chart_a11y_summary, title),
        dataTableHeader = tableHeader,
        dataTableRows = tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        emptyMessage = stringResource(R.string.translation_chart_noData),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        AreaPlot(
            projection = projection,
            height = height,
            xFormatter = xFormatter,
            yFormatter = yFormatter,
            emptyMessage = stringResource(R.string.translation_chart_noData),
        )
    }
}

/**
 * The shared ready-state plot for both overloads — builds the atomic [ChartSeries] list from the projected
 * [AreaChartProjection.columns] (resolving each [AreaSeriesColumn.colorArgb] to a Compose [Color], or deferring
 * to the chart palette by position when `null`) and renders the gradient area chart. The atomic wrapper shows
 * [emptyMessage] when there is nothing to plot, so this never collapses to a blank region.
 */
@Composable
private fun AreaPlot(
    projection: AreaChartProjection,
    height: Dp,
    xFormatter: (String) -> String,
    yFormatter: (Double) -> String,
    emptyMessage: String,
    modifier: Modifier = Modifier,
) {
    val chartSeries =
        remember(projection.columns) {
            projection.columns.map { column ->
                ChartSeries(
                    key = column.key,
                    label = column.label,
                    values = column.values,
                    kind = ChartSeriesKind.Area,
                    color = column.colorArgb?.let { Color(it) },
                )
            }
        }
    GradientAreaChart(
        series = chartSeries,
        xLabels = projection.xLabels,
        modifier = modifier,
        height = height,
        yValueFormatter = yFormatter,
        xValueFormatter = xFormatter,
        emptyMessage = emptyMessage,
    )
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun AreaFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberAreaFreshnessFormatter(),
    )
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAreaFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> FRESHNESS_EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private const val PREVIEW_TITLE: String = "State of Charge"
private const val PREVIEW_SUBTITLE: String = "Battery level over the last drive"
private const val PREVIEW_X_AXIS_LABEL: String = "Time"
private const val PREVIEW_X_KEY: String = "t"

private val PREVIEW_SERIES: List<AreaSeries> =
    listOf(
        AreaSeries(key = "soc", label = "SOC %", colorArgb = 0xFF10B981.toInt()),
        AreaSeries(key = "range", label = "Range", colorArgb = 0xFF3B82F6.toInt()),
    )

private val PREVIEW_ROWS: List<AreaChartRow> =
    listOf(
        AreaChartRow("t" to "08:00", "soc" to 82, "range" to 305),
        AreaChartRow("t" to "08:30", "soc" to 74, "range" to 271),
        AreaChartRow("t" to "09:00", "soc" to 63, "range" to 232),
        AreaChartRow("t" to "09:30", "soc" to 55, "range" to 198),
    )

private fun previewState(
    phase: UiPhase,
    data: List<AreaChartRow>? = null,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<List<AreaChartRow>> =
    UiState(
        phase = phase,
        data = data,
        stale = stale,
        fetchedAt = if (stale) 1_700_000_000_000L else null,
        errorKind = errorKind,
    )

@Composable
private fun AreaChartWrapperPreview(state: UiState<List<AreaChartRow>>) {
    TeslaSyncTheme(dynamicColor = false) {
        AreaChartWrapperContent(
            state = state,
            xKey = PREVIEW_X_KEY,
            series = PREVIEW_SERIES,
            title = PREVIEW_TITLE,
            xAxisLabel = PREVIEW_X_AXIS_LABEL,
            onRetry = {},
            subtitle = PREVIEW_SUBTITLE,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AreaChartWrapperLoadingPreview() {
    AreaChartWrapperPreview(previewState(UiPhase.Loading))
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AreaChartWrapperEmptyPreview() {
    AreaChartWrapperPreview(previewState(UiPhase.Empty, data = emptyList()))
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun AreaChartWrapperErrorPreview() {
    AreaChartWrapperPreview(previewState(UiPhase.Error, errorKind = ErrorKind.Network))
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun AreaChartWrapperContentPreview() {
    AreaChartWrapperPreview(previewState(UiPhase.Content, data = PREVIEW_ROWS))
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun AreaChartWrapperOfflinePreview() {
    AreaChartWrapperPreview(previewState(UiPhase.Content, data = PREVIEW_ROWS, stale = true, errorKind = ErrorKind.Network))
}
