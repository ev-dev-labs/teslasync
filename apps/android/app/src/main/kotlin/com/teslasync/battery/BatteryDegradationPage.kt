// The native Jetpack Compose + Material 3 BatteryDegradationPage surface — a parity port of
// web/src/features/battery/pages/BatteryDegradationPage.tsx, the battery health-trend, degradation-prediction &
// charging-habit-impact dashboard. It reproduces the page's twenty-one panels (four summary stat cards, the SoH
// radial-gauge panel, the prediction panel with its four metrics, the health-trend composed chart, the range-loss
// area chart, the scored risk-factor grid, the recommendations panel, the charging-habits-impact banner, the
// three health-factor sub-panels, and the degradation-history table), every data state (loading / empty / error /
// success, plus the cache-then-network stale/offline tier), and every visible string (resolved from the
// res/values catalog, ADR-014).
//
// Composition: [BatteryDegradationPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the two feeds + the live display preferences);
// [BatteryDegradationPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness
// chip / vehicle scope picker — then the loading / error / loaded body). The loaded body draws every panel from
// the decoded models; all decode + formatting lives in the framework-free model (BatteryDegradationPageModel.kt),
// so this file only resolves i18n + draws. SI values are converted to the user's units only here at the display
// boundary via the model's `prefs.fromKm`/`energy`/`number` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.battery.degradation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
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
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Battery state-of-health gauge ceiling (web `RadialGauge max={100}`). */
private const val SOH_MAX = 100.0

/** The 80% warranty floor the projection chart annotates (web `ReferenceLine y={80}` label). */
private const val WARRANTY_FLOOR = "80%"

/** Hard-coded unit symbols the web reads as literals (never i18n): `%`, `kWh`, plus the `%/yr` suffix. */
private const val PERCENT_UNIT = "%"
private const val CAPACITY_UNIT = "kWh"
private const val PER_YEAR_SUFFIX = "%/yr"

/** The score-out-of-100 suffix the health-factor badges show (web ``${score}/100``). */
private const val SCORE_SUFFIX = "/100"

/** Palette index per accent so the cards stay visually distinct yet theme-aware (web per-card colors). */
private const val ACCENT_CYAN = 0
private const val ACCENT_PURPLE = 4

/** The radial gauge diameter + chart heights (web `size={180}` / `height={300}` / `height={260}`). */
private val GAUGE_SIZE = 180.dp
private val TREND_HEIGHT = 300.dp
private val RANGE_HEIGHT = 260.dp

/** The risk-factor bar denominator (a 0–100 risk score). */
private const val RISK_MAX = 100.0

// ── Stateful entry point ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [BatteryDegradationPageViewModel] over the supplied [source] (the host wires the
 * shared Energy/Settings holders + the active-vehicle selection via [batteryDegradationPageSourceOf]). [logger]
 * defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state
 * to the content.
 */
