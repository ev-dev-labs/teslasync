// The native Jetpack Compose + Material 3 Elevation Profile chart feature view — a parity port of
// web/src/features/driving/components/drive-detail/ElevationChart.tsx. The web component is purely
// presentational: it wraps the shared `<ChartContainer height={220}>` (title + aria fallback + loading /
// empty states) around a Recharts `<ComposedChart>` of an elevation Area (#10b981, left axis, "Elevation
// (m)") plus a speed Line (#a855f7, right axis, "Speed (<unit>)") over the drive's time axis, with a green
// gain / red loss / muted net header above the plot and a synced reference line at the shared cursor X.
// It renders a friendly "No telemetry data available" surface when `chartData.length <= 1`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation` → the i18n catalog, `useUnits` → the live unit formatter for the speed-unit
// LABEL only, and `useSyncedCursor`/`useSyncedReferenceLineX` → the shared `CursorSyncStore`). The host
// supplies the already-projected samples + stats through the shared P1/S8 state-holder layer as a
// [UiState] (the Drive Detail page is the web parent that builds `chartData`/`stats`), so this feature view
// renders every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline (cached "last known") — without ever fetching. A web-parity overload that takes the raw
// `chartData` + `stats` props is also provided.
//
// Two documented platform deviations from the web, both forced by the shared chart layer (which feature
// views must consume as-is, never modify nor bypass with a direct Vico import):
//   1. Single value axis. Vico's shared `ComboChart` has one start axis, not the web's dual elevation/speed
//      axes (SURVEY.md). Both series share it; the elevation Area dominates the scale (the chart is the
//      "Elevation Profile") and the legend + series names carry each unit, exactly as the web axes (which
//      themselves show only plain numbers, units living in the series names). No value is ever rescaled.
//   2. Reference line → marker rail. Vico 2.0 has no vertical-line decoration, so the web `<ReferenceLine>`
//      at the synced cursor renders as the shared severity-pin rail above the plot (SURVEY.md), driven by
//      the same process-wide `CursorSyncStore` the web `useSyncedReferenceLineX` reads.
//
// Colors map web hex → generated palette token exactly: elevation #10b981 = `TeslaTokens.chart.battery`
// (#10B981), speed #a855f7 = `TeslaTokens.chart.power` (#A855F7).
//
// `chart-a11y:no-table` (web source comment): this is a dense per-sample elevation+speed trace, so — like
// the web — no fallback data table is rendered; the chart's accessible description (the aria label) plus
// the visible gain/loss/net summary and the legend carry the screen-reader content.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ElevationChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.elevationchart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import java.util.Locale

/** The web `<ChartContainer height={220}>` plot height. */
private val CHART_HEIGHT: Dp = 220.dp

/** Series keys — the web `<Area dataKey="elevation" />` / `<Line dataKey="speed" />`. */
private const val ELEVATION_SERIES_KEY: String = "elevation"
private const val SPEED_SERIES_KEY: String = "speed"

/** Gain / loss header arrows — the web `<ArrowUpRight/>` / `<ArrowDownRight/>` glyphs (language-neutral). */
private const val GAIN_ARROW: String = "\u2191"
private const val LOSS_ARROW: String = "\u2193"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the Elevation Profile chart. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live display units (web `useUnits`: the speed-unit label + locale +
 * decimal precision) from the shared formatter, and renders every lifecycle [state] the host's Drive Detail
 * feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view
 * never performs HTTP. [syncId] binds the shared cross-chart cursor (web `useSyncedCursor`); `null` (the
 * default) means the surface is standalone and shows no synced reference marker.
 *
 * @param state the cache-then-network projection of the drive's chart data + stats (web `chartData`/`stats`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page-scoped cursor-sync key shared by the drive-detail charts, or `null` if standalone.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ElevationChart(
    state: UiState<ElevationChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordElevationChartOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    ElevationChartContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        syncId = syncId,
        speedUnit = prefs.speed.label,
        locale = resolveDisplayLocale(prefs.locale),
        decimals = prefs.precision ?: DEFAULT_DECIMALS,
    )
}

