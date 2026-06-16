// The native Jetpack Compose + Material 3 ClimateControlPage vehicle-systems surface — a parity port of
// web/src/features/vehicle-systems/pages/ClimateControlPage.tsx, the HVAC status / temperatures / seat-heaters
// dashboard. It reproduces every panel (the HVAC status banner, the three temperature gauges, the thirteen
// climate-status cards, the four protection cards, the thermal-comfort indicator, the climate-efficiency stats, the
// seat-heater grid, and the two history charts + the history table), all five charts (three native RadialGauges, the
// temperature LineChart, and the AC-state/fan-speed area+line chart), every data state (loading skeleton / empty /
// error-with-retry / content), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [ClimateControlPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the three feeds + the live display preferences);
// [ClimateControlPageContent] is the stateless render layer. The backend snapshot/history/charging feeds are folded
// by the framework-free model into the cards, gauges, charts, and table — exactly as the web page threads its loaded
// data through its useMemo chain. SI temperatures are converted to the user's units only here at the display
// boundary via the model's [ClimateDisplayPrefs] helpers (Phase-48 SI-canonical); no region is ever hidden — each
// renders its own empty fallback instead.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete
// set. `ExperimentalLayoutApi` is opted in for the wrapping legend `FlowRow`.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LargeClass",
)
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package io.teslasync.android.vehiclesystems.climatecontrol

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.roundToInt

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 40

/** The em dash shown for an absent value (web `value={… ?? '—'}`). */
private const val EM_DASH = "\u2014"

/** Highest seat-heater / steering-wheel level, used in the `(n/3)` badge suffix (web `(level}/3)`). */
private const val HEAT_SCALE = 3

private val GAUGE_PANEL_HEIGHT = 200.dp
private val LINE_CHART_HEIGHT = 256.dp
private val COMFORT_RING_SIZE = 64.dp

// The web's data-viz / icon-tint accent hexes (dynamic semantic colours, not static theme tokens — the sibling
// RegenEfficiencyPage / TemperatureImpactPage precedent). They mirror the page's tailwind icon tints.
private val CYAN = Color(0xFF22D3EE)
private val BLUE = Color(0xFF60A5FA)
private val AMBER = Color(0xFFFBBF24)
private val TEAL = Color(0xFF2DD4BF)
private val GREEN = Color(0xFF4ADE80)
private val ORANGE = Color(0xFFFB923C)
private val PURPLE = Color(0xFFC084FC)
private val SKY = Color(0xFF38BDF8)
private val RED = Color(0xFFF87171)