@Composable
fun BatteryDegradationPage(
    source: BatteryDegradationPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: BatteryDegradationPageViewModel =
        viewModel(
            key = BatteryDegradationPageRegistration.SLUG,
            factory = viewModelFactory { initializer { BatteryDegradationPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val health by viewModel.health.collectAsStateWithLifecycle()
    val degradation by viewModel.degradation.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    BatteryDegradationPageContent(
        health = health,
        degradation = degradation,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker),
 * then the battery-health-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, or the loaded panels otherwise. The secondary degradation panels each render their own
 * content-or-empty surface so no section is ever hidden.
 */
@Composable
fun BatteryDegradationPageContent(
    health: UiState<BatteryHealth>,
    degradation: UiState<DegradationData>,
    prefs: BatteryDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // web `usePageTitle(t('battery.degradation.title', …))` — the screen's accessible pane title.
    val pageTitle = stringResource(R.string.translation_battery_degradation_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = pageTitle },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        BatteryDegradationChrome(health = health)

        when {
            health.isLoading -> BatteryDegradationLoading()
            health.isError -> BatteryDegradationError(onRetry = onRetry)
            else ->
                BatteryDegradationBody(
                    health = health.data ?: BatteryHealth.EMPTY,
                    degradation = degradation,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the picker. */
@Composable
private fun BatteryDegradationChrome(health: UiState<BatteryHealth>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_Battery_Degradation))
                BodyText(
                    stringResource(
                        R.string.translation_Health_trends__degradation_predictions__and_charging_habit_impact,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto` — the battery-health freshness chip (daily cagg).
            DataFreshness(
                updatedAtMillis = health.fetchedAt,
                isFetching = health.refreshing,
                isStale = health.stale,
                isError = health.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<VehicleSelect />` over the fleet — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun BatteryDegradationLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun BatteryDegradationError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the twenty-one panels in their web order, each entering with a staggered fade. */
@Composable
private fun BatteryDegradationBody(
    health: BatteryHealth,
    degradation: UiState<DegradationData>,
    prefs: BatteryDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { SummaryGrid(health, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { HealthGaugePanel(health) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { PredictionPanel(health, degradation, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { HealthTrendPanel(health, degradation, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { RangeLossPanel(health, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { RiskFactorsPanel(degradation) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { RecommendationsPanel(degradation) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { ChargingImpactPanel(degradation) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { HealthFactorsPanel(health, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 9) { HistoryPanel(health, prefs) }
    }
}

// ── Panels 1-4 — Summary metrics ────────────────────────────────────────────────────────────────────────────

/** Current-SOH / Estimated-Capacity / Degradation-Rate / Battery-Age — the web 4-up `<MetricCard>` grid. */
@Composable
private fun SummaryGrid(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Current_SOH),
                value = "${prefs.number(health.currentSoh)}$PERCENT_UNIT",
                icon = BatteryDegradationGlyphs.Battery,
                accent = TeslaTokens.status.success,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Estimated_Capacity),
                value = "${prefs.number(health.estimatedCapacityKwh)} $CAPACITY_UNIT",
                icon = BatteryDegradationGlyphs.Bolt,
                accent = paletteColor(ACCENT_CYAN),
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Degradation_Rate),
                value = "${prefs.number(health.degradationRateYr)}$PER_YEAR_SUFFIX",
                icon = BatteryDegradationGlyphs.TrendingDown,
                accent = paletteColor(ACCENT_PURPLE),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Battery_Age),
                value = batteryAgeLabel(health.batteryAgeMonths),
                icon = BatteryDegradationGlyphs.Calendar,
                accent = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

// ── Panel 5 — SoH radial gauge ──────────────────────────────────────────────────────────────────────────────

/** GlassPanel5 — the battery-health radial gauge with its Excellent/Good/Degraded band badge (web gauge panel). */
@Composable
private fun HealthGaugePanel(health: BatteryHealth) {
    val band = sohBand(health.currentSoh)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            RadialGauge(
                value = health.currentSoh,
                max = SOH_MAX,
                label = stringResource(R.string.translation_Battery_Health),
                unit = PERCENT_UNIT,
                color = sohColor(band),
                size = GAUGE_SIZE,
            )
            Badge(text = sohBandLabel(band), variant = sohBadgeVariant(band))
        }
    }
}

// ── Panel 6 — Prediction (+ panels 7-10) ──────────────────────────────────────────────────────────────────────

/** GlassPanel6 — the prediction panel: the forecast sentence + the four prediction metrics, or the needMore note. */
@Composable
private fun PredictionPanel(
    health: BatteryHealth,
    degradation: UiState<DegradationData>,
    prefs: BatteryDisplayPrefs,
) {
    PanelScaffold(
        title = stringResource(R.string.translation_battery_degradation_prediction),
        icon = BatteryDegradationGlyphs.TrendingDown,
        iconTint = paletteColor(ACCENT_PURPLE),
    ) {
        when {
            degradation.isLoading -> SectionLoader()
            degradation.isError -> SectionError()
            else -> {
                val data = degradation.data ?: DegradationData.EMPTY
                if (data.prediction?.hasEnoughData == true) {
                    PredictionContent(health, data, data.prediction, prefs)
                } else {
                    PredictionNeedMore()
                }
            }
        }
    }
}

/** The forecast sentence + the Rate / Stress / Total-Cycles / Avg-DoD metrics (web `has_enough_data` branch). */
@Composable
private fun PredictionContent(
    health: BatteryHealth,
    data: DegradationData,
    prediction: DegradationPrediction,
    prefs: BatteryDisplayPrefs,
) {
    val desc = stringResource(R.string.translation_battery_degradation_predictionDesc)
    val inApprox = stringResource(R.string.translation_battery_degradation_inApprox)
    val years = stringResource(R.string.translation_battery_degradation_years)
    val sentence =
        buildPredictionSentence(desc, inApprox, years, prefs.number(prediction.yearsTo80Pct), prediction.predictedDate)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md, accent = io.teslasync.android.components.ui.PanelAccent.Info) {
            BodyText(sentence, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_degradation_rate),
                value = "${prefs.number(absoluteSlope(prediction), CAPACITY_DECIMALS)}$PER_YEAR_SUFFIX",
                icon = BatteryDegradationGlyphs.TrendingUp,
                accent = TeslaTokens.status.danger,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_degradation_stress),
                value = data.stressLevel ?: EM_DASH,
                icon = BatteryDegradationGlyphs.Shield,
                accent = stressColor(stressBand(data.stressLevel)),
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_degradation_totalCycles),
                value = prefs.integer(if (health.totalCycles > 0.0) health.totalCycles else data.currentCycles),
                icon = BatteryDegradationGlyphs.Refresh,
                accent = paletteColor(ACCENT_CYAN),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_degradation_avgDoD),
                value = "${prefs.number(health.avgDepthOfDischarge)}$PERCENT_UNIT",
                icon = BatteryDegradationGlyphs.TrendingDown,
                accent = paletteColor(ACCENT_PURPLE),
            )
        }
    }
}

/** The "need more snapshots" note shown when the prediction lacks enough data (web `else` branch). */
@Composable
private fun PredictionNeedMore() {
    EmptyState(
        message = stringResource(R.string.translation_battery_degradation_needMore),
        icon = BatteryDegradationGlyphs.AlertTriangle,
    )
}

// ── Panel 11 — Health trend & projection (chart container + composed chart) ───────────────────────────────────

/** Health-Trend-Projection — the web composed `<ChartContainer>`: actual + projected lines + confidence band. */
@Composable
private fun HealthTrendPanel(
    health: BatteryHealth,
    degradation: UiState<DegradationData>,
    prefs: BatteryDisplayPrefs,
) {
    val data = degradation.data ?: DegradationData.EMPTY
    val chart = projectionChart(health, data, prefs)
    val status =
        when {
            degradation.isLoading && chart.isEmpty -> ChartStatus.Loading
            degradation.isError && chart.isEmpty -> ChartStatus.Error
            chart.isEmpty -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }
    val actualColor = TeslaTokens.status.success
    val projectedColor = paletteColor(ACCENT_PURPLE)
    val confidenceColor = paletteColor(ACCENT_PURPLE)
    val series =
        listOf(
            ChartSeries(
                key = "confidence",
                label = stringResource(R.string.translation_battery_degradation_confidence),
                values = chart.confidence,
                kind = ChartSeriesKind.Area,
                color = confidenceColor,
            ),
            ChartSeries(
                key = "health",
                label = stringResource(R.string.translation_battery_degradation_actualHealth),
                values = chart.actual,
                kind = ChartSeriesKind.Line,
                color = actualColor,
            ),
            ChartSeries(
                key = "projected",
                label = stringResource(R.string.translation_battery_degradation_projected),
                values = chart.projected,
                kind = ChartSeriesKind.Line,
                color = projectedColor,
            ),
        )
    val warrantyNote =
        "${stringResource(R.string.translation_battery_degradation_warranty)} ($WARRANTY_FLOOR)"
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_battery_degradation_trendTitle),
        accessibleDescription = stringResource(R.string.translation_battery_degradation_trendTitle_aria),
        status = status,
        height = TREND_HEIGHT,
        emptyMessage = stringResource(R.string.translation_battery_degradation_needMore),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ComboChart(
                series = series,
                xLabels = chart.labels,
                height = TREND_HEIGHT,
                yValueFormatter = { "${prefs.number(it, 0)}$PERCENT_UNIT" },
            )
            Caption(warrantyNote)
        }
    }
}

// ── Panel 12 — Range loss (area chart) ────────────────────────────────────────────────────────────────────────

/** GlassPanel12 — the range-loss area chart (original vs current range), or the `noRange` empty-state. */
@Composable
private fun RangeLossPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    val rows = rangeLossData(health, prefs)
    PanelScaffold(title = stringResource(R.string.translation_battery_degradation_rangeLoss)) {
        if (rows.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_battery_degradation_noRange),
                icon = BatteryDegradationGlyphs.Battery,
            )
        } else {
            val series =
                listOf(
                    ChartSeries(
                        key = "original",
                        label = stringResource(R.string.translation_Original_Range),
                        values = rows.map { it.original },
                        kind = ChartSeriesKind.Area,
                        color = paletteColor(0),
                    ),
                    ChartSeries(
                        key = "current",
                        label = stringResource(R.string.translation_Current_Range),
                        values = rows.map { it.current },
                        kind = ChartSeriesKind.Area,
                        color = paletteColor(2),
                    ),
                )
            AreaChartWrapper(
                series = series,
                xLabels = rows.map { it.label },
                height = RANGE_HEIGHT,
                yValueFormatter = { "${prefs.number(it, 0)} ${prefs.distanceLabel}" },
            )
        }
    }
}

// ── Panel 13 — Risk factors (+ panel 14 per-factor cards) ─────────────────────────────────────────────────────

/** GlassPanel13 — the scored risk-factor grid (each a GlassPanel14 card), or the `noRiskData` empty-state. */
@Composable
private fun RiskFactorsPanel(degradation: UiState<DegradationData>) {
    val factors = degradation.data?.riskFactors.orEmpty()
    PanelScaffold(
        title = stringResource(R.string.translation_battery_degradation_riskFactors),
        icon = BatteryDegradationGlyphs.Shield,
        iconTint = TeslaTokens.status.warning,
    ) {
        if (factors.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_battery_degradation_noRiskData),
                icon = BatteryDegradationGlyphs.Shield,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                factors.forEach { RiskFactorCard(it) }
            }
        }
    }
}

/** GlassPanel14 — one risk-factor card: an icon + band badge, the scored bar, and the detail line (web map). */
@Composable
private fun RiskFactorCard(factor: RiskFactor) {
    val band = riskBand(factor.score)
    val color = scoreColor(band)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Icon(riskGlyph(riskIcon(factor.name)), contentDescription = null, size = IconSize.Sm, tint = color)
                    Caption(humanizeRiskName(factor.name))
                }
                Badge(text = factor.label, variant = scoreBadgeVariant(band))
            }
            MetricBar(
                value = factor.score,
                max = RISK_MAX,
                label = humanizeRiskName(factor.name),
                valueText = factor.score.toInt().toString(),
                color = color,
            )
            if (factor.detail.isNotBlank()) {
                HelperText(factor.detail)
            }
        }
    }
}

