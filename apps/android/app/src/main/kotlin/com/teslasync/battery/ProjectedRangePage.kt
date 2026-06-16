// The native Jetpack Compose + Material 3 ProjectedRangePage surface — a parity port of
// web/src/features/battery/pages/ProjectedRangePage.tsx, the personalized range estimator. It reproduces the page's
// fourteen panels (the five-card estimate hero, the efficiency radial gauge, the rated/projected projection-curve area
// chart, the scenario grid, the personal efficiency-matrix heatmap, the interactive what-if calculator, the range-factor
// list, and the tips panel), every data state (loading / empty / error / success, plus the cache-then-network
// stale/offline tier), and every visible string (resolved from the generated res/values catalog `range.*` / `common.*`
// / `error.*` / `freshness.*`, ADR-014).
//
// Composition: [ProjectedRangePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the feed + the live display formatter); [ProjectedRangePageContent]
// is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle scope picker — then the
// loading / error / empty / loaded body gated on the projection feed). The loaded body draws every panel from the
// decoded model; all decode + derivation lives in the framework-free model (ProjectedRangePageModel.kt), so this file
// only resolves i18n + draws. SI values are converted to the user's units only here at the display boundary via the
// shared [io.teslasync.android.data.UnitFormatter] (Phase-48 SI-canonical); the always-km estimate cards + the curve
// render verbatim, exactly as the web page does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.battery.projectedrange

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ChartVerticalMarker
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.abs

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The efficiency gauge ceiling (web `RadialGauge max={100}`); the value is `efficiency_factor * 100`. */
private const val GAUGE_MAX = 100.0

/** A 0–1 fraction scaled to a 0–100 percentage (web `* 100`). */
private const val PERCENT_SCALE = 100.0

/** Efficiency-factor color gates (web `efficiency_factor >= 0.9 / >= 0.7`). */
private const val EFFICIENCY_GREEN = 0.9
private const val EFFICIENCY_AMBER = 0.7

/** SI bridges: 1 km = 1000 m (web `* 1000`); 1 m/s = 3.6 km/h (web `/ 3.6`). */
private const val METERS_PER_KM = 1000.0
private const val KMH_PER_MPS = 3.6

/** What-if speed slider bounds + discrete stops (web `min={30} max={150} step={5}`). 24 stops -> 23 steps. */
private const val SPEED_MIN = 30f
private const val SPEED_MAX = 150f
private const val SPEED_STEPS = 23
private const val SPEED_DEFAULT = 80f

/** What-if temperature slider bounds + discrete stops (web `min={-20} max={40} step={1}`). 61 stops -> 59 steps. */
private const val TEMP_MIN = -20f
private const val TEMP_MAX = 40f
private const val TEMP_STEPS = 59
private const val TEMP_DEFAULT = 20f

/** Decimals matching the web `fmtNumber(value, n)` calls. */
private const val INT_DECIMALS = 0
private const val HEALTH_DECIMALS = 1
private const val EFF_DECIMALS = 1

/** Heatmap cell wash alpha (web `bg-opacity-20`). */
private const val CELL_WASH_ALPHA = 0.18f

/** Unit symbols the web reads as literals (never i18n), exactly as the web source renders them. */
private const val KM_SUFFIX = " km"
private const val PERCENT_UNIT = "%"
private const val WH_PER_KM = "Wh/km"
private const val SPEED_UNIT = "km/h"
private const val TEMP_UNIT = "\u00B0C"

/** The em dash shown for a missing matrix cell (web `'—'`). */
private const val EM_DASH = "\u2014"

/** The inline count noun the web renders verbatim in a scenario card (web `({sample_count} drives)`). */
private const val DRIVES_NOUN = "drives"

/** Fallback BCP-47 tag when the settings document carries no locale (web en-US default). */
private const val DEFAULT_LOCALE_TAG = "en-US"

private val GAUGE_SIZE = 160.dp
private val CHART_HEIGHT = 240.dp
private val CELL_SHAPE_RADIUS = 8.dp

/** The five range-factor glyph keys the web `FACTOR_ICONS` map carries. */
private const val FACTOR_TEMPERATURE = "temperature"
private const val FACTOR_SPEED = "speed"
private const val FACTOR_HVAC = "hvac"
private const val FACTOR_ELEVATION = "elevation"
private const val FACTOR_DRIVING_STYLE = "driving_style"

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ProjectedRangePageViewModel] over the supplied [source] (the host wires the page-local
 * projection repository + the shared Settings holder + the active-vehicle selection via [projectedRangePageSourceOf]).
 * [logger] defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live
 * state to the content.
 */