/**
 * Web-parity overload mirroring the web component's `chartData` + `stats` props, for hosts that already hold
 * the projected samples. A list shorter than two samples renders the empty state (the web
 * `chartData.length <= 1` branch); two or more render the chart. Delegates to the stateful entry, so it
 * records `view.opened` and resolves live units identically. There is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun ElevationChart(
    chartData: List<ElevationSample>?,
    stats: ElevationStats?,
    modifier: Modifier = Modifier,
    syncId: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(chartData, stats) { elevationChartState(chartData, stats) }
    ElevationChart(state = state, onRetry = {}, modifier = modifier, syncId = syncId, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready state,
 * renders the gain/loss/net header, the elevation-Area + speed-Line [ComboChart], and the two-series legend,
 * reproducing the web `ChartContainer` + `ComposedChart` composition. A freshness chip appears when the
 * cached data is refreshing / stale / offline, and stale (non-error) data auto-refreshes — mirroring the
 * web freshness contract. [speedUnit] labels the speed series (web `unitPrefs.speed`), [locale] + [decimals]
 * format the metre figures (web `fmtNumber`), and [syncId] surfaces the shared cursor marker.
 */
@Composable
fun ElevationChartContent(
    state: UiState<ElevationChartData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = null,
    speedUnit: String = SpeedUnitPref.KMH.label,
    locale: Locale = Locale.US,
    decimals: Int = DEFAULT_DECIMALS,
    strings: ElevationChartStrings = rememberElevationChartStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, locale, decimals) {
            ElevationChartProjection.project(
                data = state.data ?: ElevationChartData(emptyList(), ElevationStats(0.0, 0.0)),
                formatMeters = { meters -> ElevationChartProjection.formatNumber(meters, decimals, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // Web hex → generated token, exact: elevation #10b981 = chart.battery, speed #a855f7 = chart.power.
    val elevationColor = TeslaTokens.chart.battery
    val speedColor = TeslaTokens.chart.power
    val elevationName = "${strings.elevationSeriesLabel} ($METERS_UNIT)"
    val speedName = "${strings.speedSeriesLabel} ($speedUnit)"

    val series =
        remember(result.elevationValues, result.speedValues, elevationName, speedName, elevationColor, speedColor) {
            listOf(
                ChartSeries(
                    key = ELEVATION_SERIES_KEY,
                    label = elevationName,
                    values = result.elevationValues,
                    kind = ChartSeriesKind.Area,
                    color = elevationColor,
                    unit = METERS_UNIT,
                ),
                ChartSeries(
                    key = SPEED_SERIES_KEY,
                    label = speedName,
                    values = result.speedValues,
                    kind = ChartSeriesKind.Line,
                    color = speedColor,
                    unit = speedUnit,
                ),
            )
        }
    val legend =
        remember(elevationName, speedName, elevationColor, speedColor) {
            listOf(
                LegendEntry(key = ELEVATION_SERIES_KEY, label = elevationName, color = elevationColor),
                LegendEntry(key = SPEED_SERIES_KEY, label = speedName, color = speedColor),
            )
        }

    // The shared cursor X (web `useSyncedReferenceLineX`) renders as a marker-rail pin (SURVEY.md), labelled
    // with the sample's time so the rail's screen-reader text identifies the synced moment.
    val syncedX = cursorSyncPosition(syncId)
    val markers =
        remember(syncedX, result.xLabels) {
            if (syncedX != null && syncedX in result.xLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = syncedX,
                        label = result.xLabels[syncedX],
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_driveDetail_noChartData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { ElevationFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_driveDetail_section_elevationChartFailed),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ElevationStatsHeader(result = result, strings = strings)
            ComboChart(
                series = series,
                xLabels = result.xLabels,
                height = CHART_HEIGHT,
                markers = markers,
                yValueFormatter = { value -> ElevationChartProjection.formatNumber(value, decimals, locale) },
                emptyMessage = emptyMessage,
            )
            ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The cumulative gain / loss / net header above the plot — the web `flex items-center gap-4` row: a green
 * climbed total, a red descended total, and a muted net (`gain − loss`). Each figure already carries its
 * metre suffix from the projection; this only adds the directional arrow + localized word and the semantic
 * color (status success / danger, the per-theme analogue of the web `text-green-400` / `text-red-400`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ElevationStatsHeader(
    result: ElevationChartProjectionResult,
    strings: ElevationChartStrings,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        BodyText("$GAIN_ARROW ${result.gainText} ${strings.gainLabel}", color = TeslaTokens.status.success)
        BodyText("$LOSS_ARROW ${result.lossText} ${strings.lossLabel}", color = TeslaTokens.status.danger)
        BodyText("${strings.netLabel}: ${result.netText}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline —
 * the honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the
 * localized "Offline" label; a stale-but-reachable value reads its relative age. Mirrors the sibling
 * surfaces' freshness contract; carries no English literal.
 */
@Composable
private fun ElevationFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberElevationFreshnessFormatter(),
    )
}

/**
 * Builds the localized [ElevationChartStrings] from the i18n catalog (P1/S10): the `driveDetail.*` keys the
 * web component reads. `elevProfileAria` materializes the web's inline-default aria string (the web
 * `driveDetail.elevProfile.aria` key never resolves — `driveDetail.elevProfile` is already a string, so the
 * dotted child can't exist; the web always shows its inline default). Remembered against the resolved
 * strings so a locale change re-projects.
 */
@Composable
fun rememberElevationChartStrings(): ElevationChartStrings {
    val title = stringResource(R.string.translation_driveDetail_elevProfile)
    val ariaLabel = stringResource(R.string.translation_driveDetail_elevProfileAria)
    val elevationSeriesLabel = stringResource(R.string.translation_driveDetail_elevation)
    val speedSeriesLabel = stringResource(R.string.translation_driveDetail_speed)
    val gainLabel = stringResource(R.string.translation_driveDetail_gain)
    val lossLabel = stringResource(R.string.translation_driveDetail_loss)
    val netLabel = stringResource(R.string.translation_driveDetail_net)
    return remember(title, ariaLabel, elevationSeriesLabel, speedSeriesLabel, gainLabel, lossLabel, netLabel) {
        ElevationChartStrings(
            title = title,
            ariaLabel = ariaLabel,
            elevationSeriesLabel = elevationSeriesLabel,
            speedSeriesLabel = speedSeriesLabel,
            gainLabel = gainLabel,
            lossLabel = lossLabel,
            netLabel = netLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberElevationFreshnessFormatter(): (FreshnessAge) -> String {
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
    ElevationChartStrings(
        title = "Elevation Profile",
        ariaLabel = "Elevation and speed area+line chart over the drive timeline",
        elevationSeriesLabel = "Elevation",
        speedSeriesLabel = "Speed",
        gainLabel = "gain",
        lossLabel = "loss",
        netLabel = "Net",
    )

private val PREVIEW_DATA =
    ElevationChartData(
        samples =
            listOf(
                ElevationSample(time = "09:00", elevationMeters = 120.0, speed = 0.0),
                ElevationSample(time = "09:05", elevationMeters = 168.0, speed = 42.0),
                ElevationSample(time = "09:10", elevationMeters = 210.0, speed = 65.0),
                ElevationSample(time = "09:15", elevationMeters = 184.0, speed = 58.0),
                ElevationSample(time = "09:20", elevationMeters = 142.0, speed = 31.0),
            ),
        stats = ElevationStats(elevGainMeters = 132.0, elevLossMeters = 68.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ElevationChartLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationChartContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ElevationChartEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationChartContent(
            state = UiState(UiPhase.Empty, data = ElevationChartData(emptyList(), ElevationStats(0.0, 0.0))),
            onRetry = {},
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ElevationChartErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationChartContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ElevationChartContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationChartContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ElevationChartOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationChartContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