private const val RING_BG_ALPHA = 0.2f

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ClimateControlPageViewModel] over the supplied [source] (the host wires the shared
 * resilient client + settings holder + the app-scoped active-vehicle selection via [climateControlPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun ClimateControlPage(
    source: ClimateControlPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ClimateControlPageViewModel =
        viewModel(
            key = ClimateControlPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ClimateControlPageViewModel(source, logger) } },
        )
    ClimateControlPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + display prefs to the stateless content. */
@Composable
fun ClimateControlPage(
    viewModel: ClimateControlPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val climate by viewModel.climateState.collectAsStateWithLifecycle()
    val history by viewModel.historyState.collectAsStateWithLifecycle()
    val charging by viewModel.chargingFlags.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    ClimateControlPageContent(
        climateState = climate,
        historyState = history,
        charging = charging,
        prefs = prefs,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The page chrome (title + subtitle + the global vehicle-scope picker + the refresh action)
 * always renders; then a still-loading primary feed with nothing cached shows the full-page skeleton, otherwise the
 * optional error banner is drawn above the panels. Every panel renders its own fallback (em-dash cards / empty charts
 * / empty table) so no region ever blanks — the page title is exposed as the screen's accessible name (web
 * `usePageTitle`).
 */
@Composable
fun ClimateControlPageContent(
    climateState: UiState<ClimateState>,
    historyState: UiState<List<ClimateState>>,
    charging: ChargingTelemetryFlags,
    prefs: ClimateDisplayPrefs,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pageTitle = stringResource(R.string.translation_climate_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { contentDescription = pageTitle },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ClimateChrome(onRefresh = onRefresh)

        if (climateState.isLoading) {
            ClimateLoading()
            return@Column
        }

        if (climateState.hasError) {
            ClimateErrorBanner(onRetry = onRetry)
        }

        val climate = climateState.data
        val history = remember(historyState.data) { chronoHistory(historyState.data.orEmpty()) }

        FadeIn { HvacStatusBanner(climate = climate, charging = charging) }
        FadeIn(delayMs = FADE_STEP_MS) { TemperatureGauges(climate = climate, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { ClimateStatusCards(climate = climate) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { ProtectionRow(climate = climate, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { ThermalComfortPanel(climate = climate) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { ClimateEfficiencyPanel(climate = climate, history = history) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { SeatHeaterGridPanel(climate = climate) }
        FadeIn(delayMs = FADE_STEP_MS * 7) {
            TemperatureHistoryPanel(history = history, loading = historyState.isLoading, prefs = prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS * 8) {
            AcFanHistoryPanel(history = history, loading = historyState.isLoading)
        }
        FadeIn(delayMs = FADE_STEP_MS * 9) {
            ClimateHistoryTablePanel(history = history, loading = historyState.isLoading, prefs = prefs)
        }
    }
}

/** The page chrome — title + muted subtitle (web `PageContainer` title/subtitle) + the vehicle picker + refresh. */
@Composable
private fun ClimateChrome(onRefresh: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_climate_title))
            BodyText(
                stringResource(R.string.translation_climate_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            VehicleSelect(withIcon = true)
            Button(
                label = stringResource(R.string.translation_climate_refresh),
                onClick = onRefresh,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = ClimateControlGlyphs.RefreshCw,
            )
        }
    }
}

/** The full-page loading skeleton shown before the first snapshot (web `PageContainer loading`). */
@Composable
private fun ClimateLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        PageHeaderSkeleton()
        StatGridSkeleton(count = 3)
        StatGridSkeleton(count = 3)
        ChartBlockSkeleton(height = GAUGE_PANEL_HEIGHT)
        ChartBlockSkeleton(height = LINE_CHART_HEIGHT)
    }
}

/** The data-load error surface (web `PageContainer error`) — a retry-able danger banner. */
@Composable
private fun ClimateErrorBanner(onRetry: () -> Unit) {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
        action =
            BannerAction(
                label = stringResource(R.string.translation_common_retry),
                onClick = onRetry,
            ),
    )
}

// ── GlassPanel3 — HVAC status banner ─────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel3 — the HVAC status banner (web `<GlassPanel glow={isAcOn ? 'cyan' : 'none'}>`): the power glyph, the
 * "HVAC System" label, the active/off + comfort badges, and the trailing keeper / defrost / battery-heater /
 * insufficient-power chips that surface only when their condition holds.
 */
@Composable
private fun HvacStatusBanner(
    climate: ClimateState?,
    charging: ChargingTelemetryFlags,
) {
    val acOn = climate?.isAcOn == true
    val comfort = comfortDisposition(climate?.insideTemp, climate?.driverTempSetting)
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(
                    ClimateControlGlyphs.Power,
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = if (acOn) CYAN else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                BodyText(stringResource(R.string.translation_climate_hvacSystem))
                Badge(
                    text = if (acOn) stringResource(R.string.translation_climate_active) else stringResource(R.string.translation_climate_off),
                    variant = if (acOn) BadgeVariant.Success else BadgeVariant.Neutral,
                )
                Badge(text = comfortDispositionLabel(comfort), variant = comfortVariant(comfort))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                val keeper = keeperMode(climate?.climateKeeperMode)
                if (keeper != KeeperMode.Off) {
                    Badge(text = keeperLabel(keeper), variant = keeperVariant(keeper), dot = true)
                }
                val defrost = climate?.defrostMode
                if (defrost != null && defrost != "Off") {
                    val suffix = if (defrost != "Normal") " ($defrost)" else ""
                    Badge(
                        text = stringResource(R.string.translation_climate_defrost) + suffix,
                        variant = BadgeVariant.Info,
                        dot = true,
                    )
                }
                if (climate?.batteryHeater == true) {
                    Badge(text = stringResource(R.string.translation_climate_batteryHeater), variant = BadgeVariant.Warning, dot = true)
                }
                if (charging.notEnoughPowerToHeat) {
                    Badge(text = stringResource(R.string.translation_climate_insufficientPower), variant = BadgeVariant.Danger, dot = true)
                }
            }
        }
    }
}

// ── GlassPanel4/5/6 — Temperature gauges ─────────────────────────────────────────────────────────────────────

/**
 * GlassPanel4/5/6 — the three RadialGauge temperature gauges (web `<RadialGauge>` ×3): inside, outside, and the
 * driver's set temperature, each converted to the user's unit, or an empty fallback when the reading is absent.
 */
@Composable
private fun TemperatureGauges(
    climate: ClimateState?,
    prefs: ClimateDisplayPrefs,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TemperatureGauge(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_climate_insideTemp),
            celsius = climate?.insideTemp,
            color = CYAN,
            prefs = prefs,
        )
        TemperatureGauge(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_climate_outsideTemp),
            celsius = climate?.outsideTemp,
            color = BLUE,
            prefs = prefs,
        )
        TemperatureGauge(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_climate_driverSetTemp),
            celsius = climate?.driverTempSetting,
            color = AMBER,
            prefs = prefs,
        )
    }
}

/** One gauge panel: a native [RadialGauge] in the user's unit, or the empty-state fallback when absent. */
@Composable
private fun TemperatureGauge(
    label: String,
    celsius: Double?,
    color: Color,
    prefs: ClimateDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (celsius != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    RadialGauge(
                        value = prefs.toTemperatureDisplay(celsius),
                        max = prefs.tempGaugeMax,
                        label = label,
                        unit = prefs.temperatureLabel,
                        color = color,
                        decimals = 1,
                    )
                    MetricValue(prefs.temperatureDisplay(celsius))
                }
            } else {
                EmptyState(
                    icon = ClimateControlGlyphs.Thermometer,
                    message = label,
                )
            }
        }
    }
}

// ── HVAC-Power … Rear-Display-HVAC — the thirteen climate-status cards ────────────────────────────────────────

/** A resolved metric-card model (already localized) for the climate-status + protection grids. */
private data class StatusCardModel(
    val key: String,
    val label: String,
    val value: String,
    val icon: ImageVector,
    val accent: Color,
    val subtitle: String? = null,
)

/**
 * The thirteen climate-status cards (web HVAC-Power … Rear-Display-HVAC `<MetricCard>`s): HVAC power, auto
 * conditioning, climate keeper, fan speed/status, the three steering-wheel cards, the three defrost cards, the wiper
 * heater, and the rear-display HVAC card — laid out two-per-row, each with its em-dash fallback.
 */
@Composable
private fun ClimateStatusCards(climate: ClimateState?) {
    StatusCardGrid(climateStatusCards(climate))
}

