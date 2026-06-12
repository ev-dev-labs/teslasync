// The native Jetpack Compose + Material 3 Battery & Range charts feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx. The web component is purely
// presentational: a `grid-cols-1 lg:grid-cols-2` of two `GlassPanel`s — a "Battery Overview" panel (a
// `RadialGauge` + two metric panels over a `<BarChart>` of the Current/Remaining SoC split) and a "Drive
// Distance Trend" panel (a two-series `<AreaChart>` of per-drive distance + duration, or a friendly
// `EmptyState` when there are no drives).
//
// This port keeps that contract end to end. It performs NO HTTP. Its web hooks map as: `useTranslation` →
// the i18n catalog (P1/S10), `useUnits` → the live [UnitFormatter] (P1/S8) for the distance unit + locale.
// The host supplies the combined `{ state, drives }` payload through the shared P1/S8 state-holder layer as
// a [UiState] (the cache-then-network projection the web parent passes as props), so this feature view
// renders every lifecycle state that layer can carry — a first-load skeleton, a hard error with retry, the
// empty surface, the populated content, and stale / offline ("last known") via a freshness chip with
// auto-refresh — without ever fetching. A web-parity overload that takes the loaded value directly is also
// provided. Every value derivation flows through the pure [BatteryRangeChartsProjection]; the composable is
// a thin render layer.
//
// Colors map to the generated CB-safe categorical palette (never raw hex in render code): the battery bar +
// the distance area → `paletteColor(0)` (web `CHART_COLORS[0]`), the duration area → `paletteColor(1)` (web
// `CHART_COLORS[1]`). The `RadialGauge` tint maps the web `batteryColor(level)` hex onto the per-theme
// `TeslaTokens.status` palette via the pure [BatteryBand]. The web `grid-cols-1 lg:grid-cols-2` reflows at
// the Tailwind `lg` (1024dp) breakpoint. Decorative title glyphs are hidden from TalkBack (the adjacent
// title carries the meaning); each opaque chart canvas exposes one merged accessible description so its
// values still read to screen readers, and the `FadeIn` entrance honors the reduce-motion preference (P1/S9).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryRangeCharts — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batteryrangecharts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.time.ZoneId
import java.util.Locale

// ── Layout + parity constants ───────────────────────────────────────────────────────────────────────

/** Web `RadialGauge size={100}`. */
private val RADIAL_GAUGE_SIZE: Dp = 100.dp

/** Web battery `<div className="h-48">` bar plot height (12rem). */
private val BATTERY_BAR_HEIGHT: Dp = 192.dp

/** Web drive `<div className="h-64">` area plot height (16rem). */
private val DRIVE_AREA_HEIGHT: Dp = 256.dp

/** Web Tailwind `lg` breakpoint (1024px): the two panels lay out side-by-side at or above this width. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web title icon `h-4 w-4` (16dp). */
private val TITLE_ICON_SIZE: IconSize = IconSize.Md

/** Web `CHART_COLORS[0]` — the battery bar fill + the distance area, resolved from the brand palette. */
private const val PRIMARY_COLOR_INDEX: Int = 0

/** Web `CHART_COLORS[1]` — the duration area, resolved from the brand palette by position. */
private const val DURATION_COLOR_INDEX: Int = 1

/** Series keys — the web `<Bar dataKey="value">` / `<Area dataKey="distance" | "duration">` keys. */
private const val BATTERY_VALUE_KEY: String = "value"
private const val DISTANCE_KEY: String = "distance"
private const val DURATION_KEY: String = "duration"

/** Web `AnimatedNumber suffix="%"`. */
private const val PERCENT_SUFFIX: String = "%"

/** Loading-skeleton geometry. */
private val SKELETON_TITLE_HEIGHT: Dp = 24.dp
private const val SKELETON_TITLE_WIDTH_FRACTION: Float = 0.4f
private val SKELETON_GAUGE_HEIGHT: Dp = 96.dp