// ── Panel 15 — Recommendations ────────────────────────────────────────────────────────────────────────────────

/** GlassPanel15 — the recommendation list, or the `noRecommendations` empty-state. */
@Composable
private fun RecommendationsPanel(degradation: UiState<DegradationData>) {
    val recommendations = degradation.data?.recommendations.orEmpty()
    PanelScaffold(
        title = stringResource(R.string.translation_battery_degradation_recommendations),
        icon = BatteryDegradationGlyphs.AlertTriangle,
        iconTint = TeslaTokens.status.warning,
    ) {
        if (recommendations.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_battery_degradation_noRecommendations),
                icon = BatteryDegradationGlyphs.AlertTriangle,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                recommendations.forEach { RecommendationRow(it) }
            }
        }
    }
}

/** One recommendation row — a lightning glyph + the recommendation text (web amber list item). */
@Composable
private fun RecommendationRow(text: String) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md, accent = io.teslasync.android.components.ui.PanelAccent.Warning) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                BatteryDegradationGlyphs.Bolt,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            BodyText(text, modifier = Modifier.weight(1f))
        }
    }
}

// ── Panel 16 — Charging habits impact ─────────────────────────────────────────────────────────────────────────

/** GlassPanel16 — the charging-habits-impact banner whose tone + copy switch on the stress level (web `AlertBanner`). */
@Composable
private fun ChargingImpactPanel(degradation: UiState<DegradationData>) {
    val data = degradation.data ?: DegradationData.EMPTY
    val band = stressBand(data.stressLevel)
    val fastPct = fastChargePercent(data.chargingHabits)
    val deep = (data.chargingHabits?.deepDischargeCount ?: 0.0).toInt()
    val title =
        buildImpactTitle(
            fastPct = fastPct,
            fastLabel = stringResource(R.string.translation_battery_degradation_fastCharges),
            deep = deep,
            deepLabel = stringResource(R.string.translation_battery_degradation_deepDischarges),
            stress = data.stressLevel ?: stringResource(R.string.translation_battery_degradation_stress),
            stressLabel = stringResource(R.string.translation_battery_degradation_stressLabel),
        )
    val body =
        when (band) {
            StressBand.Low -> stringResource(R.string.translation_battery_degradation_stressLow)
            StressBand.Medium -> stringResource(R.string.translation_battery_degradation_stressMedium)
            else -> stringResource(R.string.translation_battery_degradation_stressHigh)
        }
    PanelScaffold(
        title = stringResource(R.string.translation_battery_degradation_chargingImpact),
        icon = BatteryDegradationGlyphs.Bolt,
        iconTint = TeslaTokens.status.success,
    ) {
        AlertBanner(
            message = body,
            title = title,
            tone = stressTone(band),
            icon = BatteryDegradationGlyphs.Thermometer,
        )
    }
}

