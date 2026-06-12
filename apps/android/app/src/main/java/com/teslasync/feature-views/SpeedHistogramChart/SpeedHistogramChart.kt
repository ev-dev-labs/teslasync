// The native Jetpack Compose + Material 3 Speed Histogram chart feature view — a parity port of
// web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / aria fallback table / loading + empty
// states) around a Recharts `<BarChart>` of one `pct` bar per speed `range` bucket, and renders an
// "Activity" empty state ("No telemetry data available") when there are no buckets.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the buckets through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the drive-detail
// feed), so this feature view renders every lifecycle state that layer can carry — loading, hard error with
// retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The native
// [ChartContainer] + [BarChartWrapper] are the faithful counterparts of the web `ChartContainer` +
// `BarChart`. A web-parity overload that takes the raw `speedHistData` prop is also provided.
//
// Color: the single bar resolves to `TeslaTokens.chart.power`, whose value (0xFFA855F7) is exactly the web
// bar's hard-coded `fill="#a855f7"`. The web used a raw hex; the native theme layer forbids raw hex in
// component code, so the token of identical value is used — a presentation color, not a semantic "power"
// reference, kept theme-aware so light / dark / high-contrast stay correct.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SpeedHistogramChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedhistogramchart

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<ChartContainer height={220}>` plot height. */
private val CHART_HEIGHT: Dp = 220.dp

/** The single bar series key — the web `<Bar dataKey="pct" />`. */
private const val PCT_SERIES_KEY: String = "pct"

/** The web bar-name prefix — the literal `% ` in `` `% ${t('driveDetail.ofDrive')}` ``. */
private const val PCT_PREFIX: String = "% "

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Speed Histogram chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared drive-detail feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `SpeedHistogramBucket[]` (web `speedHistData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SpeedHistogramChart(
    state: UiState<List<SpeedHistogramBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSpeedHistogramChartOpened(logger) }
    SpeedHistogramChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `speedHistData: SpeedHistogramBucket[]` prop, for hosts
 * that already hold the bucketed list. An empty list renders the empty state (the web `speedHistData.length
 * > 0` branch), a non-empty list renders the bars. Records `view.opened` like the stateful entry. There is
 * no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SpeedHistogramChart(
    speedHistData: List<SpeedHistogramBucket>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(speedHistData) {
            val items = speedHistData ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    SpeedHistogramChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the
 * [BarChartWrapper] in the ready state, reproducing the web `ChartContainer` + `BarChart` composition: a
 * localized title, the aria fallback description + data table (Speed range / % of drive), and a freshness
 * chip when the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the percent values.
 */
@Composable
fun SpeedHistogramChartContent(
    state: UiState<List<SpeedHistogramBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SpeedHistogramChartStrings = rememberSpeedHistogramChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            SpeedHistogramChartProjection.project(
                buckets = state.data ?: emptyList(),
                formatPct = { pct -> SpeedHistogramChartProjection.formatPct(pct, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // The web bar's hard-coded `fill="#a855f7"` maps to the token of identical value (0xFFA855F7).
    val barColor = TeslaTokens.chart.power
    val series =
        remember(result.values, strings.seriesLabel, barColor) {
            listOf(
                ChartSeries(
                    key = PCT_SERIES_KEY,
                    label = strings.seriesLabel,
                    values = result.values,
                    kind = ChartSeriesKind.Bar,
                    color = barColor,
                ),
            )
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    // The web wraps the panel in `<FadeIn className="h-full">`; the native FadeIn is the counterpart and
    // honors reduced motion (rememberReducedMotion) — when motion is reduced the panel renders in its final
    // state with no entry animation. The caller's [modifier] frames the FadeIn; the panel fills its width.
    FadeIn(modifier = modifier) {
        ChartContainer(
            title = strings.title,
            modifier = Modifier.fillMaxWidth(),
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { SpeedHistogramFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            dataTableHeader = listOf(strings.rangeColumn, strings.pctColumn),
            dataTableRows = result.tableRows,
            dataTableLabel = stringResource(R.string.translation_Details),
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            BarChartWrapper(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> SpeedHistogramChartProjection.formatPct(value, locale) },
                emptyMessage = emptyMessage,
            )
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun SpeedHistogramFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSpeedHistogramFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SpeedHistogramChartStrings] from the i18n catalog (P1/S10): the `driveDetail.*` keys
 * the web component reads. The [SpeedHistogramChartStrings.seriesLabel] is composed exactly as the web bar
 * name — `% ` + `driveDetail.ofDrive` — so the tooltip series reads `% of drive`. Remembered against the
 * resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSpeedHistogramChartStrings(): SpeedHistogramChartStrings {
    val title = stringResource(R.string.translation_driveDetail_speedHistogram)
    val ariaLabel = stringResource(R.string.translation_driveDetail_speedHistogramAria)
    val rangeColumn = stringResource(R.string.translation_driveDetail_col_range)
    val pctColumn = stringResource(R.string.translation_driveDetail_col_pct)
    val ofDrive = stringResource(R.string.translation_driveDetail_ofDrive)
    return remember(title, ariaLabel, rangeColumn, pctColumn, ofDrive) {
        SpeedHistogramChartStrings(
            title = title,
            ariaLabel = ariaLabel,
            rangeColumn = rangeColumn,
            pctColumn = pctColumn,
            seriesLabel = PCT_PREFIX + ofDrive,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSpeedHistogramFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
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

private val PREVIEW_STRINGS =
    SpeedHistogramChartStrings(
        title = "Speed Histogram",
        ariaLabel = "Speed-bucket distribution histogram",
        rangeColumn = "Speed range",
        pctColumn = "% of drive",
        seriesLabel = "% of drive",
    )

private val PREVIEW_BUCKETS =
    listOf(
        SpeedHistogramBucket(range = "0–20", pct = 12.0),
        SpeedHistogramBucket(range = "20–40", pct = 28.0),
        SpeedHistogramBucket(range = "40–60", pct = 35.0),
        SpeedHistogramBucket(range = "60–80", pct = 19.0),
        SpeedHistogramBucket(range = "80+", pct = 6.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SpeedHistogramChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedHistogramChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SpeedHistogramChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedHistogramChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SpeedHistogramChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedHistogramChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SpeedHistogramChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedHistogramChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SpeedHistogramChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SpeedHistogramChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_BUCKETS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
