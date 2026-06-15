// The native Jetpack Compose + Material 3 BatteryHealthPage surface — a parity port of
// web/src/features/battery/pages/BatteryHealthPage.tsx, the battery degradation / prediction / charging-habits &
// longevity dashboard. It reproduces the page's twenty-seven panels (the state-of-health hero with its four radial
// gauges + years-to-80, the three metric bars, the seven summary metric cards, the thermal-monitoring panel with its
// four cards, the smart-insights list, the capacity-trend + range-trend charts, the charge-level distribution with its
// habit stats, the new-vs-now comparison with its four cards, the AC/DC pie + charging-statistics, the quick links and
// the recommendations), every data state (loading / empty / error / success, plus the cache-then-network stale/offline
// tier), and every visible string (resolved from the generated res/values catalog `battery.*` / `common.*`, ADR-014).
//
// Composition: [BatteryHealthPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the four feeds + the live display preferences); [BatteryHealthPageContent]
// is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle scope picker — then the
// loading / error / empty / loaded body gated on the primary battery-health feed). The loaded body draws every panel
// from the decoded models; all decode + derivation lives in the framework-free model (BatteryHealthPageModel.kt), so
// this file only resolves i18n + draws. SI values are converted to the user's units only here at the display boundary
// via the model's `prefs.fromKm`/`prefs.temperature` (Phase-48 SI-canonical); capacity (kWh) renders verbatim.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.battery.batteryhealth

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
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
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.navigation.navTitleRes
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Radial-gauge ceilings (web `RadialGauge max`). */
private const val SOH_MAX = 100.0
private const val CAPACITY_MAX = 100.0
private const val DEGRADATION_MAX = 10.0
private const val CYCLES_MAX = 1500.0

/** Battery health tiers (web `healthVariant`/`gaugeColor`). */
private const val SOH_EXCELLENT = 90.0
private const val SOH_GOOD = 70.0

/** Degradation color thresholds (web `degradationColor`). */
private const val DEG_LOW = 5.0
private const val DEG_MID = 15.0

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Unit symbols the web reads as literals (never i18n): `kWh`, plus the `%`, `%/yr`, `/100` gauge suffixes + AC/DC. */
private const val ENERGY_UNIT = "kWh"
private const val PERCENT_UNIT = "%"
private const val PER_YEAR_SUFFIX = "%/yr"
private const val SOH_UNIT = "/100"
private const val AC_LABEL = "AC"
private const val DC_LABEL = "DC"

/** Decimals matching the web `fmtNumber(value, n)` calls. */
private const val CAPACITY_DECIMALS = 1
private const val DEGRADATION_DECIMALS = 2
private const val PIE_DECIMALS = 1

private val GAUGE_SIZE = 112.dp
private val PIE_SIZE = 168.dp
private val PIE_RING = 28.dp
private val LEGEND_DOT = 10.dp
private val DIVIDER_SPACE = 4.dp
private const val PIE_START_ANGLE = -90f
private const val PIE_FULL_SWEEP = 360f

