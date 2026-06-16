// The native Jetpack Compose + Material 3 DrivetrainHealthPage surface — a parity port of
// web/src/features/driving/pages/DrivetrainHealthPage.tsx, the motor / inverter / battery thermal-status dashboard. It
// reproduces the page's twelve panels (the health overview alert + hero, the health-score / motor-details / drive-stats
// gauge grid, the four temperature gauges, the six thermal metric cards, the thermal-load indicators, the live-motor
// status, the stator-temperature / torque / temperature-trend / power-output charts, the health recommendations, and
// the temperature/power detail cards), every data state (loading / empty / error / success, plus the cache-then-network
// stale/offline tier), and every visible string (resolved from the generated res/values catalog `drivetrain.*` /
// `common.*`, ADR-014).
//
// Composition: [DrivetrainHealthPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the five feeds + the live display preferences);
// [DrivetrainHealthPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip /
// vehicle scope picker — then the loading / error / empty / loaded body gated on the primary drivetrain-health feed).
// The loaded body draws every panel from the decoded models; all decode + derivation lives in the framework-free model
// (DrivetrainHealthPageModel.kt), so this file only resolves i18n + draws. SI values are converted to the user's units
// only here at the display boundary via the model's `prefs` converters (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LargeClass",
    "LongParameterList",
)

package io.teslasync.android.driving.drivetrainhealth

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Unit symbols the web reads as literals (never i18n): kW / Nm / RPM / kΩ / %. */
private const val KW_UNIT = "kW"
private const val NM_UNIT = "Nm"
private const val RPM_UNIT = "RPM"
private const val KOHM_UNIT = "k\u03A9"
private const val PERCENT_UNIT = "%"

/** Decimals matching the web `fmtNumber(value, n)` calls. */
private const val SPEED_DECIMALS = 1
private const val POWER_DECIMALS = 1
private const val PERCENT_DECIMALS = 1
private const val GAUGE_DECIMALS = 0

/** The four-gauge ceiling for the health score (web `RadialGauge max={100}`). */
private const val HEALTH_SCORE_MAX = 100.0

/** Reads above one drive trace make the per-drive / motor charts meaningful (web `data.length <= 1` guard). */
private const val MIN_CHART_POINTS = 2