// ── Panel 17 — Battery health factors (+ panels 18-20) ───────────────────────────────────────────────────────

/** GlassPanel17 — the three health-factor sub-panels: Charge-Habits / Temperature-Exposure / Cycle-Depth. */
@Composable
private fun HealthFactorsPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    PanelScaffold(
        title = stringResource(R.string.translation_Battery_Health_Factors),
        icon = BatteryDegradationGlyphs.Shield,
        iconTint = TeslaTokens.status.warning,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            // GlassPanel18 — charge habits.
            FactorPanel(
                title = stringResource(R.string.translation_Charge_Habits),
                score = health.chargeHabitsScore,
                prefs = prefs,
            ) {
                FactorRow(stringResource(R.string.translation_Fast_Charge), "${prefs.number(health.fastChargePct)}$PERCENT_UNIT")
                FactorRow(stringResource(R.string.translation_Full_Charge), "${prefs.number(health.fullChargePct)}$PERCENT_UNIT")
            }
            // GlassPanel19 — temperature exposure.
            FactorPanel(
                title = stringResource(R.string.translation_Temperature_Exposure),
                score = health.tempExposureScore,
                prefs = prefs,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Icon(
                        BatteryDegradationGlyphs.Thermometer,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    HelperText(stringResource(R.string.translation_Lower_is_better_for_longevity))
                }
            }
            // GlassPanel20 — cycle depth.
            FactorPanel(
                title = stringResource(R.string.translation_Cycle_Depth),
                score = cycleDepthScore(health.avgDepthOfDischarge),
                prefs = prefs,
            ) {
                FactorRow(stringResource(R.string.translation_Avg_DoD), "${prefs.number(health.avgDepthOfDischarge)}$PERCENT_UNIT")
            }
        }
    }
}

