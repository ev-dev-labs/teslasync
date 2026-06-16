// The native Jetpack Compose + Material 3 ChargingDetailPage surface — a parity port of
// web/src/features/charging/pages/ChargingDetailPage.tsx, the per-session charge dashboard. It reproduces the page's
// twenty-two panels (the five hero radial gauges, the battery-progress meter, the eight summary stat cards, the
// more-details panel, the location panel, the charge-curve chart, the SoC/energy/range, temperature and
// voltage/current time-series charts, the advanced live-parameters panel and the timestamps footer), every data state
// (loading / empty / error / success, plus the cache-then-network stale/offline tier), and every visible string
// (resolved from the generated res/values catalog `charging.detail.*` / `common.*` / `help.charging.*`, ADR-014).
//
// Composition: [ChargingDetailPage] is the stateful entry (constructs the view-model over the host-wired source + the
// session-id route argument, records the one-shot `view.opened` diagnostic, collects the four feeds + the live display
// preferences); [ChargingDetailPageContent] is the stateless render layer (the chrome — title + freshness chip + the
// stale/offline banner — then the loading / error / empty / loaded body gated on the primary session feed). The loaded
// body draws every panel from the decoded models; all decode + derivation lives in the framework-free model
// (ChargingDetailPageModel.kt), so this file only resolves i18n + draws. SI values are converted to the user's units
// only here at the display boundary via the model's `prefs` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.charging.chargingdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.StatCard
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
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 40

/** Radial-gauge ceilings (web `RadialGauge max`). */
private const val ENERGY_GAUGE_FLOOR = 80.0
private const val SOC_MAX = 100.0
private const val DC_POWER_MAX = 250.0
private const val AC_POWER_MAX = 22.0
private const val DURATION_GAUGE_FLOOR = 120.0

/** Decimals matching the web `RadialGauge` / `fmtNumber` calls. */
private const val ENERGY_DECIMALS = 1
private const val POWER_DECIMALS = 1
private const val COST_DECIMALS = 2
private const val ZERO_DECIMALS = 0

/** Unit symbols the web reads as literals (never i18n). */
private const val PERCENT_UNIT = "%"
private const val MINUTE_UNIT = "min"
private const val VOLT_UNIT = "V"
private const val AMP_UNIT = "A"
private const val PER_KWH_UNIT = "$/kWh"
private const val KWH_PER_HOUR_UNIT = "kWh/h"
private const val AC_LABEL = "AC"
private const val DC_LABEL = "DC"

/** Chart heights mirroring the web `ResponsiveContainer` heights. */
private val CURVE_HEIGHT: Dp = 280.dp
private val SERIES_HEIGHT: Dp = 320.dp
private val COMPACT_HEIGHT: Dp = 240.dp

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ChargingDetailPageViewModel] over the supplied [source] (the host wires the
 * page-local charging repository + the shared Settings holder via [chargingDetailPageSourceOf]) scoped to [sessionId]
 * (the route argument). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic
 * and binds the live state to the content.
 */