// ── Localized microcopy ─────────────────────────────────────────────────────────────────────────────

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — every string the
 * web component resolves via `t(...)`. Lifecycle-chrome strings (loading / empty / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin content
 * carrier. Injectable so previews / UI tests render without a resource context.
 *
 * @property batteryOverviewTitle web `t('vehicles.detail.batteryOverview', 'Battery Overview')`.
 * @property driveTrendTitle web `t('vehicles.detail.driveTrend', 'Drive Distance Trend')`.
 * @property batteryLabel web `t('common.battery', 'Battery')` — the gauge label + first metric label.
 * @property rangeLabel web `t('common.range', 'Range')` — the second metric label.
 * @property currentLabel web `t('common.current', 'Current')` — the first battery bar's x-axis label.
 * @property remainingLabel web `t('common.remaining', 'Remaining')` — the second battery bar's x-axis label.
 * @property distanceLabel web `t('common.distance', 'Distance')` — the distance series name base.
 * @property durationLabel web `t('common.duration', 'Duration')` — the duration series name.
 * @property noDriveData web `t('vehicles.detail.noDriveData', 'No drive data for chart')` — the empty trend.
 */
data class BatteryRangeChartsStrings(
    val batteryOverviewTitle: String,
    val driveTrendTitle: String,
    val batteryLabel: String,
    val rangeLabel: String,
    val currentLabel: String,
    val remainingLabel: String,
    val distanceLabel: String,
    val durationLabel: String,
    val noDriveData: String,
)

// ── Public entry points ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point for the Battery & Range charts. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live display units (web `useUnits`) from the shared [UnitFormatter], and
 * renders every lifecycle [state] the shared vehicle-detail feed can carry. The host owns the feed (P1/S8)
 * and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `{ state, drives }` payload (web props).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryRangeCharts(
    state: UiState<BatteryRangeData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordBatteryRangeChartsOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    BatteryRangeChartsContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        distanceUnit = formatter.prefs.distance,
        locale = localeOf(formatter.prefs.locale),
    )
}

/**
 * Web-parity overload mirroring the web component's `state` + `drives` props, for hosts that already hold
 * the loaded value. A `null` [drives] is treated as the web `drives ?? []` (the trend panel falls back to
 * its empty state). Delegates to the stateful entry, so it records `view.opened` and resolves the live
 * units once; with no fetch behind it, it offers no retry affordance.
 */
@Composable
fun BatteryRangeCharts(
    battery: VehicleBatteryState,
    drives: List<DriveSample>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(battery, drives) {
            UiState(phase = UiPhase.Content, data = BatteryRangeData(battery = battery, drives = drives ?: emptyList()))
        }
    BatteryRangeCharts(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * two-panel grid (Battery Overview + Drive Distance Trend) and adds the lifecycle chrome the host's feed
 * implies: a first-load skeleton, a hard-error retry surface, a whole-surface empty state, and a freshness
 * chip that reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the
 * freshness contract. [distanceUnit] / [locale] / [zone] are the web `useUnits` outputs the trend formats
 * with.
 */
@Composable
fun BatteryRangeChartsContent(
    state: UiState<BatteryRangeData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    strings: BatteryRangeChartsStrings = rememberBatteryRangeChartsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier) {
        when {
            state.isLoading -> BatteryRangeChartsLoading(label = stringResource(R.string.translation_a11y_loading))
            state.isError -> BatteryRangeChartsError(onRetry = onRetry)
            else -> {
                val data = state.data
                if (data == null) {
                    BatteryRangeChartsEmpty()
                } else {
                    BatteryRangeChartsReady(
                        state = state,
                        data = data,
                        distanceUnit = distanceUnit,
                        locale = locale,
                        zone = zone,
                        strings = strings,
                    )
                }
            }
        }
    }
}

// ── Ready content ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The populated surface — the freshness chip (when refreshing / stale / offline) over the responsive
 * two-panel grid. The grid lays the panels side-by-side at the web `lg` (1024dp) breakpoint and stacks them
 * below it (web `grid-cols-1 lg:grid-cols-2`). The drive trend is projected once via the pure
 * [BatteryRangeChartsProjection.driveTrend], binding the live unit conversion + date formatting.
 */
@Composable
private fun BatteryRangeChartsReady(
    state: UiState<BatteryRangeData>,
    data: BatteryRangeData,
    distanceUnit: DistanceUnitPref,
    locale: Locale,
    zone: ZoneId,
    strings: BatteryRangeChartsStrings,
    modifier: Modifier = Modifier,
) {
    val trend =
        remember(data.drives, distanceUnit, locale, zone) {
            BatteryRangeChartsProjection.driveTrend(
                drives = data.drives,
                convertDistance = { meters -> convertDistanceFromSI(meters, distanceUnit) },
                formatDate = { raw -> BatteryRangeChartsFormat.formatDate(raw, locale, zone) },
            )
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (state.stale || state.refreshing || state.hasError) {
            BatteryRangeFreshnessRow(state = state)
        }
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            if (maxWidth >= GRID_LG_MIN_WIDTH) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Box(modifier = Modifier.weight(1f)) {
                        BatteryOverviewPanel(battery = data.battery, distanceUnit = distanceUnit, locale = locale, strings = strings)
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        DriveTrendPanel(trend = trend, distanceUnit = distanceUnit, locale = locale, strings = strings)
                    }
                }
            } else {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    BatteryOverviewPanel(battery = data.battery, distanceUnit = distanceUnit, locale = locale, strings = strings)
                    DriveTrendPanel(trend = trend, distanceUnit = distanceUnit, locale = locale, strings = strings)
                }
            }
        }
    }
}

