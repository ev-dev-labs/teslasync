// The native Jetpack Compose + Material 3 ElevationProfile shared surface — a parity port of
// web/src/components/charts/ElevationProfile.tsx. The web component is purely presentational: it wraps the
// shared `<ChartContainer height={200}>` (title + subtitle + aria + loading / empty states) around a Recharts
// `<AreaChart>` of a single gradient-filled elevation Area (#10b981) over the route's distance axis, with a
// cumulative `↑ {gain}m  ↓ {loss}m` subtitle and a synced reference line at the replay cursor's distance. It
// renders a friendly "No elevation data available" surface when `data.length === 0`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation` → the i18n catalog). The host supplies the already-projected samples through
// the shared P1/S8 state-holder layer as a [UiState] (the trip-replay page is the web parent that builds
// `data`), so this surface renders every lifecycle state that layer can carry — loading, hard error with
// retry, empty, content, and stale/offline (cached "last known") — without ever fetching. A web-parity
// overload that takes the raw `data` + `currentIndex` props is also provided.
//
// Three documented platform deviations from the web, all forced by the shared chart layer (which surfaces must
// consume as-is, never modify nor bypass with a direct Vico import):
//   1. ReferenceLine → marker rail. Vico 2.0 has no vertical-line decoration, so the web `<ReferenceLine>` at
//      the synced cursor renders as the shared severity-pin rail above the plot (SURVEY.md), driven by the same
//      process-wide `CursorSyncStore` the web `useSyncedReferenceLineX` reads. The web `currentIndex` prop is
//      honored directly and otherwise falls back to the synced cross-chart cursor.
//   2. Axis titles → series unit + subtitle. The shared Vico scaffold renders value labels but no axis titles,
//      so the web's `m` (y) / `distanceUnit` (x) axis labels live on the series unit, the cursor pin label, and
//      the gain/loss subtitle instead. No value is ever rescaled.
//   3. Click-to-seek is not wired. The web `onClickIndex` scrubs the replay cursor on tap; the shared
//      scroll-disabled Vico host exposes no per-point tap, so — like the sibling drive-replay charts — the
//      cursor is presented read-only (the marker rail) rather than shipping a dead tap affordance.
//
// Color maps web hex → generated palette token exactly: elevation #10b981 = `TeslaTokens.chart.battery`.
//
// `chart-a11y:no-table` (web source comment): this is a dense per-sample elevation trace, so — like the web —
// no fallback data table is rendered; the chart's accessible description (the aria label) plus the visible
// gain/loss subtitle carry the screen-reader content.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ElevationProfile — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.elevationprofile

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
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
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