/** The six related-page shortcuts the quick-links panel renders (web `QUICK_LINKS`), by canonical destination id. */
private val QUICK_LINK_IDS =
    listOf("batteryCells", "batteryDegradation", "energyFlow", "projectedRange", "vampireDrain", "sleepEfficiency")

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [BatteryHealthPageViewModel] over the supplied [source] (the host wires the shared
 * Energy/Settings holders + the page-local charging repository + the active-vehicle selection via
 * [batteryHealthPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun BatteryHealthPage(
    source: BatteryHealthPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: BatteryHealthPageViewModel =
        viewModel(
            key = BatteryHealthPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { BatteryHealthPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val health by viewModel.health.collectAsStateWithLifecycle()
    val degradation by viewModel.degradation.collectAsStateWithLifecycle()
    val sessions by viewModel.sessions.collectAsStateWithLifecycle()
    val telemetry by viewModel.telemetry.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    BatteryHealthPageContent(
        health = health,
        degradation = degradation,
        sessions = sessions,
        telemetry = telemetry,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner), then the battery-health-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, an empty-state when no snapshot exists, or the loaded panels otherwise. The secondary panels each render
 * their own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun BatteryHealthPageContent(
    health: UiState<BatteryHealth>,
    degradation: UiState<BatteryDegradation>,
    sessions: UiState<List<ChargingSessionRow>>,
    telemetry: UiState<ChargingTelemetrySnapshot>,
    prefs: BatteryDisplayPrefs,
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
        BatteryChrome(health = health)

        when {
            health.isLoading -> BatteryLoading()
            health.isError -> BatteryError(onRetry = onRetry)
            health.isEmpty -> BatteryNoData()
            else ->
                BatteryBody(
                    health = health.data ?: BatteryHealth.EMPTY,
                    degradation = degradation,
                    sessions = sessions,
                    telemetry = telemetry,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker, and the stale banner. */
@Composable
private fun BatteryChrome(health: UiState<BatteryHealth>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_battery_title))
                BodyText(
                    stringResource(R.string.translation_battery_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = health.fetchedAt,
                isFetching = health.refreshing,
                isStale = health.stale,
                isError = health.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        VehicleSelect(withIcon = true)
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (health.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `BatteryHealthSkeleton`). */
@Composable
private fun BatteryLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun BatteryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the web `<EmptyState … />` shown when no battery-health snapshot exists for the scope. */
@Composable
private fun BatteryNoData() {
    EmptyState(
        message = stringResource(R.string.translation_battery_empty),
        icon = BatteryGlyphs.Battery,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun BatteryBody(
    health: BatteryHealth,
    degradation: UiState<BatteryDegradation>,
    sessions: UiState<List<ChargingSessionRow>>,
    telemetry: UiState<ChargingTelemetrySnapshot>,
    prefs: BatteryDisplayPrefs,
) {
    val sessionRows = sessions.data
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn {
            SectionBoundary(stringResource(R.string.translation_battery_section_heroFailed), errored = false) {
                HealthHeroPanel(health, degradation.data?.prediction, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS) {
            SectionBoundary(stringResource(R.string.translation_battery_section_metricBarsFailed), errored = false) {
                MetricBarsPanel(health, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            SectionBoundary(stringResource(R.string.translation_battery_section_summaryCardsFailed), errored = false) {
                SummaryCardsGrid(health, telemetry.data, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 3) {
            SectionBoundary(stringResource(R.string.translation_battery_section_thermalFailed), telemetry.isError) {
                ThermalPanel(telemetry.data, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 3) {
            SectionBoundary(stringResource(R.string.translation_battery_section_insightsFailed), sessions.isError) {
                InsightsSection(health, sessionRows, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 4) { CapacityTrendPanel(health, degradation.data?.prediction, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { RangeTrendPanel(health, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) {
            SectionBoundary(stringResource(R.string.translation_battery_section_chargeDistFailed), sessions.isError) {
                ChargeLevelPanel(sessionRows, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 7) {
            SectionBoundary(stringResource(R.string.translation_battery_section_capacityRangeFailed), errored = false) {
                NewVsNowPanel(health, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 8) {
            SectionBoundary(stringResource(R.string.translation_battery_section_acdcFailed), sessions.isError) {
                AcDcSection(sessionRows, health, prefs)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 9) {
            SectionBoundary(stringResource(R.string.translation_battery_section_quickLinksFailed), errored = false) {
                QuickLinksPanel()
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 10) {
            SectionBoundary(stringResource(R.string.translation_battery_section_recommendationsFailed), errored = false) {
                RecommendationsPanel(health)
            }
        }
    }
}

// ── Panel 1 — State-of-Health hero (4 gauges + years-to-80) ─────────────────────────────────────────────────────

/** GlassPanel1 — the health hero: SoH / Capacity / Degradation / Cycles gauges + the years-to-80 figure. */
@Composable
private fun HealthHeroPanel(
    health: BatteryHealth,
    prediction: DegradationPrediction?,
    prefs: BatteryDisplayPrefs,
) {
    val yearsTo80 =
        if (prediction?.trustworthy == true && prediction.yearsTo80Pct != null) {
            prefs.number(prediction.yearsTo80Pct, CAPACITY_DECIMALS)
        } else {
            EM_DASH
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GaugeCell(modifier = Modifier.weight(1f)) {
                io.teslasync.android.components.charts.RadialGauge(
                    value = health.currentSoh,
                    max = SOH_MAX,
                    label = stringResource(R.string.translation_battery_gauge_health),
                    unit = SOH_UNIT,
                    color = gaugeColor(health.currentSoh),
                    size = GAUGE_SIZE,
                )
                Badge(text = healthLabel(health.currentSoh), variant = healthVariant(health.currentSoh))
            }
            GaugeCell(modifier = Modifier.weight(1f)) {
                io.teslasync.android.components.charts.RadialGauge(
                    value = health.capacityPercent,
                    max = CAPACITY_MAX,
                    label = stringResource(R.string.translation_battery_gauge_capacity),
                    unit = PERCENT_UNIT,
                    color = TeslaTokens.chart.regen,
                    size = GAUGE_SIZE,
                )
            }
        }
        Spacer(Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GaugeCell(modifier = Modifier.weight(1f)) {
                io.teslasync.android.components.charts.RadialGauge(
                    value = health.degradationRateYr,
                    max = DEGRADATION_MAX,
                    label = stringResource(R.string.translation_battery_gauge_degradation),
                    unit = PER_YEAR_SUFFIX,
                    color = degradationColor(health.degradationRateYr),
                    size = GAUGE_SIZE,
                )
            }
            GaugeCell(modifier = Modifier.weight(1f)) {
                io.teslasync.android.components.charts.RadialGauge(
                    value = health.totalCycles,
                    max = CYCLES_MAX,
                    label = stringResource(R.string.translation_battery_gauge_cycles),
                    unit = "",
                    color = TeslaTokens.chart.power,
                    size = GAUGE_SIZE,
                )
            }
        }
        Spacer(Modifier.height(Spacing.md))
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricValue(yearsTo80)
            MetricLabel(stringResource(R.string.translation_battery_yearsTo80))
            Caption(stringResource(R.string.translation_battery_warrantyNote))
        }
    }
}

// ── Panel 2 — Metric bars ───────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel2 — the three metric bars: current capacity, degradation, and charge cycles vs the warranty limit. */
@Composable
private fun MetricBarsPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Column {
                MetricBar(
                    value = health.capacityPercent,
                    max = CAPACITY_MAX,
                    label = stringResource(R.string.translation_battery_bar_capacity),
                    color = TeslaTokens.chart.regen,
                )
                HelperText(
                    "${prefs.number(health.estimatedCapacityKwh, CAPACITY_DECIMALS)} / " +
                        "${prefs.number(health.originalCapacityKwh, CAPACITY_DECIMALS)} $ENERGY_UNIT",
                )
            }
            Column {
                MetricBar(
                    value = health.degradationRateYr,
                    max = DEGRADATION_MAX,
                    label = stringResource(R.string.translation_battery_bar_degradation),
                    color = degradationColor(health.degradationRateYr),
                )
                HelperText(
                    "${prefs.number(health.degradationRateYr, DEGRADATION_DECIMALS)}$PERCENT_UNIT " +
                        stringResource(R.string.translation_battery_perYear),
                )
            }
            Column {
                MetricBar(
                    value = health.totalCycles,
                    max = CYCLES_MAX,
                    label = stringResource(R.string.translation_battery_bar_cycles),
                    color = TeslaTokens.chart.power,
                )
                HelperText(stringResource(R.string.translation_battery_warrantyLimit))
            }
        }
    }
}

// ── Panels 3-9 — Summary metric cards ───────────────────────────────────────────────────────────────────────────

/** State-of-Health / Current-Capacity / Original-Capacity / Degradation / Cycles / Age / Full-Charge cards. */
@Composable
private fun SummaryCardsGrid(
    health: BatteryHealth,
    telemetry: ChargingTelemetrySnapshot?,
    prefs: BatteryDisplayPrefs,
) {
    val fullCharge =
        when (telemetry?.bmsFullchargeComplete) {
            null -> EM_DASH
            true -> stringResource(R.string.translation_common_yes)
            false -> stringResource(R.string.translation_common_no)
        }
    val age =
        if (health.batteryAgeMonths > 0) {
            "${health.batteryAgeMonths} ${stringResource(R.string.translation_battery_months)}"
        } else {
            EM_DASH
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_soh),
                value = prefs.percent(health.currentSoh),
                icon = BatteryGlyphs.Heart,
                accent = TeslaTokens.chart.regen,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_currentCap),
                value = "${prefs.number(health.estimatedCapacityKwh, CAPACITY_DECIMALS)} $ENERGY_UNIT",
                icon = BatteryGlyphs.Battery,
                accent = TeslaTokens.chart.battery,
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_originalCap),
                value = "${prefs.number(health.originalCapacityKwh, CAPACITY_DECIMALS)} $ENERGY_UNIT",
                icon = BatteryGlyphs.BatteryFull,
                accent = TeslaTokens.chart.speed,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_degradation),
                value = "${prefs.number(health.degradationRateYr, DEGRADATION_DECIMALS)}$PERCENT_UNIT/" +
                    stringResource(R.string.translation_battery_yr),
                icon = BatteryGlyphs.Gauge,
                accent = TeslaTokens.chart.energy,
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_cycles),
                value = prefs.integer(health.totalCycles),
                icon = BatteryGlyphs.Refresh,
                accent = TeslaTokens.chart.power,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_age),
                value = age,
                icon = BatteryGlyphs.Clock,
                accent = TeslaTokens.chart.temperature,
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_battery_metric_fullChargeComplete),
                value = fullCharge,
                icon = BatteryGlyphs.CheckCircle,
                accent = if (telemetry?.bmsFullchargeComplete == true) TeslaTokens.chart.battery else TeslaTokens.chart.regen,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

// ── Panel 10 — Thermal monitoring (+ panels 11-14) ──────────────────────────────────────────────────────────────

/** GlassPanel10 — the thermal panel: Module-Temp-Max / Module-Temp-Min / Battery-Heater / Temperature-Spread cards. */
@Composable
private fun ThermalPanel(
    telemetry: ChargingTelemetrySnapshot?,
    prefs: BatteryDisplayPrefs,
) {
    val unit = prefs.temperatureLabel
    val maxValue =
        telemetry?.moduleTempMaxC?.let { "${prefs.number(prefs.temperature(it), CAPACITY_DECIMALS)} $unit" } ?: EM_DASH
    val minValue =
        telemetry?.moduleTempMinC?.let { "${prefs.number(prefs.temperature(it), CAPACITY_DECIMALS)} $unit" } ?: EM_DASH
    val spread =
        telemetry?.let { snap ->
            val hi = snap.moduleTempMaxC
            val lo = snap.moduleTempMinC
            if (hi != null && lo != null) {
                "${prefs.number(prefs.temperature(hi) - prefs.temperature(lo), CAPACITY_DECIMALS)} $unit"
            } else {
                null
            }
        } ?: EM_DASH
    val heater =
        when (telemetry?.batteryHeaterOn) {
            null -> EM_DASH
            true -> stringResource(R.string.translation_common_on)
            false -> stringResource(R.string.translation_common_off)
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(BatteryGlyphs.Thermometer, stringResource(R.string.translation_battery_thermal_title), TeslaTokens.chart.energy)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricRow {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_thermal_moduleTempMax),
                    value = maxValue,
                    subtitle = telemetry?.numModuleTempMax?.let {
                        stringResource(R.string.translation_battery_thermal_moduleNumber, it.toString())
                    },
                    icon = BatteryGlyphs.ThermometerSun,
                    accent = TeslaTokens.chart.energy,
                )
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_thermal_moduleTempMin),
                    value = minValue,
                    subtitle = telemetry?.numModuleTempMin?.let {
                        stringResource(R.string.translation_battery_thermal_moduleNumber, it.toString())
                    },
                    icon = BatteryGlyphs.ThermometerSnowflake,
                    accent = TeslaTokens.chart.regen,
                )
            }
            MetricRow {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_thermal_heater),
                    value = heater,
                    icon = BatteryGlyphs.Flame,
                    accent = if (telemetry?.batteryHeaterOn == true) TeslaTokens.chart.temperature else TeslaTokens.chart.battery,
                )
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_thermal_tempSpread),
                    value = spread,
                    icon = BatteryGlyphs.Activity,
                    accent = TeslaTokens.chart.power,
                )
            }
        }
    }
}

// ── Panel 15 — Smart insights ───────────────────────────────────────────────────────────────────────────────────

/** GlassPanel15 — the smart-insights list (web `buildInsights`), or the empty-state when there is not enough data. */
@Composable
private fun InsightsSection(
    health: BatteryHealth,
    sessions: List<ChargingSessionRow>?,
    prefs: BatteryDisplayPrefs,
) {
    val insights = remember(health, sessions) { buildInsights(health, sessions) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(BatteryGlyphs.Heart, stringResource(R.string.translation_battery_insights_title), TeslaTokens.chart.temperature)
        if (insights.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                insights.forEach { InsightCard(it, prefs) }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_battery_insights_empty),
                icon = BatteryGlyphs.Info,
            )
        }
    }
}

/** One insight card — an accented panel with the kind's icon, localized title and interpolated description. */
@Composable
private fun InsightCard(
    insight: BatteryInsight,
    prefs: BatteryDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md, accent = insightAccent(insight.status)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                imageVector = insightIcon(insight.kind),
                contentDescription = null,
                tint = insightTint(insight.status),
                size = IconSize.Sm,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(insightTitle(insight.kind))
                HelperText(insightDescription(insight, prefs))
            }
        }
    }
}

// ── Panel 16 — Capacity trend & prediction ──────────────────────────────────────────────────────────────────────

/** Capacity-Trend-Prediction — the web composed `ChartContainer`: actual + projected SoH, or the no-trend empty-state. */
@Composable
private fun CapacityTrendPanel(
    health: BatteryHealth,
    prediction: DegradationPrediction?,
    prefs: BatteryDisplayPrefs,
) {
    val data = remember(health, prediction) { predictionChartData(health, prediction) }
    val ready = data.isNotEmpty()
    val actualLabel = stringResource(R.string.translation_battery_chart_actual)
    val predictedLabel = stringResource(R.string.translation_battery_chart_predicted)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_battery_chart_capacityTrend),
        subtitle = stringResource(R.string.translation_battery_chart_dashedProjected),
        accessibleDescription = stringResource(R.string.translation_battery_chart_capacityTrend_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_battery_chart_noTrend),
    ) {
        ComboChart(
            series =
                listOf(
                    ChartSeries(
                        key = "actual",
                        label = actualLabel,
                        values = data.map { it.actual },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.regen,
                    ),
                    ChartSeries(
                        key = "predicted",
                        label = predictedLabel,
                        values = data.map { it.predicted },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.speed,
                    ),
                ),
            xLabels = data.map { it.label },
            yValueFormatter = { "${prefs.integer(it)}$PERCENT_UNIT" },
        )
    }
}

// ── Panel 17 — Estimated range over time ────────────────────────────────────────────────────────────────────────

/** Estimated-Range-Over-Time — the web area `ChartContainer`: per-snapshot range, or the no-range empty-state. */
@Composable
private fun RangeTrendPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    val data = remember(health, prefs) { rangeTrend(health, prefs) }
    val ready = data.isNotEmpty()
    val rangeLabel = "${stringResource(R.string.translation_battery_chart_range)} (${prefs.distanceLabel})"
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_battery_chart_rangeTrend),
        accessibleDescription = stringResource(R.string.translation_battery_chart_rangeTrend_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_battery_chart_noRange),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "range",
                        label = rangeLabel,
                        values = data.map { it.rangeDisplay },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.battery,
                    ),
                ),
            xLabels = data.map { it.label },
            yValueFormatter = { prefs.integer(it) },
        )
    }
}

