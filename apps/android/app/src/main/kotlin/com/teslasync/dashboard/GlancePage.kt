// The native Jetpack Compose + Material 3 GlancePage dashboard surface — a parity port of
// web/src/features/dashboard/pages/GlancePage.tsx, the single-vehicle "quick glance" screen. It reproduces the
// web page's no-vehicle empty panel (GlassPanel1), the vehicle name + status badge, the big battery RadialGauge,
// the four key-metric cards (Range / Interior / Security / Location), the three quick-action buttons
// (lock·climate·horn), the freshness indicator, and the "open full app" link — every visible string resolved
// from the generated res/values catalog (ADR-014), every SI value converted at the display boundary by the
// shared UnitFormatter (web `useUnits`).
//
// Composition: [GlancePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the resolved snapshot + the in-flight command + the live unit
// formatter, and wires the back-dispatcher "open full app" affordance); [GlancePageContent] is the stateless
// render layer that switches the loading / empty / error / content surfaces off the bound [UiState].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.glance

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.FreshnessIndicator
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger

/** Em dash — the empty-value display the web page renders as `'—'`. */
private const val EM_DASH = "\u2014"

/** Percent suffix for the battery gauge (web `unit="%"`); a unit symbol, not translatable copy. */
private const val PERCENT_UNIT = "%"

/** Diameter of the hero battery gauge (web `size={180}`). */
private val GlanceGaugeSize = 180.dp

/** Max content width so the centered hero stays phone-shaped on tablets (web `max-w-xs` column). */
private val GlanceContentMaxWidth = 420.dp

