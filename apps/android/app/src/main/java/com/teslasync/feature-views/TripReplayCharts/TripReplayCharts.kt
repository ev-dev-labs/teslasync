// The native Jetpack Compose + Material 3 TripReplayCharts feature view — a parity port of
// web/src/features/trips/components/TripReplayCharts.tsx. The web component is purely presentational:
// inside a `<ChartTimeRangeProvider syncId="trip-replay" syncMethod="value">` it wraps the shared
// `<ChartContainer title="Speed & Power Timeline" subtitle="Click to seek replay position">` around a
// Recharts `<AreaChart>` of a speed area + a power area over a time (minutes) x-axis, draws a
// `<ReferenceLine>` playhead at `data[currentIndex].time`, seeks on click (`onSeekToIndex(data[idx].index)`),
// and mirrors a persistent hover cursor through a render-only `<ChartCursorBridge>` (the
// `useSyncedReferenceLineX` → `nearestIndexByTime` → `onSeekToIndex` path). With no samples it renders a
// friendly `<EmptyState>` ("No telemetry data available").
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its web
// hooks map as: `useTranslation` → the i18n catalog (P1/S10), `useSyncedCursor`/`useSyncedReferenceLineX` →
// [cursorSyncPosition] + [CursorSyncStore] over the shared cursor-sync store (P1/S8, scoped by the host's
// `ChartSyncScope`), and `useUnits` → the live [UnitFormatter] for the speed unit label + locale. The host
// supplies the per-sample `TripReplayChartPoint[]` through the shared P1/S8 state-holder layer as a
// [UiState] (the cache-then-network projection of the selected drive's positions), so this feature view
// renders every lifecycle state that layer can carry — loading, hard error with retry, empty, content, and
// stale/offline ("last known") — without ever fetching. A web-parity overload that takes the raw `data`
// prop is also provided. The playhead is a [ChartVerticalMarker] (the Vico counterpart of the web
// `<ReferenceLine>`; see the charts SURVEY for why a marker rail replaces the overlay line on Vico 2.0).
//
// Web colors map to the generated CB-safe categorical palette (never raw hex in render code): speed →
// `paletteColor(0)` (web `CHART_COLORS[0]`), power → `paletteColor(1)` (web `CHART_COLORS[1]`). The web
// draws two Y axes (a left speed axis + a right power axis); the shared cartesian renderer exposes a single
// value axis and must not be altered (allowed-files), so both areas share one axis and each series name
// carries its unit (the user's speed unit / `kW`) so the hover marker stays screen-reader honest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TripReplayCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripreplaycharts

import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.CursorSyncStore
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import java.util.Locale

/** The web `<ChartContainer height={220}>` / `height={220}` plot height. */
private val CHART_HEIGHT: Dp = 220.dp

/** Series keys — the web `<Area dataKey="speed" />` / `<Area dataKey="power" />` keys. */
private const val SPEED_KEY: String = "speed"
private const val POWER_KEY: String = "power"

/** The web right "power" axis unit suffix (`label={{ value: 'kW' }}`). */
private const val POWER_UNIT: String = "kW"

/** Axis tick precision — the web Y axes render whole numbers (`tickFormatter={(v) => fmt(v, 0)}`). */
private const val AXIS_DECIMALS: Int = 0

/** Per-series categorical palette slots — the web `CHART_COLORS[0]` (speed) / `CHART_COLORS[1]` (power). */
private const val SPEED_COLOR_INDEX: Int = 0
private const val POWER_COLOR_INDEX: Int = 1

/**
 * The page-scoped cursor `syncId` — the web `<ChartTimeRangeProvider syncId="trip-replay">` that
 * `useSyncedCursor`/`useSyncedReferenceLineX` read. Hosted under the same id as the trip-replay map +
 * elevation profile, the shared [CursorSyncStore] mirrors the seeked sample across all three surfaces.
 */
private const val DEFAULT_SYNC_ID: String = "trip-replay"

/** Em dash shown for an unknown freshness age — the shared freshness `'—'` fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)` in the `replay.timeline` namespace: the panel [title]/[subtitle], the
 * accessible chart description [ariaLabel], the two series labels ([speed]/[power]), and the [noData] empty
 * message. All six exist in the catalog and resolve at compile time.
 */
data class TripReplayChartsStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val speed: String,
    val power: String,
    val noData: String,
)