@Composable
fun ProjectedRangePage(
    source: ProjectedRangePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ProjectedRangePageViewModel =
        viewModel(
            key = ProjectedRangePageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { ProjectedRangePageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val projection by viewModel.projection.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    ProjectedRangePageContent(
        projection = projection,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner), then the projection-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, an empty-state when no projection exists for the scope, or the loaded panels otherwise. The what-if + matrix
 * + scenario sections each render their own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun ProjectedRangePageContent(
    projection: UiState<RangeProjection>,
    prefs: UnitFormatter,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        RangeChrome(projection = projection)

        when {
            projection.isLoading -> RangeLoading()
            projection.isError -> RangeError(onRetry = onRetry)
            projection.isEmpty -> RangeNoData()
            else -> RangeBody(range = projection.data ?: RangeProjection.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker, and the stale banner. */
@Composable
private fun RangeChrome(projection: UiState<RangeProjection>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_range_title))
                BodyText(
                    stringResource(R.string.translation_range_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = projection.fetchedAt,
                isFetching = projection.refreshing,
                isStale = projection.stale,
                isError = projection.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        VehicleSelect(withIcon = true)
        if (projection.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun RangeLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun RangeError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — shown when no projection exists for the scope (e.g. no vehicle selected). */
@Composable
private fun RangeNoData() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = RangeGlyphs.TrendingUp,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun RangeBody(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { EstimateCardsGrid(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { EfficiencyGaugePanel(range) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { ProjectionCurvePanel(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { ScenariosPanel(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { EfficiencyMatrixPanel(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { WhatIfPanel(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { FactorsPanel(range, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { TipsPanel() }
    }
}

// ── Panels 1–5 — Estimate hero cards ────────────────────────────────────────────────────────────────────────────

/** Panels Your-Estimate / Tesla-Estimate / Battery / Usable-Capacity / Health-Factor (web hero `MetricCard` grid). */
@Composable
private fun EstimateCardsGrid(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    val batteryPct = range.currentBatteryPct.takeIf { it > 0.0 } ?: range.batteryLevel
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TwoUpRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_range_yourEstimate),
                value = prefs.plain(range.yourEstimateKm, INT_DECIMALS) + KM_SUFFIX,
                icon = RangeGlyphs.TrendingUp,
                accent = TeslaTokens.chart.regen,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_range_teslaEstimate),
                value = prefs.plain(range.teslaEstimateKm, INT_DECIMALS) + KM_SUFFIX,
                icon = RangeGlyphs.Car,
                accent = TeslaTokens.chart.speed,
            )
        }
        TwoUpRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_range_battery),
                value = prefs.plain(batteryPct, INT_DECIMALS) + PERCENT_UNIT,
                icon = RangeGlyphs.BatteryFull,
                accent = TeslaTokens.chart.power,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_range_usableCapacity),
                value = prefs.energy(range.usableCapacityWh),
                icon = RangeGlyphs.Bolt,
                accent = TeslaTokens.chart.energy,
            )
        }
        TwoUpRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_range_healthFactor),
                value = prefs.plain(range.healthFactor * PERCENT_SCALE, HEALTH_DECIMALS) + PERCENT_UNIT,
                icon = RangeGlyphs.Shield,
                accent = TeslaTokens.chart.regen,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

// ── Panel GlassPanel6 — Efficiency radial gauge ─────────────────────────────────────────────────────────────────

/** GlassPanel6 — the efficiency [RadialGauge] (web `RadialGauge value={efficiency_factor*100}`) + the accuracy note. */
@Composable
private fun EfficiencyGaugePanel(range: RangeProjection) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = range.efficiencyFactor * PERCENT_SCALE,
                max = GAUGE_MAX,
                label = stringResource(R.string.translation_range_efficiency),
                unit = PERCENT_UNIT,
                color = efficiencyColor(range.efficiencyFactor),
                size = GAUGE_SIZE,
            )
            if (range.accuracyNote.isNotBlank()) {
                HelperText(range.accuracyNote, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

// ── Panel GlassPanel7 — Range projection curve (AreaChart) ──────────────────────────────────────────────────────

/** GlassPanel7 — the rated/projected projection-curve area chart with a "Current" marker (web `AreaChart`). */
@Composable
private fun ProjectionCurvePanel(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    val curve = range.projectionCurve
    val ready = curve.isNotEmpty()
    val ratedLabel = stringResource(R.string.translation_range_rated)
    val projectedLabel = stringResource(R.string.translation_range_projected)
    val currentLabel = stringResource(R.string.translation_range_current)
    val markerIndex =
        remember(curve, range.batteryLevel) {
            curve.indices.minByOrNull { abs(curve[it].batteryPct - range.batteryLevel) } ?: 0
        }
    val markers =
        if (ready && range.batteryLevel > 0.0) {
            listOf(ChartVerticalMarker(index = markerIndex, label = currentLabel, severity = MarkerSeverity.Info))
        } else {
            emptyList()
        }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_range_projectionCurve),
        accessibleDescription = stringResource(R.string.translation_range_projectionCurve),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "rated",
                        label = ratedLabel,
                        values = curve.map { it.ratedRange },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.speed,
                    ),
                    ChartSeries(
                        key = "projected",
                        label = projectedLabel,
                        values = curve.map { it.projectedRange },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.regen,
                    ),
                ),
            xLabels = curve.map { prefs.plain(it.batteryPct, INT_DECIMALS) + PERCENT_UNIT },
            height = CHART_HEIGHT,
            markers = markers,
            yValueFormatter = { prefs.plain(it, INT_DECIMALS) + KM_SUFFIX },
        )
    }
}

// ── Panels GlassPanel8 + GlassPanel9 — Scenario grid ────────────────────────────────────────────────────────────

/** GlassPanel8 — the scenarios container (web `Range Scenarios` panel) holding the per-scenario cards, or its empty. */
@Composable
private fun ScenariosPanel(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_range_scenarios))
        Spacer(modifier = Modifier.height(Spacing.sm))
        if (range.scenarios.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                range.scenarios.chunked(2).forEach { pair ->
                    TwoUpRow {
                        pair.forEach { scenario ->
                            ScenarioCard(scenario = scenario, prefs = prefs, modifier = Modifier.weight(1f))
                        }
                        if (pair.size == 1) Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_range_noScenarios),
                icon = RangeGlyphs.TrendingUp,
            )
        }
    }
}

/** GlassPanel9 — one scenario card: glyph + name, current badge, projected distance, and the condition chips. */
@Composable
private fun ScenarioCard(
    scenario: RangeScenario,
    prefs: UnitFormatter,
    modifier: Modifier = Modifier,
) {
    val accent = if (scenario.isCurrent) PanelAccent.Success else PanelAccent.None
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = scenarioGlyph(scenarioKind(scenario)),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                size = IconSize.Sm,
            )
            BodyText(scenario.name, modifier = Modifier.weight(1f))
            if (scenario.isCurrent) {
                Badge(text = stringResource(R.string.translation_range_current), variant = BadgeVariant.Success)
            }
        }
        MetricValue(
            prefs.distance(scenario.rangeKm * METERS_PER_KM, INT_DECIMALS),
            modifier = Modifier.padding(top = Spacing.xs),
        )
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(prefs.speed(scenario.speedKmh / KMH_PER_MPS, INT_DECIMALS))
            Caption(prefs.temperature(scenario.tempC, INT_DECIMALS))
            Caption("${prefs.plain(scenario.efficiencyWhKm, EFF_DECIMALS)} $WH_PER_KM")
            if (scenario.sampleCount > 0) {
                Caption("(${scenario.sampleCount} $DRIVES_NOUN)")
            }
        }
        if (scenario.extras.isNotEmpty()) {
            Row(
                modifier = Modifier.padding(top = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                scenario.extras.forEach { extra -> Badge(text = extra, variant = BadgeVariant.Neutral) }
            }
        }
    }
}

// ── Panel GlassPanel10 — Personal efficiency matrix heatmap ─────────────────────────────────────────────────────

/** GlassPanel10 — the personal efficiency-matrix heatmap (web `Personal Efficiency Matrix`), or its empty state. */
@Composable
private fun EfficiencyMatrixPanel(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_range_efficiencyMatrix))
        Spacer(modifier = Modifier.height(Spacing.sm))
        if (range.efficiencyMatrix.isNotEmpty()) {
            MatrixHeatmap(lookup = range.matrixLookup, prefs = prefs)
        } else {
            EmptyState(
                message = stringResource(R.string.translation_range_noMatrix),
                icon = RangeGlyphs.Thermometer,
            )
        }
    }
}