private val GAUGE_SIZE = 140.dp
private val SENSOR_GAUGE_SIZE = 112.dp
private val CHART_HEIGHT = 280.dp

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DrivetrainHealthPageViewModel] over the supplied [source] (the host wires the
 * page-local Driving repository + the shared Settings holder + the active-vehicle selection via
 * [drivetrainHealthPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun DrivetrainHealthPage(
    source: DrivetrainHealthPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DrivetrainHealthPageViewModel =
        viewModel(
            key = DrivetrainHealthPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { DrivetrainHealthPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val health by viewModel.health.collectAsStateWithLifecycle()
    val drives by viewModel.drives.collectAsStateWithLifecycle()
    val stats by viewModel.stats.collectAsStateWithLifecycle()
    val motorLatest by viewModel.motorLatest.collectAsStateWithLifecycle()
    val motorHistory by viewModel.motorHistory.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    DrivetrainHealthPageContent(
        health = health,
        drives = drives,
        stats = stats,
        motorLatest = motorLatest,
        motorHistory = motorHistory,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner), then the drivetrain-health-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, an empty-state when no payload exists, or the loaded panels otherwise. The secondary panels each render their
 * own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun DrivetrainHealthPageContent(
    health: UiState<DrivetrainHealth>,
    drives: UiState<List<DriveRow>>,
    stats: UiState<DrivingStatsData>,
    motorLatest: UiState<MotorSnapshotData>,
    motorHistory: UiState<List<MotorSnapshotData>>,
    prefs: DrivetrainDisplayPrefs,
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
        DrivetrainChrome(health = health)

        when {
            health.isLoading -> DrivetrainLoading()
            health.isError -> DrivetrainError(onRetry = onRetry)
            health.isEmpty -> DrivetrainNoData()
            else ->
                DrivetrainBody(
                    health = health.data ?: DrivetrainHealth.EMPTY,
                    drives = drives.data.orEmpty(),
                    stats = stats.data?.takeIf { it.hasData },
                    motorLatest = motorLatest.data?.takeIf { it.hasData },
                    motorHistory = motorHistory.data.orEmpty(),
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker, and the stale banner. */
@Composable
private fun DrivetrainChrome(health: UiState<DrivetrainHealth>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_drivetrain_title))
                BodyText(
                    stringResource(R.string.translation_drivetrain_subtitle),
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
        // web `actions`: the vehicle scope picker (the date-range picker defaults to the web's initial 30-day window).
        VehicleSelect(withIcon = true)
        if (health.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun DrivetrainLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun DrivetrainError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the web `<EmptyState … />` shown when no drivetrain-health payload exists for the scope. */
@Composable
private fun DrivetrainNoData() {
    EmptyState(
        message = stringResource(R.string.translation_drivetrain_noData),
        icon = DrivetrainGlyphs.Gauge,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun DrivetrainBody(
    health: DrivetrainHealth,
    drives: List<DriveRow>,
    stats: DrivingStatsData?,
    motorLatest: MotorSnapshotData?,
    motorHistory: List<MotorSnapshotData>,
    prefs: DrivetrainDisplayPrefs,
) {
    val nowMillis = remember { System.currentTimeMillis() }
    val window = remember(nowMillis) { defaultChartWindow(nowMillis) }
    val sensors = remember(health) { buildSensors(health) }
    val chartData = remember(drives, window, prefs) { buildChartData(drives, window.first, window.last, prefs) }
    val tempTrend = remember(chartData) { temperatureTrend(chartData) }
    val motorChart = remember(motorHistory, prefs) { buildMotorChartData(motorHistory, prefs) }
    val peak = remember(chartData) { peakPower(chartData) }
    val avg = remember(chartData) { averagePower(chartData) }
    val minRegen = remember(chartData) { minRegenPower(chartData) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { HealthOverviewPanel(health) }
        FadeIn(delayMs = FADE_STEP_MS) { HealthGaugeGridPanel(health, sensors, stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { TemperatureGaugesPanel(sensors, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { TemperatureMetricCardsPanel(sensors, health, peak, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { ThermalLoadPanel(sensors, peak, avg, stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { LiveMotorStatusPanel(motorLatest, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { StatorTempChartPanel(motorChart, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { TorqueHistoryChartPanel(motorChart, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { TemperatureTrendChartPanel(tempTrend, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { PowerOutputChartPanel(chartData, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { HealthRecommendationsPanel(health.overallHealth) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { DetailCardsPanel(health, peak, avg, minRegen, stats, prefs) }
    }
}

// ── Panel 1 — Health overview (alert + hero) ────────────────────────────────────────────────────────────────────

/** GlassPanel1 — the elevated-temperature alert (when not good) + the health hero with motor state + score. */
@Composable
private fun HealthOverviewPanel(health: DrivetrainHealth) {
    val status = health.overallHealth
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (status != HealthStatus.Good) {
            AlertBanner(
                modifier = Modifier.fillMaxWidth(),
                tone = if (status == HealthStatus.Critical) Tone.Danger else Tone.Warning,
                title =
                    stringResource(
                        if (status == HealthStatus.Critical) {
                            R.string.translation_drivetrain_alert_criticalTitle
                        } else {
                            R.string.translation_drivetrain_alert_warningTitle
                        },
                    ),
                message =
                    stringResource(
                        if (status == HealthStatus.Critical) {
                            R.string.translation_drivetrain_alert_criticalMsg
                        } else {
                            R.string.translation_drivetrain_alert_warningMsg
                        },
                    ),
                icon = DrivetrainGlyphs.AlertTriangle,
            )
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = panelAccent(status)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (status == HealthStatus.Good) DrivetrainGlyphs.CheckCircle else DrivetrainGlyphs.AlertTriangle,
                    contentDescription = null,
                    tint = healthColor(status),
                    size = IconSize.Xl,
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    SectionTitle(healthHeroTitle(status))
                    Caption("${stringResource(R.string.translation_drivetrain_motorState)}: ${health.motorStatus}")
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Badge(text = healthBadgeText(status), variant = healthBadgeVariant(status), dot = true)
                    AnimatedNumber(value = status.score.asDouble(), suffix = PERCENT_UNIT)
                }
            }
        }
    }
}

// ── Panel 2 — Health-score gauge + motor-details + drive-stats grid ─────────────────────────────────────────────

/** GlassPanel2 — the health-score radial gauge, the motor-details KV list, and the drive-statistics KV list. */
@Composable
private fun HealthGaugeGridPanel(
    health: DrivetrainHealth,
    sensors: List<SensorReading>,
    stats: DrivingStatsData?,
    prefs: DrivetrainDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                RadialGauge(
                    value = health.overallHealth.score.asDouble(),
                    max = HEALTH_SCORE_MAX,
                    label = stringResource(R.string.translation_drivetrain_healthScore),
                    unit = PERCENT_UNIT,
                    color = healthColor(health.overallHealth),
                    size = GAUGE_SIZE,
                )
                Caption(
                    stringResource(R.string.translation_drivetrain_healthScoreDesc),
                    modifier = Modifier.padding(top = Spacing.sm),
                )
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            PanelTitle(stringResource(R.string.translation_drivetrain_motorDetails))
            Spacer(Modifier.height(Spacing.sm))
            KVList(
                items =
                    listOf(
                        KVItem(stringResource(R.string.translation_drivetrain_motorStatus), health.motorStatus),
                        KVItem(stringResource(R.string.translation_drivetrain_overallHealth), healthTierLabel(health.overallHealth)),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_healthScoreLabel),
                            "${health.overallHealth.score}$PERCENT_UNIT",
                        ),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_sensorCount),
                            activeSensorCount(sensors).toString(),
                        ),
                    ),
            )
            Row(
                modifier = Modifier.padding(top = Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(DrivetrainGlyphs.Activity, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = IconSize.Sm)
                Caption(stringResource(R.string.translation_drivetrain_realTime))
            }
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            PanelTitle(stringResource(R.string.translation_drivetrain_driveStats))
            Spacer(Modifier.height(Spacing.sm))
            if (stats != null) {
                KVList(
                    items =
                        listOf(
                            KVItem(stringResource(R.string.translation_drivetrain_totalDrives), prefs.integer(stats.totalDrives.asDouble())),
                            KVItem(
                                stringResource(R.string.translation_drivetrain_totalDistance),
                                "${prefs.integer(prefs.distance(stats.totalDistanceKm))} ${prefs.distanceLabel}",
                            ),
                            KVItem(
                                stringResource(R.string.translation_drivetrain_avgSpeed),
                                "${prefs.number(prefs.speed(stats.avgSpeedKmh), SPEED_DECIMALS)} ${prefs.speedLabel}",
                            ),
                            KVItem(
                                stringResource(R.string.translation_drivetrain_topSpeed),
                                "${prefs.number(prefs.speed(stats.topSpeedKmh), SPEED_DECIMALS)} ${prefs.speedLabel}",
                            ),
                        ),
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_drivetrain_noData))
            }
        }
    }
}

// ── Panel 3 — Temperature gauges ────────────────────────────────────────────────────────────────────────────────

/** GlassPanel3 — the four module-temperature radial gauges with their per-sensor severity color + max caption. */
@Composable
private fun TemperatureGaugesPanel(
    sensors: List<SensorReading>,
    prefs: DrivetrainDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(DrivetrainGlyphs.Thermometer, stringResource(R.string.translation_drivetrain_tempGauges), TeslaTokens.chart.energy)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            sensors.chunked(2).forEach { pair ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    pair.forEach { sensor -> SensorGaugeCell(sensor, prefs, Modifier.weight(1f)) }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SensorGaugeCell(
    sensor: SensorReading,
    prefs: DrivetrainDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        RadialGauge(
            value = sensor.valueC?.let(prefs::temperature) ?: 0.0,
            max = prefs.temperature(sensor.maxTempC),
            label = sensorLabel(sensor.id),
            unit = prefs.temperatureLabel,
            color = severityColor(sensor.severity),
            size = SENSOR_GAUGE_SIZE,
        )
        Caption(
            "${stringResource(R.string.translation_drivetrain_maxLabel)}: " +
                "${prefs.number(prefs.temperature(sensor.maxTempC), GAUGE_DECIMALS)}${prefs.temperatureLabel}",
        )
    }
}

// ── Panel 4 — Temperature metric cards ──────────────────────────────────────────────────────────────────────────

/** GlassPanel4 — the six metric cards (four sensors + health score + peak power), laid out two per row. */
@Composable
private fun TemperatureMetricCardsPanel(
    sensors: List<SensorReading>,
    health: DrivetrainHealth,
    peak: Double,
    prefs: DrivetrainDisplayPrefs,
) {
    val cards: List<@Composable RowScope.() -> Unit> =
        buildList {
            sensors.forEach { sensor ->
                add {
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        label = sensorLabel(sensor.id),
                        value = displayTemp(sensor.valueC, prefs),
                        icon = sensorGlyph(sensor.id),
                        accent = neonAccent(sensor.severity),
                        subtitle = sensorSubtitle(sensor, prefs),
                    )
                }
            }
            add {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_drivetrain_healthScore),
                    value = "${health.overallHealth.score}$PERCENT_UNIT",
                    icon = DrivetrainGlyphs.Heart,
                    accent = healthColor(health.overallHealth),
                )
            }
            add {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_drivetrain_peakPower),
                    value = if (peak > 0.0) "${prefs.integer(peak)} $KW_UNIT" else EM_DASH,
                    icon = DrivetrainGlyphs.Zap,
                    accent = TeslaTokens.chart.power,
                )
            }
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        cards.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                pair.forEach { cell -> cell() }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

// ── Panel 5 — Thermal load indicators ───────────────────────────────────────────────────────────────────────────

/** GlassPanel5 — the four thermal-load metric bars plus the peak/avg-power, drives and regen-ratio inline metrics. */
@Composable
private fun ThermalLoadPanel(
    sensors: List<SensorReading>,
    peak: Double,
    avg: Double,
    stats: DrivingStatsData?,
    prefs: DrivetrainDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(DrivetrainGlyphs.Activity, stringResource(R.string.translation_drivetrain_thermalMetrics), TeslaTokens.chart.speed)
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            sensors.forEach { sensor ->
                MetricBar(
                    value = sensor.valueC ?: 0.0,
                    max = sensor.maxTempC,
                    label = sensorLabel(sensor.id),
                    valueText = displayTemp(sensor.valueC, prefs),
                    color = severityColor(sensor.severity),
                )
            }
        }
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                InlineMetric(
                    modifier = Modifier.weight(1f),
                    icon = DrivetrainGlyphs.Zap,
                    iconContentDescription = null,
                    label = stringResource(R.string.translation_drivetrain_peakPower),
                    value = if (peak > 0.0) "${prefs.integer(peak)} $KW_UNIT" else EM_DASH,
                )
                InlineMetric(
                    modifier = Modifier.weight(1f),
                    icon = DrivetrainGlyphs.TrendingUp,
                    iconContentDescription = null,
                    label = stringResource(R.string.translation_drivetrain_avgPower),
                    value = if (avg > 0.0) "${prefs.number(avg, POWER_DECIMALS)} $KW_UNIT" else EM_DASH,
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                InlineMetric(
                    modifier = Modifier.weight(1f),
                    icon = DrivetrainGlyphs.Activity,
                    iconContentDescription = null,
                    label = stringResource(R.string.translation_drivetrain_drivesLabel),
                    value = stats?.let { prefs.integer(it.totalDrives.asDouble()) } ?: EM_DASH,
                )
                InlineMetric(
                    modifier = Modifier.weight(1f),
                    icon = DrivetrainGlyphs.Shield,
                    iconContentDescription = null,
                    label = stringResource(R.string.translation_drivetrain_regenRatio),
                    value = stats?.let { "${prefs.number(it.regenRatio * 100, PERCENT_DECIMALS)}$PERCENT_UNIT" } ?: EM_DASH,
                )
            }
        }
    }
}

// ── Panel 6 — Live motor status ─────────────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel6 — the live-motor status. When a latest motor snapshot exists it renders the four state cells plus the
 * nine inline metrics; otherwise it shows the "no live motor telemetry" empty state (web `LiveMotorStatus` internal
 * branch) so the section is never hidden.
 */
@Composable
private fun LiveMotorStatusPanel(
    motorLatest: MotorSnapshotData?,
    prefs: DrivetrainDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(DrivetrainGlyphs.Cog, stringResource(R.string.translation_drivetrain_liveMotor), TeslaTokens.chart.speed)
        Spacer(Modifier.height(Spacing.md))
        if (motorLatest != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    StateCell(Modifier.weight(1f), stringResource(R.string.translation_drivetrain_shiftState), motorLatest.shiftState ?: EM_DASH, TeslaTokens.chart.speed)
                    StateCell(Modifier.weight(1f), stringResource(R.string.translation_drivetrain_power), motorLatest.powerKw?.let { "${prefs.number(it)} $KW_UNIT" } ?: EM_DASH, TeslaTokens.chart.power)
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    StateCell(Modifier.weight(1f), stringResource(R.string.translation_drivetrain_regen), motorLatest.regenKw?.let { "${prefs.number(it)} $KW_UNIT" } ?: EM_DASH, TeslaTokens.chart.regen)
                    StateCell(Modifier.weight(1f), stringResource(R.string.translation_drivetrain_source), motorLatest.source ?: EM_DASH, MaterialTheme.colorScheme.onSurface)
                }
                LiveMotorMetrics(motorLatest, prefs)
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_drivetrain_noLiveMotor))
        }
    }
}

@Composable
private fun LiveMotorMetrics(
    motor: MotorSnapshotData,
    prefs: DrivetrainDisplayPrefs,
) {
    val unit = prefs.temperatureLabel
    val metrics: List<Triple<ImageVector, String, String>> =
        listOf(
            Triple(DrivetrainGlyphs.Activity, stringResource(R.string.translation_drivetrain_rpmFront), motor.motorRpmFront?.let { "${prefs.integer(it)} $RPM_UNIT" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Activity, stringResource(R.string.translation_drivetrain_rpmRear), motor.motorRpmRear?.let { "${prefs.integer(it)} $RPM_UNIT" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Zap, stringResource(R.string.translation_drivetrain_torqueFront), motor.torqueNmFront?.let { "${prefs.number(it)} $NM_UNIT" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Zap, stringResource(R.string.translation_drivetrain_torqueRear), motor.torqueNmRear?.let { "${prefs.number(it)} $NM_UNIT" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Thermometer, stringResource(R.string.translation_drivetrain_motorTempFront), motor.motorTempCFront?.let { "${prefs.number(prefs.temperature(it))} $unit" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Thermometer, stringResource(R.string.translation_drivetrain_motorTempRear), motor.motorTempCRear?.let { "${prefs.number(prefs.temperature(it))} $unit" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Thermometer, stringResource(R.string.translation_drivetrain_inverterTemp), motor.inverterTempC?.let { "${prefs.number(prefs.temperature(it))} $unit" } ?: EM_DASH),
            Triple(DrivetrainGlyphs.Thermometer, stringResource(R.string.translation_drivetrain_batteryTemp), motor.batteryTempC?.let { "${prefs.number(prefs.temperature(it))} $unit" } ?: EM_DASH),
            // HV isolation has no shared live accessor on Android yet (web sources it from the SSE live state); the metric
            // is reproduced and shows an em dash until that overlay is wired, rather than being hidden.
            Triple(DrivetrainGlyphs.Shield, stringResource(R.string.translation_drivetrain_isolationResistance), EM_DASH),
        )
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        metrics.chunked(2).forEach { pair ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                pair.forEach { (icon, label, value) ->
                    InlineMetric(modifier = Modifier.weight(1f), icon = icon, iconContentDescription = null, label = label, value = value)
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

// ── Panels 7-10 — Charts ────────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel7 — the motor stator-temperature history line chart (front / rear-left / rear-right). */
@Composable
private fun StatorTempChartPanel(
    data: List<MotorChartPoint>,
    prefs: DrivetrainDisplayPrefs,
) {
    val ready = data.size >= MIN_CHART_POINTS
    val unit = prefs.temperatureLabel
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_drivetrain_statorTempHistory),
        subtitle = stringResource(R.string.translation_drivetrain_statorTempSub),
        accessibleDescription = stringResource(R.string.translation_drivetrain_statorTempHistory_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_drivetrain_noData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_drivetrain_col_time),
                "${stringResource(R.string.translation_drivetrain_col_stator)} ($unit)",
                "${stringResource(R.string.translation_drivetrain_col_statorRel)} ($unit)",
                "${stringResource(R.string.translation_drivetrain_col_statorRer)} ($unit)",
            ),
        dataTableRows = data.map { listOf(it.time, cell(it.stator, prefs), cell(it.statorRel, prefs), cell(it.statorRer, prefs)) },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries("stator", "${stringResource(R.string.translation_drivetrain_statorTemp)} ($unit)", data.map { it.stator }, color = TeslaTokens.status.danger),
                    ChartSeries("statorRel", "${stringResource(R.string.translation_drivetrain_statorTempRearLeft)} ($unit)", data.map { it.statorRel }, color = TeslaTokens.chart.power),
                    ChartSeries("statorRer", "${stringResource(R.string.translation_drivetrain_statorTempRearRight)} ($unit)", data.map { it.statorRer }, color = TeslaTokens.chart.speed),
                ),
            xLabels = data.map { it.time },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, GAUGE_DECIMALS) },
        )
    }
}

/** GlassPanel8 — the motor torque output history area chart. */
@Composable
private fun TorqueHistoryChartPanel(
    data: List<MotorChartPoint>,
    prefs: DrivetrainDisplayPrefs,
) {
    val ready = data.size >= MIN_CHART_POINTS && hasTorque(data)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_drivetrain_torqueHistory),
        subtitle = stringResource(R.string.translation_drivetrain_torqueHistorySub),
        accessibleDescription = stringResource(R.string.translation_drivetrain_torqueHistory_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_drivetrain_noData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_drivetrain_col_time),
                stringResource(R.string.translation_drivetrain_col_torque),
            ),
        dataTableRows = data.map { listOf(it.time, cell(it.torque, prefs)) },
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries("torque", "${stringResource(R.string.translation_drivetrain_torque)} ($NM_UNIT)", data.map { it.torque }, color = TeslaTokens.chart.speed),
                ),
            xLabels = data.map { it.time },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, POWER_DECIMALS) },
        )
    }
}

/** GlassPanel9 — the outside-temperature trend line chart over recent drives. */
@Composable
private fun TemperatureTrendChartPanel(
    data: List<DriveChartPoint>,
    prefs: DrivetrainDisplayPrefs,
) {
    val ready = data.size >= MIN_CHART_POINTS
    val unit = prefs.temperatureLabel
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_drivetrain_tempHistory),
        subtitle = stringResource(R.string.translation_drivetrain_tempHistorySub),
        accessibleDescription = stringResource(R.string.translation_drivetrain_tempHistory_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_drivetrain_noData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_drivetrain_col_date),
                "${stringResource(R.string.translation_drivetrain_col_outside)} ($unit)",
            ),
        dataTableRows = data.map { listOf(it.date, cell(it.outsideTempDisplay, prefs)) },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries("outsideTemp", stringResource(R.string.translation_drivetrain_outsideTemp), data.map { it.outsideTempDisplay }, color = TeslaTokens.chart.speed),
                ),
            xLabels = data.map { it.date },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, GAUGE_DECIMALS) },
        )
    }
}