// ── Panel 18 — Charge level distribution ────────────────────────────────────────────────────────────────────────

/** GlassPanel18 — the charge-level distribution bar chart + the four charging-habit stats, or the no-sessions empty. */
@Composable
private fun ChargeLevelPanel(
    sessions: List<ChargingSessionRow>?,
    prefs: BatteryDisplayPrefs,
) {
    val rows = sessions.orEmpty()
    val dist = remember(rows) { chargeLevelDistribution(rows) }
    val habits = remember(rows) { chargingHabits(rows) }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(BatteryGlyphs.Bolt, contentDescription = null, tint = TeslaTokens.chart.energy, size = IconSize.Sm)
            SectionTitle(stringResource(R.string.translation_battery_chart_chargeDist))
            Caption(stringResource(R.string.translation_battery_chart_chargeDistSub))
        }
        Spacer(Modifier.height(Spacing.md))
        if (dist.isNotEmpty()) {
            BarChartWrapper(
                series =
                    listOf(
                        ChartSeries(
                            key = "startCount",
                            label = stringResource(R.string.translation_battery_chart_chargeStarted),
                            values = dist.map { it.startCount.asDouble() },
                            kind = ChartSeriesKind.Bar,
                            color = TeslaTokens.chart.temperature,
                        ),
                        ChartSeries(
                            key = "endCount",
                            label = stringResource(R.string.translation_battery_chart_chargeEnded),
                            values = dist.map { it.endCount.asDouble() },
                            kind = ChartSeriesKind.Bar,
                            color = TeslaTokens.chart.battery,
                        ),
                    ),
                xLabels = dist.map { it.range },
                yValueFormatter = { prefs.integer(it) },
            )
            if (habits != null) {
                Spacer(Modifier.height(Spacing.md))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    HabitStat(
                        modifier = Modifier.weight(1f),
                        value = prefs.percent(habits.avgStart),
                        label = stringResource(R.string.translation_battery_habit_avgStart),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    HabitStat(
                        modifier = Modifier.weight(1f),
                        value = prefs.percent(habits.avgEnd),
                        label = stringResource(R.string.translation_battery_habit_avgEnd),
                        color = TeslaTokens.chart.battery,
                    )
                    HabitStat(
                        modifier = Modifier.weight(1f),
                        value = habits.superchargerCount.toString(),
                        label = stringResource(R.string.translation_battery_habit_supercharger),
                        color = TeslaTokens.chart.energy,
                    )
                    HabitStat(
                        modifier = Modifier.weight(1f),
                        value = habits.homeCount.toString(),
                        label = stringResource(R.string.translation_battery_habit_home),
                        color = TeslaTokens.chart.regen,
                    )
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_battery_chart_noSessions),
                icon = BatteryGlyphs.Bolt,
            )
        }
    }
}