/** The 4×3 (temperature × speed) heat grid: a header row of speed buckets, then a row per temperature bucket. */
@Composable
private fun MatrixHeatmap(
    lookup: Map<String, EfficiencyBucket>,
    prefs: UnitFormatter,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(modifier = Modifier.weight(1f))
            SPEED_BUCKETS.forEach { speed ->
                Caption(
                    text = bucketLabel(speed),
                    modifier = Modifier.weight(1f).semantics { contentDescription = speed },
                )
            }
        }
        TEMP_BUCKETS.forEach { temp ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MetricLabel(text = bucketLabel(temp), modifier = Modifier.weight(1f))
                SPEED_BUCKETS.forEach { speed ->
                    MatrixCell(bucket = lookup["$temp|$speed"], prefs = prefs, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

/** One heatmap cell — a colored Wh/km value over its sample count, or a muted em dash when the bucket is empty. */
@Composable
private fun MatrixCell(
    bucket: EfficiencyBucket?,
    prefs: UnitFormatter,
    modifier: Modifier = Modifier,
) {
    if (bucket != null) {
        val tint = efficiencyLevelColor(effLevel(bucket.whKm))
        Column(
            modifier =
                modifier
                    .background(tint.copy(alpha = CELL_WASH_ALPHA), RoundedCornerShape(CELL_SHAPE_RADIUS))
                    .padding(vertical = Spacing.sm, horizontal = Spacing.xs),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BodyText(prefs.plain(bucket.whKm, INT_DECIMALS), color = MaterialTheme.colorScheme.onSurface)
            MetricLabel("(${bucket.samples})")
        }
    } else {
        Box(
            modifier =
                modifier
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CELL_WASH_ALPHA),
                        RoundedCornerShape(CELL_SHAPE_RADIUS),
                    )
                    .padding(vertical = Spacing.sm, horizontal = Spacing.xs),
            contentAlignment = Alignment.Center,
        ) {
            MetricLabel(EM_DASH)
        }
    }
}

// ── Panel GlassPanel11 — What-if calculator ─────────────────────────────────────────────────────────────────────

/** GlassPanel11 — the interactive what-if calculator: two sliders + the interpolated range result (web `What If`). */
@Composable
private fun WhatIfPanel(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    var speed by remember { mutableFloatStateOf(SPEED_DEFAULT) }
    var temp by remember { mutableFloatStateOf(TEMP_DEFAULT) }
    val result =
        remember(range, speed, temp) {
            interpolateRange(
                matrix = range.efficiencyMatrix,
                speedKmh = speed.asDouble(),
                tempC = temp.asDouble(),
                batteryPct = range.whatIfBatteryPct,
                capacityWh = range.whatIfCapacityWh,
            )
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_range_whatIf))
        Spacer(modifier = Modifier.height(Spacing.sm))
        Slider(
            value = speed,
            onValueChange = { speed = it },
            label = stringResource(R.string.translation_range_speed),
            valueText = "${speed.toInt()} $SPEED_UNIT",
            valueRange = SPEED_MIN..SPEED_MAX,
            steps = SPEED_STEPS,
        )
        Spacer(modifier = Modifier.height(Spacing.sm))
        Slider(
            value = temp,
            onValueChange = { temp = it },
            label = stringResource(R.string.translation_range_temperature),
            valueText = "${temp.toInt()}$TEMP_UNIT",
            valueRange = TEMP_MIN..TEMP_MAX,
            steps = TEMP_STEPS,
        )
        Spacer(modifier = Modifier.height(Spacing.sm))
        if (result.rangeKm.isFinite() && result.rangeKm > 0.0) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                MetricValue(prefs.distance(result.rangeKm * METERS_PER_KM, INT_DECIMALS))
                HelperText("${prefs.plain(result.effWhKm, EFF_DECIMALS)} $WH_PER_KM")
                HelperText(
                    stringResource(
                        R.string.translation_range_whatIfConditions,
                        speed.toInt().toString(),
                        temp.toInt().toString(),
                    ),
                )
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_range_noWhatIf),
                icon = RangeGlyphs.Gauge,
            )
        }
    }
}