/** One health-factor sub-panel — a title + a `score/100` badge, then its detail rows (web inner GlassPanel). */
@Composable
private fun FactorPanel(
    title: String,
    score: Double,
    prefs: BatteryDisplayPrefs,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(title)
            Badge(text = "${prefs.number(score, 0)}$SCORE_SUFFIX", variant = scoreBadgeVariant(scoreBand(score)))
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        content()
    }
}

/** A label/value detail row inside a health-factor sub-panel (web `flex justify-between`). */
@Composable
private fun FactorRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        HelperText(label)
        HelperText(value)
    }
}

// ── Panel 21 — Degradation history (table) ────────────────────────────────────────────────────────────────────

/** GlassPanel21 — the degradation-history table (Date / Odometer / SOH% / Capacity / Range), or `noHistory`. */
@Composable
private fun HistoryPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    PanelScaffold(title = stringResource(R.string.translation_Degradation_History)) {
        if (health.history.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_battery_degradation_noHistory),
                icon = BatteryDegradationGlyphs.Activity,
            )
        } else {
            val distanceLabel = prefs.distanceLabel
            val columns =
                listOf(
                    TableColumn<BatteryHistoryEntry>(
                        key = "date",
                        header = stringResource(R.string.translation_Date),
                        weight = 1.4f,
                        cell = { BodyText(prefs.formatDate(it.date)) },
                    ),
                    TableColumn(
                        key = "odometer",
                        header = stringResource(R.string.translation_Odometer),
                        cell = { BodyText("${prefs.number(prefs.fromKm(it.odometerKm))} $distanceLabel") },
                    ),
                    TableColumn(
                        key = "soh",
                        header = stringResource(R.string.translation_SOH__),
                        cell = {
                            Badge(
                                text = "${prefs.number(it.sohPct)}$PERCENT_UNIT",
                                variant = sohBadgeVariant(sohBand(it.sohPct)),
                            )
                        },
                    ),
                    TableColumn(
                        key = "capacity",
                        header = stringResource(R.string.translation_Capacity),
                        cell = { BodyText(prefs.energy(it.capacityWh, CAPACITY_DECIMALS)) },
                    ),
                    TableColumn(
                        key = "range",
                        header = stringResource(R.string.translation_Range),
                        cell = { BodyText("${prefs.number(prefs.fromKm(it.rangeKm))} $distanceLabel") },
                    ),
                )
            DataTable(
                columns = columns,
                rows = health.history,
                keyOf = { "${it.date}-${it.odometerKm}" },
                emptyText = stringResource(R.string.translation_No_degradation_records_found_),
            )
        }
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────

