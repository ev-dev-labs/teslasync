// The native Jetpack Compose + Material 3 FleetComparePage analytics surface — a parity port of
// web/src/features/analytics/pages/FleetComparePage.tsx, the side-by-side two-vehicle comparison. It reproduces
// the page's panels (the disambiguation banner, the two cross-disabled vehicle selectors, the two current-status
// cards, the overlaid monthly-distance line chart, the drives-per-month bar chart, the lifetime comparison table,
// and the four key-highlight stat cards), every data state (loading / empty / error / content), and every visible
// string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [FleetComparePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the eight feeds + the interaction snapshot + the live
// display prefs); [FleetComparePageContent] is the stateless render layer. The single-vehicle guard and the page
// chrome (title + subtitle + loading/error) flow through the shared PageContainer; each panel resolves its own
// content/empty/loading/error surface so no region is ever blank. All derivation lives in the framework-free
// model (FleetComparePageModel.kt); this file resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.fleetcompare

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer
import io.teslasync.android.sharedsurfaces.select.Select
import io.teslasync.android.sharedsurfaces.select.SelectOption
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.JsonElement

/** The two overlaid chart heights (web `ChartContainer height={300}` / `height={280}`). */
private val MONTHLY_CHART_HEIGHT = 300.dp
private val DRIVES_CHART_HEIGHT = 280.dp

/** The current-status battery bar height (web `h-2`). */
private val BATTERY_BAR_HEIGHT = 8.dp

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in milliseconds. */
private const val FADE_STEP_MS = 50

/** Series keys for the two overlaid vehicles. */
private const val KEY_A = "a"
private const val KEY_B = "b"

/** The CO₂ unit suffix the comparison + highlight rows append (web hardcodes ` kg`). */
private const val CO2_UNIT = "kg"

/** The em-dash shown for an absent value inside a status card (web `?? '—'`). */
private const val EM_DASH = "\u2014"

/** The chip-background opacity for the online status pill. */
private const val STATUS_PILL_BG_ALPHA = 0.12f

/**
 * The marker passed to [PageContainer] when the fleet list hard-fails with no cached fallback. It carries no
 * message, so the container shows its own localized server-error copy + the retry affordance (web query error).
 */
private val FleetCompareLoadError: Throwable = IllegalStateException()

