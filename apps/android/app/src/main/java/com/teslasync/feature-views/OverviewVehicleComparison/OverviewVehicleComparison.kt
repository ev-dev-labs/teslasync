// The native Jetpack Compose + Material 3 "Overview vehicle comparison" analytics feature view — a parity
// port of web/src/features/analytics/components/analytics/OverviewVehicleComparison.tsx. The web component is
// purely presentational: it receives the loaded `FleetAnalytics` and renders four `<GlassPanel>`s, each with
// an always-visible `<SectionTitle>` wrapping either a chart or a friendly `<EmptyState>`:
//   1. Fleet Usage      — a Recharts donut `<PieChart>` of each vehicle's distance (+ `<Legend>`).
//   2. Efficiency board — a sorted list of `MetricBar`-style efficiency bars (lower Wh/km = rank #1).
//   3. Vehicle Compare  — a Recharts `<RadarChart>` across distance/energy/drives/efficiency (≥2 vehicles).
//   4. Energy & Activity— a grouped `<BarChart>` of energy (kWh) + drive count (+ `<Legend>`).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own; its two
// web hooks map to native seams — `useTranslation` → the i18n catalog, `useUnits` → the live
// [io.teslasync.android.data.UnitFormatter] from the shared data container (P1/S8, the single SI→display
// boundary). The host supplies the `vehicle_comparison` rows through the shared state-holder layer as a
// [UiState], so this feature view renders every lifecycle state that layer can carry — loading, hard error
// with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. A web-parity
// overload that takes the raw `vehicle_comparison` list is also provided for hosts that already hold it.
//
// The native donut + radar are drawn with Compose `Canvas` (the shared chart layer ships no pie/radar
// wrapper and feature views must not import Vico directly); the bars use the shared [BarChartWrapper] and the
// leaderboard the shared [MetricBar], exactly as the parity guidelines require. Series colours resolve to the
// generated brand palette via [paletteColor] (never raw hex). The radar's per-vehicle [ChartLegend] and the
// donut's slice [ChartLegend] are honest native adaptations of the web charts' hover tooltips (touch has no
// hover), so every polygon/slice is identifiable and TalkBack-labelled.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OverviewVehicleComparison — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.overviewvehiclecomparison

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import java.util.Locale
import kotlin.math.cos
import kotlin.math.sin

/** Donut plot height (web `<ResponsiveContainer height={280}>`, trimmed for the native panel). */
private val DONUT_HEIGHT: Dp = 220.dp

/** Radar plot height — square-ish so the four-axis polygon reads cleanly. */
private val RADAR_HEIGHT: Dp = 260.dp

/** Energy & activity bar plot height. */
private val BAR_PLOT_HEIGHT: Dp = 240.dp

/** Donut ring geometry — web `Pie innerRadius={55} outerRadius={95} paddingAngle={3}`. */
private const val DONUT_OUTER_FRACTION: Float = 0.92f
private const val DONUT_INNER_FRACTION: Float = 0.55f
private const val DONUT_GAP_DEGREES: Float = 3f
private const val FULL_CIRCLE_DEGREES: Float = 360f
private const val DONUT_START_DEGREES: Float = -90f

/** Radar geometry — four concentric grid rings + the web `Radar fillOpacity={0.15} strokeWidth={2}`. */
private const val RADAR_RING_COUNT: Int = 4
private const val RADAR_FILL_ALPHA: Float = 0.15f
private const val RADAR_LABEL_INSET_FRACTION: Float = 0.78f
private const val RADAR_AXIS_MAX: Float = 100f
private const val QUARTER_TURN_RAD: Float = (Math.PI / 2).toFloat()
private const val RADAR_START_RAD: Float = -QUARTER_TURN_RAD

/** Bar series keys — the web `<Bar dataKey="energy" />` / `<Bar dataKey="drives" />`. */
private const val ENERGY_KEY: String = "energy"
private const val DRIVES_KEY: String = "drives"