@Composable
private fun climateStatusCards(climate: ClimateState?): List<StatusCardModel> {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val on = stringResource(R.string.translation_climate_on)
    val off = stringResource(R.string.translation_climate_off)
    val swLevel = climate?.hvacSteeringWheelHeatLevel
    val fanStatus = climate?.hvacFanStatus
    return listOf(
        StatusCardModel(
            key = "HVAC-Power",
            label = stringResource(R.string.translation_climate_hvacPower),
            value = if (climate?.isAcOn == true) on else off,
            icon = ClimateControlGlyphs.Power,
            accent = if (climate?.isAcOn == true) CYAN else muted,
            subtitle = climate?.hvacPower?.let { "${stringResource(R.string.translation_climate_state)}: $it" },
        ),
        StatusCardModel(
            key = "Auto-Conditioning",
            label = stringResource(R.string.translation_climate_autoConditioning),
            value = if (climate?.hvacAutoMode != null && climate.hvacAutoMode != "Off") on else off,
            icon = ClimateControlGlyphs.Settings,
            accent = BLUE,
        ),
        StatusCardModel(
            key = "Climate-Keeper",
            label = stringResource(R.string.translation_climate_climateKeeper),
            value = keeperLabel(keeperMode(climate?.climateKeeperMode)),
            icon = ClimateControlGlyphs.ThermometerSun,
            accent = AMBER,
            subtitle =
                if (climate?.climateKeeperMode != null && climate.climateKeeperMode != "Off") {
                    stringResource(R.string.translation_climate_active)
                } else {
                    null
                },
        ),
        StatusCardModel(
            key = "Fan-Speed",
            label = stringResource(R.string.translation_climate_fanSpeed),
            value = (climate?.fanSpeed ?: 0).toString(),
            icon = ClimateControlGlyphs.Wind,
            accent = TEAL,
            subtitle = stringResource(R.string.translation_climate_level010),
        ),
        StatusCardModel(
            key = "Fan-Status",
            label = stringResource(R.string.translation_climate_fanStatus),
            value =
                when {
                    fanStatus == null -> EM_DASH
                    fanStatus > 0 -> stringResource(R.string.translation_climate_running)
                    else -> stringResource(R.string.translation_climate_idle)
                },
            icon = ClimateControlGlyphs.Wind,
            accent = if (fanStatus != null && fanStatus > 0) TEAL else muted,
            subtitle = fanStatus?.let { "${stringResource(R.string.translation_climate_code)} $it" },
        ),
        StatusCardModel(
            key = "Steering-Wheel-Heater",
            label = stringResource(R.string.translation_climate_steeringWheelHeater),
            value = if (swLevel != null && swLevel > 0) on else off,
            icon = ClimateControlGlyphs.CircleGauge,
            accent = if (swLevel != null && swLevel > 0) AMBER else muted,
        ),
        StatusCardModel(
            key = "Steering-Wheel-Heat-Level",
            label = stringResource(R.string.translation_climate_steeringWheelHeatLevel),
            value = if (swLevel == null) EM_DASH else heatLevelLabel(heatOrdinal(swLevel)),
            icon = ClimateControlGlyphs.Flame,
            accent = if (swLevel != null) heatColor(heatOrdinal(swLevel), muted) else muted,
            subtitle = swLevel?.let { "${stringResource(R.string.translation_climate_level)} $it" },
        ),
        StatusCardModel(
            key = "Steering-Wheel-Heat-Auto",
            label = stringResource(R.string.translation_climate_steeringWheelHeatAuto),
            value =
                when (climate?.hvacSteeringWheelHeatAuto) {
                    null -> EM_DASH
                    true -> stringResource(R.string.translation_climate_auto)
                    false -> stringResource(R.string.translation_climate_manual)
                },
            icon = ClimateControlGlyphs.Activity,
            accent = if (climate?.hvacSteeringWheelHeatAuto == true) AMBER else muted,
        ),
        StatusCardModel(
            key = "Defrost-Mode",
            label = stringResource(R.string.translation_climate_defrostMode),
            value =
                if (climate?.defrostMode != null && climate.defrostMode != "Off") climate.defrostMode else off,
            icon = ClimateControlGlyphs.Snowflake,
            accent = if (climate?.defrostMode != null && climate.defrostMode != "Off") BLUE else muted,
        ),
        StatusCardModel(
            key = "Defrost-for-Preconditioning",
            label = stringResource(R.string.translation_climate_defrostForPreconditioning),
            value =
                when (climate?.defrostForPreconditioning) {
                    null -> EM_DASH
                    true -> stringResource(R.string.translation_climate_active)
                    false -> stringResource(R.string.translation_climate_inactive)
                },
            icon = ClimateControlGlyphs.Snowflake,
            accent = if (climate?.defrostForPreconditioning == true) CYAN else muted,
            subtitle =
                if (climate?.defrostForPreconditioning == true) {
                    stringResource(R.string.translation_climate_clearingWindshield)
                } else {
                    null
                },
        ),
        StatusCardModel(
            key = "Rear-Defrost",
            label = stringResource(R.string.translation_climate_rearDefrost),
            value =
                when (climate?.rearDefrostEnabled) {
                    null -> EM_DASH
                    true -> on
                    false -> off
                },
            icon = ClimateControlGlyphs.Snowflake,
            accent = if (climate?.rearDefrostEnabled == true) BLUE else muted,
            subtitle =
                if (climate?.rearDefrostEnabled == true) stringResource(R.string.translation_climate_clearingRearWindow) else null,
        ),
        StatusCardModel(
            key = "Wiper-Heater",
            label = stringResource(R.string.translation_climate_wiperHeater),
            value =
                when (climate?.wiperHeatEnabled) {
                    null -> EM_DASH
                    true -> on
                    false -> off
                },
            icon = ClimateControlGlyphs.Flame,
            accent = if (climate?.wiperHeatEnabled == true) ORANGE else muted,
            subtitle =
                if (climate?.wiperHeatEnabled == true) stringResource(R.string.translation_climate_heatingWipers) else null,
        ),
        StatusCardModel(
            key = "Rear-Display-HVAC",
            label = stringResource(R.string.translation_climate_rearDisplayHvac),
            value =
                when (climate?.rearDisplayHvacEnabled) {
                    null -> EM_DASH
                    true -> stringResource(R.string.translation_climate_enabled)
                    false -> stringResource(R.string.translation_climate_disabled)
                },
            icon = ClimateControlGlyphs.Monitor,
            accent = if (climate?.rearDisplayHvacEnabled == true) CYAN else muted,
            subtitle =
                if (climate?.rearDisplayHvacEnabled == true) {
                    stringResource(R.string.translation_climate_rearPassengersControl)
                } else {
                    null
                },
        ),
    )
}