@Composable
fun ChargingDetailPage(
    source: ChargingDetailPageSource,
    sessionId: Long,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ChargingDetailPageViewModel =
        viewModel(
            key = "${ChargingDetailPageRegistration.ROUTE_ID}:$sessionId",
            factory = viewModelFactory { initializer { ChargingDetailPageViewModel(source, sessionId, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val session by viewModel.session.collectAsStateWithLifecycle()
    val telemetry by viewModel.telemetry.collectAsStateWithLifecycle()
    val vehicle by viewModel.vehicle.collectAsStateWithLifecycle()
    val live by viewModel.live.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    ChargingDetailPageContent(
        session = session,
        telemetry = telemetry,
        vehicle = vehicle,
        live = live,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + freshness chip + the stale/offline banner), then the session-gated
 * body — a centered loader on a first load, a retryable error panel on a hard failure, an empty-state when no session
 * exists, or the loaded panels otherwise. The secondary feeds (telemetry, vehicle, live) each render their own
 * content-or-empty surface so no section is ever hidden.
 */
@Composable
fun ChargingDetailPageContent(
    session: UiState<ChargingSessionDetail>,
    telemetry: UiState<List<ChargeTelemetryReading>>,
    vehicle: UiState<VehicleInfo>,
    live: UiState<ChargingTelemetrySnapshot>,
    prefs: ChargingDisplayPrefs,
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
        Chrome(session)

        when {
            session.isLoading -> Loading()
            session.isError -> Failure(onRetry)
            session.isEmpty -> NoSession()
            else ->
                Body(
                    session = session.data ?: ChargingSessionDetail.EMPTY,
                    telemetry = telemetry,
                    vehicle = vehicle,
                    live = live,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — the "Charge Session" title (web `PageContainer` title), freshness chip, and the stale banner. */
@Composable
private fun Chrome(session: UiState<ChargingSessionDetail>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            PageTitle(stringResource(R.string.translation_charging_detail_title), modifier = Modifier.weight(1f))
            DataFreshness(
                updatedAtMillis = session.fetchedAt,
                isFetching = session.refreshing,
                isStale = session.stale,
                isError = session.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (session.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `LoadingSkeleton`). */
@Composable
private fun Loading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun Failure(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the empty-state shown when no charging session exists for the id (web `!session`). */
@Composable
private fun NoSession() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = ChargingGlyphs.Zap,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun Body(
    session: ChargingSessionDetail,
    telemetry: UiState<List<ChargeTelemetryReading>>,
    vehicle: UiState<VehicleInfo>,
    live: UiState<ChargingTelemetrySnapshot>,
    prefs: ChargingDisplayPrefs,
) {
    val readings = telemetry.data ?: emptyList()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { Header(session, vehicle.data, live.data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { HeroGauges(session, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { BatteryProgressPanel(session, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { StatCardsGrid(session, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { MoreDetailsPanel(session, vehicle.data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { LocationPanel(session) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { ChargeCurvePanel(session, readings, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { SocEnergyRangePanel(readings, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { TemperaturePanel(readings, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 9) { VoltageCurrentPanel(readings, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 10) { AdvancedParamsPanel(live.data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 11) { TimestampsPanel(session, prefs) }
    }
}

// ── 1. Header ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The session header — back glyph, the session date, the vehicle name, and the AC/DC + state + charger + place badges. */
@Composable
private fun Header(
    session: ChargingSessionDetail,
    vehicle: VehicleInfo?,
    live: ChargingTelemetrySnapshot?,
    prefs: ChargingDisplayPrefs,
) {
    val dc = isDc(session)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                ChargingGlyphs.ArrowLeft,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Subhead(sessionDateLabel(session.startedAt, prefs.locale))
            vehicle?.displayName?.takeIf { it.isNotBlank() }?.let { name ->
                Caption(name)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Badge(
                text = if (dc) DC_LABEL else AC_LABEL,
                variant = if (dc) BadgeVariant.Warning else BadgeVariant.Info,
                dot = true,
            )
            live?.chargingState?.takeIf { it.isNotBlank() }?.let { state ->
                Badge(text = state, variant = chargingStateVariant(state), dot = true)
            }
            session.chargerType?.takeIf { it.isNotBlank() }?.let { type ->
                Badge(text = type, variant = BadgeVariant.Neutral)
            }
            session.startPlace?.takeIf { it.isNotBlank() }?.let { place ->
                Badge(text = place, variant = BadgeVariant.Neutral)
            }
        }
    }
}

// ── 2. Hero gauges (GlassPanel1-5) ──────────────────────────────────────────────────────────────────────────────

/** The five hero radial gauges, each in its own [GlassPanel] (web hero `StaggerContainer`). */
@Composable
private fun HeroGauges(
    session: ChargingSessionDetail,
    prefs: ChargingDisplayPrefs,
) {
    val dc = isDc(session)
    val durationMin = durationMinutes(session.startedAt, session.endedAt).asDouble()
    val powerMax = if (dc) DC_POWER_MAX else AC_POWER_MAX
    val energyKwh = prefs.energyKwh(session.totalEnergyAddedWh)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            GaugeCell(
                modifier = Modifier.weight(1f),
                value = energyKwh,
                max = maxOf(energyKwh, ENERGY_GAUGE_FLOOR),
                label = stringResource(R.string.translation_charging_detail_energyAdded),
                unit = prefs.energyLabel,
                color = TeslaTokens.chart.battery,
                accent = PanelAccent.Info,
                decimals = ENERGY_DECIMALS,
            )
            GaugeCell(
                modifier = Modifier.weight(1f),
                value = session.endSocPct ?: 0.0,
                max = SOC_MAX,
                label = stringResource(R.string.translation_charging_detail_endSoc),
                unit = PERCENT_UNIT,
                color = TeslaTokens.chart.regen,
                accent = PanelAccent.Success,
                decimals = ZERO_DECIMALS,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            GaugeCell(
                modifier = Modifier.weight(1f),
                value = prefs.powerKw(session.peakPowerW ?: 0.0),
                max = powerMax,
                label = stringResource(R.string.translation_charging_detail_peakPower),
                unit = prefs.powerLabel,
                color = TeslaTokens.chart.power,
                accent = PanelAccent.Primary,
                decimals = POWER_DECIMALS,
            )
            GaugeCell(
                modifier = Modifier.weight(1f),
                value = durationMin,
                max = maxOf(durationMin, DURATION_GAUGE_FLOOR),
                label = stringResource(R.string.translation_charging_detail_duration),
                unit = MINUTE_UNIT,
                color = TeslaTokens.chart.energy,
                accent = PanelAccent.None,
                decimals = ZERO_DECIMALS,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            GaugeCell(
                modifier = Modifier.weight(1f),
                value = prefs.powerKw(session.avgPowerW ?: 0.0),
                max = powerMax,
                label = stringResource(R.string.translation_charging_detail_avgPower),
                unit = prefs.powerLabel,
                color = TeslaTokens.chart.speed,
                accent = PanelAccent.None,
                decimals = POWER_DECIMALS,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

/** A single hero gauge inside its own glass panel (web `GlassPanel glow` wrapping a `RadialGauge`). */
@Composable
private fun GaugeCell(
    value: Double,
    max: Double,
    label: String,
    unit: String,
    color: androidx.compose.ui.graphics.Color,
    accent: PanelAccent,
    decimals: Int,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, accent = accent) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            RadialGauge(value = value, max = max, label = label, unit = unit, color = color, decimals = decimals)
        }
    }
}

// ── 3. Battery progress (GlassPanel6) ───────────────────────────────────────────────────────────────────────────

/** The start/end SoC meter plus the SoC-gained / range-gained / energy-added summary (web "Battery Progress"). */
@Composable
private fun BatteryProgressPanel(
    session: ChargingSessionDetail,
    prefs: ChargingDisplayPrefs,
) {
    val startSoc = session.startSocPct ?: 0.0
    val endSoc = session.endSocPct ?: 0.0
    val added = distanceAddedM(session)
    val socRangeAria = stringResource(R.string.translation_help_charging_socRange_aria)
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = socRangeAria },
        padding = PanelPadding.Lg,
    ) {
        PanelTitle(stringResource(R.string.translation_charging_detail_batteryProgress))
        Spacer(Modifier.padding(top = Spacing.xs))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricBar(
                value = startSoc,
                max = SOC_MAX,
                label = stringResource(R.string.translation_charging_detail_startSoc),
                valueText = prefs.percent(startSoc),
                color = TeslaTokens.chart.energy,
            )
            MetricBar(
                value = endSoc,
                max = SOC_MAX,
                label = stringResource(R.string.translation_charging_detail_endSoc),
                valueText = prefs.percent(endSoc),
                color = TeslaTokens.chart.regen,
            )
        }
        Spacer(Modifier.padding(top = Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MiniStat(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_detail_socGained),
                value = prefs.percent(endSoc - startSoc),
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_detail_rangeGained),
                value = milesAddedDisplay(added, prefs),
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_detail_energyAdded),
                value = prefs.formatEnergy(session.totalEnergyAddedWh),
            )
        }
    }
}

/** A small label-over-value cell used inside the battery-progress summary row. */
@Composable
private fun MiniStat(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        Subhead(value)
    }
}

// ── 4. Eight stat cards (GlassPanel7-14) ────────────────────────────────────────────────────────────────────────

/** The eight summary stat cards (web "Eight stat cards" grid), two per row. */
@Composable
private fun StatCardsGrid(
    session: ChargingSessionDetail,
    prefs: ChargingDisplayPrefs,
) {
    val durationMin = durationMinutes(session.startedAt, session.endedAt).asDouble()
    val added = distanceAddedM(session)
    val rate = kwhPerHour(session)
    val perKwh = costPerKwh(session)
    val cost = session.costDecimal
    val hasCost = cost != null
    val costValue =
        when {
            cost != null -> prefs.number(cost, COST_DECIMALS)
            session.totalEnergyAddedWh > 0.0 -> prefs.formatEnergyCost(session.totalEnergyAddedWh / 1000.0)
            else -> EM_DASH
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.Zap,
                label = stringResource(R.string.translation_charging_detail_energy),
                value = prefs.number(prefs.energyKwh(session.totalEnergyAddedWh)),
                unit = prefs.energyLabel,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.Clock,
                label = stringResource(R.string.translation_charging_detail_duration),
                value = prefs.integer(durationMin),
                unit = MINUTE_UNIT,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.Gauge,
                label = stringResource(R.string.translation_charging_detail_peakPower),
                value = prefs.number(prefs.powerKw(session.peakPowerW ?: 0.0)),
                unit = prefs.powerLabel,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.Battery,
                label = stringResource(R.string.translation_charging_detail_socRange),
                value = "${prefs.integer(session.startSocPct ?: 0.0)}$EM_DASH${prefs.integer(session.endSocPct ?: 0.0)}",
                unit = PERCENT_UNIT,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.DollarSign,
                label =
                    if (hasCost) {
                        stringResource(R.string.translation_charging_detail_totalCost)
                    } else {
                        stringResource(R.string.translation_charging_detail_estCost)
                    },
                value = costValue,
                unit = if (hasCost) prefs.currencySymbol else "",
                sublabel =
                    if (!hasCost && session.totalEnergyAddedWh > 0.0) {
                        stringResource(
                            R.string.translation_charging_detail_atRate,
                            prefs.currencySymbol,
                            prefs.number(prefs.costPerKwh, COST_DECIMALS),
                        )
                    } else {
                        null
                    },
            )
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.DollarSign,
                label = stringResource(R.string.translation_charging_detail_perKwh),
                value = prefs.number(perKwh ?: prefs.costPerKwh, COST_DECIMALS),
                unit = PER_KWH_UNIT,
                sublabel = if (perKwh == null) stringResource(R.string.translation_charging_detail_fromSettings) else null,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.MapPin,
                label = stringResource(R.string.translation_charging_detail_milesAdded),
                value = if (added != null) prefs.number(prefs.fromMeters(added / 1000.0), ZERO_DECIMALS) else EM_DASH,
                unit = if (added != null) prefs.distanceLabel else "",
            )
            StatCard(
                modifier = Modifier.weight(1f),
                icon = ChargingGlyphs.Zap,
                label = stringResource(R.string.translation_charging_detail_avgRate),
                value = if (rate != null) prefs.number(rate) else EM_DASH,
                unit = if (rate != null) KWH_PER_HOUR_UNIT else "",
            )
        }
    }
}

// ── 5. More details (GlassPanel15) ──────────────────────────────────────────────────────────────────────────────

/** Avg-power / miles-added / status / currency inline metrics plus the charger/location/vehicle key-value list. */
@Composable
private fun MoreDetailsPanel(
    session: ChargingSessionDetail,
    vehicle: VehicleInfo?,
    prefs: ChargingDisplayPrefs,
) {
    val dc = isDc(session)
    val added = distanceAddedM(session)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_charging_detail_moreDetails))
        Spacer(Modifier.padding(top = Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            InlineMetric(
                icon = ChargingGlyphs.Gauge,
                label = stringResource(R.string.translation_charging_detail_avgPower),
                value =
                    session.avgPowerW?.let { "${prefs.number(prefs.powerKw(it), POWER_DECIMALS)} ${prefs.powerLabel}" }
                        ?: EM_DASH,
            )
            InlineMetric(
                icon = ChargingGlyphs.MapPin,
                label = stringResource(R.string.translation_charging_detail_milesAdded),
                value = milesAddedDisplay(added, prefs),
            )
            InlineMetric(
                icon = ChargingGlyphs.Zap,
                label = stringResource(R.string.translation_charging_detail_status),
                value = session.endedStatus ?: EM_DASH,
            )
            InlineMetric(
                icon = ChargingGlyphs.DollarSign,
                label = stringResource(R.string.translation_charging_detail_currency),
                value = session.costCurrency ?: EM_DASH,
            )
        }
        Spacer(Modifier.padding(top = Spacing.sm))
        KVList(
            items =
                listOf(
                    KVItem(
                        label = stringResource(R.string.translation_charging_detail_chargerType),
                        value = session.chargerType ?: if (dc) DC_LABEL else AC_LABEL,
                    ),
                    KVItem(
                        label = stringResource(R.string.translation_charging_detail_location),
                        value = session.startPlace ?: EM_DASH,
                    ),
                    KVItem(
                        label = stringResource(R.string.translation_charging_detail_vehicle),
                        value = vehicle?.displayName?.takeIf { it.isNotBlank() } ?: "ID ${session.vehicleId ?: 0}",
                    ),
                ),
        )
    }
}

// ── 6. Location (GlassPanel16) ──────────────────────────────────────────────────────────────────────────────────

/** The start-location panel — always shown; an em dash stands in when no place was recorded (web conditional panel). */
@Composable
private fun LocationPanel(session: ChargingSessionDetail) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_charging_detail_location))
        Spacer(Modifier.padding(top = Spacing.sm))
        BodyText(session.startPlace ?: EM_DASH)
    }
}

// ── 7. Charge curve (GlassPanel17) ──────────────────────────────────────────────────────────────────────────────

/** The power-vs-SoC charge-curve area chart, with the synthesized-fallback "estimated" subtitle (web "Charge Curve"). */
@Composable
private fun ChargeCurvePanel(
    session: ChargingSessionDetail,
    telemetry: List<ChargeTelemetryReading>,
    prefs: ChargingDisplayPrefs,
) {
    val points = buildChargeCurve(session, telemetry)
    val hasTelemetry = telemetry.isNotEmpty()
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_charging_detail_chargeCurve),
        subtitle = if (!hasTelemetry) stringResource(R.string.translation_charging_detail_estimated) else null,
        accessibleDescription = stringResource(R.string.translation_help_charging_chargeCurve_aria),
        status = if (points.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = CURVE_HEIGHT,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "power",
                        label = stringResource(R.string.translation_charging_detail_power),
                        values = points.map { it.power },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.power,
                        unit = prefs.powerLabel,
                    ),
                ),
            xLabels = points.map { prefs.number(it.soc, ZERO_DECIMALS) },
            height = CURVE_HEIGHT,
            yValueFormatter = { prefs.number(it, POWER_DECIMALS) },
        )
    }
}

// ── 8. SoC / Energy / Range over time (GlassPanel18) ────────────────────────────────────────────────────────────

/** The SoC + energy + range time-series composed chart (web "SoC, Energy & Range over Time"). */
@Composable
private fun SocEnergyRangePanel(
    telemetry: List<ChargeTelemetryReading>,
    prefs: ChargingDisplayPrefs,
) {
    val rows = buildTimeSeries(telemetry, prefs)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_charging_detail_socOverTime),
        accessibleDescription = stringResource(R.string.translation_charging_detail_socOverTime),
        status = if (rows.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = SERIES_HEIGHT,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        ComboChart(
            series =
                listOf(
                    ChartSeries(
                        key = "soc",
                        label = stringResource(R.string.translation_charging_detail_soc),
                        values = rows.map { it.soc },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.regen,
                        unit = PERCENT_UNIT,
                    ),
                    ChartSeries(
                        key = "energy",
                        label = stringResource(R.string.translation_charging_detail_energy),
                        values = rows.map { it.energy },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.battery,
                        unit = prefs.energyLabel,
                    ),
                    ChartSeries(
                        key = "range",
                        label = stringResource(R.string.translation_charging_detail_range),
                        values = rows.map { it.range },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.energy,
                        unit = prefs.distanceLabel,
                    ),
                ),
            xLabels = rows.map { it.time },
            height = SERIES_HEIGHT,
            yValueFormatter = { prefs.number(it, ZERO_DECIMALS) },
        )
    }
}

// ── 9. Temperature (GlassPanel19) ───────────────────────────────────────────────────────────────────────────────

/** The battery / inside / outside temperature time-series composed chart (web "Temperature"). */
@Composable
private fun TemperaturePanel(
    telemetry: List<ChargeTelemetryReading>,
    prefs: ChargingDisplayPrefs,
) {
    val rows = buildTempSeries(telemetry, prefs)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_charging_detail_temperature),
        accessibleDescription = stringResource(R.string.translation_charging_detail_temperature),
        status = if (rows.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = COMPACT_HEIGHT,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        ComboChart(
            series =
                listOf(
                    ChartSeries(
                        key = "battery",
                        label = stringResource(R.string.translation_charging_detail_batteryTemp),
                        values = rows.map { it.battery },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.temperature,
                        unit = prefs.temperatureLabel,
                    ),
                    ChartSeries(
                        key = "inside",
                        label = stringResource(R.string.translation_charging_detail_insideTemp),
                        values = rows.map { it.inside },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.energy,
                        unit = prefs.temperatureLabel,
                    ),
                    ChartSeries(
                        key = "outside",
                        label = stringResource(R.string.translation_charging_detail_outsideTemp),
                        values = rows.map { it.outside },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.speed,
                        unit = prefs.temperatureLabel,
                    ),
                ),
            xLabels = rows.map { it.time },
            height = COMPACT_HEIGHT,
            yValueFormatter = { prefs.number(it, ZERO_DECIMALS) },
        )
    }
}

// ── 10. Voltage & Current (GlassPanel20) ────────────────────────────────────────────────────────────────────────

/** The charger voltage + current time-series composed chart (web "Voltage & Current"). */
@Composable
private fun VoltageCurrentPanel(
    telemetry: List<ChargeTelemetryReading>,
    prefs: ChargingDisplayPrefs,
) {
    val rows = buildVoltSeries(telemetry)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_charging_detail_voltageCurrent),
        status = if (rows.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = COMPACT_HEIGHT,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        ComboChart(
            series =
                listOf(
                    ChartSeries(
                        key = "voltage",
                        label = stringResource(R.string.translation_charging_detail_voltage),
                        values = rows.map { it.voltage },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.energy,
                        unit = VOLT_UNIT,
                    ),
                    ChartSeries(
                        key = "current",
                        label = stringResource(R.string.translation_charging_detail_current),
                        values = rows.map { it.current },
                        kind = ChartSeriesKind.Line,
                        color = TeslaTokens.chart.speed,
                        unit = AMP_UNIT,
                    ),
                ),
            xLabels = rows.map { it.time },
            height = COMPACT_HEIGHT,
            yValueFormatter = { prefs.number(it, ZERO_DECIMALS) },
        )
    }
}

// ── 11. Advanced live parameters (GlassPanel21) ─────────────────────────────────────────────────────────────────

/** The latest live charging parameters key-value list, or the "no live data" note (web "Advanced Charging Parameters"). */
@Composable
private fun AdvancedParamsPanel(
    live: ChargingTelemetrySnapshot?,
    prefs: ChargingDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_charging_detail_advanced))
        HelperText(stringResource(R.string.translation_charging_detail_advancedHint))
        Spacer(Modifier.padding(top = Spacing.sm))
        if (live != null && live.present) {
            KVList(items = advancedItems(live, prefs))
        } else {
            BodyText(stringResource(R.string.translation_charging_detail_noLiveData))
        }
    }
}

/** Builds the advanced-parameter key-value rows from the live snapshot, formatting each at the display boundary. */
@Composable
private fun advancedItems(
    live: ChargingTelemetrySnapshot,
    prefs: ChargingDisplayPrefs,
): List<KVItem> =
    listOf(
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargingState),
            value = live.chargingState?.takeIf { it.isNotBlank() } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargerVoltage),
            value = live.chargerVoltage?.let { "${prefs.number(it, ZERO_DECIMALS)} $VOLT_UNIT" } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargerActualCurrent),
            value = live.chargerActualCurrent?.let { "${prefs.number(it, POWER_DECIMALS)} $AMP_UNIT" } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargerPilotCurrent),
            value = live.chargerPilotCurrent?.let { "${prefs.number(it, POWER_DECIMALS)} $AMP_UNIT" } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargerPowerKw),
            value = live.chargerPowerW?.let { "${prefs.number(it, POWER_DECIMALS)} ${prefs.powerLabel}" } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargerPhases),
            value = live.chargerPhases?.toString() ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_batteryRange),
            value = live.batteryRangeMi?.let { "${prefs.number(prefs.fromMeters(it), ZERO_DECIMALS)} ${prefs.distanceLabel}" }
                ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargeRate),
            value = live.rangeAddedMetersPerHour
                ?.let { "${prefs.number(prefs.fromMeters(it), POWER_DECIMALS)} ${prefs.distanceLabel}/h" }
                ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargeEnergyAdded),
            value = live.chargeEnergyAddedWh?.let { "${prefs.number(it, COST_DECIMALS)} ${prefs.energyLabel}" } ?: EM_DASH,
        ),
        KVItem(
            label = stringResource(R.string.translation_charging_detail_chargeMilesAdded),
            value = live.rangeAddedMetersPerHour
                ?.let { "${prefs.number(prefs.fromMeters(it / 1000.0), POWER_DECIMALS)} ${prefs.distanceLabel}" }
                ?: EM_DASH,
        ),
    )