/** GlassPanel10 — the per-drive peak and regen power output history area chart. */
@Composable
private fun PowerOutputChartPanel(
    data: List<DriveChartPoint>,
    prefs: DrivetrainDisplayPrefs,
) {
    val ready = data.size >= MIN_CHART_POINTS
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_drivetrain_powerOutput),
        subtitle = stringResource(R.string.translation_drivetrain_powerOutputSub),
        accessibleDescription = stringResource(R.string.translation_drivetrain_powerOutput_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_drivetrain_noData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_drivetrain_col_date),
                stringResource(R.string.translation_drivetrain_col_powerMax),
                stringResource(R.string.translation_drivetrain_col_powerMin),
            ),
        dataTableRows = data.map { listOf(it.date, prefs.number(it.powerMax, POWER_DECIMALS), prefs.number(it.powerMin, POWER_DECIMALS)) },
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries("powerMax", stringResource(R.string.translation_drivetrain_powerMax), data.map { it.powerMax }, color = TeslaTokens.chart.power),
                    ChartSeries("powerMin", stringResource(R.string.translation_drivetrain_powerMin), data.map { it.powerMin }, color = TeslaTokens.status.danger),
                ),
            xLabels = data.map { it.date },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, POWER_DECIMALS) },
        )
    }
}