// ── Overheat-Protection … Passenger-Setting — the four protection cards ───────────────────────────────────────

/**
 * Overheat-Protection / Overheat-Temp-Limit / Battery-Heater / Passenger-Setting — the four protection-and-safety
 * `<MetricCard>`s (web protection row), two per row with their em-dash / unknown fallbacks.
 */
@Composable
private fun ProtectionRow(
    climate: ClimateState?,
    prefs: ClimateDisplayPrefs,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val cards =
        listOf(
            StatusCardModel(
                key = "Overheat-Protection",
                label = stringResource(R.string.translation_climate_overheatProtection),
                value = climate?.overheatProtection ?: stringResource(R.string.translation_climate_unknown),
                icon = ClimateControlGlyphs.ShieldCheck,
                accent = GREEN,
            ),
            StatusCardModel(
                key = "Overheat-Temp-Limit",
                label = stringResource(R.string.translation_climate_overheatTempLimit),
                value = climate?.cabinOverheatProtectionTempLimit ?: EM_DASH,
                icon = ClimateControlGlyphs.ThermometerSun,
                accent = ORANGE,
            ),
            StatusCardModel(
                key = "Battery-Heater",
                label = stringResource(R.string.translation_climate_batteryHeater),
                value =
                    if (climate?.batteryHeater == true) {
                        stringResource(R.string.translation_climate_on)
                    } else {
                        stringResource(R.string.translation_climate_off)
                    },
                icon = ClimateControlGlyphs.BatteryCharging,
                accent = if (climate?.batteryHeater == true) AMBER else muted,
            ),
            StatusCardModel(
                key = "Passenger-Setting",
                label = stringResource(R.string.translation_climate_passengerSetting),
                value = climate?.passengerTempSetting?.let { prefs.temperatureDisplay(it) } ?: EM_DASH,
                icon = ClimateControlGlyphs.Thermometer,
                accent = PURPLE,
            ),
        )
    StatusCardGrid(cards)
}

/** Renders [cards] as a two-column grid of [MetricCard]s (web `grid-cols-2`), padding the last row. */
@Composable
private fun StatusCardGrid(cards: List<StatusCardModel>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        cards.chunked(2).forEach { rowCards ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowCards.forEach { card ->
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        label = card.label,
                        value = card.value,
                        icon = card.icon,
                        accent = card.accent,
                        subtitle = card.subtitle,
                    )
                }
                repeat(2 - rowCards.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// ── GlassPanel24 — Thermal comfort indicator ─────────────────────────────────────────────────────────────────

/**
 * GlassPanel24 — the thermal-comfort indicator (web `Thermal Comfort` panel) wrapping the three GlassPanel25/26/27
 * tiles: the comfort score ring, the temperature-delta ring, and the cabin-status ring.
 */
@Composable
private fun ThermalComfortPanel(climate: ClimateState?) {
    val score = comfortScore(climate?.insideTemp, climate?.driverTempSetting)
    val delta = tempDelta(climate?.insideTemp, climate?.driverTempSetting)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(icon = ClimateControlGlyphs.Thermometer, tint = CYAN, title = stringResource(R.string.translation_climate_thermalComfort))
        Spacer(Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ComfortScoreTile(modifier = Modifier.weight(1f), score = score)
            TempDeltaTile(modifier = Modifier.weight(1f), delta = delta)
            ComfortStatusTile(modifier = Modifier.weight(1f), score = score, delta = delta)
        }
    }
}

/** GlassPanel25 — the comfort-score ring (web `Comfort Score` tile). */
@Composable
private fun ComfortScoreTile(
    score: Double?,
    modifier: Modifier = Modifier,
) {
    val rating = comfortRating(score)
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        ComfortTile(
            caption = stringResource(R.string.translation_climate_comfortScore),
            ringColor = ratingColor(rating),
        ) {
            MetricValue(score?.roundToInt()?.toString() ?: EM_DASH)
        }
        Spacer(Modifier.height(Spacing.xs))
        Badge(text = comfortRatingLabel(rating), variant = ratingVariant(rating))
    }
}

/** GlassPanel26 — the temperature-delta ring (web `Temp Delta` tile). */
@Composable
private fun TempDeltaTile(
    delta: Double?,
    modifier: Modifier = Modifier,
) {
    val target = deltaTarget(delta)
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        ComfortTile(
            caption = stringResource(R.string.translation_climate_tempDelta),
            ringColor = deltaColor(delta),
        ) {
            MetricValue(delta?.let { "${if (it > 0) "+" else ""}${trimDelta(it)}" } ?: EM_DASH)
        }
        Spacer(Modifier.height(Spacing.xs))
        Caption(
            when (target) {
                DeltaTarget.Near -> stringResource(R.string.translation_climate_nearTarget)
                DeltaTarget.Above -> stringResource(R.string.translation_climate_aboveTarget)
                DeltaTarget.Below -> stringResource(R.string.translation_climate_belowTarget)
                null -> stringResource(R.string.translation_climate_na)
            },
        )
    }
}