/** The page's interaction callbacks, wired to the [FleetComparePageViewModel] (web event handlers). */
data class FleetCompareActions(
    val onSelectA: (String) -> Unit,
    val onSelectB: (String) -> Unit,
    val onDismissBanner: () -> Unit,
    val onRetry: () -> Unit,
    val onOpenPeriodCompare: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [FleetComparePageViewModel] over the supplied [source] (the host wires the
 * shared Vehicles + Analytics + Driving + Settings holders via [fleetCompareSourceOf]). [onOpenPeriodCompare] is
 * the host's navigation seam for the disambiguation banner's CTA (web `Link to="/period-compare"`); [logger]
 * defaults to the app's redacting logger.
 */
@Composable
fun FleetComparePage(
    source: FleetCompareSource,
    modifier: Modifier = Modifier,
    onOpenPeriodCompare: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: FleetComparePageViewModel =
        viewModel(
            key = FleetComparePageRegistration.SLUG,
            factory = viewModelFactory { initializer { FleetComparePageViewModel(source, logger) } },
        )
    FleetComparePage(viewModel = vm, modifier = modifier, onOpenPeriodCompare = onOpenPeriodCompare)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot + display prefs to the stateless content. */
@Composable
fun FleetComparePage(
    viewModel: FleetComparePageViewModel,
    modifier: Modifier = Modifier,
    onOpenPeriodCompare: () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val stateA by viewModel.stateA.collectAsStateWithLifecycle()
    val stateB by viewModel.stateB.collectAsStateWithLifecycle()
    val drivingStatsA by viewModel.drivingStatsA.collectAsStateWithLifecycle()
    val drivingStatsB by viewModel.drivingStatsB.collectAsStateWithLifecycle()
    val costA by viewModel.costA.collectAsStateWithLifecycle()
    val costB by viewModel.costB.collectAsStateWithLifecycle()
    val monthlyA by viewModel.monthlyA.collectAsStateWithLifecycle()
    val monthlyB by viewModel.monthlyB.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel, onOpenPeriodCompare) {
            FleetCompareActions(
                onSelectA = viewModel::setVehicleA,
                onSelectB = viewModel::setVehicleB,
                onDismissBanner = viewModel::dismissBanner,
                onRetry = viewModel::retry,
                onOpenPeriodCompare = onOpenPeriodCompare,
            )
        }

    FleetComparePageContent(
        interaction = interaction,
        vehiclesState = vehiclesState,
        stateA = stateA,
        stateB = stateB,
        drivingStatsA = drivingStatsA,
        drivingStatsB = drivingStatsB,
        costA = costA,
        costB = costB,
        monthlyA = monthlyA,
        monthlyB = monthlyB,
        prefs = prefs,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page chrome (title + subtitle + the vehicles-source loading/error surface), then
 * either the single-vehicle guard (web `vehicleList.length < 2`) or the full comparison body — banner, selectors,
 * status cards, the two overlaid charts, the lifetime table, and the key highlights.
 */
@Composable
fun FleetComparePageContent(
    interaction: FleetCompareInteraction,
    vehiclesState: UiState<List<Vehicle>>,
    stateA: UiState<VehicleStateEnvelope>,
    stateB: UiState<VehicleStateEnvelope>,
    drivingStatsA: UiState<JsonElement>,
    drivingStatsB: UiState<JsonElement>,
    costA: UiState<JsonElement>,
    costB: UiState<JsonElement>,
    monthlyA: UiState<JsonElement>,
    monthlyB: UiState<JsonElement>,
    prefs: FleetCompareDisplayPrefs,
    actions: FleetCompareActions,
    modifier: Modifier = Modifier,
) {
    val vehicleList = vehiclesState.data ?: emptyList()
    PageContainer(
        title = stringResource(R.string.translation_comparison_title),
        modifier = modifier,
        subtitle = stringResource(R.string.translation_comparison_subtitle),
        loading = vehiclesState.isLoading,
        error = if (vehiclesState.isError) FleetCompareLoadError else null,
        onRetry = actions.onRetry,
    ) {
        if (vehicleList.size < 2) {
            SingleVehicleGuard(actions = actions)
        } else {
            FleetCompareBody(
                vehicleList = vehicleList,
                interaction = interaction,
                stateA = stateA,
                stateB = stateB,
                drivingStatsA = drivingStatsA,
                drivingStatsB = drivingStatsB,
                costA = costA,
                costB = costB,
                monthlyA = monthlyA,
                monthlyB = monthlyB,
                prefs = prefs,
                actions = actions,
            )
        }
    }
}

/** Panel: the single-vehicle account guard — a focused empty state with a "manage vehicles" CTA (web guard). */
@Composable
private fun SingleVehicleGuard(actions: FleetCompareActions) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(
                icon = FleetCompareGlyphs.Car,
                title = stringResource(R.string.translation_fleetCompare_singleVehicle_title),
                message = stringResource(R.string.translation_fleetCompare_singleVehicle_body),
                action =
                    EmptyStateAction(
                        label = stringResource(R.string.translation_fleetCompare_singleVehicle_cta),
                        onClick = actions.onRetry,
                    ),
            )
        }
    }
}

/** The loaded comparison body — every panel, chart, table, and highlight, in the web's source order. */
@Composable
private fun FleetCompareBody(
    vehicleList: List<Vehicle>,
    interaction: FleetCompareInteraction,
    stateA: UiState<VehicleStateEnvelope>,
    stateB: UiState<VehicleStateEnvelope>,
    drivingStatsA: UiState<JsonElement>,
    drivingStatsB: UiState<JsonElement>,
    costA: UiState<JsonElement>,
    costB: UiState<JsonElement>,
    monthlyA: UiState<JsonElement>,
    monthlyB: UiState<JsonElement>,
    prefs: FleetCompareDisplayPrefs,
    actions: FleetCompareActions,
) {
    val vehicleA = remember(vehicleList, interaction.vehicleIdA) { vehicleList.firstOrNull { it.id.toString() == interaction.vehicleIdA } }
    val vehicleB = remember(vehicleList, interaction.vehicleIdB) { vehicleList.firstOrNull { it.id.toString() == interaction.vehicleIdB } }
    val nameA = vehicleA?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_comparison_vehicleA)
    val nameB = vehicleB?.displayName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_comparison_vehicleB)

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (interaction.bannerVisible) {
            FadeIn { DisambiguationBanner(actions = actions) }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            VehicleSelectors(vehicleList = vehicleList, interaction = interaction, actions = actions)
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            CurrentStatusSection(
                vehicleA = vehicleA,
                vehicleB = vehicleB,
                stateA = stateA,
                stateB = stateB,
                hasSelectionA = interaction.vehicleIdA.isNotBlank(),
                hasSelectionB = interaction.vehicleIdB.isNotBlank(),
                prefs = prefs,
            )
        }

        FadeIn(delayMs = FADE_STEP_MS * 3) {
            MonthlyDistanceChart(monthlyA = monthlyA, monthlyB = monthlyB, nameA = nameA, nameB = nameB, onRetry = actions.onRetry)
        }

        FadeIn(delayMs = FADE_STEP_MS * 4) {
            DrivesPerMonthChart(monthlyA = monthlyA, monthlyB = monthlyB, nameA = nameA, nameB = nameB, onRetry = actions.onRetry)
        }

        FadeIn(delayMs = FADE_STEP_MS * 5) {
            LifetimeComparisonTable(
                drivingStatsA = drivingStatsA,
                drivingStatsB = drivingStatsB,
                costA = costA,
                costB = costB,
                nameA = nameA,
                nameB = nameB,
                prefs = prefs,
            )
        }

        FadeIn(delayMs = FADE_STEP_MS * 6) {
            KeyHighlights(
                stateA = stateA,
                stateB = stateB,
                drivingStatsA = drivingStatsA,
                drivingStatsB = drivingStatsB,
                costA = costA,
                costB = costB,
                prefs = prefs,
            )
        }
    }
}