// ── Panels 19-23 — Capacity & range: new vs now ─────────────────────────────────────────────────────────────────

/** GlassPanel19 — the new-vs-now comparison wrapping the four capNew / capNow / rangeNew / rangeNow cards. */
@Composable
private fun NewVsNowPanel(
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    val unit = prefs.distanceLabel
    val rangeNew = health.history.firstOrNull()?.rangeKm
    val rangeNow = health.history.lastOrNull()?.rangeKm
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(BatteryGlyphs.Activity, stringResource(R.string.translation_battery_newVsNow_title), TeslaTokens.chart.regen)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricRow {
                NewVsNowCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_newVsNow_capNew),
                    value = prefs.number(health.originalCapacityKwh, CAPACITY_DECIMALS),
                    unit = ENERGY_UNIT,
                    valueColor = MaterialTheme.colorScheme.onSurface,
                )
                NewVsNowCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_newVsNow_capNow),
                    value = prefs.number(health.estimatedCapacityKwh, CAPACITY_DECIMALS),
                    unit = ENERGY_UNIT,
                    valueColor = TeslaTokens.chart.regen,
                    delta = "-${prefs.number(health.originalCapacityKwh - health.estimatedCapacityKwh, CAPACITY_DECIMALS)} $ENERGY_UNIT",
                )
            }
            MetricRow {
                NewVsNowCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_newVsNow_rangeNew),
                    value = rangeNew?.let { prefs.integer(prefs.fromKm(it)) } ?: EM_DASH,
                    unit = unit,
                    valueColor = MaterialTheme.colorScheme.onSurface,
                )
                NewVsNowCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_battery_newVsNow_rangeNow),
                    value = rangeNow?.let { prefs.integer(prefs.fromKm(it)) } ?: EM_DASH,
                    unit = unit,
                    valueColor = TeslaTokens.chart.battery,
                    delta =
                        if (health.history.size >= 2 && rangeNew != null && rangeNow != null) {
                            "-${prefs.integer(prefs.fromKm(rangeNew - rangeNow))} $unit " +
                                stringResource(R.string.translation_battery_newVsNow_lost)
                        } else {
                            null
                        },
                )
            }
        }
    }
}