/** GlassPanel27 — the cabin-status ring (web `Status` tile): a warm/cold/comfortable glyph + badge. */
@Composable
private fun ComfortStatusTile(
    score: Double?,
    delta: Double?,
    modifier: Modifier = Modifier,
) {
    val rating = comfortRating(score)
    val status = deltaStatus(delta)
    val comfort = comfortDispositionFromDelta(delta)
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        ComfortTile(
            caption = stringResource(R.string.translation_climate_status),
            ringColor = ratingColor(rating),
        ) {
            Icon(
                imageVector =
                    when (status) {
                        DeltaStatus.TooWarm -> ClimateControlGlyphs.Sun
                        DeltaStatus.TooCold -> ClimateControlGlyphs.Snowflake
                        DeltaStatus.Comfortable -> ClimateControlGlyphs.Wind
                    },
                contentDescription = null,
                size = IconSize.Lg,
                tint =
                    when (status) {
                        DeltaStatus.TooWarm -> AMBER
                        DeltaStatus.TooCold -> CYAN
                        DeltaStatus.Comfortable -> GREEN
                    },
            )
        }
        Spacer(Modifier.height(Spacing.xs))
        Badge(
            text =
                when (status) {
                    DeltaStatus.TooWarm -> stringResource(R.string.translation_climate_tooWarm)
                    DeltaStatus.TooCold -> stringResource(R.string.translation_climate_tooCold)
                    DeltaStatus.Comfortable -> stringResource(R.string.translation_climate_comfortable)
                },
            variant = comfortVariant(comfort),
        )
    }
}

/** A comfort tile: the muted [caption], the tinted circular ring, and its centered [content]. */
@Composable
private fun ComfortTile(
    caption: String,
    ringColor: Color,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(caption)
        Box(
            modifier =
                Modifier
                    .size(COMFORT_RING_SIZE)
                    .clip(CircleShape)
                    .background(ringColor.copy(alpha = RING_BG_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            content()
        }
    }
}

// ── GlassPanel28 — Climate efficiency ────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel28 — the climate-efficiency panel (web `Climate Efficiency`) wrapping the Avg-Fan-Speed, Peak-Fan-Speed,
 * AC-On-Time, and Comfort-Score `<MetricCard>`s, each with its em-dash fallback until history loads.
 */
@Composable
private fun ClimateEfficiencyPanel(
    climate: ClimateState?,
    history: List<ClimateState>,
) {
    val stats = remember(history) { efficiencyStats(history) }
    val score = comfortScore(climate?.insideTemp, climate?.driverTempSetting)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val level010 = stringResource(R.string.translation_climate_level010)
    val cards =
        listOf(
            StatusCardModel(
                key = "Avg-Fan-Speed",
                label = stringResource(R.string.translation_climate_avgFanSpeed),
                value = stats?.let { fmt1(it.avgFan) } ?: EM_DASH,
                icon = ClimateControlGlyphs.Wind,
                accent = CYAN,
                subtitle = level010,
            ),
            StatusCardModel(
                key = "Peak-Fan-Speed",
                label = stringResource(R.string.translation_climate_peakFanSpeed),
                value = stats?.let { fmt1(it.peakFan) } ?: EM_DASH,
                icon = ClimateControlGlyphs.Wind,
                accent = PURPLE,
                subtitle = level010,
            ),
            StatusCardModel(
                key = "AC-On-Time",
                label = stringResource(R.string.translation_climate_acOnTime),
                value = stats?.let { "${it.acOnPct.roundToInt()}%" } ?: EM_DASH,
                icon = ClimateControlGlyphs.Zap,
                accent = AMBER,
                subtitle = stringResource(R.string.translation_climate_ofSamples),
            ),
            StatusCardModel(
                key = "Comfort-Score",
                label = stringResource(R.string.translation_climate_comfortScore),
                value = score?.let { "${it.roundToInt()}%" } ?: EM_DASH,
                icon = ClimateControlGlyphs.Thermometer,
                accent = if (score != null && score >= COMFORT_GREEN_MIN) GREEN else AMBER,
            ),
        )
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(icon = ClimateControlGlyphs.Activity, tint = CYAN, title = stringResource(R.string.translation_climate_climateEfficiency))
        Spacer(Modifier.height(Spacing.md))
        StatusCardGrid(cards)
    }
}

// ── GlassPanel33 — Seat heater grid ──────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel33 — the seat-heater grid (web `Seat Heaters`): the front + rear [SeatHeaterCard]s, the auto-seat-climate
 * chips, the seat-cooling [SeatCoolingCard]s with the ventilation badge, and the heat-level legend.
 */
@Composable
private fun SeatHeaterGridPanel(climate: ClimateState?) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(icon = ClimateControlGlyphs.Flame, tint = AMBER, title = stringResource(R.string.translation_climate_seatHeaters))
        Spacer(Modifier.height(Spacing.md))

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SeatHeaterCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatFrontLeft), level = climate?.seatHeaterLeft)
            SeatHeaterCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatFrontRight), level = climate?.seatHeaterRight)
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            AutoClimateChip(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_autoClimateLeft), auto = climate?.autoSeatClimateLeft)
            AutoClimateChip(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_autoClimateRight), auto = climate?.autoSeatClimateRight)
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SeatHeaterCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatRearLeft), level = climate?.seatHeaterRearLeft)
            SeatHeaterCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatRearCenter), level = climate?.seatHeaterRearCenter)
            SeatHeaterCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatRearRight), level = climate?.seatHeaterRearRight)
        }

        Spacer(Modifier.height(Spacing.md))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(ClimateControlGlyphs.Snowflake, contentDescription = null, size = IconSize.Sm, tint = SKY)
                SectionTitle(stringResource(R.string.translation_climate_seatCooling))
            }
            val vent = climate?.seatVentEnabled
            val ventValue =
                when (vent) {
                    null -> EM_DASH
                    true -> stringResource(R.string.translation_climate_on)
                    false -> stringResource(R.string.translation_climate_off)
                }
            Badge(
                text = "${stringResource(R.string.translation_climate_ventilation)}: $ventValue",
                variant = if (vent == true) BadgeVariant.Success else BadgeVariant.Neutral,
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            SeatCoolingCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatFrontLeft), level = climate?.climateSeatCoolingFrontLeft)
            SeatCoolingCard(modifier = Modifier.weight(1f), label = stringResource(R.string.translation_climate_seatFrontRight), level = climate?.climateSeatCoolingFrontRight)
        }

        Spacer(Modifier.height(Spacing.md))
        HeatLegend()
    }
}

