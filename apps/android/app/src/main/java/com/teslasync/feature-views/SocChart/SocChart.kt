// The native Jetpack Compose + Material 3 SOC-over-time chart feature view — a parity port of
// web/src/features/driving/components/drive-detail/SocChart.tsx. The web component is purely presentational:
// inside a `<FadeIn className="h-full">` it wraps the shared `<ChartContainer title="SOC % Over Time"
// height={220}>` around a Recharts `<AreaChart>` of the single green `battery` (state-of-charge percent)
// area, with a `<YAxis domain={[0, 100]}>` and a synced reference line; ≤ 1 sample renders its
// "No telemetry data available" branch instead.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog, and `useSyncedCursor`/`useSyncedReferenceLineX` →
// [cursorSyncPosition] over the shared [CursorSyncStore], surfaced as a marker rail (the Vico counterpart of
// the web `<ReferenceLine x={syncedX}>`; the shared cartesian renderer draws no overlay reference line). The
// host supplies the per-sample SOC trace through the shared P1/S8 state-holder layer as a [UiState] (the
// cache-then-network projection of the selected drive's `chartData`), so this feature view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
// (cached "last known") — without ever fetching. The native [ChartContainer] + [AreaChartWrapper] are the
// faithful counterparts of the web `ChartContainer` + `AreaChart`. A web-parity overload that takes the raw
// `chartData` prop is also provided.
//
// The SOC area takes the generated `chart.battery` design token (`TeslaTokens.chart.battery`), which is the
// token analogue of the web area's `#10b981` fill — same value, but theme-aware and never a raw hex literal
// in render code (light / dark / high-contrast all stay correct). The web draws its own value axis with a
// fixed `domain={[0, 100]}`; the shared cartesian renderer exposes a single auto-scaled value axis and no
// fixed-domain hook, and it is allowed-files-frozen, so the axis auto-scales — SOC is itself a 0-100
// percentage, so the rendered axis stays within the web's domain. The web marks this surface
// `chart-a11y:no-table` (start/end SOC are shown in the drive summary tiles), so — like the sibling drive
// charts — no fallback data table is rendered; the chart's accessible description carries its meaning.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SocChart — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.socchart

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
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

/** The single area series key — the web `<Area dataKey="battery" />` (SOC plots `battery`). */
private const val SOC_KEY: String = "battery"

/** The SOC series-name unit suffix — the web `name={t('driveDetail.soc') + ' %'}`. */
private const val PERCENT_UNIT: String = "%"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * The page-scoped cursor `syncId` — the web `<ChartTimeRangeProvider syncId="drive-detail">` that
 * `useSyncedCursor`/`useSyncedReferenceLineX` read. When this chart is hosted next to the other drive-detail
 * charts under the same id, the shared [io.teslasync.android.components.charts.CursorSyncStore] mirrors the
 * hovered sample here as a marker.
 */
private const val DEFAULT_SYNC_ID: String = "drive-detail"

/**
 * Stateful entry point for the SOC-over-time chart. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared drive-trace feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the SOC trace (web `chartData`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page cursor-sync id (web `useSyncedCursor`); `null` disables the synced marker.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SocChart(
    state: UiState<List<SocChartPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSocChartOpened(logger) }
    SocChartContent(state = state, onRetry = onRetry, modifier = modifier, syncId = syncId)
}

/**
 * Web-parity overload mirroring the web component's `chartData: ChartDataPoint[]` prop, for hosts that
 * already hold the loaded trace. The web `chartData.length > 1` boundary is reproduced: 0 or 1 samples
 * render the empty state, 2+ render the area chart. Records `view.opened` like the stateful entry; with no
 * fetch behind it, it offers no retry affordance.
 */
@Composable
fun SocChart(
    chartData: List<SocChartPoint>?,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(chartData) {
            val items = chartData ?: emptyList()
            val phase = if (items.size > 1) UiPhase.Content else UiPhase.Empty
            UiState(phase = phase, data = items)
        }
    SocChart(state = state, onRetry = {}, modifier = modifier, syncId = syncId, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and in the ready state renders
 * the single-series [AreaChartWrapper] inside a [FadeIn], reproducing the web `FadeIn` + `ChartContainer` +
 * `AreaChart` composition: the localized title, the aria description, the synced cursor marker, and a
 * freshness chip when cached data is refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale] formats the value-axis ticks.
 */
@Composable
fun SocChartContent(
    state: UiState<List<SocChartPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    locale: Locale = Locale.getDefault(),
    strings: SocChartStrings = rememberSocChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result = remember(state.data) { SocChartProjection.project(state.data ?: emptyList()) }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val socColor = TeslaTokens.chart.battery
    val series =
        remember(result.socValues, strings.seriesLabel, socColor) {
            listOf(
                ChartSeries(
                    key = SOC_KEY,
                    label = "${strings.seriesLabel} $PERCENT_UNIT",
                    values = result.socValues,
                    kind = ChartSeriesKind.Area,
                    color = socColor,
                    unit = PERCENT_UNIT,
                ),
            )
        }

    val syncedIndex = cursorSyncPosition(syncId)
    val markers =
        remember(syncedIndex, result.xLabels) {
            val index = syncedIndex
            if (index != null && index in result.xLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = index,
                        label = result.xLabels[index],
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        ChartContainer(
            title = strings.title,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { SocFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            emptyMessage = emptyMessage,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            AreaChartWrapper(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                markers = markers,
                yValueFormatter = { value -> SocChartProjection.formatAxisValue(value, locale) },
                emptyMessage = emptyMessage,
            )
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling surfaces'
 * freshness contract; carries no English literal.
 */
@Composable
private fun SocFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberSocFreshnessFormatter(),
    )
}

/**
 * Builds the localized [SocChartStrings] from the i18n catalog (P1/S10): the title
 * (`driveDetail.socOverTime`) and series base (`driveDetail.soc`) resolve through compile-time resources;
 * the aria description resolves by-name with the web `t(key, default)` fallback, since the catalog defines
 * no key for it. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberSocChartStrings(): SocChartStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_driveDetail_socOverTime)
    val seriesLabel = stringResource(R.string.translation_driveDetail_soc)
    val ariaLabel = resolveOptional({ context.optionalString(it) }, KEY_ARIA, SocChartDefaults.ARIA_LABEL)
    return remember(title, seriesLabel, ariaLabel) {
        SocChartStrings(title = title, seriesLabel = seriesLabel, ariaLabel = ariaLabel)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberSocFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SocChartStrings(
        title = "SOC % Over Time",
        seriesLabel = "SOC",
        ariaLabel = "State of charge percent over time area chart",
    )

private val PREVIEW_POINTS =
    listOf(
        SocChartPoint("09:00", battery = 88.0),
        SocChartPoint("09:05", battery = 86.0),
        SocChartPoint("09:10", battery = 83.0),
        SocChartPoint("09:15", battery = 82.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SocChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SocChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun SocChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SocChartContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SocChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SocChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SocChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SocChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun SocChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SocChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_POINTS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