/** Panel: the disambiguation banner pointing period-comparison seekers to the right page (web `AlertBanner`). */
@Composable
private fun DisambiguationBanner(actions: FleetCompareActions) {
    AlertBanner(
        message = stringResource(R.string.translation_comparison_banner_toPeriodPrefix),
        tone = Tone.Info,
        icon = FleetCompareGlyphs.Calendar,
        action =
            BannerAction(
                label = stringResource(R.string.translation_comparison_banner_toPeriodCta),
                onClick = actions.onOpenPeriodCompare,
            ),
        onClose = actions.onDismissBanner,
        closeLabel = stringResource(R.string.translation_common_dismiss),
    )
}

/** Panel: the two cross-disabled vehicle selectors with the swap glyph between them (web `Select` × 2). */
@Composable
private fun VehicleSelectors(
    vehicleList: List<Vehicle>,
    interaction: FleetCompareInteraction,
    actions: FleetCompareActions,
) {
    val optionsA =
        remember(vehicleList, interaction.vehicleIdB) {
            vehicleList.map { v ->
                SelectOption(
                    value = v.id.toString(),
                    label = v.displayName.ifBlank { v.vin },
                    enabled = v.id.toString() != interaction.vehicleIdB,
                )
            }
        }
    val optionsB =
        remember(vehicleList, interaction.vehicleIdA) {
            vehicleList.map { v ->
                SelectOption(
                    value = v.id.toString(),
                    label = v.displayName.ifBlank { v.vin },
                    enabled = v.id.toString() != interaction.vehicleIdA,
                )
            }
        }
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Bottom,
        ) {
            Select(
                options = optionsA,
                selectedValue = interaction.vehicleIdA.ifBlank { null },
                onSelect = actions.onSelectA,
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_comparison_vehicleA),
            )
            Icon(
                imageVector = FleetCompareGlyphs.ArrowLeftRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                size = IconSize.Lg,
                modifier = Modifier.padding(bottom = Spacing.sm),
            )
            Select(
                options = optionsB,
                selectedValue = interaction.vehicleIdB.ifBlank { null },
                onSelect = actions.onSelectB,
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_comparison_vehicleB),
            )
        }
    }
}

/** Section: the "Current Status" header over the two side-by-side status cards (web `currentStatus` grid). */
@Composable
private fun CurrentStatusSection(
    vehicleA: Vehicle?,
    vehicleB: Vehicle?,
    stateA: UiState<VehicleStateEnvelope>,
    stateB: UiState<VehicleStateEnvelope>,
    hasSelectionA: Boolean,
    hasSelectionB: Boolean,
    prefs: FleetCompareDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Subhead(stringResource(R.string.translation_comparison_currentStatus))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            VehicleStatusCard(
                vehicle = vehicleA,
                stateUi = stateA,
                isLoading = stateA.isLoading && hasSelectionA,
                prefs = prefs,
                modifier = Modifier.weight(1f),
            )
            VehicleStatusCard(
                vehicle = vehicleB,
                stateUi = stateB,
                isLoading = stateB.isLoading && hasSelectionB,
                prefs = prefs,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** Panel: one vehicle's current-status card — loading skeleton, no-vehicle empty, or the status content. */
@Composable
private fun VehicleStatusCard(
    vehicle: Vehicle?,
    stateUi: UiState<VehicleStateEnvelope>,
    isLoading: Boolean,
    prefs: FleetCompareDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            isLoading -> SkeletonLines(lines = 5)
            vehicle == null ->
                EmptyState(
                    icon = FleetCompareGlyphs.Car,
                    message = stringResource(R.string.translation_comparison_selectVehicle),
                )
            else -> VehicleStatusContent(model = vehicleStatus(vehicle, stateUi.data, prefs))
        }
    }
}