/**
 * The Battery-Overview panel — the faithful first `<GlassPanel>`: a Battery-glyph title, a [RadialGauge]
 * beside two metric panels (Battery % + rated Range), over a single-series [BarChartWrapper] of the
 * Current/Remaining SoC split. The gauge tint tracks the web `batteryColor(level)` band; the rated range is
 * converted to the user's distance unit at this display boundary (web `convertDistanceFromSI`). Never blank.
 */
@Composable
private fun BatteryOverviewPanel(
    battery: VehicleBatteryState,
    distanceUnit: DistanceUnitPref,
    locale: Locale,
    strings: BatteryRangeChartsStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitleRow(icon = DataDisplayGlyphs.Battery, title = strings.batteryOverviewTitle)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                RadialGauge(
                    value = battery.batteryLevelPct,
                    max = BATTERY_FULL_PCT,
                    label = strings.batteryLabel,
                    unit = PERCENT_SUFFIX,
                    color = batteryColor(BatteryBand.fromLevel(battery.batteryLevelPct)),
                    size = RADIAL_GAUGE_SIZE,
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    MetricMiniPanel(label = strings.batteryLabel) {
                        AnimatedNumber(value = battery.batteryLevelPct, suffix = PERCENT_SUFFIX, locale = locale)
                    }
                    MetricMiniPanel(label = strings.rangeLabel) {
                        AnimatedNumber(
                            value = convertDistanceFromSI(battery.ratedRangeMeters, distanceUnit),
                            decimals = 0,
                            suffix = " ${distanceUnit.label}",
                            locale = locale,
                        )
                    }
                }
            }
            BatteryBarChart(level = battery.batteryLevelPct, strings = strings, locale = locale)
        }
    }
}

/** One inner metric panel — the web `<GlassPanel className="p-3">` of a muted label over an animated value. */
@Composable
private fun MetricMiniPanel(
    label: String,
    modifier: Modifier = Modifier,
    value: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(label)
            value()
        }
    }
}

/**
 * The Current/Remaining battery bar chart — the web `<BarChart data={batteryChartData}>`. The two SoC bars
 * are projected by the pure [BatteryRangeChartsProjection.batteryBars]; the whole canvas exposes one merged
 * accessible description (the opaque chart's screen-reader fallback) carrying both values.
 */
@Composable
private fun BatteryBarChart(
    level: Double,
    strings: BatteryRangeChartsStrings,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val bars = remember(level) { BatteryRangeChartsProjection.batteryBars(level) }
    val barColor = paletteColor(PRIMARY_COLOR_INDEX)
    val series =
        remember(bars, strings.batteryLabel, barColor) {
            listOf(
                ChartSeries(
                    key = BATTERY_VALUE_KEY,
                    label = strings.batteryLabel,
                    values = bars.map { it.value },
                    kind = ChartSeriesKind.Bar,
                    color = barColor,
                ),
            )
        }
    val xLabels = remember(bars, strings.currentLabel, strings.remainingLabel) { bars.map { segmentLabel(it.segment, strings) } }
    val description =
        bars.joinToString(
            separator = ", ",
            prefix = "${strings.batteryOverviewTitle}: ",
        ) { bar -> "${segmentLabel(bar.segment, strings)} ${BatteryRangeChartsProjection.fmtInt(bar.value, locale)}$PERCENT_SUFFIX" }
    Box(modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description }) {
        BarChartWrapper(
            series = series,
            xLabels = xLabels,
            height = BATTERY_BAR_HEIGHT,
            yValueFormatter = { value -> BatteryRangeChartsProjection.fmtInt(value, locale) },
        )
    }
}