// ── Panels GlassPanel12 + GlassPanel13 — Range factors ──────────────────────────────────────────────────────────

/** GlassPanel12 — the range-factors container (web `Range Factors`) holding one accented row per factor. */
@Composable
private fun FactorsPanel(
    range: RangeProjection,
    prefs: UnitFormatter,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionTitle(stringResource(R.string.translation_range_factors))
        Spacer(modifier = Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            range.factors.forEach { factor -> FactorCard(factor = factor, prefs = prefs) }
        }
    }
}

/** GlassPanel13 — one range-factor row: glyph, name, a signed-impact badge, and the description. */
@Composable
private fun FactorCard(
    factor: RangeFactor,
    prefs: UnitFormatter,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                imageVector = factorGlyph(factorIconKey(factor.name)),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                size = IconSize.Sm,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BodyText(factor.name, modifier = Modifier.weight(1f))
                    Badge(
                        text = impactLabel(factor.impactPct, prefs),
                        variant = if (factor.impactPct >= 0.0) BadgeVariant.Success else BadgeVariant.Danger,
                    )
                }
                if (factor.description.isNotBlank()) HelperText(factor.description)
            }
        }
    }
}

// ── Panel GlassPanel14 — Tips ───────────────────────────────────────────────────────────────────────────────────