/** GlassPanel1 — the reusable seat-heater card (web `SeatHeaterCard`): a flame glyph + label + level badge. */
@Composable
private fun SeatHeaterCard(
    label: String,
    level: Int?,
    modifier: Modifier = Modifier,
) {
    val ordinal = heatOrdinal(level)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(ClimateControlGlyphs.Flame, contentDescription = null, size = IconSize.Lg, tint = heatColor(ordinal, muted))
            Caption(label)
            Badge(text = "${heatLevelLabel(ordinal)} ($ordinal/$HEAT_SCALE)", variant = heatBadgeVariant(ordinal))
        }
    }
}

/** GlassPanel2 — the reusable seat-cooling card (web `SeatCoolingCard`): a snowflake glyph + label + level badge. */
@Composable
private fun SeatCoolingCard(
    label: String,
    level: Int?,
    modifier: Modifier = Modifier,
) {
    val ordinal = coolOrdinal(level)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(ClimateControlGlyphs.Snowflake, contentDescription = null, size = IconSize.Lg, tint = coolColor(ordinal, muted))
            Caption(label)
            if (level != null) {
                Badge(text = "${heatLevelLabel(ordinal)} ($ordinal/$HEAT_SCALE)", variant = coolBadgeVariant(ordinal))
            } else {
                Caption(EM_DASH)
            }
        }
    }
}

/** An auto-seat-climate chip (web auto-climate row): the label + an Auto/Manual badge or an em-dash. */
@Composable
private fun AutoClimateChip(
    label: String,
    auto: Boolean?,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(label)
            if (auto != null) {
                Badge(
                    text =
                        if (auto) stringResource(R.string.translation_climate_auto) else stringResource(R.string.translation_climate_manual),
                    variant = if (auto) BadgeVariant.Success else BadgeVariant.Neutral,
                )
            } else {
                Caption(EM_DASH)
            }
        }
    }
}

/** The heat-level legend (web legend): a flame swatch + `"{n} — {label}"` row per level. */
@Composable
private fun HeatLegend() {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        for (ordinal in 0..HEAT_SCALE) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(ClimateControlGlyphs.Flame, contentDescription = null, size = IconSize.Sm, tint = heatColor(ordinal, muted))
                Caption("$ordinal \u2014 ${heatLevelLabel(ordinal)}")
            }
        }
    }
}

// ── GlassPanel34 — Temperature history (LineChart) ───────────────────────────────────────────────────────────

/**
 * GlassPanel34 — the temperature-history LineChart (web `<LineChart>`): the inside / outside / driver-set series in
 * the user's unit over a shared time axis, with loading / empty fallbacks.
 */
@Composable
private fun TemperatureHistoryPanel(
    history: List<ClimateState>,
    loading: Boolean,
    prefs: ClimateDisplayPrefs,
) {
    val data = remember(history, prefs) { temperatureChartData(history, prefs) }
    val title = stringResource(R.string.translation_climate_temperatureHistory)
    val insideLabel = stringResource(R.string.translation_climate_insideTemp)
    val outsideLabel = stringResource(R.string.translation_climate_outsideTemp)
    val driverLabel = stringResource(R.string.translation_climate_driverSetTemp)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = title,
        status = chartStatus(loading, data.hasData),
        height = LINE_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_a11y_chartFigure, title),
        emptyMessage = stringResource(R.string.translation_climate_noTempHistory),
        dataTableHeader = listOf(stringResource(R.string.translation_climate_time), insideLabel, outsideLabel, driverLabel),
        dataTableRows =
            history.indices.map { i ->
                listOf(
                    data.xLabels.getOrElse(i) { "" },
                    data.inside.getOrNull(i)?.let { prefs.number(it) } ?: EM_DASH,
                    data.outside.getOrNull(i)?.let { prefs.number(it) } ?: EM_DASH,
                    data.driverSet.getOrNull(i)?.let { prefs.number(it) } ?: EM_DASH,
                )
            },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(key = "inside", label = insideLabel, values = data.inside, color = CYAN, unit = prefs.temperatureLabel),
                    ChartSeries(key = "outside", label = outsideLabel, values = data.outside, color = BLUE, unit = prefs.temperatureLabel),
                    ChartSeries(key = "driverSet", label = driverLabel, values = data.driverSet, color = AMBER, unit = prefs.temperatureLabel),
                ),
            xLabels = data.xLabels,
            height = LINE_CHART_HEIGHT,
            yValueFormatter = { prefs.number(it) },
            emptyMessage = stringResource(R.string.translation_climate_noTempHistory),
        )
    }
}

// ── GlassPanel35 — AC state & fan speed (AreaChart) ──────────────────────────────────────────────────────────

/**
 * GlassPanel35 — the AC-state + fan-speed history (web `<AreaChart>` with a stepped AC `<Area>` + a fan `<Line>`).
 * The native counterpart renders the AC On/Off as a filled area and the fan speed as a line over the same time axis
 * via the A3 [ComboChart], with loading / empty fallbacks.
 */