/**
 * Stateful entry point for the TripReplayCharts surface. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live speed unit + locale (web `useUnits`) from the shared
 * [UnitFormatter], and renders every lifecycle [state] the shared drive-trace feed can carry. The host owns
 * the feed (P1/S8) and supplies [currentIndex] (the playhead) + [onSeekToIndex] (web `seekTo`) + [onRetry]
 * (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `TripReplayChartPoint[]` (web `data`).
 * @param currentIndex the playhead sample — drives the reference-line marker (web `currentIndex`).
 * @param onSeekToIndex receives a positions-array index when the user seeks (web `onSeekToIndex`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param syncId the page cursor-sync id (web `useSyncedCursor`); `null` disables the synced bridge.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TripReplayCharts(
    state: UiState<List<TripReplayChartPoint>>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTripReplayChartsOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TripReplayChartsContent(
        state = state,
        currentIndex = currentIndex,
        onSeekToIndex = onSeekToIndex,
        onRetry = onRetry,
        modifier = modifier,
        syncId = syncId,
        speedUnit = formatter.prefs.speed.label,
        locale = localeOf(formatter.prefs.locale),
    )
}

/**
 * Web-parity overload mirroring the web component's `data: TripReplayChartPoint[]` + `speedUnit` props, for
 * hosts that already hold the loaded trace. The web `data.length > 0` boundary is reproduced: 0 samples
 * render the empty state, 1+ render the chart. Records `view.opened` like the stateful entry; with no fetch
 * behind it, it offers no retry affordance.
 */
@Composable
fun TripReplayCharts(
    data: List<TripReplayChartPoint>?,
    currentIndex: Int,
    speedUnit: String,
    onSeekToIndex: (Int) -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTripReplayChartsOpened(logger) }
    val state =
        remember(data) {
            val items = data ?: emptyList()
            UiState(phase = if (items.isNotEmpty()) UiPhase.Content else UiPhase.Empty, data = items)
        }
    TripReplayChartsContent(
        state = state,
        currentIndex = currentIndex,
        onSeekToIndex = onSeekToIndex,
        onRetry = {},
        modifier = modifier,
        syncId = syncId,
        speedUnit = speedUnit,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Maps the host feed's [UiState]
 * onto the [ChartContainer] lifecycle (loading / error+retry / empty / ready), and in the ready state
 * renders the speed+power area [ComboChart] (with the playhead marker + the tap/scrub seek overlay) inside a
 * [FadeIn] — reproducing the web `FadeIn` + `ChartContainer` + `AreaChart` + `ChartCursorBridge`
 * composition. A freshness chip appears when cached data is refreshing / stale / offline, and stale
 * (non-error) data auto-refreshes, mirroring the sibling surfaces' freshness contract.
 * [speedUnit]/[locale] are the web `useUnits` outputs used for the series label + axis/cursor formatting.
 */
@Composable
fun TripReplayChartsContent(
    state: UiState<List<TripReplayChartPoint>>,
    currentIndex: Int,
    onSeekToIndex: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    syncId: String? = DEFAULT_SYNC_ID,
    speedUnit: String = SpeedUnitPref.KMH.label,
    locale: Locale = Locale.getDefault(),
    strings: TripReplayChartsStrings = rememberTripReplayChartsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val points = state.data ?: emptyList()
    val result = remember(points, locale) { TripReplayChartsProjection.project(points, locale) }

    val status =
        when {
            state.isLoading -> ChartStatus.Loading
            state.isError -> ChartStatus.Error
            result.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }

    val series = remember(result, strings, speedUnit) { buildTimelineSeries(result, strings, speedUnit) }

    val markerIndex = remember(currentIndex, points.size) { TripReplayChartsProjection.clampCursorIndex(currentIndex, points.size) }
    val markers =
        remember(markerIndex, result.cursorLabels) {
            if (markerIndex != null && markerIndex in result.cursorLabels.indices) {
                listOf(
                    ChartVerticalMarker(
                        index = markerIndex,
                        label = result.cursorLabels[markerIndex],
                        severity = MarkerSeverity.Info,
                    ),
                )
            } else {
                emptyList()
            }
        }

    // The web `<ChartCursorBridge>` sibling: forward an externally-set persistent cursor into onSeekToIndex.
    TripReplayCursorBridge(syncId = syncId, points = points, onSeekToIndex = onSeekToIndex)

    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)

    FadeIn(modifier = modifier) {
        ChartContainer(
            title = strings.title,
            subtitle = strings.subtitle,
            status = status,
            height = CHART_HEIGHT,
            action =
                if (showFreshness) {
                    { TripReplayFreshnessChip(state) }
                } else {
                    null
                },
            accessibleDescription = strings.ariaLabel,
            emptyMessage = strings.noData,
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            retryLabel = stringResource(R.string.translation_common_retry),
            onRetry = onRetry,
        ) {
            TripReplayTimelinePlot(
                series = series,
                xLabels = result.xLabels,
                markers = markers,
                points = points,
                syncId = syncId,
                onSeekToIndex = onSeekToIndex,
                locale = locale,
                seekLabel = strings.subtitle,
            )
        }
    }
}