/**
 * The Drive-Distance-Trend panel — the faithful second `<GlassPanel>`: a Route-glyph title over the web
 * `driveChartData.length > 0 ? <AreaChart> : <EmptyState>` branch. A populated trend draws the two-series
 * [AreaChartWrapper] (distance + duration) with a [ChartLegend] beneath (web `<Legend />`); an empty trend
 * shows the localized "No drive data for chart" empty state, so the panel is never blank.
 */
@Composable
private fun DriveTrendPanel(
    trend: DriveTrendResult,
    distanceUnit: DistanceUnitPref,
    locale: Locale,
    strings: BatteryRangeChartsStrings,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitleRow(icon = MapsGlyphs.Route, title = strings.driveTrendTitle)
            if (trend.isEmpty) {
                EmptyState(
                    message = strings.noDriveData,
                    modifier = Modifier.fillMaxWidth(),
                    icon = MapsGlyphs.Route,
                )
            } else {
                DriveTrendChart(trend = trend, distanceUnit = distanceUnit, locale = locale, strings = strings)
            }
        }
    }
}

/** The distance + duration area chart with its legend — the web `<AreaChart>` + `<Legend />`. */
@Composable
private fun DriveTrendChart(
    trend: DriveTrendResult,
    distanceUnit: DistanceUnitPref,
    locale: Locale,
    strings: BatteryRangeChartsStrings,
    modifier: Modifier = Modifier,
) {
    val distanceColor = paletteColor(PRIMARY_COLOR_INDEX)
    val durationColor = paletteColor(DURATION_COLOR_INDEX)
    val distanceName = "${strings.distanceLabel} (${distanceUnit.label})"
    val series =
        remember(trend, distanceName, strings.durationLabel, distanceColor, durationColor) {
            listOf(
                ChartSeries(
                    key = DISTANCE_KEY,
                    label = distanceName,
                    values = trend.distanceValues,
                    kind = ChartSeriesKind.Area,
                    color = distanceColor,
                ),
                ChartSeries(
                    key = DURATION_KEY,
                    label = strings.durationLabel,
                    values = trend.durationValues,
                    kind = ChartSeriesKind.Area,
                    color = durationColor,
                ),
            )
        }
    val legend =
        remember(distanceName, strings.durationLabel, distanceColor, durationColor) {
            listOf(
                LegendEntry(key = DISTANCE_KEY, label = distanceName, color = distanceColor),
                LegendEntry(key = DURATION_KEY, label = strings.durationLabel, color = durationColor),
            )
        }
    val description = "${strings.driveTrendTitle}: $distanceName, ${strings.durationLabel}"
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = description }) {
            AreaChartWrapper(
                series = series,
                xLabels = trend.xLabels,
                height = DRIVE_AREA_HEIGHT,
                yValueFormatter = { value -> BatteryRangeChartsProjection.fmtInt(value, locale) },
            )
        }
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

// ── Shared bits ───────────────────────────────────────────────────────────────────────────────────────

/** A panel title row — a decorative accent glyph (web `text-[var(--neon-cyan)]`) beside the bold title. */
@Composable
private fun PanelTitleRow(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            icon,
            contentDescription = null,
            size = TITLE_ICON_SIZE,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clearAndSetSemantics {},
        )
        PanelTitle(title)
    }
}

/** Maps a [BatteryBand] onto a P1/S9 design token — the web `batteryColor` good/warn/critical hexes. */
@Composable
private fun batteryColor(band: BatteryBand): Color =
    when (band) {
        BatteryBand.Good -> TeslaTokens.status.success
        BatteryBand.Warning -> TeslaTokens.status.warning
        BatteryBand.Critical -> TeslaTokens.status.danger
    }

/** The localized x-axis label for a battery [segment] — web `t('common.current'|'common.remaining')`. */
private fun segmentLabel(
    segment: BatterySegment,
    strings: BatteryRangeChartsStrings,
): String =
    when (segment) {
        BatterySegment.Current -> strings.currentLabel
        BatterySegment.Remaining -> strings.remainingLabel
    }

