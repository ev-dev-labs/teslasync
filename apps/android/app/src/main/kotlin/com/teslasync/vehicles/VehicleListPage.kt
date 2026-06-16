// The native Jetpack Compose + Material 3 VehicleListPage fleet surface — a parity port of
// web/src/features/vehicles/pages/VehicleListPage.tsx, the fleet overview + management page. It reproduces the
// page's sync feedback banners, the four fleet-summary MetricCards (total vehicles, avg battery, total range,
// charging/online), the fleet-battery-status panel of per-vehicle battery bars, the pinned-sorted list of vehicle
// cards (each with its status badge, battery bar, range/odometer/charger stats, lock + sentry glyphs, pin /
// open-detail / remove actions), the remove-confirmation dialog, every data state (loading skeleton / empty /
// error-retry / content, plus the cache-then-network stale/offline tier the bound holder carries), and every
// visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [VehicleListPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the vehicles feed + the per-vehicle states + the pins +
// the live display preferences + the sync/delete lifecycles); [VehicleListPageContent] is the stateless render
// layer. The feeds are folded by the framework-free model (deriveVehicleListData) into the slices the panels read
// — exactly as the web page threads its `vehicles`, `fleetStates`, and pin list through its `fleet` memo, its
// `sortedVehicleList` memo, and the per-card derivations. SI values are converted to the user's units only here
// at the display boundary via the model's prefs helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.vehicles.vehiclelist

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.PinButton
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.vehiclecard.VehicleCardGlyphs
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.notifications.NotificationRouteMap
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` delay cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The battery-bar track height in the fleet-battery-status panel (web `h-3`). */
private val BATTERY_BAR_HEIGHT: Dp = 10.dp

/** The compact battery-bar height inside a vehicle card (web `h-2`). */
private val CARD_BATTERY_BAR_HEIGHT: Dp = 6.dp

/** The compact battery-bar width inside a vehicle card (web `w-20`). */
private val CARD_BATTERY_BAR_WIDTH: Dp = 80.dp

/** The per-vehicle name-column battery-bar width in the battery-status panel (web `w-24`). */
private val PANEL_NAME_WIDTH: Dp = 96.dp

/** The vehicle-card top accent strip height (web `h-1`). */
private val CARD_ACCENT_HEIGHT: Dp = 3.dp

private const val BATTERY_FILL_START_ALPHA = 0.55f
private const val BATTERY_TRACK_ALPHA = 0.35f
private const val PERCENT_MAX = 100

/**
 * The vehicle-card top accent gradient (web `from-cyan-400 via-purple-400 to-green-400`). A decorative brand
 * gradient (dynamic gradient stops, not semantic status text), mirroring the DrivesList trend-colour precedent.
 */
private val CARD_ACCENT_GRADIENT: List<Color> =
    listOf(Color(0xFF22D3EE), Color(0xFFA855F7), Color(0xFF34D399))

/** The page's interaction callbacks, wired to the [VehicleListPageViewModel] (web event handlers). */
data class VehicleListActions(
    val onSync: () -> Unit,
    val onRequestDelete: (Vehicle) -> Unit,
    val onConfirmDelete: () -> Unit,
    val onCancelDelete: () -> Unit,
    val onTogglePin: (Long, Boolean) -> Unit,
    val onRetry: () -> Unit,
    val onOpenRoute: (String) -> Unit,
)

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [VehicleListPageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Pinned + Settings holders via [vehicleListPageSourceOf]). [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun VehicleListPage(
    source: VehicleListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: VehicleListPageViewModel =
        viewModel(
            key = VehicleListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { VehicleListPageViewModel(source, logger) } },
        )
    VehicleListPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + mutation lifecycles to the stateless content. */
@Composable
fun VehicleListPage(
    viewModel: VehicleListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val fleetStates by viewModel.fleetStates.collectAsStateWithLifecycle()
    val pins by viewModel.pins.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val syncStatus by viewModel.syncStatus.collectAsStateWithLifecycle()
    val deleteTarget by viewModel.deleteTarget.collectAsStateWithLifecycle()
    val deleting by viewModel.deleting.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val syncToastMsg = stringResource(R.string.translation_vehicles_syncToast)
    val syncFailedMsg = stringResource(R.string.translation_vehicles_syncFailed)
    val deleteSuccessMsg = stringResource(R.string.translation_vehicles_deleteSuccess)
    val deleteFailedMsg = stringResource(R.string.translation_vehicles_deleteFailed)
    val toastMessages =
        remember(syncToastMsg, syncFailedMsg, deleteSuccessMsg, deleteFailedMsg) {
            mapOf(
                VEHICLES_SYNC_TOAST_KEY to syncToastMsg,
                VEHICLES_SYNC_FAILED_KEY to syncFailedMsg,
                VEHICLES_DELETE_SUCCESS_KEY to deleteSuccessMsg,
                VEHICLES_DELETE_FAILED_KEY to deleteFailedMsg,
            )
        }
    LaunchedEffect(viewModel, context, toastMessages) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) {
                toastMessages[event.messageKey]?.let { message ->
                    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    val actions =
        remember(viewModel, context) {
            VehicleListActions(
                onSync = viewModel::sync,
                onRequestDelete = viewModel::requestDelete,
                onConfirmDelete = viewModel::confirmDelete,
                onCancelDelete = viewModel::cancelDelete,
                onTogglePin = viewModel::togglePin,
                onRetry = viewModel::retry,
                onOpenRoute = { path -> openRoute(context, path) },
            )
        }

    VehicleListPageContent(
        vehiclesState = vehiclesState,
        fleetStates = fleetStates,
        pins = pins,
        prefs = prefs,
        syncStatus = syncStatus,
        deleteTarget = deleteTarget,
        deleting = deleting,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton; otherwise
 * the page header is drawn, then either the hard-error retry panel (web error `PageContainer`), the no-vehicles
 * empty state, or the loaded body (summary cards + battery-status panel + the vehicle-card list) — so no region
 * ever blanks. The remove-confirmation dialog is overlaid in every non-loading state.
 */
@Composable
fun VehicleListPageContent(
    vehiclesState: UiState<List<Vehicle>>,
    fleetStates: Map<Long, io.teslasync.shared.core.api.generated.VehicleState?>,
    pins: List<io.teslasync.shared.core.presentation.pinned.PinnedItem>,
    prefs: VehicleListDisplayPrefs,
    syncStatus: SyncStatus,
    deleteTarget: Vehicle?,
    deleting: Boolean,
    actions: VehicleListActions,
    modifier: Modifier = Modifier,
) {
    if (vehiclesState.isLoading) {
        VehicleListSkeleton(modifier)
        return
    }

    val vehicles = vehiclesState.data.orEmpty()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        VehicleListHeader(
            state = vehiclesState,
            vehicleCount = vehicles.size,
            syncing = syncStatus == SyncStatus.Loading,
            showActions = !vehiclesState.isError,
            vehicles = vehicles,
            actions = actions,
        )

        if (vehiclesState.isError) {
            VehicleListErrorPanel(onRetry = actions.onRetry)
        } else {
            SyncBanners(syncStatus = syncStatus)

            if (vehiclesState.isEmpty) {
                VehicleListEmpty(onSync = actions.onSync)
            } else {
                val data =
                    remember(vehicles, fleetStates, pins, prefs) {
                        deriveVehicleListData(vehicles, fleetStates, pins, prefs)
                    }
                val pinnedIds = remember(pins) { pins.map { it.itemId }.toSet() }

                FadeIn(delayMs = FADE_STEP_MS) { FleetSummary(metrics = data.metrics) }
                FadeIn(delayMs = FADE_STEP_MS * 2) {
                    FleetBatteryPanel(bars = data.batteryBars, avgRounded = data.metrics.avgBatteryRounded)
                }
                FadeIn(delayMs = FADE_STEP_MS * 3) { AllVehiclesHeader() }
                data.rows.forEachIndexed { index, row ->
                    FadeIn(delayMs = FADE_STEP_MS * (4 + index)) {
                        VehicleCard(
                            row = row,
                            pinned = pinnedIds.contains(row.vehicle.id.toString()),
                            actions = actions,
                        )
                    }
                }
            }
        }
    }

    if (deleteTarget != null) {
        val name = deleteTarget.displayName.ifBlank { deleteTarget.vin }
        ConfirmDialog(
            title = stringResource(R.string.translation_vehicles_removeTitle),
            message = stringResource(R.string.translation_vehicles_removeMessage, name),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = actions.onConfirmDelete,
            onCancel = actions.onCancelDelete,
            loading = deleting,
        )
    }
}

// ── Loading skeleton ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors the loaded layout while the fleet list loads: the title, four summary stat tiles, the fleet hero panel,
 * then three vehicle-row tiles (web `VehicleListSkeleton`). Keeps CLS at zero when the real list arrives.
 */
@Composable
private fun VehicleListSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_nav_vehicles))
        StatGridSkeleton(count = 4)
        Skeleton(height = 140.dp, rounded = true)
        repeat(3) {
            Skeleton(height = 110.dp, rounded = true)
        }
    }
}

// ── Header ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page header — the title + muted subtitle + freshness chip, plus the compare + sync action buttons. */
@Composable
private fun VehicleListHeader(
    state: UiState<List<Vehicle>>,
    vehicleCount: Int,
    syncing: Boolean,
    showActions: Boolean,
    vehicles: List<Vehicle>,
    actions: VehicleListActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_nav_vehicles))
                BodyText(
                    stringResource(R.string.translation_vehicles_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }

        if (showActions) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (vehicleCount >= VehicleListPageRegistration.COMPARE_MIN_VEHICLES) {
                    Button(
                        label = stringResource(R.string.translation_vehicles_compareButton),
                        onClick = { actions.onOpenRoute(compareRoute(vehicles)) },
                        variant = ButtonVariant.Outline,
                        size = ButtonSize.Sm,
                        leadingIcon = DataDisplayGlyphs.ArrowRight,
                    )
                }
                Button(
                    label = stringResource(R.string.translation_vehicles_syncButton),
                    onClick = actions.onSync,
                    size = ButtonSize.Sm,
                    loading = syncing,
                    leadingIcon = FeedbackGlyphs.Refresh,
                )
            }
        }
    }
}

// ── Error panel (GlassPanel1) ─────────────────────────────────────────────────────────────────────────────────

/** The hard-error surface for the vehicles feed (web error `PageContainer` GlassPanel) — a retry-able panel. */
@Composable
private fun VehicleListErrorPanel(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_vehicles_loadError),
                title = stringResource(R.string.translation_queryError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

// ── Sync banners (GlassPanel2 / GlassPanel3) ──────────────────────────────────────────────────────────────────

/** The sync success / error feedback banners (web `syncMut.isSuccess` / `syncMut.isError` GlassPanels). */
@Composable
private fun SyncBanners(syncStatus: SyncStatus) {
    when (syncStatus) {
        SyncStatus.Success ->
            FadeIn {
                GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Success) {
                    BodyText(
                        stringResource(R.string.translation_vehicles_syncSuccess),
                        color = TeslaTokens.status.success,
                    )
                }
            }

        SyncStatus.Error ->
            FadeIn {
                GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Danger) {
                    BodyText(
                        stringResource(R.string.translation_vehicles_syncError),
                        color = TeslaTokens.status.danger,
                    )
                }
            }

        SyncStatus.Idle, SyncStatus.Loading -> Unit
    }
}

// ── Empty state ───────────────────────────────────────────────────────────────────────────────────────────────

/** The no-vehicles empty state with a sync CTA (web `EmptyState` with the sync action). */
@Composable
private fun VehicleListEmpty(onSync: () -> Unit) {
    EmptyState(
        message = stringResource(R.string.translation_vehicles_emptyMessage),
        icon = NavGlyphs.Car,
        title = stringResource(R.string.translation_vehicles_emptyTitle),
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_vehicles_syncButton),
                onClick = onSync,
            ),
    )
}

// ── Fleet summary (Total-Vehicles / Avg-Battery / MetricCard6 / Charging-Online) ──────────────────────────────

/** The four fleet-summary MetricCards in a 2×2 responsive grid (web 1/2/4-column grid). */
@Composable
private fun FleetSummary(metrics: FleetMetrics) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_vehicles_totalVehicles),
                value = metrics.totalVehicles.toString(),
                modifier = Modifier.weight(1f),
                icon = NavGlyphs.Car,
                accent = TeslaTokens.status.info,
            )
            MetricCard(
                label = stringResource(R.string.translation_vehicles_avgBattery),
                value = "${metrics.avgBatteryValue}$BATTERY_PERCENT_UNIT",
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Battery,
                accent = TeslaTokens.status.success,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = "${stringResource(R.string.translation_vehicles_totalRange)} (${metrics.totalRangeUnitLabel})",
                value = metrics.totalRangeValue,
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Gauge,
                accent = MaterialTheme.colorScheme.primary,
            )
            MetricCard(
                label = stringResource(R.string.translation_vehicles_chargingOnline),
                value = "${metrics.chargingCount} / ${metrics.onlineCount}",
                modifier = Modifier.weight(1f),
                icon = DataDisplayGlyphs.Bolt,
                accent = TeslaTokens.status.success,
            )
        }
    }
}

// ── Fleet battery status (GlassPanel8) ────────────────────────────────────────────────────────────────────────

/** The fleet-battery-status panel — per-vehicle battery bars, or the no-data empty state (web battery panel). */
@Composable
private fun FleetBatteryPanel(
    bars: List<VehicleBatteryBar>,
    avgRounded: Int,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(
                    NavGlyphs.Pulse,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.info,
                )
                PanelTitle(stringResource(R.string.translation_vehicles_batteryStatus))
            }
            Caption("$avgRounded$BATTERY_PERCENT_UNIT ${stringResource(R.string.translation_vehicles_avgLabel)}")
        }

        if (bars.isEmpty()) {
            EmptyState(message = stringResource(R.string.translation_common_noData))
        } else {
            Column(
                modifier = Modifier.padding(top = Spacing.md),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                bars.forEach { bar -> BatteryBarRow(bar = bar) }
            }
        }
    }
}

/** One per-vehicle battery bar row in the battery-status panel (web `fleet.entries.map` row). */
@Composable
private fun BatteryBarRow(bar: VehicleBatteryBar) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "${bar.name}: ${bar.level}$BATTERY_PERCENT_UNIT, ${bar.rangeLabel}" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(bar.name, modifier = Modifier.width(PANEL_NAME_WIDTH))
        BatteryBar(
            level = bar.level,
            severity = bar.severity,
            height = BATTERY_BAR_HEIGHT,
            modifier = Modifier.weight(1f),
        )
        BodyText("${bar.level}$BATTERY_PERCENT_UNIT", modifier = Modifier.width(40.dp))
        Caption(bar.rangeLabel, modifier = Modifier.width(64.dp))
    }
}

// ── All-vehicles header ───────────────────────────────────────────────────────────────────────────────────────

/** The "All Vehicles" section header (web `Car` icon + label). */
@Composable
private fun AllVehiclesHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
        SectionTitle(stringResource(R.string.translation_vehicles_allVehicles))
    }
}

// ── Vehicle card (GlassPanel9) ────────────────────────────────────────────────────────────────────────────────

/** One vehicle card — title + status badge, model/vin subtitle, battery + stats row, and the row actions. */
@Composable
private fun VehicleCard(
    row: VehicleRow,
    pinned: Boolean,
    actions: VehicleListActions,
) {
    val detailPath = "${VehicleListPageRegistration.DETAIL_PATH_PREFIX}${row.vehicle.id}"
    GlassPanel(padding = PanelPadding.None) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(CARD_ACCENT_HEIGHT)
                    .background(Brush.horizontalGradient(CARD_ACCENT_GRADIENT)),
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    BodyText(
                        row.displayName,
                        modifier = Modifier.clickable { actions.onOpenRoute(detailPath) },
                        maxLines = 1,
                    )
                    Badge(row.status, variant = badgeVariantOf(row.statusBadge), dot = true)
                }
                Caption(row.subtitle)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    BatteryBar(
                        level = row.batteryLevel,
                        severity = row.batterySeverity,
                        height = CARD_BATTERY_BAR_HEIGHT,
                        modifier = Modifier.width(CARD_BATTERY_BAR_WIDTH),
                    )
                    BodyText("${row.batteryLevel}$BATTERY_PERCENT_UNIT")
                    if (row.hasState) {
                        row.rangeLabel?.let { Caption(it) }
                        row.odometerLabel?.let { Caption(it) }
                        row.chargerPowerLabel?.let {
                            BodyText(it, color = TeslaTokens.status.success)
                        }
                    }
                    if (row.isLocked) {
                        Icon(
                            DataDisplayGlyphs.Lock,
                            contentDescription = stringResource(R.string.translation_common_locked),
                            size = IconSize.Sm,
                            tint = TeslaTokens.status.success,
                        )
                    }
                    if (row.sentryMode) {
                        Icon(
                            DataDisplayGlyphs.Shield,
                            contentDescription = stringResource(R.string.translation_common_sentry),
                            size = IconSize.Sm,
                            tint = TeslaTokens.status.info,
                        )
                    }
                }
            }

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                PinButton(
                    pinned = pinned,
                    onToggle = { actions.onTogglePin(row.vehicle.id, !pinned) },
                    pinLabel = stringResource(R.string.translation_pin_pin),
                    pinnedLabel = stringResource(R.string.translation_pin_unpin),
                    size = IconSize.Sm,
                )
                Button(
                    onClick = { actions.onOpenRoute(detailPath) },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                ) {
                    Icon(
                        DataDisplayGlyphs.ExternalLink,
                        contentDescription = stringResource(R.string.translation_common_open),
                        size = IconSize.Sm,
                    )
                }
                Button(
                    onClick = { actions.onRequestDelete(row.vehicle) },
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                ) {
                    Icon(
                        VehicleCardGlyphs.Trash,
                        contentDescription = stringResource(R.string.translation_common_delete),
                        size = IconSize.Sm,
                        tint = TeslaTokens.status.danger,
                    )
                }
            }
        }
    }
}

// ── Shared bits ───────────────────────────────────────────────────────────────────────────────────────────────

/** A horizontal battery-level bar with a severity-tinted gradient fill (web battery bar). */
@Composable
private fun BatteryBar(
    level: Int,
    severity: BatterySeverity,
    height: Dp,
    modifier: Modifier = Modifier,
) {
    val color = severityColor(severity)
    Box(
        modifier =
            modifier
                .height(height)
                .clip(RoundedCornerShape(percent = 50))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = BATTERY_TRACK_ALPHA)),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction = level.coerceIn(0, PERCENT_MAX) / PERCENT_MAX.toFloat())
                    .clip(RoundedCornerShape(percent = 50))
                    .background(Brush.horizontalGradient(listOf(color.copy(alpha = BATTERY_FILL_START_ALPHA), color))),
        )
    }
}

/** Maps a battery severity bucket to its theme status colour (web `batteryColor` -> COLOR.GOOD/WARN/BAD). */
@Composable
private fun severityColor(severity: BatterySeverity): Color =
    when (severity) {
        BatterySeverity.Good -> TeslaTokens.status.success
        BatterySeverity.Warning -> TeslaTokens.status.warning
        BatterySeverity.Critical -> TeslaTokens.status.danger
    }

/** Maps the model's [VehicleStatusBadge] to the shared [BadgeVariant] (web `statusVariant`). */
private fun badgeVariantOf(badge: VehicleStatusBadge): BadgeVariant =
    when (badge) {
        VehicleStatusBadge.Success -> BadgeVariant.Success
        VehicleStatusBadge.Warning -> BadgeVariant.Warning
        VehicleStatusBadge.Info -> BadgeVariant.Info
        VehicleStatusBadge.Neutral -> BadgeVariant.Neutral
        VehicleStatusBadge.Danger -> BadgeVariant.Danger
    }

/** Builds the compare deep-link target, pre-filling the first two vehicles (web `?leftId=&rightId=`). */
private fun compareRoute(vehicles: List<Vehicle>): String {
    val left = vehicles.getOrNull(0)?.id?.toString().orEmpty()
    val right = vehicles.getOrNull(1)?.id?.toString().orEmpty()
    return "${VehicleListPageRegistration.COMPARE_PATH}?leftId=$left&rightId=$right"
}

/**
 * Forward-navigates to an in-app [path] by handing its `teslasync://app/...` deep-link URI to an `ACTION_VIEW`
 * Intent scoped to this app — the sanctioned page-host navigation seam (no `LocalNavController` is exposed to
 * hosts), the native analogue of the web `<Link to=…>` / `navigate(…)`. The rare no-handler case is swallowed so
 * a tap never crashes the page.
 */
private fun openRoute(
    context: Context,
    path: String,
) {
    val uri = NotificationRouteMap.deepLinkUriFor(path)
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
    runCatching { context.startActivity(intent) }
}
