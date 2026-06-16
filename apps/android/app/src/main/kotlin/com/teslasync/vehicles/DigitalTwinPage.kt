// The native Jetpack Compose + Material 3 DigitalTwinPage vehicles surface — a parity port of
// web/src/features/vehicles/pages/DigitalTwinPage.tsx, the real-time vehicle physical-state ("digital twin")
// dashboard. It reproduces the page's five GlassPanels (the no-vehicles empty panel, the main VehicleTwin
// visualization panel with its paint picker + last-updated caption, and the doors / windows / security-&-status side
// panels), every data state (loading skeleton / no-vehicles empty / content, plus the cache-then-network stale/offline
// tier the bound state holders carry and a hard-error retry surface), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [DigitalTwinPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the four feeds + the active-vehicle selection); [DigitalTwinPageContent]
// is the stateless render layer. The `/vehicles` feed drives the primary loading / empty / content lifecycle (web
// `vehiclesLoading` + the `!vehicle` empty branch) and supplies the selected vehicle's exterior colour; the
// `/vehicles/{id}/state` + `/security/latest` + `/charging-telemetry/latest` feeds are merged by the framework-free
// model (`buildTwinState`) into the VehicleTwin physical state and the badge status, and projected into the doors /
// windows / security rows — exactly as the web page threads its hooks through `buildTwinState` + `deriveVehicleStatus`.
// The only display formatting is the locale-aware last-updated time applied here at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `TooManyFunctions` / `LongMethod` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)