// ── Panel 11 — Recommendations ──────────────────────────────────────────────────────────────────────────────────

/** GlassPanel11 — the urgency-ordered drivetrain health recommendations. */
@Composable
private fun HealthRecommendationsPanel(overallHealth: HealthStatus) {
    val tips = remember(overallHealth) { buildRecommendations(overallHealth) }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(DrivetrainGlyphs.Shield, stringResource(R.string.translation_drivetrain_recommendations), TeslaTokens.chart.speed)
        Spacer(Modifier.height(Spacing.md))
        StaggerContainer {
            tips.forEachIndexed { index, tip ->
                StaggerItem(index = index) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Icon(
                            recommendationGlyph(tip.priority),
                            contentDescription = null,
                            tint = priorityColor(tip.priority),
                            size = IconSize.Sm,
                        )
                        BodyText(recommendationText(tip), modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

// ── Panel 12 — Detail cards ─────────────────────────────────────────────────────────────────────────────────────

/** GlassPanel12 — the temperature-details and power-summary KV cards. */
@Composable
private fun DetailCardsPanel(
    health: DrivetrainHealth,
    peak: Double,
    avg: Double,
    minRegen: Double,
    stats: DrivingStatsData?,
    prefs: DrivetrainDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            PanelTitle(stringResource(R.string.translation_drivetrain_temperatures))
            Spacer(Modifier.height(Spacing.sm))
            KVList(
                items =
                    listOf(
                        KVItem(stringResource(R.string.translation_drivetrain_frontMotorTemp), displayTemp(health.frontMotorTempC, prefs)),
                        KVItem(stringResource(R.string.translation_drivetrain_rearMotorTemp), displayTemp(health.rearMotorTempC, prefs)),
                        KVItem(stringResource(R.string.translation_drivetrain_inverterTemp), displayTemp(health.inverterTempC, prefs)),
                        KVItem(stringResource(R.string.translation_drivetrain_batteryTemp), displayTemp(health.batteryTempC, prefs)),
                    ),
            )
        }
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            PanelTitle(stringResource(R.string.translation_drivetrain_powerSummary))
            Spacer(Modifier.height(Spacing.sm))
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_drivetrain_peakPowerLabel),
                            if (peak > 0.0) "${prefs.integer(peak)} $KW_UNIT" else EM_DASH,
                        ),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_avgPowerLabel),
                            if (avg > 0.0) "${prefs.number(avg, POWER_DECIMALS)} $KW_UNIT" else EM_DASH,
                        ),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_maxRegenLabel),
                            if (minRegen < 0.0) "${prefs.number(abs(minRegen), POWER_DECIMALS)} $KW_UNIT" else EM_DASH,
                        ),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_regenLabel),
                            stats?.let { prefs.energyText(it.regenEnergyWh, POWER_DECIMALS) } ?: EM_DASH,
                        ),
                        KVItem(
                            stringResource(R.string.translation_drivetrain_co2Label),
                            stats?.let { "${prefs.number(it.co2SavedKg, POWER_DECIMALS)} kg" } ?: EM_DASH,
                        ),
                    ),
            )
        }
    }
}