// ── 12. Timestamps footer (GlassPanel22) ────────────────────────────────────────────────────────────────────────

/** The started / ended timestamps footer (web "Timestamps footer"). */
@Composable
private fun TimestampsPanel(
    session: ChargingSessionDetail,
    prefs: ChargingDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_charging_detail_started))
                BodyText(timestampLabel(session.startedAt, prefs.locale))
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_charging_detail_ended))
                BodyText(if (session.endedAt != null) timestampLabel(session.endedAt, prefs.locale) else EM_DASH)
            }
        }
    }
}

// ── Shared display helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Web "Range Gained" / "Miles Added": the odometer delta in the display distance, or an em dash when absent. */
private fun milesAddedDisplay(addedMeters: Double?, prefs: ChargingDisplayPrefs): String =
    if (addedMeters != null) {
        "${prefs.number(prefs.fromMeters(addedMeters / 1000.0), ZERO_DECIMALS)} ${prefs.distanceLabel}"
    } else {
        EM_DASH
    }

/** Web `chargingStateVariant`: maps a Tesla charging-state literal to its badge tone. */
private fun chargingStateVariant(state: String): BadgeVariant =
    when (state) {
        "Charging", "Starting" -> BadgeVariant.Success
        "Complete" -> BadgeVariant.Info
        "Stopped", "NoPower" -> BadgeVariant.Warning
        "Error" -> BadgeVariant.Danger
        else -> BadgeVariant.Neutral
    }