/** The populated status-card body — header, battery (+ bar), range, temperature, security, and the status pill. */
@Composable
private fun VehicleStatusContent(model: VehicleStatusModel) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                imageVector = FleetCompareGlyphs.Car,
                contentDescription = null,
                tint = if (model.online) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant,
                size = IconSize.Md,
            )
            Column(modifier = Modifier.weight(1f)) {
                PanelTitle(model.name)
                if (model.subtitle != null) Caption(model.subtitle)
            }
        }

        StatusRow(
            icon = FleetCompareGlyphs.Battery,
            iconTint = TeslaTokens.status.success,
            label = stringResource(R.string.translation_comparison_battery),
        ) {
            BodyText(model.batteryLevel?.let { "$it%" } ?: EM_DASH)
        }
        if (model.batteryLevel != null) {
            BatteryBar(level = model.batteryLevel)
        }

        StatusRow(
            icon = FleetCompareGlyphs.Gauge,
            iconTint = TeslaTokens.status.info,
            label = stringResource(R.string.translation_comparison_range),
        ) {
            BodyText(model.rangeText)
        }

        StatusRow(
            icon = FleetCompareGlyphs.Thermometer,
            iconTint = TeslaTokens.status.warning,
            label = stringResource(R.string.translation_comparison_temp),
        ) {
            BodyText(model.tempText)
        }

        StatusRow(
            icon = FleetCompareGlyphs.Lock,
            iconTint = TeslaTokens.status.info,
            label = stringResource(R.string.translation_comparison_security),
        ) {
            if (model.hasState) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Caption(
                        if (model.isLocked) {
                            stringResource(R.string.translation_comparison_locked)
                        } else {
                            stringResource(R.string.translation_comparison_unlocked)
                        },
                    )
                    if (model.sentryMode) {
                        Icon(FleetCompareGlyphs.Shield, contentDescription = null, tint = TeslaTokens.status.info, size = IconSize.Xs)
                        Caption(stringResource(R.string.translation_comparison_sentry))
                    }
                }
            } else {
                BodyText(EM_DASH)
            }
        }

        StatusRow(
            icon = FleetCompareGlyphs.Wifi,
            iconTint = TeslaTokens.status.info,
            label = stringResource(R.string.translation_comparison_status),
        ) {
            StatusPill(
                text = model.rawStatus ?: stringResource(R.string.translation_comparison_unknown),
                online = model.online,
            )
        }
    }
}

/** One label↔value row inside a status card (a tinted leading glyph + muted label, then the trailing value slot). */
@Composable
private fun StatusRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    label: String,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(icon, contentDescription = null, tint = iconTint, size = IconSize.Sm)
            Caption(label)
        }
        trailing()
    }
}

/** The battery state-of-charge bar — a track with a tone-colored fill clamped to 0..100% (web `h-2` bar). */
@Composable
private fun BatteryBar(level: Long) {
    val tone =
        when (batteryTone(level)) {
            BatteryTone.Good -> TeslaTokens.status.success
            BatteryTone.Warning -> TeslaTokens.status.warning
            BatteryTone.Critical -> TeslaTokens.status.danger
        }
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(BATTERY_BAR_HEIGHT)
                .clip(RoundedCornerShape(percent = 50))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(batteryFillFraction(level))
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(percent = 50))
                    .background(tone),
        )
    }
}