package io.teslasync.android.vehicles.digitaltwin

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.sharedsurfaces.vehiclepaintpicker.VehiclePaintPicker
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwin
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinSize
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` delay cascade 0.05/0.10/0.15), in ms per ordinal. */
private const val FADE_STEP_MS = 50

/** The loading-skeleton heights for the visualization block and each side panel. */
private val TWIN_VIZ_SKELETON_HEIGHT = 240.dp
private val SIDE_PANEL_SKELETON_HEIGHT = 140.dp

/** The page's interaction callbacks, wired to the [DigitalTwinPageViewModel] (web event handlers). */
data class DigitalTwinActions(
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DigitalTwinPageViewModel] over the supplied [source] (the host wires the shared
 * resilient client + the app-scoped active-vehicle selection via [digitalTwinPageSourceOf]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun DigitalTwinPage(
    source: DigitalTwinPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DigitalTwinPageViewModel =
        viewModel(
            key = DigitalTwinPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DigitalTwinPageViewModel(source, logger) } },
        )
    DigitalTwinPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + the active-vehicle selection to the stateless content. */
@Composable
fun DigitalTwinPage(
    viewModel: DigitalTwinPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val vehicleStateState by viewModel.vehicleStateState.collectAsStateWithLifecycle()
    val securityState by viewModel.securityState.collectAsStateWithLifecycle()
    val chargingState by viewModel.chargingState.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()

    val actions = remember(viewModel) { DigitalTwinActions(onRetry = viewModel::retry) }

    DigitalTwinPageContent(
        vehiclesState = vehiclesState,
        vehicleStateState = vehicleStateState,
        securityState = securityState,
        chargingState = chargingState,
        selectedVehicleId = selectedVehicleId,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The header (title + subtitle + freshness + vehicle picker) is always drawn; the body then
 * resolves on the vehicles feed: a first load renders the skeleton, a hard error the retry surface, an empty fleet the
 * no-vehicles panel (web `!vehicle && !vehiclesLoading`), otherwise the twin body (which renders its own side-panel
 * empty states inline so no region ever blanks).
 */
@Composable
fun DigitalTwinPageContent(
    vehiclesState: UiState<List<TwinVehicle>>,
    vehicleStateState: UiState<VehicleStateSnapshot?>,
    securityState: UiState<SecuritySnapshot?>,
    chargingState: UiState<ChargingSnapshot?>,
    selectedVehicleId: Long?,
    actions: DigitalTwinActions,
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
        DigitalTwinHeader(vehiclesState = vehiclesState)

        when {
            vehiclesState.isLoading -> DigitalTwinLoading()
            vehiclesState.isError -> DigitalTwinError(onRetry = actions.onRetry)
            vehiclesState.isEmpty -> NoVehiclesPanel()
            else ->
                DigitalTwinBody(
                    vehicles = vehiclesState.data.orEmpty(),
                    selectedVehicleId = selectedVehicleId,
                    security = securityState.data,
                    vehicleState = vehicleStateState.data,
                    charging = chargingState.data,
                )
        }
    }
}

/** The page header — title + muted subtitle + the query-freshness chip + the active-vehicle picker (web actions). */
@Composable
private fun DigitalTwinHeader(vehiclesState: UiState<List<TwinVehicle>>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_digitalTwin_title))
                BodyText(
                    stringResource(R.string.translation_digitalTwin_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = vehiclesState.fetchedAt?.takeIf { it > 0L },
                isFetching = vehiclesState.refreshing,
                isStale = vehiclesState.stale,
                isError = vehiclesState.hasError,
                compact = true,
            )
        }
        VehicleSelect(withIcon = true)
    }
}

/** The full-page loading skeleton shown before the first vehicles response (web `PageContainer loading`). */
@Composable
private fun DigitalTwinLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        ChartBlockSkeleton(height = TWIN_VIZ_SKELETON_HEIGHT)
        ChartBlockSkeleton(height = SIDE_PANEL_SKELETON_HEIGHT)
        ChartBlockSkeleton(height = SIDE_PANEL_SKELETON_HEIGHT)
        ChartBlockSkeleton(height = SIDE_PANEL_SKELETON_HEIGHT)
    }
}

/** The hard-error surface for the vehicles feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun DigitalTwinError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_loadFailed),
                onRetry = onRetry,
            )
        }
    }
}

/** GlassPanel1 — the no-vehicles empty state (web `!vehicle && !vehiclesLoading`). */
@Composable
private fun NoVehiclesPanel() {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(
                message = stringResource(R.string.translation_digitalTwin_noVehicles),
                icon = NavGlyphs.Car,
            )
        }
    }
}

// ── Loaded body ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The loaded surface — the VehicleTwin visualization panel and the doors / windows / security-&-status side panels.
 * The three per-vehicle feeds are merged by the framework-free [buildTwinState] into the [VehicleTwinState] the twin
 * draws and into the side-panel rows; the badge status is derived by [deriveBadgeStatus]. The doors + windows panels
 * show their own empty surfaces until security data arrives (web `securityData ? <KVList /> : <EmptyState />`).
 */
@Composable
private fun DigitalTwinBody(
    vehicles: List<TwinVehicle>,
    selectedVehicleId: Long?,
    security: SecuritySnapshot?,
    vehicleState: VehicleStateSnapshot?,
    charging: ChargingSnapshot?,
) {
    val twin = remember(security, vehicleState, charging) { buildTwinState(security, vehicleState, charging) }
    val badgeStatus =
        remember(twin, vehicleState, security, charging) {
            deriveBadgeStatus(twin, vehicleState, hasSecurity = security != null, hasCharging = charging != null)
        }
    val selectedVehicle =
        remember(vehicles, selectedVehicleId) {
            vehicles.firstOrNull { it.id == selectedVehicleId } ?: vehicles.firstOrNull()
        }
    val lastUpdated = remember(security) { lastUpdatedTime(security?.createdAt) }

    FadeIn { TwinVisualizationPanel(twin = twin, vehicle = selectedVehicle, lastUpdated = lastUpdated) }
    FadeIn(delayMs = FADE_STEP_MS) { TwinDoorsPanel(twin = twin, hasSecurity = security != null) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { TwinWindowsPanel(twin = twin, hasSecurity = security != null) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { TwinSecurityPanel(twin = twin, badgeStatus = badgeStatus) }
}

/** GlassPanel2 — the main VehicleTwin visualization + the paint picker + the last-updated caption. */
@Composable
private fun TwinVisualizationPanel(
    twin: VehicleTwinState,
    vehicle: TwinVehicle?,
    lastUpdated: String?,
) {
    val twinDescription = stringResource(R.string.translation_digitalTwin_title)
    GlassPanel(
        padding = PanelPadding.Lg,
        modifier = Modifier.semantics { contentDescription = twinDescription },
    ) {
        VehicleTwin(
            twinState = twin,
            size = VehicleTwinSize.Lg,
            interactive = true,
            driveIn = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (vehicle != null && vehicle.id > 0L) {
            Spacer(Modifier.height(Spacing.md))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                VehiclePaintPicker(vehicleId = vehicle.id, exteriorColor = vehicle.exteriorColor)
            }
        }
        if (lastUpdated != null) {
            Spacer(Modifier.height(Spacing.sm))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                HelperText("${stringResource(R.string.translation_digitalTwin_lastUpdated)}: $lastUpdated")
            }
        }
    }
}

/** GlassPanel3 — the doors & openings panel (web `doorItems` KVList, or the no-door-data empty state). */
@Composable
private fun TwinDoorsPanel(
    twin: VehicleTwinState,
    hasSecurity: Boolean,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_digitalTwin_doorsTitle))
        Spacer(Modifier.height(Spacing.sm))
        if (hasSecurity) {
            KVList(items = twinItems(doorRows(twin)))
        } else {
            EmptyState(
                message = stringResource(R.string.translation_digitalTwin_noDoorData),
                icon = TeslaGlyphs.Info,
            )
        }
    }
}

/** GlassPanel4 — the windows panel (web `windowItems` KVList, or the no-window-data empty state). */
@Composable
private fun TwinWindowsPanel(
    twin: VehicleTwinState,
    hasSecurity: Boolean,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_digitalTwin_windowsTitle))
        Spacer(Modifier.height(Spacing.sm))
        if (hasSecurity) {
            KVList(items = twinItems(windowRows(twin)))
        } else {
            EmptyState(
                message = stringResource(R.string.translation_digitalTwin_noWindowData),
                icon = TeslaGlyphs.Info,
            )
        }
    }
}

/** GlassPanel5 — the security & status panel (web `securityItems` KVList + the live `StatusBadge`). */
@Composable
private fun TwinSecurityPanel(
    twin: VehicleTwinState,
    badgeStatus: String,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_digitalTwin_securityTitle))
        Spacer(Modifier.height(Spacing.sm))
        KVList(items = twinItems(securityRows(twin)))
        Spacer(Modifier.height(Spacing.md))
        StatusBadge(status = badgeStatus)
    }
}

// ── String resolution at the render boundary (ADR-014) ────────────────────────────────────────────────────────

/** Resolves the model's [TwinRow] tokens to localized [KVItem]s (label + value) at the render boundary. */
@Composable
private fun twinItems(rows: List<TwinRow>): List<KVItem> =
    rows.map { KVItem(label = stringResource(labelRes(it.label)), value = valueText(it.value)) }

/** Localizes a [TwinValue] cell, or renders the em dash for an unknown value (web `'—'` / `windowLabel` default). */
@Composable
private fun valueText(value: TwinValue): String =
    when (value) {
        TwinValue.Open -> stringResource(R.string.translation_common_open)
        TwinValue.Closed -> stringResource(R.string.translation_common_closed)
        TwinValue.Partial -> stringResource(R.string.translation_widget_doorWindow_partial)
        TwinValue.Yes -> stringResource(R.string.translation_common_yes)
        TwinValue.No -> stringResource(R.string.translation_common_no)
        TwinValue.Active -> stringResource(R.string.translation_common_active)
        TwinValue.Inactive -> stringResource(R.string.translation_common_inactive)
        TwinValue.On -> stringResource(R.string.translation_common_on)
        TwinValue.Off -> stringResource(R.string.translation_common_off)
        TwinValue.Occupied -> stringResource(R.string.translation_digitalTwin_occupied)
        TwinValue.Empty -> stringResource(R.string.translation_digitalTwin_empty)
        TwinValue.Charging -> stringResource(R.string.translation_digitalTwin_charging)
        TwinValue.Dash -> TWIN_EM_DASH
    }

/** Maps a [TwinLabel] token to its generated string resource (web key names preserved). */
@StringRes
private fun labelRes(label: TwinLabel): Int =
    when (label) {
        TwinLabel.DoorDriverFront -> R.string.translation_digitalTwin_doorDriverFront
        TwinLabel.DoorPassengerFront -> R.string.translation_digitalTwin_doorPassengerFront
        TwinLabel.DoorDriverRear -> R.string.translation_digitalTwin_doorDriverRear
        TwinLabel.DoorPassengerRear -> R.string.translation_digitalTwin_doorPassengerRear
        TwinLabel.Frunk -> R.string.translation_digitalTwin_frunk
        TwinLabel.Trunk -> R.string.translation_digitalTwin_trunk
        TwinLabel.WindowFD -> R.string.translation_digitalTwin_windowFD
        TwinLabel.WindowFP -> R.string.translation_digitalTwin_windowFP
        TwinLabel.WindowRD -> R.string.translation_digitalTwin_windowRD
        TwinLabel.WindowRP -> R.string.translation_digitalTwin_windowRP
        TwinLabel.Locked -> R.string.translation_digitalTwin_locked
        TwinLabel.Driving -> R.string.translation_digitalTwin_driving
        TwinLabel.Charging -> R.string.translation_digitalTwin_charging
        TwinLabel.SentryMode -> R.string.translation_digitalTwin_sentryMode
        TwinLabel.ChargePort -> R.string.translation_digitalTwin_chargePort
        TwinLabel.DriverSeat -> R.string.translation_digitalTwin_driverSeat
        TwinLabel.Headlights -> R.string.translation_digitalTwin_headlights
        TwinLabel.Hazards -> R.string.translation_digitalTwin_hazards
    }