// ── Panels 24-25 — AC/DC energy breakdown + charging statistics ─────────────────────────────────────────────────

/** AC-DC-Energy-Breakdown (pie) + GlassPanel25 (charging statistics) — the web two-column section. */
@Composable
private fun AcDcSection(
    sessions: List<ChargingSessionRow>?,
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    val rows = sessions.orEmpty()
    val breakdown = remember(rows) { energyBreakdown(rows) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        ChartContainer(
            modifier = Modifier.fillMaxWidth(),
            title = stringResource(R.string.translation_battery_chart_acdc),
            accessibleDescription = stringResource(R.string.translation_battery_chart_acdc_aria),
            status = if (breakdown != null) ChartStatus.Ready else ChartStatus.Empty,
            emptyMessage = stringResource(R.string.translation_battery_chart_noBreakdown),
        ) {
            if (breakdown != null) AcDcPie(breakdown, prefs)
        }
        ChargingStatsPanel(breakdown, health, prefs)
    }
}

/** GlassPanel25 — the charging-statistics rows, or the empty-state when no sessions exist. */
@Composable
private fun ChargingStatsPanel(
    breakdown: EnergyBreakdown?,
    health: BatteryHealth,
    prefs: BatteryDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(BatteryGlyphs.Gauge, stringResource(R.string.translation_battery_stats_title), TeslaTokens.chart.power)
        Spacer(Modifier.height(Spacing.md))
        if (breakdown != null) {
            Column {
                StatRow(stringResource(R.string.translation_battery_stats_totalSessions), breakdown.totalSessions.toString())
                StatRow(stringResource(R.string.translation_battery_stats_acSessions), breakdown.acCount.toString())
                StatRow(stringResource(R.string.translation_battery_stats_dcSessions), breakdown.dcCount.toString())
                StatRow(
                    stringResource(R.string.translation_battery_stats_totalEnergy),
                    "${prefs.number(breakdown.totalEnergyKwh, PIE_DECIMALS)} $ENERGY_UNIT",
                )
                StatRow(stringResource(R.string.translation_battery_stats_cycles), prefs.integer(health.totalCycles))
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_battery_stats_empty),
                icon = BatteryGlyphs.Activity,
            )
        }
    }
}

