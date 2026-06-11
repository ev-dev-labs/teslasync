// The native Jetpack Compose + Material 3 Ingest X-Ray bucket chart feature view — a parity port of
// web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer>` (title / subtitle / aria fallback table /
// loading + empty states) around a Recharts `<BarChart>` of `count` per `bucket_start` time bucket.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its
// only web hooks are `useTranslation` + `useDateFormat`, mapped here to the i18n catalog and a localized
// time formatter). The host supplies the buckets through the shared P1/S8 state-holder layer as a
// [UiState] (the cache-then-network projection of the ingest-x-ray feed), so this feature view renders
// every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. The native [ChartContainer] +
// [BarChartWrapper] are the faithful counterparts of the web `ChartContainer` + `BarChart`; the brand
// `MaterialTheme.colorScheme.primary` is the token analogue of the web bar's `var(--accent-primary)`.
// A web-parity overload that takes the raw `buckets` + `loading` props is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/XRayBucketChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xraybucketchart

import androidx.compose.material3.MaterialTheme
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
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale
import kotlin.math.roundToLong

/** The web `<ChartContainer height={260}>` plot height. */
private val CHART_HEIGHT: Dp = 260.dp

/** The single bar series key — the web `<Bar dataKey="count" />`. */
private const val COUNT_SERIES_KEY: String = "count"

/**
 * Stateful entry point for the ingest-x-ray bucket chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared ingest-x-ray feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `IngestXRayBucketPoint[]` (web `buckets`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun XRayBucketChart(
    state: UiState<List<XRayBucketPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordXRayBucketChartOpened(logger) }
    XRayBucketChartContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `buckets` + `loading` props, for hosts that already
 * hold the loaded list. While [loading] the surface shows the chart loading state; otherwise an empty
 * list renders the empty state (web `!loading && series.length === 0`) and a non-empty list renders the
 * bars. Records `view.opened` like the stateful entry. There is no fetch behind it, so no retry is offered.
 */
@Composable
fun XRayBucketChart(
    buckets: List<XRayBucketPoint>?,
    loading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(buckets, loading) {
            val items = buckets ?: emptyList()
            val phase =
                when {
                    loading -> UiPhase.Loading
                    items.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = items)
        }
    XRayBucketChart(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's
 * [UiState] onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and renders the
 * [BarChartWrapper] in the ready state, reproducing the web `ChartContainer` + `BarChart` composition: a
 * localized title/subtitle, the aria fallback description + data table (Bucket / Samples), and a freshness
 * chip when the cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale]/[zoneId] format the bucket times and sample counts.
 */
@Composable
fun XRayBucketChartContent(
    state: UiState<List<XRayBucketPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: XRayBucketChartStrings = rememberXRayBucketChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale, zoneId) {
            XRayBucketChartProjection.project(
                buckets = state.data ?: emptyList(),
                formatTime = { iso -> XRayBucketTimeFormatting.format(iso, zoneId, locale) },
                formatCount = { count -> XRayBucketChartProjection.formatCount(count, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val barColor = MaterialTheme.colorScheme.primary
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
                { XRayFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        dataTableHeader = listOf(strings.bucketColumn, strings.countColumn),
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
            yValueFormatter = { value -> XRayBucketChartProjection.formatCount(value.roundToLong(), locale) },
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
private fun XRayFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberXRayFreshnessFormatter(),
    )
}

/**
 * Builds the localized [XRayBucketChartStrings] from the i18n catalog (P1/S10): the six `admin.xray.chart.*`
 * keys the web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberXRayBucketChartStrings(): XRayBucketChartStrings {
    val title = stringResource(R.string.translation_admin_xray_chart_title)
    val subtitle = stringResource(R.string.translation_admin_xray_chart_subtitle)
    val ariaLabel = stringResource(R.string.translation_admin_xray_chart_ariaLabel)
    val bucketColumn = stringResource(R.string.translation_admin_xray_chart_cols_bucket)
    val countColumn = stringResource(R.string.translation_admin_xray_chart_cols_count)
    val seriesLabel = stringResource(R.string.translation_admin_xray_chart_tooltip)
    return remember(title, subtitle, ariaLabel, bucketColumn, countColumn, seriesLabel) {
        XRayBucketChartStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            bucketColumn = bucketColumn,
            countColumn = countColumn,
            seriesLabel = seriesLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberXRayFreshnessFormatter(): (FreshnessAge) -> String {
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
    XRayBucketChartStrings(
        title = "Samples per bucket",
        subtitle = "Time-series of ingested telemetry rows over the selected window.",
        ariaLabel = "Bar chart of ingest sample counts per time bucket.",
        bucketColumn = "Bucket",
        countColumn = "Samples",
        seriesLabel = "Samples",
    )

private val PREVIEW_BUCKETS =
    listOf(
        XRayBucketPoint(bucketStart = "2026-04-04T14:00:00Z", count = 1_204),
        XRayBucketPoint(bucketStart = "2026-04-04T15:00:00Z", count = 1_877),
        XRayBucketPoint(bucketStart = "2026-04-04T16:00:00Z", count = 932),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun XRayBucketChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayBucketChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun XRayBucketChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayBucketChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun XRayBucketChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayBucketChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun XRayBucketChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayBucketChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_BUCKETS),
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun XRayBucketChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayBucketChartContent(
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
            zoneId = ZoneOffset.UTC,
            strings = PREVIEW_STRINGS,
        )
    }
}