@Composable
private fun AcFanHistoryPanel(
    history: List<ClimateState>,
    loading: Boolean,
) {
    val data = remember(history) { acFanChartData(history) }
    val title = stringResource(R.string.translation_climate_acStateFanSpeed)
    val acLabel = stringResource(R.string.translation_climate_acOnOff)
    val fanLabel = stringResource(R.string.translation_climate_fanSpeed)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = title,
        status = chartStatus(loading, data.hasData),
        height = LINE_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_a11y_chartFigure, title),
        emptyMessage = stringResource(R.string.translation_climate_noHvacHistory),
        dataTableHeader = listOf(stringResource(R.string.translation_climate_time), stringResource(R.string.translation_climate_ac), fanLabel),
        dataTableRows =
            history.indices.map { i ->
                listOf(
                    data.xLabels.getOrElse(i) { "" },
                    if ((data.acActive.getOrNull(i) ?: 0.0) > 0.0) stringResource(R.string.translation_climate_on) else stringResource(R.string.translation_climate_off),
                    data.fanSpeed.getOrNull(i)?.roundToInt()?.toString() ?: EM_DASH,
                )
            },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Caption(stringResource(R.string.translation_climate_ac))
                Caption(stringResource(R.string.translation_climate_fanLevel))
            }
            ComboChart(
                series =
                    listOf(
                        ChartSeries(key = "ac", label = acLabel, values = data.acActive, kind = ChartSeriesKind.Area, color = CYAN),
                        ChartSeries(key = "fan", label = fanLabel, values = data.fanSpeed, kind = ChartSeriesKind.Line, color = PURPLE),
                    ),
                xLabels = data.xLabels,
                height = LINE_CHART_HEIGHT,
                yValueFormatter = { fmt1(it) },
                emptyMessage = stringResource(R.string.translation_climate_noHvacHistory),
            )
        }
    }
}

// ── GlassPanel36 — Climate history table ─────────────────────────────────────────────────────────────────────

/**
 * GlassPanel36 — the climate-history table (web `<DataTable>`): sortable Time / Inside / Outside / Set-Temp / Fan /
 * HVAC / Climate-Keeper rows over the 7-day history, with loading / empty fallbacks.
 */
@Composable
private fun ClimateHistoryTablePanel(
    history: List<ClimateState>,
    loading: Boolean,
    prefs: ClimateDisplayPrefs,
) {
    val unit = prefs.temperatureLabel
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelHeader(icon = ClimateControlGlyphs.CircleGauge, tint = PURPLE, title = stringResource(R.string.translation_climate_climateHistory))
        Spacer(Modifier.height(Spacing.md))
        when {
            loading -> TableSkeleton(rows = 6, columns = 5)
            history.isEmpty() ->
                EmptyState(message = stringResource(R.string.translation_climate_noHistoryRecords))
            else -> ClimateHistoryTable(history = history, unit = unit, prefs = prefs)
        }
    }
}

/** The sortable history [DataTable] over the climate rows (web `useSortToggle` + `<DataTable>`). */
@Composable
private fun ClimateHistoryTable(
    history: List<ClimateState>,
    unit: String,
    prefs: ClimateDisplayPrefs,
) {
    var sort by remember { mutableStateOf(SortState(key = "timestamp", direction = SortDirection.Desc)) }
    val sorted =
        remember(history, sort) {
            val column = climateHistoryColumnOf(sort.key ?: "timestamp") ?: ClimateHistoryColumn.Timestamp
            sortClimateHistory(history, column, ascending = sort.direction == SortDirection.Asc)
        }
    val on = stringResource(R.string.translation_climate_on)
    val off = stringResource(R.string.translation_climate_off)
    val columns =
        listOf(
            TableColumn<ClimateState>(
                key = "timestamp",
                header = stringResource(R.string.translation_climate_time),
                weight = 1.6f,
                sortable = true,
                cell = { BodyText(it.timestamp?.let(::clockLabel)?.takeIf { s -> s.isNotBlank() } ?: EM_DASH) },
            ),
            TableColumn(
                key = "insideTemp",
                header = "${stringResource(R.string.translation_climate_inside)} $unit",
                sortable = true,
                cell = { BodyText(it.insideTemp?.let { c -> prefs.number(prefs.toTemperatureDisplay(c)) } ?: EM_DASH) },
            ),
            TableColumn(
                key = "outsideTemp",
                header = "${stringResource(R.string.translation_climate_outside)} $unit",
                sortable = true,
                cell = { BodyText(it.outsideTemp?.let { c -> prefs.number(prefs.toTemperatureDisplay(c)) } ?: EM_DASH) },
            ),
            TableColumn(
                key = "driverTempSetting",
                header = "${stringResource(R.string.translation_climate_setTemp)} $unit",
                sortable = true,
                cell = { BodyText(it.driverTempSetting?.let { c -> prefs.number(prefs.toTemperatureDisplay(c)) } ?: EM_DASH) },
            ),
            TableColumn(
                key = "fanSpeed",
                header = stringResource(R.string.translation_climate_fan),
                sortable = true,
                cell = { BodyText(it.fanSpeed?.toString() ?: EM_DASH) },
            ),
            TableColumn(
                key = "isAcOn",
                header = stringResource(R.string.translation_climate_hvac),
                cell = { Badge(text = if (it.isAcOn == true) on else off, variant = if (it.isAcOn == true) BadgeVariant.Success else BadgeVariant.Neutral) },
            ),
            TableColumn(
                key = "climateKeeperMode",
                header = stringResource(R.string.translation_climate_climateKeeper),
                weight = 1.4f,
                cell = {
                    val keeper = keeperMode(it.climateKeeperMode)
                    Badge(text = keeperLabel(keeper), variant = keeperVariant(keeper))
                },
            ),
        )
    DataTable(
        columns = columns,
        rows = sorted,
        keyOf = { it.id?.toString() ?: it.timestamp ?: it.hashCode().toString() },
        sortState = sort,
        onSortChange = { sort = sort.toggledBy(it) },
        emptyText = stringResource(R.string.translation_climate_noHistoryRecords),
    )
}

// ── Shared sub-components ────────────────────────────────────────────────────────────────────────────────────

/** A panel header: a tinted [icon] + a [title] (web ``<div className="mb-4 flex items-center gap-2">``). */
@Composable
private fun PanelHeader(
    icon: ImageVector,
    tint: Color,
    title: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = tint)
        SectionTitle(title)
    }
}