/** The web `<ChartContainer height={200}>` plot height. */
private val CHART_HEIGHT: Dp = 200.dp

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for the ElevationProfile surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the live display units (the distance-unit label + locale) from the shared formatter, and
 * renders every lifecycle [state] the host's trip-replay feed can carry. The host owns the feed (P1/S8) and
 * supplies [onRetry] (the feed's `refetch`); this surface never performs HTTP. [currentIndex] is the web replay
 * cursor; [syncId] binds the shared cross-chart cursor (web `useSyncedReferenceLineX`), used when no explicit
 * [currentIndex] is set. [distanceUnit] overrides the resolved live label when a caller already holds it.
 *
 * @param state the cache-then-network projection of the route's elevation samples (web `data`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param currentIndex the replay cursor sample index (web `currentIndex`), or `null`.
 * @param syncId the page-scoped cursor-sync key shared by the replay charts, or `null` if standalone.
 * @param distanceUnit an explicit distance-unit label, or `null` to read the live preference (web `distanceUnit`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ElevationProfile(
    state: UiState<ElevationProfileData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currentIndex: Int? = null,
    syncId: String? = null,
    distanceUnit: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordElevationProfileOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    ElevationProfileContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        currentIndex = currentIndex,
        syncId = syncId,
        distanceUnit = distanceUnit ?: prefs.distance.label,
        locale = resolveDisplayLocale(prefs.locale),
    )
}

/**
 * Web-parity overload mirroring the web component's `data` + `currentIndex` props, for hosts that already hold
 * the projected samples. An empty list renders the empty state (the web `data.length === 0` branch); one or
 * more samples render the chart. Delegates to the stateful entry, so it records `view.opened` and resolves live
 * units identically. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ElevationProfile(
    data: List<ElevationProfilePoint>,
    modifier: Modifier = Modifier,
    currentIndex: Int? = null,
    syncId: String? = null,
    distanceUnit: String = DEFAULT_DISTANCE_UNIT,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { elevationProfileState(data) }
    ElevationProfile(
        state = state,
        onRetry = {},
        modifier = modifier,
        currentIndex = currentIndex,
        syncId = syncId,
        distanceUnit = distanceUnit,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState] onto
 * the [ChartContainer] lifecycle (loading / error+retry / empty / ready) and, in the ready state, renders the
 * gain/loss subtitle, the single elevation-Area [AreaChartWrapper], and the replay-cursor marker, reproducing
 * the web `ChartContainer` + `AreaChart` composition. A freshness chip appears when the cached data is
 * refreshing / stale / offline, and stale (non-error) data auto-refreshes — mirroring the web freshness
 * contract. [distanceUnit] labels the x axis (web `distanceUnit`), [locale] formats the distance/elevation
 * figures (web `fmt`), and [currentIndex] / [syncId] surface the synced cursor marker.
 */
@Composable
fun ElevationProfileContent(
    state: UiState<ElevationProfileData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    currentIndex: Int? = null,
    syncId: String? = null,
    distanceUnit: String = DEFAULT_DISTANCE_UNIT,
    locale: Locale = Locale.US,
    strings: ElevationProfileStrings = rememberElevationProfileStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    // Web `currentIndex` prop takes precedence; otherwise the shared cross-chart cursor (web useSyncedCursor).
    val effectiveCursor = currentIndex ?: cursorSyncPosition(syncId)
    val result =
        remember(state.data, effectiveCursor, locale) {
            ElevationProfileProjection.project(
                data = state.data ?: ElevationProfileData(emptyList()),
                currentIndex = effectiveCursor,
                formatDistance = { ChartFormat.number(it, DISTANCE_DECIMALS, locale) },
            )
        }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    // Web hex → generated token, exact: elevation #10b981 = chart.battery.
    val elevationColor = TeslaTokens.chart.battery
    val series =
        remember(result.elevationValues, strings.seriesLabel, elevationColor) {
            listOf(
                ChartSeries(
                    key = ELEVATION_SERIES_KEY,
                    label = strings.seriesLabel,
                    values = result.elevationValues,
                    kind = ChartSeriesKind.Area,
                    color = elevationColor,
                    unit = METERS_UNIT,
                ),
            )
        }

    // The synced cursor X (web `<ReferenceLine x={cursorDistance} />`) renders as a marker-rail pin (SURVEY.md),
    // labelled with the sample's distance so the rail's screen-reader text identifies the synced moment.
    val markers =
        remember(result.cursorIndex, result.xLabels, distanceUnit) {
            val idx = result.cursorIndex
            if (idx != null && idx in result.xLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = idx,
                        label = "${result.xLabels[idx]} $distanceUnit",
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    val emptyMessage = stringResource(R.string.translation_replay_elevation_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    ChartContainer(
        title = strings.title,
        modifier = modifier,
        subtitle = if (status == ChartStatus.Ready) result.subtitle else null,
        status = status,
        height = CHART_HEIGHT,
        action =
            if (showFreshness) {
                { ElevationProfileFreshnessChip(state) }
            } else {
                null
            },
        accessibleDescription = strings.ariaLabel,
        emptyMessage = emptyMessage,
        errorMessage = stringResource(R.string.translation_errors_section_chartTitle),
        retryLabel = stringResource(R.string.translation_common_retry),
        onRetry = onRetry,
    ) {
        AreaChartWrapper(
            series = series,
            xLabels = result.xLabels,
            height = CHART_HEIGHT,
            markers = markers,
            yValueFormatter = { ChartFormat.number(it, ELEVATION_DECIMALS, locale) },
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * Builds the localized [ElevationProfileStrings] from the i18n catalog (P1/S10): the `replay.elevation.*` keys
 * the web component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
fun rememberElevationProfileStrings(): ElevationProfileStrings {
    val title = stringResource(R.string.translation_replay_elevation_title)
    val ariaLabel = stringResource(R.string.translation_replay_elevation_aria)
    val seriesLabel = stringResource(R.string.translation_replay_elevation_label)
    return remember(title, ariaLabel, seriesLabel) {
        ElevationProfileStrings(title = title, ariaLabel = ariaLabel, seriesLabel = seriesLabel)
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun ElevationProfileFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberElevationProfileFreshnessFormatter(),
    )
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberElevationProfileFreshnessFormatter(): (FreshnessAge) -> String {
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
    ElevationProfileStrings(
        title = "Elevation Profile",
        ariaLabel = "Elevation profile chart along the route, with total gain and loss in meters",
        seriesLabel = "Elevation",
    )

private val PREVIEW_DATA =
    ElevationProfileData(
        points =
            listOf(
                ElevationProfilePoint(index = 0, distance = 0.0, elevation = 120.0, speed = 0.0),
                ElevationProfilePoint(index = 1, distance = 1.2, elevation = 168.0, speed = 42.0),
                ElevationProfilePoint(index = 2, distance = 2.6, elevation = 210.0, speed = 65.0),
                ElevationProfilePoint(index = 3, distance = 3.9, elevation = 184.0, speed = 58.0),
                ElevationProfilePoint(index = 4, distance = 5.1, elevation = 142.0, speed = 31.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ElevationProfileLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ElevationProfileEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state = UiState(UiPhase.Empty, data = ElevationProfileData(emptyList())),
            onRetry = {},
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ElevationProfileErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ElevationProfileContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (cursor)", showBackground = true)
@Composable
private fun ElevationProfileCursorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            currentIndex = 2,
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun ElevationProfileOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ElevationProfileContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            distanceUnit = "km",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