/** The AC/DC donut + legend (the A3 chart library carries no pie wrapper — a Compose-native Canvas, never a webview). */
@Composable
private fun AcDcPie(
    breakdown: EnergyBreakdown,
    prefs: BatteryDisplayPrefs,
) {
    val acColor = TeslaTokens.chart.battery
    val dcColor = TeslaTokens.chart.energy
    val values = breakdown.pieValues
    val total = values.sum().toFloat().coerceAtLeast(1f)
    val description =
        "$AC_LABEL ${prefs.number(values[0], PIE_DECIMALS)} $ENERGY_UNIT, " +
            "$DC_LABEL ${prefs.number(values[1], PIE_DECIMALS)} $ENERGY_UNIT"
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(modifier = Modifier.size(PIE_SIZE)) {
                val strokePx = PIE_RING.toPx()
                val diameter = size.minDimension - strokePx
                val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                val arcSize = Size(diameter, diameter)
                var startAngle = PIE_START_ANGLE
                listOf(acColor to values[0], dcColor to values[1]).forEach { (color, value) ->
                    val sweep = value.toFloat() / total * PIE_FULL_SWEEP
                    drawArc(
                        color = color,
                        startAngle = startAngle,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = strokePx),
                    )
                    startAngle += sweep
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            LegendRow(acColor, "$AC_LABEL ${prefs.number(values[0], PIE_DECIMALS)} $ENERGY_UNIT")
            LegendRow(dcColor, "$DC_LABEL ${prefs.number(values[1], PIE_DECIMALS)} $ENERGY_UNIT")
        }
    }
}