// ── Shared sub-components + mappers ──────────────────────────────────────────────────────────────────────────────

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

/** A centered live-motor state cell — a muted label over a colored value (web `Live Motor Status` cell). */
@Composable
private fun StateCell(
    modifier: Modifier,
    label: String,
    value: String,
    accent: Color,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(label)
            BodyText(value, color = accent)
        }
    }
}

/** Web `displayTemp`: a formatted temperature with its unit, or an em dash when the reading is absent. */
@Composable
private fun displayTemp(celsius: Double?, prefs: DrivetrainDisplayPrefs): String =
    if (celsius != null) prefs.temperatureText(celsius) else EM_DASH

/** A data-table cell for a nullable converted value (web chart data-table). */
private fun cell(value: Double?, prefs: DrivetrainDisplayPrefs): String =
    if (value != null) prefs.number(value, GAUGE_DECIMALS) else EM_DASH

/** Web `TemperatureMetricCards` subtitle: the percent-of-max, or the "No data" string when absent. */
@Composable
private fun sensorSubtitle(sensor: SensorReading, prefs: DrivetrainDisplayPrefs): String {
    val ratio = sensor.ratio
    return if (ratio != null) {
        "${prefs.number(ratio * 100, GAUGE_DECIMALS)}$PERCENT_UNIT ${stringResource(R.string.translation_drivetrain_ofMax)}"
    } else {
        stringResource(R.string.translation_drivetrain_noData)
    }
}