/**
 * The chart body — the speed+power area [ComboChart] with the playhead marker rail, overlaid by a
 * transparent tap/scrub surface that reproduces the web chart's interactivity: a tap seeks (web `onClick` →
 * `onSeekToIndex(data[idx].index)`) and a horizontal drag writes the persistent cursor (web `onMouseMove`
 * via `useSyncedCursor`), which the [TripReplayCursorBridge] then forwards. The overlay carries the
 * "Click to seek replay position" label as a button-role content description so the seek affordance is
 * announced to TalkBack.
 */
@Composable
private fun TripReplayTimelinePlot(
    series: List<ChartSeries>,
    xLabels: List<String>,
    markers: List<ChartVerticalMarker>,
    points: List<TripReplayChartPoint>,
    syncId: String?,
    onSeekToIndex: (Int) -> Unit,
    locale: Locale,
    seekLabel: String,
) {
    Box(modifier = Modifier.fillMaxWidth()) {
        ComboChart(
            series = series,
            xLabels = xLabels,
            height = CHART_HEIGHT,
            markers = markers,
            yValueFormatter = { value -> TripReplayChartFormat.number(value, AXIS_DECIMALS, locale) },
        )
        Box(
            modifier =
                Modifier
                    .matchParentSize()
                    .semantics {
                        contentDescription = seekLabel
                        role = Role.Button
                    }.pointerInput(points, syncId) {
                        detectTapGestures { offset ->
                            seekTargetAt(offset.x, size.width, points)?.let(onSeekToIndex)
                        }
                    }.pointerInput(points, syncId) {
                        detectHorizontalDragGestures { change, _ ->
                            scrubAt(change.position.x, size.width, points, syncId, onSeekToIndex)
                        }
                    },
        )
    }
}

/**
 * Render-only bridge for the persistent cursor sync — the native counterpart of the web `<ChartCursorBridge>`
 * (`useSyncedReferenceLineX` → `onSeekToIndex`). Subscribes to [syncId]'s cursor index and forwards the
 * sample's positions-array [TripReplayChartPoint.index] into [onSeekToIndex], tracking the last forwarded
 * index so a parent re-render does not re-seek to the same frame (web `lastForwardedRef`). Renders nothing.
 */
@Composable
private fun TripReplayCursorBridge(
    syncId: String?,
    points: List<TripReplayChartPoint>,
    onSeekToIndex: (Int) -> Unit,
) {
    val cursor = cursorSyncPosition(syncId)
    var lastForwarded by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(cursor, points) {
        val idx = cursor
        if (idx != null && idx in points.indices && lastForwarded != idx) {
            lastForwarded = idx
            onSeekToIndex(points[idx].index)
        }
    }
}

/**
 * The freshness chip rendered in the container header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun TripReplayFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberTripReplayFreshnessFormatter(),
    )
}

/**
 * Builds the two area series — the web `<Area dataKey="speed">` + `<Area dataKey="power">`. Each name carries
 * its unit in parentheses (the user's speed unit / `kW`) so the single shared value axis stays honest in the
 * hover marker, and each takes its web `CHART_COLORS` categorical slot.
 */