/**
 * Resolves the [BatteryRangeChartsStrings] from the i18n catalog (P1/S10) — every `t(...)` key the web
 * component reads. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberBatteryRangeChartsStrings(): BatteryRangeChartsStrings {
    val batteryOverviewTitle = stringResource(R.string.translation_vehicles_detail_batteryOverview)
    val driveTrendTitle = stringResource(R.string.translation_vehicles_detail_driveTrend)
    val batteryLabel = stringResource(R.string.translation_common_battery)
    val rangeLabel = stringResource(R.string.translation_common_range)
    val currentLabel = stringResource(R.string.translation_common_current)
    val remainingLabel = stringResource(R.string.translation_common_remaining)
    val distanceLabel = stringResource(R.string.translation_common_distance)
    val durationLabel = stringResource(R.string.translation_common_duration)
    val noDriveData = stringResource(R.string.translation_vehicles_detail_noDriveData)
    return remember(
        batteryOverviewTitle,
        driveTrendTitle,
        batteryLabel,
        rangeLabel,
        currentLabel,
        remainingLabel,
        distanceLabel,
        durationLabel,
        noDriveData,
    ) {
        BatteryRangeChartsStrings(
            batteryOverviewTitle = batteryOverviewTitle,
            driveTrendTitle = driveTrendTitle,
            batteryLabel = batteryLabel,
            rangeLabel = rangeLabel,
            currentLabel = currentLabel,
            remainingLabel = remainingLabel,
            distanceLabel = distanceLabel,
            durationLabel = durationLabel,
            noDriveData = noDriveData,
        )
    }
}

// ── Lifecycle chrome ──────────────────────────────────────────────────────────────────────────────────

/** First-load skeleton — a battery panel (title, gauge block, bar block) and a drive panel (title, area block). */
@Composable
private fun BatteryRangeChartsLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(widthFraction = SKELETON_TITLE_WIDTH_FRACTION, height = SKELETON_TITLE_HEIGHT)
                Skeleton(height = SKELETON_GAUGE_HEIGHT)
                ChartBlockSkeleton(height = BATTERY_BAR_HEIGHT)
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Skeleton(widthFraction = SKELETON_TITLE_WIDTH_FRACTION, height = SKELETON_TITLE_HEIGHT)
                ChartBlockSkeleton(height = DRIVE_AREA_HEIGHT)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun BatteryRangeChartsError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Whole-surface empty state — shown when the host feed resolves to no vehicle data, never a blank box. */
@Composable
private fun BatteryRangeChartsEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_chart_noData),
        modifier = modifier.fillMaxWidth(),
        icon = DataDisplayGlyphs.Battery,
    )
}

/**
 * The freshness chip shown above the panels when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun BatteryRangeFreshnessRow(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberBatteryRangeFreshnessFormatter(),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberBatteryRangeFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> BATTERY_RANGE_EM_DASH
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

/** Resolves a BCP-47 language tag to a [Locale], falling back to the platform default for a blank tag. */
private fun localeOf(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    BatteryRangeChartsStrings(
        batteryOverviewTitle = "Battery Overview",
        driveTrendTitle = "Drive Distance Trend",
        batteryLabel = "Battery",
        rangeLabel = "Range",
        currentLabel = "Current",
        remainingLabel = "Remaining",
        distanceLabel = "Distance",
        durationLabel = "Duration",
        noDriveData = "No drive data for chart",
    )

private val PREVIEW_DATA =
    BatteryRangeData(
        battery = VehicleBatteryState(batteryLevelPct = 72.0, ratedRangeMeters = 412_000.0),
        drives =
            listOf(
                DriveSample(startTs = "2026-03-18T08:00:00Z", distanceMeters = 42_000.0, durationSeconds = 2_700.0),
                DriveSample(startTs = "2026-03-17T09:30:00Z", distanceMeters = 18_500.0, durationSeconds = 1_500.0),
                DriveSample(startTs = "2026-03-16T18:15:00Z", distanceMeters = 64_200.0, durationSeconds = 3_900.0),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun BatteryRangeChartsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun BatteryRangeChartsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state = UiState(UiPhase.Empty, data = null),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun BatteryRangeChartsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun BatteryRangeChartsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (no drives)", showBackground = true)
@Composable
private fun BatteryRangeChartsNoDrivesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = PREVIEW_DATA.copy(drives = emptyList()),
                ),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun BatteryRangeChartsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryRangeChartsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    fetchedAt = 1_700_000_000_000L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
            strings = PREVIEW_STRINGS,
        )
    }
}
