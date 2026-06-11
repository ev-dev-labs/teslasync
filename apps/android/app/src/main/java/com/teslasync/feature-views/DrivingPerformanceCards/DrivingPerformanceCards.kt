// The native Jetpack Compose + Material 3 DrivingPerformanceCards feature view — a parity port of
// web/src/features/analytics/components/analytics/DrivingPerformanceCards.tsx. The web component is purely
// presentational: its parent (the fleet analytics page) passes the fetched `FleetAnalytics` document down
// as `data`, and the component renders a responsive grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-6`) of
// six MetricCards — Top Speed, Avg Speed, Peak Power, Peak Regen, Avg Drive Distance, and Longest Drive —
// each formatted to the user's display units via `useUnits`, with an em dash when its stat group is absent.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and `useUnits`, mapped to the live
// [UnitFormatter] P1/S8). The host supplies the drive-analytics snapshot through the shared state-holder
// layer as a [UiState], so this feature view also renders every lifecycle state that layer can carry —
// loading skeletons, a hard error with retry, a friendly empty state, content, and stale/offline cached
// "last known" — without ever fetching. The content branch reproduces the web six-card grid exactly,
// including the per-card em dash for an absent stat group. A web-parity overload that takes the raw `data`
// snapshot (web `{ data }`) is also provided for hosts that already hold the analytics document.
//
// Like the web source, the surface is a bare grid: it adds no panel, title, or entry animation, so it drops
// cleanly into the analytics page's own section chrome.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingPerformanceCards — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingperformancecards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/** Web `Array.from({ length: 6 })` — the six loading skeleton tiles. */
private const val SKELETON_TILE_COUNT = 6

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

private val SKELETON_TILE_HEIGHT = 80.dp

// Responsive column counts mirroring the web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`, aligned to the
// Material window-size-class width breakpoints (compact < 600dp, medium < 840dp, expanded ≥ 840dp). Six
// tiles divide evenly across 2 / 3 / 6 columns, so every row is full at every breakpoint.
private val GRID_MEDIUM_MIN = 600.dp
private val GRID_EXPANDED_MIN = 840.dp
private const val GRID_COLS_COMPACT = 2
private const val GRID_COLS_MEDIUM = 3
private const val GRID_COLS_EXPANDED = 6

/**
 * The already-localized strings the grid renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the grid free of any English literal.
 */
data class DrivingPerformanceCardsStrings(
    val topSpeed: String,
    val avgSpeed: String,
    val peakPower: String,
    val peakRegen: String,
    val avgDriveDistance: String,
    val longestDrive: String,
    val noData: String,
)

/**
 * Stateful entry point for the driving-performance grid. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), reads the live display units (web `useUnits`), and renders every lifecycle [state]
 * the shared drive-analytics feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the
 * feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [DrivingPerformanceSnapshot] (the four stat groups).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingPerformanceCards(
    state: UiState<DrivingPerformanceSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordDrivingPerformanceCardsOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    DrivingPerformanceCardsContent(state = state, onRetry = onRetry, prefs = formatter.prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ data })` prop, for hosts that already hold the
 * analytics document. Projects the [data] snapshot onto a [UiState] via
 * [DrivingPerformanceCardsProjection.projectUiState] (content when present, else the friendly empty state)
 * and delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it
 * offers no retry affordance.
 */