// ── Panel 26 — Quick links ──────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel26 — the six related-page shortcut buttons (web `QUICK_LINKS`). */
@Composable
private fun QuickLinksPanel() {
    val router = LocalDeepLinkRouter.current
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            QUICK_LINK_IDS.forEach { id ->
                val webPath = Destinations.find(id)?.webPath
                Button(
                    label = stringResource(navTitleRes(id)),
                    onClick = { webPath?.let { router?.request("${RouteTable.APP_SCHEME}://app$it") } },
                    modifier = Modifier.fillMaxWidth(),
                    variant = ButtonVariant.Outline,
                    leadingIcon = BatteryGlyphs.ArrowRight,
                )
            }
        }
    }
}

// ── Panel 27 — Recommendations ──────────────────────────────────────────────────────────────────────────────────

/** GlassPanel27 — the longevity recommendation tips (web `buildRecommendations`). */
@Composable
private fun RecommendationsPanel(health: BatteryHealth) {
    val tips = remember(health) { buildRecommendations(health) }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Success) {
        Badge(
            text = stringResource(R.string.translation_battery_recommendations_title),
            variant = BadgeVariant.Success,
        )
        Spacer(Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            tips.forEach { tip ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Icon(
                        imageVector = BatteryGlyphs.Lightbulb,
                        contentDescription = null,
                        tint = TeslaTokens.status.success,
                        size = IconSize.Sm,
                    )
                    BodyText(
                        recommendationText(tip),
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A lightweight section boundary mirroring the web `SectionErrorBoundary`: renders [content] normally, or — when its
 * backing feed has [errored] — a localized failure card titled [fallbackTitle] (the web `fallbackTitle` prop, always
 * resolved). Never hides the section.
 */
@Composable
private fun SectionBoundary(
    fallbackTitle: String,
    errored: Boolean,
    content: @Composable () -> Unit,
) {
    if (errored) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Danger) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(BatteryGlyphs.AlertTriangle, contentDescription = null, tint = TeslaTokens.status.danger, size = IconSize.Sm)
                PanelTitle(fallbackTitle)
            }
        }
    } else {
        content()
    }
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

/** A centered gauge cell (web hero gauge column): the gauge plus any trailing badge, centered in its weighted slot. */
@Composable
private fun GaugeCell(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        content = content,
    )
}

/** A section header — an accented icon plus a [SectionTitle] (web `section-title` h3 with a leading icon). */
@Composable
private fun SectionHeader(
    icon: ImageVector,
    title: String,
    tint: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Icon(icon, contentDescription = null, tint = tint, size = IconSize.Sm)
        SectionTitle(title)
    }
}

/** A centered habit stat (web charge-habit cell): a colored value over a muted label. */
@Composable
private fun HabitStat(
    value: String,
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        ColoredMetricValue(value, color)
        MetricLabel(label)
    }
}

/** A centered new-vs-now card (web inner GlassPanel): label, colored value + unit, and an optional delta caption. */
@Composable
private fun NewVsNowCard(
    label: String,
    value: String,
    unit: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
    delta: String? = null,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            MetricLabel(label)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(DIVIDER_SPACE)) {
                ColoredMetricValue(
                    value,
                    valueColor,
                    modifier = Modifier.semantics { contentDescription = "$label $value $unit" },
                )
                Caption(unit)
            }
            if (delta != null) Caption(delta)
        }
    }
}

/** One legend row — a color swatch + its label (web pie legend). */
@Composable
private fun LegendRow(
    color: Color,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
        Caption(label)
    }
}

/** One charging-statistics row — a muted label and an emphasized value, divided from the next (web bordered rows). */
@Composable
private fun StatRow(
    label: String,
    value: String,
) {
    Column {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BodyText(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            BodyText(value)
        }
        HorizontalDivider()
    }
}

/** An emphasized metric value tinted to a semantic [color] (web colored stat numbers; no role component takes a color). */
@Composable
private fun ColoredMetricValue(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        color = color,
        modifier = modifier,
    )
}

// ── i18n + color mapping helpers ────────────────────────────────────────────────────────────────────────────────