/** The connection-status pill — a tinted rounded chip showing the state token (web `rounded-full` status badge). */
@Composable
private fun StatusPill(
    text: String,
    online: Boolean,
) {
    val bg = if (online) TeslaTokens.status.success.copy(alpha = STATUS_PILL_BG_ALPHA) else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (online) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(percent = 50))
                .background(bg)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
    ) {
        Text(text = text, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}

/** Panel: the overlaid monthly-distance line chart for both vehicles (web `Monthly Distance` `ChartContainer`). */
@Composable
private fun MonthlyDistanceChart(
    monthlyA: UiState<JsonElement>,
    monthlyB: UiState<JsonElement>,
    nameA: String,
    nameB: String,
    onRetry: () -> Unit,
) {
    val points =
        remember(monthlyA.data, monthlyB.data) {
            mergeMonthly(parseMonthlyBuckets(monthlyA.data), parseMonthlyBuckets(monthlyB.data))
        }
    val status = chartStatus(monthlyA, monthlyB, points.isNotEmpty())
    ChartContainer(
        title = stringResource(R.string.translation_comparison_monthlyDistance),
        status = status,
        height = MONTHLY_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_comparison_monthlyDistance_aria),
        emptyMessage = stringResource(R.string.translation_comparison_noMonthlyData),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_queryError_retry),
        onRetry = onRetry,
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(key = KEY_A, label = nameA, values = points.map { it.distA }, kind = ChartSeriesKind.Line),
                    ChartSeries(key = KEY_B, label = nameB, values = points.map { it.distB }, kind = ChartSeriesKind.Line),
                ),
            xLabels = points.map { it.month },
            height = MONTHLY_CHART_HEIGHT,
            emptyMessage = stringResource(R.string.translation_comparison_noMonthlyData),
        )
    }
}

/** Panel: the drives-per-month bar chart for both vehicles (web `Drives per Month` `ChartContainer`). */
@Composable
private fun DrivesPerMonthChart(
    monthlyA: UiState<JsonElement>,
    monthlyB: UiState<JsonElement>,
    nameA: String,
    nameB: String,
    onRetry: () -> Unit,
) {
    val points =
        remember(monthlyA.data, monthlyB.data) {
            mergeMonthly(parseMonthlyBuckets(monthlyA.data), parseMonthlyBuckets(monthlyB.data))
        }
    val status = chartStatus(monthlyA, monthlyB, points.isNotEmpty())
    ChartContainer(
        title = stringResource(R.string.translation_comparison_drivesPerMonth),
        status = status,
        height = DRIVES_CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_comparison_drivesPerMonth_aria),
        emptyMessage = stringResource(R.string.translation_comparison_noDrivesData),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_queryError_retry),
        onRetry = onRetry,
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(key = KEY_A, label = nameA, values = points.map { it.drivesA }, kind = ChartSeriesKind.Bar),
                    ChartSeries(key = KEY_B, label = nameB, values = points.map { it.drivesB }, kind = ChartSeriesKind.Bar),
                ),
            xLabels = points.map { it.month },
            height = DRIVES_CHART_HEIGHT,
            emptyMessage = stringResource(R.string.translation_comparison_noDrivesData),
        )
    }
}

/** Panel: the lifetime stats comparison table (web `DataTable` with winner cells) under its lifetime note. */
@Composable
private fun LifetimeComparisonTable(
    drivingStatsA: UiState<JsonElement>,
    drivingStatsB: UiState<JsonElement>,
    costA: UiState<JsonElement>,
    costB: UiState<JsonElement>,
    nameA: String,
    nameB: String,
    prefs: FleetCompareDisplayPrefs,
) {
    val statsLoading = drivingStatsA.isLoading || drivingStatsB.isLoading
    val labels =
        ComparisonLabels(
            totalDrives = stringResource(R.string.translation_comparison_totalDrives),
            totalDistance = stringResource(R.string.translation_comparison_totalDistance),
            avgEfficiency = stringResource(R.string.translation_comparison_avgEfficiency),
            avgSpeed = stringResource(R.string.translation_comparison_avgSpeed),
            topSpeed = stringResource(R.string.translation_comparison_topSpeed),
            regenRatio = stringResource(R.string.translation_comparison_regenRatio),
            co2Saved = stringResource(R.string.translation_comparison_co2Saved),
            chargingCost = stringResource(R.string.translation_comparison_chargingCost),
            totalEnergy = stringResource(R.string.translation_comparison_totalEnergy),
            chargeSessions = stringResource(R.string.translation_comparison_chargeSessions),
        )
    val metricHeader = stringResource(R.string.translation_comparison_metric)
    val rows =
        remember(drivingStatsA.data, drivingStatsB.data, costA.data, costB.data, prefs, labels) {
            comparisonRows(
                statsA = parseDrivingStats(drivingStatsA.data),
                statsB = parseDrivingStats(drivingStatsB.data),
                costA = parseCostSummary(costA.data),
                costB = parseCostSummary(costB.data),
                prefs = prefs,
                labels = labels,
                co2Unit = CO2_UNIT,
            )
        }

    GlassPanel(padding = PanelPadding.Md) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(FleetCompareGlyphs.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = IconSize.Sm)
            Caption(stringResource(R.string.translation_comparison_lifetimeNote))
        }
        if (statsLoading) {
            SkeletonLines(lines = 8, modifier = Modifier.padding(top = Spacing.sm))
        } else {
            Column(modifier = Modifier.padding(top = Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                ComparisonHeaderRow(metric = metricHeader, nameA = nameA, nameB = nameB)
                rows.forEach { row -> ComparisonDataRow(row = row) }
            }
        }
    }
}

