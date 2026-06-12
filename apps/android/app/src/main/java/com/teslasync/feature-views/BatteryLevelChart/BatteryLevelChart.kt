// The native Jetpack Compose + Material 3 Battery-Level-at-Charge-Start chart feature view — a parity port
// of web/src/features/charging/components/charging-list/BatteryLevelChart.tsx. The web component is purely
// presentational: it wraps a `GlassPanel` (title + a muted hint) around a Recharts `<BarChart>` of one
// amber `count` bar per start-of-charge SoC band (the `StartLevelBucket[]` its parent computes via
// `computeStartLevelDist`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog; counts use the localized number
// formatter). The host supplies the data through the shared P1/S8 state-holder layer as a [UiState], so this
// feature view renders every lifecycle state that layer can carry — loading, hard error with retry, empty,
// content, and stale/offline (cached "last known") — without ever fetching. The native [ChartContainer] +
// [BarChartWrapper] are the faithful counterparts of the web `GlassPanel` + `BarChart`; the bar's amber
// `chart.energy` design token is the token analogue of the web bar's `#f59e0b` fill (and the web title
// icon's `text-neon-amber`). Two entry points are offered: the stateful one binds the raw charging feed
// (`UiState<List<ChargingSessionStart>>`) and buckets it via the shared model — reproducing the web parent's
// `computeStartLevelDist(sessions)` — while a web-parity overload takes the already-computed
// `StartLevelBucket[]` exactly like the web component's `data` prop.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryLevelChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterylevelchart

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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.roundToLong

/** The plot height — the web `h-36 sm:h-44` (≈176 dp at the larger breakpoint). */
private val CHART_HEIGHT: Dp = 176.dp

/** The single bar series key — the web `<Bar dataKey="count" />`. */
private const val COUNT_SERIES_KEY: String = "count"

/** Em dash shown when a freshness age is unknown — the sibling surfaces' freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point bound to the raw charging feed. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared charging feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP. The
 * payload is bucketed via the shared model ([distributionState]) — the native mirror of the web parent's
 * `computeStartLevelDist(sessions)` — before rendering.
 *
 * @param state the cache-then-network projection of the `ChargingSession[]` (web `sessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryLevelChart(
    state: UiState<List<ChargingSessionStart>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordBatteryLevelChartOpened(logger) }
    val bucketState = remember(state) { distributionState(state) }
    BatteryLevelChartContent(state = bucketState, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: StartLevelBucket[]` prop, for hosts that already
 * computed the distribution. An all-zero (or empty) list renders the friendly empty state; any populated
 * band renders the bars. Records `view.opened` like the stateful entry. There is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun BatteryLevelChart(
    buckets: List<StartLevelBucket>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordBatteryLevelChartOpened(logger) }
    val state =
        remember(buckets) {
            val items = buckets ?: emptyList()
            val phase = if (items.isEmpty() || items.all { it.count == 0L }) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    BatteryLevelChartContent(state = state, onRetry = {}, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the single-series
 * [BarChartWrapper] in the ready state, reproducing the web `GlassPanel` + `BarChart` composition: a
 * localized title/subtitle, the aria fallback description + data table (Range / Sessions), and a freshness
 * chip when the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the session counts.
 */
@Composable
fun BatteryLevelChartContent(
    state: UiState<List<StartLevelBucket>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: BatteryLevelChartStrings = rememberBatteryLevelChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale) {
            BatteryLevelChartProjection.projectBuckets(
                buckets = state.data ?: emptyList(),
                formatCount = { count -> BatteryLevelChartProjection.formatCount(count, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val barColor = TeslaTokens.chart.energy
    val series =
        remember(result.values, strings.seriesLabel, barColor) {
            listOf(
                ChartSeries(
                    key = COUNT_SERIES_KEY,
                    label = strings.seriesLabel,
                    values = result.values,
                    kind = ChartSeriesKind.Bar,
                    color = barColor,
                ),
            )
        }

    val emptyMessage = stringResource(R.string.translation_chart_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        subtitle = strings.subtitle,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { BatteryLevelFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = "${strings.title} ${strings.subtitle}",
        dataTableHeader = listOf(strings.rangeColumn, strings.sessionsColumn),
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
            yValueFormatter = { value -> BatteryLevelChartProjection.formatCount(value.roundToLong(), locale) },
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun BatteryLevelFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberBatteryLevelFreshnessFormatter(),
    )
}

/**
 * Builds the localized [BatteryLevelChartStrings] from the i18n catalog (P1/S10): the two
 * `charging.charts.*` keys the web component reads, plus the accessible table headers (`common.range` /
 * `charging.curve.col.sessions`) and the bar series name (web `<Bar name="Sessions" />`, reusing the
 * `Sessions` column key). Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberBatteryLevelChartStrings(): BatteryLevelChartStrings {
    val title = stringResource(R.string.translation_charging_charts_batteryLevelAtStart)
    val subtitle = stringResource(R.string.translation_charging_charts_batteryLevelHint)
    val rangeColumn = stringResource(R.string.translation_common_range)
    val sessionsColumn = stringResource(R.string.translation_charging_curve_col_sessions)
    return remember(title, subtitle, rangeColumn, sessionsColumn) {
        BatteryLevelChartStrings(
            title = title,
            subtitle = subtitle,
            rangeColumn = rangeColumn,
            sessionsColumn = sessionsColumn,
            seriesLabel = sessionsColumn,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberBatteryLevelFreshnessFormatter(): (FreshnessAge) -> String {
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
    BatteryLevelChartStrings(
        title = "Battery Level at Charge Start",
        subtitle = "How low do you typically go before charging?",
        rangeColumn = "Range",
        sessionsColumn = "Sessions",
        seriesLabel = "Sessions",
    )

private val PREVIEW_BUCKETS =
    listOf(
        StartLevelBucket("0-10%", 1),
        StartLevelBucket("10-20%", 3),
        StartLevelBucket("20-30%", 6),
        StartLevelBucket("30-40%", 9),
        StartLevelBucket("40-50%", 7),
        StartLevelBucket("50-60%", 4),
        StartLevelBucket("60-70%", 2),
        StartLevelBucket("70-80%", 1),
        StartLevelBucket("80-90%", 0),
        StartLevelBucket("90-100%", 0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun BatteryLevelChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryLevelChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun BatteryLevelChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryLevelChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun BatteryLevelChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryLevelChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun BatteryLevelChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryLevelChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun BatteryLevelChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryLevelChartContent(
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