/** Web `gaugeColor`: ≥90 success, ≥70 warning, else danger. */
@Composable
private fun gaugeColor(score: Double): Color =
    when {
        score >= SOH_EXCELLENT -> TeslaTokens.status.success
        score >= SOH_GOOD -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

/** Web `degradationColor`: ≤5 success, ≤15 warning, else danger. */
@Composable
private fun degradationColor(pct: Double): Color =
    when {
        pct <= DEG_LOW -> TeslaTokens.status.success
        pct <= DEG_MID -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

/** Web `healthVariant`: the badge variant for the state-of-health tier. */
private fun healthVariant(score: Double): BadgeVariant =
    when {
        score >= SOH_EXCELLENT -> BadgeVariant.Success
        score >= SOH_GOOD -> BadgeVariant.Warning
        else -> BadgeVariant.Danger
    }

/** Web `healthLabel`: the localized state-of-health tier label. */
@Composable
private fun healthLabel(score: Double): String =
    when {
        score >= SOH_EXCELLENT -> stringResource(R.string.translation_battery_health_excellent)
        score >= SOH_GOOD -> stringResource(R.string.translation_battery_health_good)
        else -> stringResource(R.string.translation_battery_health_degraded)
    }

/** The panel accent for an insight status (web `insightPanelClass`). */
private fun insightAccent(status: InsightStatus): PanelAccent =
    when (status) {
        InsightStatus.Good -> PanelAccent.Success
        InsightStatus.Warning -> PanelAccent.Warning
        InsightStatus.Critical -> PanelAccent.Danger
    }

/** The icon tint for an insight status (web `insightIconClass`). */
@Composable
private fun insightTint(status: InsightStatus): Color =
    when (status) {
        InsightStatus.Good -> TeslaTokens.status.success
        InsightStatus.Warning -> TeslaTokens.status.warning
        InsightStatus.Critical -> TeslaTokens.status.danger
    }

/** The lucide icon the web pairs with each insight kind. */
private fun insightIcon(kind: BatteryInsightKind): ImageVector =
    when (kind) {
        BatteryInsightKind.ExcellentHealth -> BatteryGlyphs.CheckCircle
        BatteryInsightKind.GoodHealth -> BatteryGlyphs.Info
        BatteryInsightKind.HealthConcern -> BatteryGlyphs.AlertTriangle
        BatteryInsightKind.HighFastCharge -> BatteryGlyphs.AlertTriangle
        BatteryInsightKind.GoodHabits -> BatteryGlyphs.CheckCircle
        BatteryInsightKind.DeepDischarge -> BatteryGlyphs.AlertTriangle
        BatteryInsightKind.HighSupercharger -> BatteryGlyphs.Info
        BatteryInsightKind.LowDegradation -> BatteryGlyphs.Target
    }

/** The localized title for an insight kind (web `t('battery.insight.*Title')`). */
@Composable
private fun insightTitle(kind: BatteryInsightKind): String =
    when (kind) {
        BatteryInsightKind.ExcellentHealth -> stringResource(R.string.translation_battery_insight_excellentTitle)
        BatteryInsightKind.GoodHealth -> stringResource(R.string.translation_battery_insight_goodTitle)
        BatteryInsightKind.HealthConcern -> stringResource(R.string.translation_battery_insight_concernTitle)
        BatteryInsightKind.HighFastCharge -> stringResource(R.string.translation_battery_insight_highFastChargeTitle)
        BatteryInsightKind.GoodHabits -> stringResource(R.string.translation_battery_insight_goodHabitsTitle)
        BatteryInsightKind.DeepDischarge -> stringResource(R.string.translation_battery_insight_deepDischargeTitle)
        BatteryInsightKind.HighSupercharger -> stringResource(R.string.translation_battery_insight_highSuperchargerTitle)
        BatteryInsightKind.LowDegradation -> stringResource(R.string.translation_battery_insight_lowDegTitle)
    }

/** The localized, interpolated description for an insight (web `t('battery.insight.*Desc', { … })`). */
@Composable
private fun insightDescription(
    insight: BatteryInsight,
    prefs: BatteryDisplayPrefs,
): String =
    when (insight.kind) {
        BatteryInsightKind.ExcellentHealth ->
            stringResource(R.string.translation_battery_insight_excellentDesc, prefs.integer(insight.value))
        BatteryInsightKind.GoodHealth ->
            stringResource(R.string.translation_battery_insight_goodDesc, prefs.integer(insight.value))
        BatteryInsightKind.HealthConcern ->
            stringResource(R.string.translation_battery_insight_concernDesc, prefs.integer(insight.value))
        BatteryInsightKind.HighFastCharge ->
            stringResource(R.string.translation_battery_insight_highFastChargeDesc, prefs.percent(insight.value))
        BatteryInsightKind.GoodHabits ->
            stringResource(R.string.translation_battery_insight_goodHabitsDesc)
        BatteryInsightKind.DeepDischarge ->
            stringResource(R.string.translation_battery_insight_deepDischargeDesc, prefs.integer(insight.value))
        BatteryInsightKind.HighSupercharger ->
            stringResource(R.string.translation_battery_insight_highSuperchargerDesc, prefs.integer(insight.value))
        BatteryInsightKind.LowDegradation ->
            stringResource(R.string.translation_battery_insight_lowDegDesc, prefs.number(insight.value, 1))
    }

/** The localized recommendation tip (web `buildRecommendations`). */
@Composable
private fun recommendationText(tip: BatteryRecommendation): String =
    when (tip) {
        BatteryRecommendation.ReduceFast -> stringResource(R.string.translation_battery_tip_reduceFast)
        BatteryRecommendation.Avoid100 -> stringResource(R.string.translation_battery_tip_avoid100)
        BatteryRecommendation.AvoidDeep -> stringResource(R.string.translation_battery_tip_avoidDeep)
        BatteryRecommendation.AboveAvg -> stringResource(R.string.translation_battery_tip_aboveAvg)
        BatteryRecommendation.Great -> stringResource(R.string.translation_battery_tip_great)
    }