// ── String + colour resolvers ────────────────────────────────────────────────────────────────────────────────

private const val COMFORT_GREEN_MIN = 80.0

/** The localized heat-level label for an ordinal `0..3` (web HEAT_LEVELS label). */
@Composable
private fun heatLevelLabel(ordinal: Int): String =
    when (ordinal) {
        0 -> stringResource(R.string.translation_climate_off)
        1 -> stringResource(R.string.translation_climate_levelLow)
        2 -> stringResource(R.string.translation_climate_levelMedium)
        else -> stringResource(R.string.translation_climate_levelHigh)
    }

/** The localized Climate-Keeper label for a folded mode (web `keeperLabel`). */
@Composable
private fun keeperLabel(mode: KeeperMode): String =
    when (mode) {
        KeeperMode.On -> stringResource(R.string.translation_climate_on)
        KeeperMode.DogMode -> stringResource(R.string.translation_climate_dogMode)
        KeeperMode.CampMode -> stringResource(R.string.translation_climate_campMode)
        KeeperMode.Off -> stringResource(R.string.translation_climate_off)
    }

/** The localized comfort-disposition label (web `comfortBadge.label`). */
@Composable
private fun comfortDispositionLabel(disposition: ComfortDisposition): String =
    when (disposition) {
        ComfortDisposition.Comfortable -> stringResource(R.string.translation_climate_comfortable)
        ComfortDisposition.Adjusting -> stringResource(R.string.translation_climate_adjusting)
        ComfortDisposition.FarFromTarget -> stringResource(R.string.translation_climate_farFromTarget)
    }

/** The localized comfort-rating label (web `Excellent` / `Moderate` / `Poor`). */
@Composable
private fun comfortRatingLabel(rating: ComfortRating?): String =
    when (rating) {
        ComfortRating.Excellent -> stringResource(R.string.translation_climate_excellent)
        ComfortRating.Moderate -> stringResource(R.string.translation_climate_moderate)
        ComfortRating.Poor, null -> stringResource(R.string.translation_climate_poor)
    }

/** Web `comfortBadge` variant — the same disposition recomputed from the signed delta for the status tile. */
private fun comfortDispositionFromDelta(delta: Double?): ComfortDisposition {
    val d = abs(delta ?: 0.0)
    return when {
        d <= 1.0 -> ComfortDisposition.Comfortable
        d <= 3.0 -> ComfortDisposition.Adjusting
        else -> ComfortDisposition.FarFromTarget
    }
}

private fun comfortVariant(disposition: ComfortDisposition): BadgeVariant =
    when (disposition) {
        ComfortDisposition.Comfortable -> BadgeVariant.Success
        ComfortDisposition.Adjusting -> BadgeVariant.Warning
        ComfortDisposition.FarFromTarget -> BadgeVariant.Danger
    }

private fun ratingVariant(rating: ComfortRating?): BadgeVariant =
    when (rating) {
        ComfortRating.Excellent -> BadgeVariant.Success
        ComfortRating.Moderate -> BadgeVariant.Warning
        ComfortRating.Poor, null -> BadgeVariant.Danger
    }

private fun keeperVariant(mode: KeeperMode): BadgeVariant =
    when (mode) {
        KeeperMode.On -> BadgeVariant.Info
        KeeperMode.DogMode -> BadgeVariant.Warning
        KeeperMode.CampMode -> BadgeVariant.Info
        KeeperMode.Off -> BadgeVariant.Neutral
    }

private fun heatBadgeVariant(ordinal: Int): BadgeVariant =
    when (ordinal) {
        0 -> BadgeVariant.Neutral
        1 -> BadgeVariant.Info
        2 -> BadgeVariant.Warning
        else -> BadgeVariant.Danger
    }

private fun coolBadgeVariant(ordinal: Int): BadgeVariant =
    if (ordinal <= 0) BadgeVariant.Neutral else BadgeVariant.Info

private fun heatColor(
    ordinal: Int,
    muted: Color,
): Color =
    when (ordinal) {
        0 -> muted
        1 -> CYAN
        2 -> AMBER
        else -> RED
    }

private fun coolColor(
    ordinal: Int,
    muted: Color,
): Color =
    when (ordinal) {
        0 -> muted
        1 -> SKY
        2 -> CYAN
        else -> BLUE
    }

private fun ratingColor(rating: ComfortRating?): Color =
    when (rating) {
        ComfortRating.Excellent -> GREEN
        ComfortRating.Moderate -> AMBER
        ComfortRating.Poor, null -> RED
    }

/** The temp-delta ring colour: |delta| ≤ 1 green, ≤ 3 amber, else red; null → muted (web bg classes). */
private fun deltaColor(delta: Double?): Color =
    when {
        delta == null -> GREEN
        abs(delta) <= 1.0 -> GREEN
        abs(delta) <= 3.0 -> AMBER
        else -> RED
    }

/** Chart lifecycle for a feed: still loading → Loading, no data → Empty, else Ready. */
private fun chartStatus(
    loading: Boolean,
    hasData: Boolean,
): ChartStatus =
    when {
        loading -> ChartStatus.Loading
        !hasData -> ChartStatus.Empty
        else -> ChartStatus.Ready
    }

/** Grouped one-decimal number in the default locale (the chart axis / fan-speed formatter). */
private fun fmt1(value: Double): String = io.teslasync.android.components.charts.ChartFormat.number(value, 1)

/** The signed delta string without a trailing `.0` (web shows the raw JS number, e.g. `2.5` / `-1` / `0`). */
private fun trimDelta(value: Double): String {
    val rounded = (value * 10).roundToInt() / 10.0
    return if (rounded % 1.0 == 0.0) rounded.toInt().toString() else rounded.toString()
}