private fun buildTimelineSeries(
    result: TripReplayChartsProjectionResult,
    strings: TripReplayChartsStrings,
    speedUnit: String,
): List<ChartSeries> =
    listOf(
        ChartSeries(
            key = SPEED_KEY,
            label = "${strings.speed} ($speedUnit)",
            values = result.speedValues,
            kind = ChartSeriesKind.Area,
            color = paletteColor(SPEED_COLOR_INDEX),
            unit = speedUnit,
        ),
        ChartSeries(
            key = POWER_KEY,
            label = "${strings.power} ($POWER_UNIT)",
            values = result.powerValues,
            kind = ChartSeriesKind.Area,
            color = paletteColor(POWER_COLOR_INDEX),
            unit = POWER_UNIT,
        ),
    )

/** The positions-array index a tap at pixel [x] over [width] should seek to, or `null` when not seekable. */
private fun seekTargetAt(
    x: Float,
    width: Int,
    points: List<TripReplayChartPoint>,
): Int? {
    if (width <= 0 || points.isEmpty()) return null
    return TripReplayChartsProjection.seekTargetForFraction(points, x / width.toFloat())
}

/**
 * Handles a horizontal scrub at pixel [x] over [width]: writes the chart-array index to the shared cursor so
 * every synced surface follows (web `useSyncedCursor` hover write), or — with no [syncId] active — seeks
 * directly so dragging still works outside a `ChartSyncScope`.
 */
private fun scrubAt(
    x: Float,
    width: Int,
    points: List<TripReplayChartPoint>,
    syncId: String?,
    onSeekToIndex: (Int) -> Unit,
) {
    if (width <= 0 || points.isEmpty()) return
    val arrayIndex = TripReplayChartsProjection.indexForFraction(points.size, x / width.toFloat())
    if (syncId != null) {
        CursorSyncStore.set(syncId, arrayIndex)
    } else {
        onSeekToIndex(points[arrayIndex].index)
    }
}

/**
 * Builds the localized [TripReplayChartsStrings] from the i18n catalog (P1/S10): all six keys
 * (`replay.timeline.title`/`subtitle`/`aria`/`speed`/`power`/`noData`) resolve through compile-time
 * resources. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberTripReplayChartsStrings(): TripReplayChartsStrings {
    val title = stringResource(R.string.translation_replay_timeline_title)
    val subtitle = stringResource(R.string.translation_replay_timeline_subtitle)
    val ariaLabel = stringResource(R.string.translation_replay_timeline_aria)
    val speed = stringResource(R.string.translation_replay_timeline_speed)
    val power = stringResource(R.string.translation_replay_timeline_power)
    val noData = stringResource(R.string.translation_replay_timeline_noData)
    return remember(title, subtitle, ariaLabel, speed, power, noData) {
        TripReplayChartsStrings(
            title = title,
            subtitle = subtitle,
            ariaLabel = ariaLabel,
            speed = speed,
            power = power,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTripReplayFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Builds a [Locale] from a BCP-47 [tag]; null/blank ⇒ the device default (web `deriveLocale` fallback). */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    TripReplayChartsStrings(
        title = "Speed & Power Timeline",
        subtitle = "Click to seek replay position",
        ariaLabel = "Trip replay speed and power timeline area chart",
        speed = "Speed",
        power = "Power",
        noData = "No telemetry data available",
    )

private val PREVIEW_POINTS =
    listOf(
        TripReplayChartPoint(index = 0, time = 0.0, speed = 0.0, power = 0.0),
        TripReplayChartPoint(index = 1, time = 1.0, speed = 32.0, power = 28.0),
        TripReplayChartPoint(index = 2, time = 2.0, speed = 64.0, power = 54.0),
        TripReplayChartPoint(index = 3, time = 3.0, speed = 41.0, power = -12.0),
        TripReplayChartPoint(index = 4, time = 4.0, speed = 18.0, power = 6.0),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun TripReplayChartsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripReplayChartsContent(
            state = UiState(UiPhase.Content, data = PREVIEW_POINTS),
            currentIndex = 2,
            onSeekToIndex = {},
            onRetry = {},
            syncId = null,
            speedUnit = "mph",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TripReplayChartsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripReplayChartsContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            currentIndex = 0,
            onSeekToIndex = {},
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TripReplayChartsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripReplayChartsContent(
            state = UiState(UiPhase.Loading),
            currentIndex = 0,
            onSeekToIndex = {},
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TripReplayChartsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripReplayChartsContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            currentIndex = 0,
            onSeekToIndex = {},
            onRetry = {},
            syncId = null,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