/** Palette indices matching the web `CHART_COLORS[1]` (energy) and `CHART_COLORS[3]` (drives). */
private const val ENERGY_COLOR_INDEX: Int = 1
private const val DRIVES_COLOR_INDEX: Int = 3

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), binds the live
 * display units from the shared data container (web `useUnits`), and renders every lifecycle [state] the
 * host's `/analytics/fleet` feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (its
 * `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the `vehicle_comparison` rows (web `data?.vehicle_comparison`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun OverviewVehicleComparison(
    state: UiState<List<VehicleComparison>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordOverviewVehicleComparisonOpened(logger) }
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = unitFormatter.prefs
    val locale = remember(prefs.locale) { prefs.locale?.let(Locale::forLanguageTag) ?: Locale.getDefault() }
    OverviewVehicleComparisonContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        distanceUnit = prefs.distance,
        locale = locale,
    )
}

/**
 * Web-parity overload mirroring the web component's `data?.vehicle_comparison` prop, for hosts that already
 * hold the loaded list. An empty/`null` list renders the per-panel empty states (web `vehicles.length > 0`
 * ternaries), a non-empty list renders the charts. Records `view.opened` like the stateful entry. There is
 * no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun OverviewVehicleComparison(
    comparison: List<VehicleComparison>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(comparison) {
            val rows = comparison ?: emptyList()
            UiState(phase = if (rows.isEmpty()) UiPhase.Empty else UiPhase.Content, data = rows)
        }
    OverviewVehicleComparison(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * four always-titled panels (each with its content/empty branch) and adds the lifecycle chrome the host's
 * feed implies: a loading skeleton, a hard-error retry surface, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [distanceUnit]/[locale] drive the SI→display conversion and number grouping.
 */
@Composable
fun OverviewVehicleComparisonContent(
    state: UiState<List<VehicleComparison>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    distanceUnit: DistanceUnitPref = DistanceUnitPref.KM,
    locale: Locale = Locale.getDefault(),
    strings: OverviewVehicleComparisonStrings = rememberOverviewVehicleComparisonStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier) {
        when {
            state.isLoading -> OverviewLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> OverviewError(onRetry = onRetry)
            else -> {
                val display =
                    remember(state.data, distanceUnit, locale, strings) {
                        OverviewVehicleComparisonProjection.project(
                            vehicles = state.data ?: emptyList(),
                            distanceUnit = distanceUnit,
                            strings = strings,
                            locale = locale,
                        )
                    }
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    if (state.stale || state.refreshing || state.hasError) {
                        OverviewFreshnessRow(state)
                    }
                    FleetUsagePanel(display)
                    EfficiencyLeaderboardPanel(display)
                    VehicleComparisonPanel(display)
                    EnergyActivityPanel(display)
                }
            }
        }
    }
}

// ── Panel 1: Fleet Usage donut ─────────────────────────────────────────────────────────────────────

@Composable
private fun FleetUsagePanel(display: OverviewVehicleComparisonDisplay) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(display.strings.fleetUsage)
        Spacer(Modifier.height(Spacing.sm))
        if (display.fleetUsage.isNotEmpty()) {
            FleetUsageDonut(segments = display.fleetUsage, contentDescription = display.fleetUsageDescription)
            Spacer(Modifier.height(Spacing.sm))
            ChartLegend(
                entries = display.fleetUsage.map { LegendEntry(it.name, it.name, paletteColor(it.colorIndex)) },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            EmptyState(message = display.strings.noVehicles, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun FleetUsageDonut(
    segments: List<FleetUsageSegment>,
    contentDescription: String,
) {
    val colors = segments.map { paletteColor(it.colorIndex) }
    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DONUT_HEIGHT)
                .semantics { this.contentDescription = contentDescription },
    ) {
        val total = segments.sumOf { it.value }
        if (total <= 0.0) return@Canvas
        val radius = size.minDimension / 2f
        val thickness = radius * (DONUT_OUTER_FRACTION - DONUT_INNER_FRACTION)
        val ringRadius = radius * (DONUT_OUTER_FRACTION + DONUT_INNER_FRACTION) / 2f
        val center = Offset(size.width / 2f, size.height / 2f)
        val topLeft = Offset(center.x - ringRadius, center.y - ringRadius)
        val arcSize = Size(ringRadius * 2f, ringRadius * 2f)
        val gap = if (segments.size > 1) DONUT_GAP_DEGREES else 0f
        val sweepBudget = FULL_CIRCLE_DEGREES - gap * segments.size
        var startAngle = DONUT_START_DEGREES
        segments.forEachIndexed { index, segment ->
            val sweep = (segment.value / total).toFloat() * sweepBudget
            drawArc(
                color = colors[index],
                startAngle = startAngle,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = thickness),
            )
            startAngle += sweep + gap
        }
    }
}

// ── Panel 2: Efficiency leaderboard ────────────────────────────────────────────────────────────────

@Composable
private fun EfficiencyLeaderboardPanel(display: OverviewVehicleComparisonDisplay) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(display.strings.effLeaderboard)
        Spacer(Modifier.height(Spacing.sm))
        if (display.leaderboard.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                display.leaderboard.forEach { row ->
                    MetricBar(
                        value = row.fraction,
                        max = 1.0,
                        label = "#${row.rank} ${row.name}",
                        valueText = row.efficiencyText,
                        color = TeslaTokens.chart.speed,
                    )
                }
            }
        } else {
            EmptyState(message = display.strings.noEfficiency, modifier = Modifier.fillMaxWidth())
        }
    }
}

// ── Panel 3: Radar vehicle comparison ──────────────────────────────────────────────────────────────

@Composable
private fun VehicleComparisonPanel(display: OverviewVehicleComparisonDisplay) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(display.strings.vehicleComparison)
        Spacer(Modifier.height(Spacing.sm))
        if (display.radar.hasData) {
            RadarChart(radar = display.radar, title = display.strings.vehicleComparison)
            Spacer(Modifier.height(Spacing.sm))
            ChartLegend(
                entries = display.radar.vehicles.map { LegendEntry(it.name, it.name, paletteColor(it.colorIndex)) },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            EmptyState(message = display.strings.noComparison, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun RadarChart(
    radar: RadarChartData,
    title: String,
) {
    val gridColor = MaterialTheme.colorScheme.outlineVariant
    val colors = radar.vehicles.map { paletteColor(it.colorIndex) }
    val description = remember(radar, title) { "$title: ${radar.vehicles.joinToString(", ") { it.name }}" }
    Box(modifier = Modifier.fillMaxWidth().height(RADAR_HEIGHT)) {
        Canvas(
            modifier = Modifier.fillMaxSize().semantics { contentDescription = description },
        ) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val maxRadius = size.minDimension / 2f * RADAR_LABEL_INSET_FRACTION
            drawRadarGrid(center, maxRadius, gridColor)
            radar.vehicles.forEachIndexed { index, vehicle ->
                drawRadarPolygon(center, maxRadius, vehicle.axisValues, colors[index])
            }
        }
        Caption(radar.axisLabels.getOrElse(0) { "" }, modifier = Modifier.align(Alignment.TopCenter))
        Caption(radar.axisLabels.getOrElse(1) { "" }, modifier = Modifier.align(Alignment.CenterEnd))
        Caption(radar.axisLabels.getOrElse(2) { "" }, modifier = Modifier.align(Alignment.BottomCenter))
        Caption(radar.axisLabels.getOrElse(3) { "" }, modifier = Modifier.align(Alignment.CenterStart))
    }
}

/** Radar vertex for axis [index] at the given [fraction] (0..1) of [maxRadius] around [center]. */
private fun radarVertex(
    center: Offset,
    maxRadius: Float,
    index: Int,
    fraction: Float,
): Offset {
    val angle = RADAR_START_RAD + index * QUARTER_TURN_RAD
    return Offset(center.x + cos(angle) * maxRadius * fraction, center.y + sin(angle) * maxRadius * fraction)
}

/** Draws the four concentric grid rings + the four radial spokes — the web `<PolarGrid>`. */
private fun DrawScope.drawRadarGrid(
    center: Offset,
    maxRadius: Float,
    color: Color,
) {
    val axes = 4
    for (ring in 1..RADAR_RING_COUNT) {
        val fraction = ring.toFloat() / RADAR_RING_COUNT
        val path = Path()
        for (axis in 0 until axes) {
            val vertex = radarVertex(center, maxRadius, axis, fraction)
            if (axis == 0) path.moveTo(vertex.x, vertex.y) else path.lineTo(vertex.x, vertex.y)
        }
        path.close()
        drawPath(path, color, style = Stroke(width = 1f))
    }
    for (axis in 0 until axes) {
        drawLine(color, center, radarVertex(center, maxRadius, axis, 1f), strokeWidth = 1f)
    }
}

/** Draws one vehicle's filled + stroked polygon — the web `<Radar fillOpacity={0.15} strokeWidth={2}>`. */
private fun DrawScope.drawRadarPolygon(
    center: Offset,
    maxRadius: Float,
    axisValues: List<Double>,
    color: Color,
) {
    if (axisValues.isEmpty()) return
    val path = Path()
    axisValues.forEachIndexed { index, value ->
        val fraction = (value.toFloat() / RADAR_AXIS_MAX).coerceIn(0f, 1f)
        val vertex = radarVertex(center, maxRadius, index, fraction)
        if (index == 0) path.moveTo(vertex.x, vertex.y) else path.lineTo(vertex.x, vertex.y)
    }
    path.close()
    drawPath(path, color.copy(alpha = RADAR_FILL_ALPHA))
    drawPath(path, color, style = Stroke(width = 2f))
}

// ── Panel 4: Energy & activity bars ────────────────────────────────────────────────────────────────

@Composable
private fun EnergyActivityPanel(display: OverviewVehicleComparisonDisplay) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(display.strings.energyActivity)
        Spacer(Modifier.height(Spacing.sm))
        if (display.hasVehicles) {
            val energyColor = paletteColor(ENERGY_COLOR_INDEX)
            val drivesColor = paletteColor(DRIVES_COLOR_INDEX)
            val series =
                remember(display.energyValues, display.drivesValues, display.energyLabel, display.drivesLabel) {
                    listOf(
                        ChartSeries(ENERGY_KEY, display.energyLabel, display.energyValues, ChartSeriesKind.Bar, energyColor),
                        ChartSeries(DRIVES_KEY, display.drivesLabel, display.drivesValues, ChartSeriesKind.Bar, drivesColor),
                    )
                }
            BarChartWrapper(series = series, xLabels = display.barLabels, height = BAR_PLOT_HEIGHT)
            Spacer(Modifier.height(Spacing.sm))
            ChartLegend(
                entries =
                    listOf(
                        LegendEntry(ENERGY_KEY, display.energyLabel, energyColor),
                        LegendEntry(DRIVES_KEY, display.drivesLabel, drivesColor),
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            EmptyState(message = display.strings.noVehicles, modifier = Modifier.fillMaxWidth())
        }
    }
}

// ── Lifecycle chrome (loading / error / freshness) ───────────────────────────────────────────────────

@Composable
private fun OverviewLoading(label: String) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            ChartBlockSkeleton(modifier = Modifier.fillMaxWidth(), height = DONUT_HEIGHT)
            ChartBlockSkeleton(modifier = Modifier.fillMaxWidth(), height = BAR_PLOT_HEIGHT)
        }
    }
}

@Composable
private fun OverviewError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun OverviewFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberOverviewFreshnessFormatter(),
        )
    }
}

private const val LOADING_TITLE_FRACTION: Float = 0.4f
private val LOADING_TITLE_HEIGHT: Dp = 14.dp

/**
 * Builds the localized [OverviewVehicleComparisonStrings] from the i18n catalog (P1/S10): the nine
 * `analytics.overview.*` keys the web component reads plus the three shared metric labels its radar axes use
 * (`analytics.hero.*`). Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberOverviewVehicleComparisonStrings(): OverviewVehicleComparisonStrings {
    val fleetUsage = stringResource(R.string.translation_analytics_overview_fleetUsage)
    val effLeaderboard = stringResource(R.string.translation_analytics_overview_effLeaderboard)
    val vehicleComparison = stringResource(R.string.translation_analytics_overview_vehicleComparison)
    val energyActivity = stringResource(R.string.translation_analytics_overview_energyActivity)
    val noVehicles = stringResource(R.string.translation_analytics_overview_noVehicles)
    val noEfficiency = stringResource(R.string.translation_analytics_overview_noEfficiency)
    val noComparison = stringResource(R.string.translation_analytics_overview_noComparison)
    val energyLabel = stringResource(R.string.translation_analytics_overview_energykWh)
    val drivesLabel = stringResource(R.string.translation_analytics_overview_drives)
    val metricDistance = stringResource(R.string.translation_analytics_hero_distance)
    val metricEnergy = stringResource(R.string.translation_analytics_hero_energy)
    val metricEfficiency = stringResource(R.string.translation_analytics_hero_efficiency)
    return remember(
        fleetUsage,
        effLeaderboard,
        vehicleComparison,
        energyActivity,
        noVehicles,
        noEfficiency,
        noComparison,
        energyLabel,
        drivesLabel,
        metricDistance,
        metricEnergy,
        metricEfficiency,
    ) {
        OverviewVehicleComparisonStrings(
            fleetUsage = fleetUsage,
            effLeaderboard = effLeaderboard,
            vehicleComparison = vehicleComparison,
            energyActivity = energyActivity,
            noVehicles = noVehicles,
            noEfficiency = noEfficiency,
            noComparison = noComparison,
            energyLabel = energyLabel,
            drivesLabel = drivesLabel,
            metricDistance = metricDistance,
            metricEnergy = metricEnergy,
            metricEfficiency = metricEfficiency,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberOverviewFreshnessFormatter(): (FreshnessAge) -> String {
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
    OverviewVehicleComparisonStrings(
        fleetUsage = "Fleet Usage",
        effLeaderboard = "Efficiency Leaderboard",
        vehicleComparison = "Vehicle Comparison",
        energyActivity = "Energy & Activity",
        noVehicles = "No vehicle data",
        noEfficiency = "No efficiency data",
        noComparison = "Need 2+ vehicles for comparison",
        energyLabel = "Energy (kWh)",
        drivesLabel = "Drives",
        metricDistance = "Distance",
        metricEnergy = "Energy",
        metricEfficiency = "Efficiency",
    )

private val PREVIEW_VEHICLES =
    listOf(
        VehicleComparison(1, "Model 3", distanceKm = 1840.0, energyKwh = 280.0, efficiencyWhKm = 152.0, drives = 96.0),
        VehicleComparison(2, "Model Y", distanceKm = 1220.0, energyKwh = 215.0, efficiencyWhKm = 176.0, drives = 64.0),
        VehicleComparison(3, "Model S", distanceKm = 640.0, energyKwh = 134.0, efficiencyWhKm = 198.0, drives = 28.0),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun OverviewLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewVehicleComparisonContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun OverviewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewVehicleComparisonContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun OverviewErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewVehicleComparisonContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun OverviewContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewVehicleComparisonContent(
            state = UiState(UiPhase.Content, data = PREVIEW_VEHICLES),
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun OverviewOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OverviewVehicleComparisonContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_VEHICLES,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            distanceUnit = DistanceUnitPref.MI,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}