/** Spinner size for the in-flight quick-action affordance. */
private val QuickActionSpinnerSize = 20.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [GlancePageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Vehicle-command holders + the app-scoped active-vehicle selection via [glancePageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun GlancePage(
    source: GlancePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GlancePageViewModel =
        viewModel(
            key = GlancePageRegistration.SLUG,
            factory = viewModelFactory { initializer { GlancePageViewModel(source, logger) } },
        )
    GlancePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] snapshot + in-flight command + the live unit formatter to the content. */
@Composable
fun GlancePage(
    viewModel: GlancePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val activeCommand by viewModel.activeCommand.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    // "Open full app" leaves the standalone glance surface — the native analogue of the web <Link to="/">; no
    // LocalNavController is exposed to page hosts, so the back-dispatcher is the sanctioned navigation seam.
    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onOpenApp: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    // The screen title (web `usePageTitle(t('glance.title'))`) surfaced as the accessibility pane title.
    val title = stringResource(R.string.translation_glance_title)

    GlancePageContent(
        uiState = uiState,
        activeCommand = activeCommand,
        unitFormatter = unitFormatter,
        onCommand = viewModel::sendCommand,
        onRetry = viewModel::retry,
        onOpenApp = onOpenApp,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. Switches the four mutually-exclusive data surfaces off the bound [uiState]: the
 * loading spinner (first vehicle-list load), the hard-error retry panel, the no-vehicle empty panel
 * (GlassPanel1), or the resolved hero. The per-vehicle state/location are folded into the snapshot, so the hero
 * renders em-dash metrics + a muted gauge until they load — the region is never blank.
 */
@Composable
fun GlancePageContent(
    uiState: UiState<GlanceSnapshot>,
    activeCommand: String?,
    unitFormatter: UnitFormatter,
    onCommand: (String) -> Unit,
    onRetry: () -> Unit,
    onOpenApp: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        uiState.isLoading -> GlanceLoading(modifier)
        uiState.isError -> GlanceError(onRetry = onRetry, modifier = modifier)
        else -> {
            val snapshot = uiState.data
            if (snapshot?.vehicle == null) {
                GlanceEmptyPanel(modifier)
            } else {
                GlanceContent(
                    vehicle = snapshot.vehicle,
                    snapshot = snapshot,
                    unitFormatter = unitFormatter,
                    activeCommand = activeCommand,
                    onCommand = onCommand,
                    onOpenApp = onOpenApp,
                    modifier = modifier,
                )
            }
        }
    }
}

/** The first-load loader (web `PageContainer loading`): a centered spinner so no region flashes blank. */
@Composable
private fun GlanceLoading(modifier: Modifier = Modifier) {
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Spinner()
    }
}

/** The hard-error surface for the vehicle-list feed (web `PageContainer error`): a retry-able error panel. */
@Composable
private fun GlanceError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    FadeIn {
        Box(
            modifier = modifier.fillMaxSize().padding(Spacing.lg),
            contentAlignment = Alignment.Center,
        ) {
            GlassPanel(padding = PanelPadding.Lg, modifier = Modifier.fillMaxWidth().widthIn(max = GlanceContentMaxWidth)) {
                ErrorDisplay(
                    message = stringResource(R.string.translation_error_serverError_message),
                    title = stringResource(R.string.translation_error_serverError_title),
                    onRetry = onRetry,
                    retryLabel = stringResource(R.string.translation_common_retry),
                )
            }
        }
    }
}

/**
 * GlassPanel1 — the no-vehicle empty panel (web `!vehicle` branch: `<GlassPanel><EmptyState …/></GlassPanel>`).
 * Shows the battery glyph + the "No vehicle found" message so the region never collapses to a blank box.
 */
@Composable
private fun GlanceEmptyPanel(modifier: Modifier = Modifier) {
    FadeIn {
        Box(
            modifier = modifier.fillMaxSize().padding(Spacing.lg),
            contentAlignment = Alignment.Center,
        ) {
            GlassPanel(padding = PanelPadding.Lg, modifier = Modifier.fillMaxWidth().widthIn(max = GlanceContentMaxWidth)) {
                EmptyState(
                    icon = GlanceGlyphs.Battery,
                    message = stringResource(R.string.translation_glance_noVehicle),
                )
            }
        }
    }
}

/**
 * The resolved hero (web `vehicle` branch): vehicle name + status badge, the big battery RadialGauge, the four
 * key-metric cards, the three quick-action buttons, the freshness indicator, and the "open full app" link.
 */
@Composable
private fun GlanceContent(
    vehicle: Vehicle,
    snapshot: GlanceSnapshot,
    unitFormatter: UnitFormatter,
    activeCommand: String?,
    onCommand: (String) -> Unit,
    onOpenApp: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = snapshot.state
    val online = isVehicleOnline(state?.state)
    val canSend = online && activeCommand == null
    val unknownLabel = stringResource(R.string.translation_glance_unknown)
    val defaultName = stringResource(R.string.translation_glance_defaultName)
    val name = vehicle.displayName.ifBlank { vehicle.model?.takeIf { it.isNotBlank() } ?: defaultName }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            modifier =
                Modifier
                    .fillMaxHeight()
                    .widthIn(max = GlanceContentMaxWidth)
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            FadeIn {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    PageTitle(name, modifier = Modifier.semantics { heading() })
                    Badge(
                        text = state?.state ?: unknownLabel,
                        variant = if (online) BadgeVariant.Success else BadgeVariant.Neutral,
                        dot = true,
                    )
                }
            }

            // Big battery ring (web <RadialGauge value={battery_level} max={100} …/>).
            RadialGauge(
                value = (state?.batteryLevel ?: 0L).toDouble(), // parity:allow numeric conversion, not an unfinished marker
                max = 100.0,
                label = stringResource(R.string.translation_glance_battery),
                unit = PERCENT_UNIT,
                size = GlanceGaugeSize,
                color = batteryBandColor(batteryBandFor(state)),
            )

            GlanceMetrics(state = state, location = snapshot.location, formatter = unitFormatter)

            GlanceQuickActions(
                isLocked = state?.isLocked == true,
                isClimateOn = state?.isClimateOn == true,
                activeCommand = activeCommand,
                canSend = canSend,
                onCommand = onCommand,
            )

            FreshnessIndicator(timestampMillis = snapshot.stateFetchedAt?.takeIf { it > 0 })

            Button(
                label = stringResource(R.string.translation_glance_openApp),
                onClick = onOpenApp,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The 2×2 key-metric grid (web `grid-cols-1 sm:grid-cols-2`): Range / Interior / Security / Location. */
@Composable
private fun GlanceMetrics(
    state: VehicleState?,
    location: GlanceLocation?,
    formatter: UnitFormatter,
    modifier: Modifier = Modifier,
) {
    val locked = state?.isLocked == true
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_glance_range),
                value = state?.let { formatter.distance(it.ratedRange, precision = 0) } ?: EM_DASH,
                icon = GlanceGlyphs.Battery,
                accent = TeslaTokens.status.success,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = stringResource(R.string.translation_glance_temp),
                value = state?.let { formatter.temperature(it.insideTemp, precision = 1) } ?: EM_DASH,
                icon = GlanceGlyphs.Thermometer,
                accent = TeslaTokens.status.warning,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = stringResource(R.string.translation_glance_security),
                value =
                    if (locked) {
                        stringResource(R.string.translation_glance_locked)
                    } else {
                        stringResource(R.string.translation_glance_unlocked)
                    },
                icon = if (locked) GlanceGlyphs.Lock else GlanceGlyphs.Unlock,
                accent = if (locked) TeslaTokens.status.success else TeslaTokens.status.danger,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = stringResource(R.string.translation_glance_locationLabel),
                value = glanceLocationLabel(location),
                icon = GlanceGlyphs.MapPin,
                accent = TeslaTokens.chart.regen,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** Resolve the location metric label from the snapshot (web `getLocationLabel`), localized at the boundary. */
@Composable
private fun glanceLocationLabel(location: GlanceLocation?): String =
    when (locationKindOf(location)) {
        GlanceLocationKind.Home -> stringResource(R.string.translation_glance_location_home)
        GlanceLocationKind.Work -> stringResource(R.string.translation_glance_location_work)
        GlanceLocationKind.Favorite -> stringResource(R.string.translation_glance_location_favorite)
        GlanceLocationKind.Destination -> location?.destinationName?.takeIf { it.isNotBlank() } ?: EM_DASH
        GlanceLocationKind.None -> EM_DASH
    }

/** The three quick-action buttons (web lock·climate·horn): disabled offline, the active one spins. */
@Composable
private fun GlanceQuickActions(
    isLocked: Boolean,
    isClimateOn: Boolean,
    activeCommand: String?,
    canSend: Boolean,
    onCommand: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        GlanceQuickAction(
            icon = if (isLocked) GlanceGlyphs.Unlock else GlanceGlyphs.Lock,
            label =
                if (isLocked) {
                    stringResource(R.string.translation_glance_action_unlock)
                } else {
                    stringResource(R.string.translation_glance_action_lock)
                },
            enabled = canSend,
            loading = activeCommand?.let { it in LOCK_COMMANDS } ?: false,
            onClick = { onCommand(lockCommandFor(isLocked)) },
        )
        GlanceQuickAction(
            icon = GlanceGlyphs.Wind,
            label =
                if (isClimateOn) {
                    stringResource(R.string.translation_glance_action_climateOff)
                } else {
                    stringResource(R.string.translation_glance_action_climateOn)
                },
            enabled = canSend,
            loading = activeCommand?.let { it in CLIMATE_COMMANDS } ?: false,
            onClick = { onCommand(climateCommandFor(isClimateOn)) },
        )
        GlanceQuickAction(
            icon = GlanceGlyphs.Volume2,
            label = stringResource(R.string.translation_glance_action_horn),
            enabled = canSend,
            loading = activeCommand == GlanceCommands.HORN,
            onClick = { onCommand(GlanceCommands.HORN) },
        )
    }
}

/** One vertical icon-over-label quick action (web `QuickAction`): a ghost button, spinner while in flight. */
@Composable
private fun GlanceQuickAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean,
    loading: Boolean,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = enabled,
        loading = loading,
        modifier = Modifier.semantics { contentDescription = label },
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(QuickActionSpinnerSize),
                    strokeWidth = 2.dp,
                    color = LocalContentColor.current,
                )
            } else {
                Icon(icon, contentDescription = null, size = IconSize.Lg)
            }
            Caption(label)
        }
    }
}

/** Map the battery color band onto a semantic theme color (muted surface when no state — web `COLOR.MUTED`). */
@Composable
private fun batteryBandColor(band: GlanceBatteryBand): Color =
    when (band) {
        GlanceBatteryBand.Green -> TeslaTokens.status.success
        GlanceBatteryBand.Amber -> TeslaTokens.status.warning
        GlanceBatteryBand.Red -> TeslaTokens.status.danger
        GlanceBatteryBand.Unknown -> MaterialTheme.colorScheme.surfaceVariant
    }