/** The comparison table's header row (Metric | vehicle A | vehicle B). */
@Composable
private fun ComparisonHeaderRow(
    metric: String,
    nameA: String,
    nameB: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(metric, modifier = Modifier.weight(1f))
        Caption(nameA, modifier = Modifier.weight(1f))
        Caption(nameB, modifier = Modifier.weight(1f))
    }
}

/** One comparison data row: the metric label and the two winner-aware value cells. */
@Composable
private fun ComparisonDataRow(row: ComparisonRow) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BodyText(row.metric, modifier = Modifier.weight(1f))
        WinnerCell(value = row.valueA, isWinner = row.winnerSide == WinnerSide.A, modifier = Modifier.weight(1f))
        WinnerCell(value = row.valueB, isWinner = row.winnerSide == WinnerSide.B, modifier = Modifier.weight(1f))
    }
}

/** A single comparison value cell — green with a trailing check when it wins, else the default body tone. */
@Composable
private fun WinnerCell(
    value: String,
    isWinner: Boolean,
    modifier: Modifier = Modifier,
) {
    BodyText(
        text = if (isWinner) "$value \u2713" else value,
        modifier = modifier,
        color = if (isWinner) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurface,
    )
}

/** Section: the four key-highlight stat cards (web `Key Highlights` grid). */
@Composable
private fun KeyHighlights(
    stateA: UiState<VehicleStateEnvelope>,
    stateB: UiState<VehicleStateEnvelope>,
    drivingStatsA: UiState<JsonElement>,
    drivingStatsB: UiState<JsonElement>,
    costA: UiState<JsonElement>,
    costB: UiState<JsonElement>,
    prefs: FleetCompareDisplayPrefs,
) {
    val statsLoading = drivingStatsA.isLoading || drivingStatsB.isLoading
    val statsA = parseDrivingStats(drivingStatsA.data)
    val statsB = parseDrivingStats(drivingStatsB.data)
    val cA = parseCostSummary(costA.data)
    val cB = parseCostSummary(costB.data)

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Subhead(stringResource(R.string.translation_comparison_highlights))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_comparison_batteryDiff),
                value = batteryHighlightValue(stateA.data?.state, stateB.data?.state),
                modifier = Modifier.weight(1f),
                icon = FleetCompareGlyphs.Battery,
                loading = stateA.isLoading || stateB.isLoading,
            )
            StatCard(
                label = stringResource(R.string.translation_comparison_efficiencyDiff),
                value = efficiencyHighlightValue(statsA, statsB, prefs),
                modifier = Modifier.weight(1f),
                unit = prefs.efficiencyUnitLabel,
                icon = FleetCompareGlyphs.Zap,
                loading = statsLoading,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_comparison_costDiff),
                value = costHighlightValue(cA, cB, prefs),
                modifier = Modifier.weight(1f),
                icon = FleetCompareGlyphs.DollarSign,
            )
            StatCard(
                label = stringResource(R.string.translation_comparison_co2Diff),
                value = co2HighlightValue(statsA, statsB, prefs),
                modifier = Modifier.weight(1f),
                unit = CO2_UNIT,
                icon = FleetCompareGlyphs.Leaf,
                loading = statsLoading,
            )
        }
    }
}

/**
 * Folds the two per-vehicle monthly feeds into a single chart lifecycle: still-loading with nothing merged is
 * Loading, a hard error with nothing merged is Error (retry), no merged points is Empty, otherwise Ready. Once
 * any data merges it renders Ready so a one-sided result still draws (web shows the chart whenever data exists).
 */
private fun chartStatus(
    a: UiState<*>,
    b: UiState<*>,
    hasPoints: Boolean,
): ChartStatus =
    when {
        hasPoints -> ChartStatus.Ready
        a.isLoading || b.isLoading -> ChartStatus.Loading
        a.isError || b.isError -> ChartStatus.Error
        else -> ChartStatus.Empty
    }