@Composable
private fun sensorLabel(id: DrivetrainSensorId): String =
    stringResource(
        when (id) {
            DrivetrainSensorId.FrontMotor -> R.string.translation_drivetrain_frontMotor
            DrivetrainSensorId.RearMotor -> R.string.translation_drivetrain_rearMotor
            DrivetrainSensorId.Inverter -> R.string.translation_drivetrain_inverter
            DrivetrainSensorId.Battery -> R.string.translation_drivetrain_battery
        },
    )

private fun sensorGlyph(id: DrivetrainSensorId): ImageVector =
    when (id) {
        DrivetrainSensorId.FrontMotor, DrivetrainSensorId.RearMotor -> DrivetrainGlyphs.Zap
        DrivetrainSensorId.Inverter -> DrivetrainGlyphs.Cpu
        DrivetrainSensorId.Battery -> DrivetrainGlyphs.BatteryCharging
    }

/** Web `tempSeverityColor`: critical → danger, warning → warning, good → success, unknown → muted. */
@Composable
private fun severityColor(severity: TempSeverity): Color =
    when (severity) {
        TempSeverity.Critical -> TeslaTokens.status.danger
        TempSeverity.Warning -> TeslaTokens.status.warning
        TempSeverity.Good -> TeslaTokens.status.success
        TempSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Web `tempNeonColor`: critical → danger, warning → warning, else success (a null reading reads as green). */
@Composable
private fun neonAccent(severity: TempSeverity): Color =
    when (severity) {
        TempSeverity.Critical -> TeslaTokens.status.danger
        TempSeverity.Warning -> TeslaTokens.status.warning
        TempSeverity.Good, TempSeverity.Unknown -> TeslaTokens.status.success
    }

@Composable
private fun healthColor(status: HealthStatus): Color =
    when (status) {
        HealthStatus.Good -> TeslaTokens.status.success
        HealthStatus.Warning -> TeslaTokens.status.warning
        HealthStatus.Critical -> TeslaTokens.status.danger
    }

private fun healthBadgeVariant(status: HealthStatus): BadgeVariant =
    when (status) {
        HealthStatus.Good -> BadgeVariant.Success
        HealthStatus.Warning -> BadgeVariant.Warning
        HealthStatus.Critical -> BadgeVariant.Danger
    }

private fun panelAccent(status: HealthStatus): io.teslasync.android.components.ui.PanelAccent =
    when (status) {
        HealthStatus.Good -> io.teslasync.android.components.ui.PanelAccent.Success
        HealthStatus.Warning -> io.teslasync.android.components.ui.PanelAccent.Warning
        HealthStatus.Critical -> io.teslasync.android.components.ui.PanelAccent.Danger
    }

@Composable
private fun healthHeroTitle(status: HealthStatus): String =
    stringResource(
        when (status) {
            HealthStatus.Good -> R.string.translation_drivetrain_healthGood
            HealthStatus.Warning -> R.string.translation_drivetrain_healthWarn
            HealthStatus.Critical -> R.string.translation_drivetrain_healthCrit
        },
    )

@Composable
private fun healthBadgeText(status: HealthStatus): String =
    stringResource(
        when (status) {
            HealthStatus.Good -> R.string.translation_drivetrain_health_good
            HealthStatus.Warning -> R.string.translation_drivetrain_health_warning
            HealthStatus.Critical -> R.string.translation_drivetrain_health_critical
        },
    )

/** Web `overallHealth.charAt(0).toUpperCase() + slice(1)` — the localized tier label. */
@Composable
private fun healthTierLabel(status: HealthStatus): String = healthBadgeText(status)

@Composable
private fun priorityColor(priority: RecommendationPriority): Color =
    when (priority) {
        RecommendationPriority.High -> TeslaTokens.status.danger
        RecommendationPriority.Medium -> TeslaTokens.status.warning
        RecommendationPriority.Low -> TeslaTokens.chart.speed
    }

private fun recommendationGlyph(priority: RecommendationPriority): ImageVector =
    when (priority) {
        RecommendationPriority.High, RecommendationPriority.Medium -> DrivetrainGlyphs.AlertTriangle
        RecommendationPriority.Low -> DrivetrainGlyphs.TrendingUp
    }

@Composable
private fun recommendationText(tip: RecommendationTip): String =
    stringResource(
        when (tip) {
            RecommendationTip.CriticalStop -> R.string.translation_drivetrain_tips_criticalStop
            RecommendationTip.ServiceUrgent -> R.string.translation_drivetrain_tips_serviceUrgent
            RecommendationTip.ReduceLoad -> R.string.translation_drivetrain_tips_reduceLoad
            RecommendationTip.CheckCoolant -> R.string.translation_drivetrain_tips_checkCoolant
            RecommendationTip.AvoidSupercharging -> R.string.translation_drivetrain_tips_avoidSupercharging
            RecommendationTip.RegularService -> R.string.translation_drivetrain_tips_regularService
            RecommendationTip.GentleAccel -> R.string.translation_drivetrain_tips_gentleAccel
            RecommendationTip.Precondition -> R.string.translation_drivetrain_tips_precondition
            RecommendationTip.MonitorTemps -> R.string.translation_drivetrain_tips_monitorTemps
        },
    )