/** A GlassPanel with an optional leading icon + a [title] header, then its [content] (web section `GlassPanel`). */
@Composable
private fun PanelScaffold(
    title: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    iconTint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = title },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
            }
            PanelTitle(title)
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        content()
    }
}

/** A compact inline loader for a degradation section's first load (web `Skeleton`). */
@Composable
private fun SectionLoader() {
    Spinner(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** An inline error note for a degradation section's hard failure (web error surface). */
@Composable
private fun SectionError() {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
        icon = BatteryDegradationGlyphs.AlertTriangle,
    )
}

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

// ── Pure mappers (display boundary) ───────────────────────────────────────────────────────────────────────────

/** The em dash shown for a missing stress level (web `'—'`). */
private const val EM_DASH = "\u2014"

/** The SoH band's badge label string id (web `Excellent` / `Good` / `Degraded`). */
@Composable
private fun sohBandLabel(band: SohBand): String =
    when (band) {
        SohBand.Excellent -> stringResource(R.string.translation_Excellent)
        SohBand.Good -> stringResource(R.string.translation_Good)
        SohBand.Degraded -> stringResource(R.string.translation_Degraded)
    }

/** The SoH band's gauge color (web `sohColor`). */
@Composable
private fun sohColor(band: SohBand): Color =
    when (band) {
        SohBand.Excellent -> TeslaTokens.status.success
        SohBand.Good -> TeslaTokens.status.warning
        SohBand.Degraded -> TeslaTokens.status.danger
    }

/** The SoH band's badge variant (web success / warning / danger). */
private fun sohBadgeVariant(band: SohBand): BadgeVariant =
    when (band) {
        SohBand.Excellent -> BadgeVariant.Success
        SohBand.Good -> BadgeVariant.Warning
        SohBand.Degraded -> BadgeVariant.Danger
    }

/** A score band's color (web `riskScoreColor` / `scoreVariant`). */
@Composable
private fun scoreColor(band: ScoreBand): Color =
    when (band) {
        ScoreBand.Good -> TeslaTokens.status.success
        ScoreBand.Warning -> TeslaTokens.status.warning
        ScoreBand.Bad -> TeslaTokens.status.danger
    }

/** A score band's badge variant (web success / warning / danger). */
private fun scoreBadgeVariant(band: ScoreBand): BadgeVariant =
    when (band) {
        ScoreBand.Good -> BadgeVariant.Success
        ScoreBand.Warning -> BadgeVariant.Warning
        ScoreBand.Bad -> BadgeVariant.Danger
    }

/** The stress band's accent color (web `green` / `amber` / `red`). */
@Composable
private fun stressColor(band: StressBand): Color =
    when (band) {
        StressBand.Low -> TeslaTokens.status.success
        StressBand.Medium -> TeslaTokens.status.warning
        StressBand.High -> TeslaTokens.status.danger
        StressBand.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The stress band's banner tone (web success / warning / danger). */
private fun stressTone(band: StressBand): Tone =
    when (band) {
        StressBand.Low -> Tone.Success
        StressBand.Medium -> Tone.Warning
        StressBand.High -> Tone.Danger
        StressBand.Unknown -> Tone.Info
    }

/** The glyph for a risk-factor icon key (web `riskFactorIcon`). */
private fun riskGlyph(icon: RiskIcon): ImageVector =
    when (icon) {
        RiskIcon.FastCharge -> BatteryDegradationGlyphs.Bolt
        RiskIcon.HighSoc -> BatteryDegradationGlyphs.Battery
        RiskIcon.Temperature -> BatteryDegradationGlyphs.Thermometer
        RiskIcon.CycleCount -> BatteryDegradationGlyphs.Activity
        RiskIcon.DeepDischarge -> BatteryDegradationGlyphs.TrendingDown
        RiskIcon.Generic -> BatteryDegradationGlyphs.Shield
    }

/** Humanizes a risk-factor name (web `rf.name.replace(/_/g, ' ')`, title-cased). */
private fun humanizeRiskName(name: String): String =
    name.split('_').filter { it.isNotBlank() }.joinToString(" ") { word ->
        word.replaceFirstChar { it.uppercaseChar() }
    }

/** The battery-age label (web `ageLabel`): months, or `{{y}} years` / `{{y}}y {{m}}m` past a year. */
@Composable
private fun batteryAgeLabel(months: Int): String =
    if (months < MONTHS_IN_YEAR) {
        stringResource(R.string.translation___count___months, months.toString())
    } else {
        val years = months / MONTHS_IN_YEAR
        val rem = months % MONTHS_IN_YEAR
        if (rem > 0) {
            stringResource(R.string.translation___y__y___m__m, years.toString(), rem.toString())
        } else {
            stringResource(R.string.translation___y___years, years.toString())
        }
    }

/** Builds the forecast sentence (web `predictionDesc 80% inApprox ~X years (date)`). */
private fun buildPredictionSentence(
    desc: String,
    inApprox: String,
    years: String,
    yearsValue: String,
    predictedDate: String?,
): String {
    val core = "$desc 80% $inApprox ~$yearsValue $years"
    return if (!predictedDate.isNullOrBlank()) "$core ($predictedDate)" else core
}

/** Builds the charging-impact banner title (web `${pct}% fast charges, ${deep} deep discharges — ${stress} stress`). */
private fun buildImpactTitle(
    fastPct: Int,
    fastLabel: String,
    deep: Int,
    deepLabel: String,
    stress: String,
    stressLabel: String,
): String = "$fastPct$PERCENT_UNIT $fastLabel, $deep $deepLabel \u2014 $stress $stressLabel"

private const val MONTHS_IN_YEAR = 12