@Composable
fun DrivingPerformanceCards(
    data: DrivingPerformanceSnapshot?,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { DrivingPerformanceCardsProjection.projectUiState(data, isLoading = false) }
    DrivingPerformanceCards(state = state, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's six-card grid (with the per-card em dash for an absent stat group) and adds the lifecycle
 * chrome the host's feed implies: a loading skeleton grid, a hard-error retry surface, a friendly empty
 * state, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [prefs] supplies the SI → display unit conversion + formatting.
 */
@Composable
fun DrivingPerformanceCardsContent(
    state: UiState<DrivingPerformanceSnapshot>,
    onRetry: () -> Unit,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    strings: DrivingPerformanceCardsStrings = rememberDrivingPerformanceCardsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    Column(modifier = modifier.fillMaxWidth()) {
        when {
            state.isLoading -> DrivingPerformanceSkeletonGrid()
            state.isError -> DrivingPerformanceError(onRetry = onRetry)
            state.isEmpty || snapshot == null -> DrivingPerformanceEmpty(message = strings.noData)
            else -> DrivingPerformanceLoaded(snapshot = snapshot, state = state, prefs = prefs, strings = strings)
        }
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the six
 * `MetricCard` tiles. Emitted into the enclosing column so the freshness chrome the host's feed implies
 * sits directly above the web grid.
 */
@Composable
private fun DrivingPerformanceLoaded(
    snapshot: DrivingPerformanceSnapshot,
    state: UiState<DrivingPerformanceSnapshot>,
    prefs: UnitPref,
    strings: DrivingPerformanceCardsStrings,
) {
    if (state.stale || state.refreshing || state.hasError) {
        val formatAge = rememberDrivingFreshnessFormatter()
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = formatAge,
            )
        }
    }
    val values = remember(snapshot, prefs) { DrivingPerformanceCardsProjection.metricValues(snapshot, prefs) }
    DrivingGrid(itemCount = values.size) { index ->
        val item = values[index]
        MetricCard(
            label = strings.label(item.metric),
            value = item.value,
            subtitle = item.subtitle,
            modifier = Modifier.weight(1f),
            icon = item.metric.glyph(),
            accent = item.metric.accent(),
        )
    }
}

/** The web loading branch: six shimmering tiles laid out in the same responsive grid as the cards. */
@Composable
private fun DrivingPerformanceSkeletonGrid() {
    DrivingGrid(itemCount = SKELETON_TILE_COUNT) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
}

/**
 * Empty state — the `common.noData` message with a gauge glyph, so the grid never collapses to a blank box.
 * [EmptyState] exposes the message as its accessibility label, so the section is still announced to TalkBack
 * when it holds no data.
 */
@Composable
private fun DrivingPerformanceEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DrivingPerformanceGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DrivingPerformanceError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A responsive grid of [itemCount] equal-width cells — the native analogue of the web
 * `grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3`. The column count tracks the available width via
 * Material window-size breakpoints; the trailing cells of a short final row are filled with weighted spacers
 * so every tile keeps a uniform width. [tile] receives the cell index and applies `weight(1f)`.
 */
@Composable
private fun DrivingGrid(
    itemCount: Int,
    tile: @Composable RowScope.(Int) -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth < GRID_MEDIUM_MIN -> GRID_COLS_COMPACT
                maxWidth < GRID_EXPANDED_MIN -> GRID_COLS_MEDIUM
                else -> GRID_COLS_EXPANDED
            }
        val rowCount = (itemCount + columns - 1) / columns
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            for (rowIndex in 0 until rowCount) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    for (column in 0 until columns) {
                        val index = rowIndex * columns + column
                        if (index < itemCount) tile(index) else Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Builds the localized [DrivingPerformanceCardsStrings] from the i18n catalog (P1/S10): the
 * `analytics.driving.*` and `common.noData` keys the web component reads through `useTranslation`. Resolved
 * once at the Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberDrivingPerformanceCardsStrings(): DrivingPerformanceCardsStrings {
    val topSpeed = stringResource(R.string.translation_analytics_driving_topSpeed)
    val avgSpeed = stringResource(R.string.translation_analytics_driving_avgSpeed)
    val peakPower = stringResource(R.string.translation_analytics_driving_peakPower)
    val peakRegen = stringResource(R.string.translation_analytics_driving_peakRegen)
    val avgDriveDistance = stringResource(R.string.translation_analytics_driving_avgDriveDist)
    val longestDrive = stringResource(R.string.translation_analytics_driving_longestDrive)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(topSpeed, avgSpeed, peakPower, peakRegen, avgDriveDistance, longestDrive, noData) {
        DrivingPerformanceCardsStrings(
            topSpeed = topSpeed,
            avgSpeed = avgSpeed,
            peakPower = peakPower,
            peakRegen = peakRegen,
            avgDriveDistance = avgDriveDistance,
            longestDrive = longestDrive,
            noData = noData,
        )
    }
}

/** Resolves a tile's already-localized label from the bundled strings. */
private fun DrivingPerformanceCardsStrings.label(metric: DrivingMetric): String =
    when (metric) {
        DrivingMetric.TopSpeed -> topSpeed
        DrivingMetric.AvgSpeed -> avgSpeed
        DrivingMetric.PeakPower -> peakPower
        DrivingMetric.PeakRegen -> peakRegen
        DrivingMetric.AvgDriveDistance -> avgDriveDistance
        DrivingMetric.LongestDrive -> longestDrive
    }

/**
 * The tile accent — the native mirror of the web `MetricCard` `color` prop. Maps the web neon palette onto
 * the theme-invariant chart tokens by the same convention the sibling surfaces use: cyan→regen, purple→power,
 * amber→energy, green→battery.
 */
private fun DrivingMetric.accent(): Color =
    when (this) {
        DrivingMetric.TopSpeed -> TeslaTokens.chart.regen
        DrivingMetric.AvgSpeed -> TeslaTokens.chart.power
        DrivingMetric.PeakPower -> TeslaTokens.chart.energy
        DrivingMetric.PeakRegen -> TeslaTokens.chart.battery
        DrivingMetric.AvgDriveDistance -> TeslaTokens.chart.regen
        DrivingMetric.LongestDrive -> TeslaTokens.chart.power
    }

/** Resolves a tile's line glyph — the native analogue of the web lucide icon for that metric. */
private fun DrivingMetric.glyph(): ImageVector =
    when (this) {
        DrivingMetric.TopSpeed -> DrivingPerformanceGlyphs.Gauge
        DrivingMetric.AvgSpeed -> DrivingPerformanceGlyphs.TrendingUp
        DrivingMetric.PeakPower -> DrivingPerformanceGlyphs.Zap
        DrivingMetric.PeakRegen -> DrivingPerformanceGlyphs.BatteryCharging
        DrivingMetric.AvgDriveDistance -> DrivingPerformanceGlyphs.MapPin
        DrivingMetric.LongestDrive -> DrivingPerformanceGlyphs.Car
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDrivingFreshnessFormatter(): (FreshnessAge) -> String {
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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time by
 * the [MetricCard] accent — the same approach as the sibling feature-view glyphs.
 */
private object DrivingPerformanceGlyphs {
    /** lucide `gauge` — a speedometer arc with a needle (Top Speed tile + empty-state glyph). */
    val Gauge: ImageVector =
        drivingVector("DrivingPerformanceGauge") {
            moveTo(4f, 18f)
            curveTo(4f, 10f, 20f, 10f, 20f, 18f)
            moveTo(12f, 18f)
            lineTo(15.5f, 11.5f)
        }

    /** lucide `trending-up` — an up-right polyline with an arrowhead (Avg Speed tile). */
    val TrendingUp: ImageVector =
        drivingVector("DrivingPerformanceTrendingUp") {
            moveTo(3f, 17f)
            lineTo(9f, 11f)
            lineTo(13f, 15f)
            lineTo(21f, 7f)
            moveTo(15f, 7f)
            lineTo(21f, 7f)
            lineTo(21f, 13f)
        }

    /** lucide `zap` — a lightning bolt (Peak Power tile). */
    val Zap: ImageVector =
        drivingVector("DrivingPerformanceZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `battery-charging` — a battery body, terminal, and inner bolt (Peak Regen tile). */
    val BatteryCharging: ImageVector =
        drivingVector("DrivingPerformanceBatteryCharging") {
            moveTo(3f, 8f)
            lineTo(15f, 8f)
            lineTo(15f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(18f, 11f)
            lineTo(18f, 13f)
            moveTo(9.5f, 9.5f)
            lineTo(6.5f, 12.5f)
            lineTo(9f, 12.5f)
            lineTo(8f, 15f)
        }

    /** lucide `map-pin` — a teardrop pin with an inner circle (Avg Drive Distance tile). */
    val MapPin: ImageVector =
        drivingVector("DrivingPerformanceMapPin") {
            moveTo(12f, 22f)
            curveTo(12f, 22f, 4f, 16f, 4f, 10f)
            curveTo(4f, 5.58f, 7.58f, 2f, 12f, 2f)
            curveTo(16.42f, 2f, 20f, 5.58f, 20f, 10f)
            curveTo(20f, 16f, 12f, 22f, 12f, 22f)
            close()
            moveTo(15f, 10f)
            curveTo(15f, 11.66f, 13.66f, 13f, 12f, 13f)
            curveTo(10.34f, 13f, 9f, 11.66f, 9f, 10f)
            curveTo(9f, 8.34f, 10.34f, 7f, 12f, 7f)
            curveTo(13.66f, 7f, 15f, 8.34f, 15f, 10f)
            close()
        }

    /** lucide `car` — a cabin, body, and two wheels (Longest Drive tile). */
    val Car: ImageVector =
        drivingVector("DrivingPerformanceCar") {
            moveTo(5f, 12f)
            lineTo(6.5f, 7.5f)
            lineTo(17.5f, 7.5f)
            lineTo(19f, 12f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(9.5f, 16.5f)
            curveTo(9.5f, 17.33f, 8.83f, 18f, 8f, 18f)
            curveTo(7.17f, 18f, 6.5f, 17.33f, 6.5f, 16.5f)
            curveTo(6.5f, 15.67f, 7.17f, 15f, 8f, 15f)
            curveTo(8.83f, 15f, 9.5f, 15.67f, 9.5f, 16.5f)
            close()
            moveTo(17.5f, 16.5f)
            curveTo(17.5f, 17.33f, 16.83f, 18f, 16f, 18f)
            curveTo(15.17f, 18f, 14.5f, 17.33f, 14.5f, 16.5f)
            curveTo(14.5f, 15.67f, 15.17f, 15f, 16f, 15f)
            curveTo(16.83f, 15f, 17.5f, 15.67f, 17.5f, 16.5f)
            close()
        }
}

private fun drivingVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    DrivingPerformanceCardsStrings(
        topSpeed = "Top Speed",
        avgSpeed = "Avg Speed",
        peakPower = "Peak Power",
        peakRegen = "Peak Regen",
        avgDriveDistance = "Avg Drive Distance",
        longestDrive = "Longest Drive",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    DrivingPerformanceSnapshot(
        speedStats = DriveStatSummary(avg = 64.4, max = 113.0),
        powerStats = DriveStatSummary(avg = 42.0, max = 211.0),
        regenStats = DriveStatSummary(avg = 21.0, max = 67.0),
        distanceStats = DriveStatSummary(avg = 23.7, max = 142.3),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun DrivingPerformanceCardsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingPerformanceCardsContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingPerformanceCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingPerformanceCardsContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingPerformanceCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingPerformanceCardsContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DrivingPerformanceCardsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingPerformanceCardsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}