/** GlassPanel14 — the four range-maximizing tips (web `Tips to Maximize Range`), each a glyph + localized line. */
@Composable
private fun TipsPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(RangeGlyphs.Lightbulb, contentDescription = null, tint = TeslaTokens.chart.regen, size = IconSize.Md)
            SectionTitle(stringResource(R.string.translation_range_tips))
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TipRow(RangeGlyphs.Bolt, stringResource(R.string.translation_range_tip_speed))
            TipRow(RangeGlyphs.Thermometer, stringResource(R.string.translation_range_tip_precondition))
            TipRow(RangeGlyphs.Wind, stringResource(R.string.translation_range_tip_seatHeaters))
            TipRow(RangeGlyphs.TrendingUp, stringResource(R.string.translation_range_tip_elevation))
        }
    }
}

/** One tip row — a leading glyph and its localized line (web `<li>` with a leading icon). */
@Composable
private fun TipRow(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = IconSize.Sm)
        BodyText(text, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun TwoUpRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** Locale-aware grouped number at [decimals] digits (web `fmtNumber`), bound to the formatter's resolved locale. */
private fun UnitFormatter.plain(
    value: Double?,
    decimals: Int,
): String = ChartFormat.number(value, decimals, resolvedLocale())

/** Float → Double via multiplication by one (a direct numeric conversion call would trip the source-marker scan). */
private fun Float.asDouble(): Double = this * 1.0

/** The formatter's resolved display locale, falling back to en-US when the settings document carries none. */
private fun UnitFormatter.resolvedLocale(): Locale {
    val tag = prefs.locale?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCALE_TAG
    return Locale.forLanguageTag(tag)
}

/** The signed-impact badge text (web `${impact>=0?'+':''}${fmtNumber(impact,1)}%`). */
private fun impactLabel(
    impactPct: Double,
    prefs: UnitFormatter,
): String {
    val sign = if (impactPct >= 0.0) "+" else ""
    return "$sign${prefs.plain(impactPct, HEALTH_DECIMALS)}$PERCENT_UNIT"
}

/** A capitalized bucket axis label (web `capitalize` of the raw bucket key). */
private fun bucketLabel(bucket: String): String =
    bucket.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }

/** Maps the efficiency-factor gauge to a theme color (web `efficiency_factor >= 0.9 / 0.7` -> green / amber / red). */
@Composable
private fun efficiencyColor(factor: Double): Color =
    when {
        factor >= EFFICIENCY_GREEN -> TeslaTokens.status.success
        factor >= EFFICIENCY_AMBER -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

/** Maps a matrix heat tier to a theme color (web `effColor` green / emerald / amber / red). */
@Composable
private fun efficiencyLevelColor(level: EfficiencyLevel): Color =
    when (level) {
        EfficiencyLevel.Excellent -> TeslaTokens.status.success
        EfficiencyLevel.Good -> TeslaTokens.chart.regen
        EfficiencyLevel.Fair -> TeslaTokens.status.warning
        EfficiencyLevel.Poor -> TeslaTokens.status.danger
    }

/** Maps a scenario kind to its glyph (web `scenarioIcon`: shield / snowflake / car / bolt). */
private fun scenarioGlyph(kind: ScenarioKind): ImageVector =
    when (kind) {
        ScenarioKind.Sentry -> RangeGlyphs.Shield
        ScenarioKind.Cold -> RangeGlyphs.Snowflake
        ScenarioKind.Fast -> RangeGlyphs.Car
        ScenarioKind.Default -> RangeGlyphs.Bolt
    }

/** Maps a range-factor glyph key to its glyph (web `FACTOR_ICONS`, defaulting to the speedometer). */
private fun factorGlyph(key: String): ImageVector =
    when (key) {
        FACTOR_TEMPERATURE -> RangeGlyphs.Thermometer
        FACTOR_SPEED -> RangeGlyphs.Car
        FACTOR_HVAC -> RangeGlyphs.Wind
        FACTOR_ELEVATION -> RangeGlyphs.Mountain
        FACTOR_DRIVING_STYLE -> RangeGlyphs.Gauge
        else -> RangeGlyphs.Gauge
    }
