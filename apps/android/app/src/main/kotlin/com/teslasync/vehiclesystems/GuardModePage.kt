// The native GuardModePage surface (P3/A7) — the Jetpack Compose / Material 3 port of
// web/src/features/vehicle-systems/pages/GuardModePage.tsx at full panel / map / state / string parity. The screen is
// a stateless [GuardModePageContent] driven entirely by the [GuardModePageViewModel]'s StateFlow holders; it performs
// no HTTP. The six web GlassPanels are reproduced as Material 3 GlassPanels (the guard toggle, the status card, the
// panic card, the settings card, the live map, and the event timeline), the Leaflet map is reproduced with the A3
// Maps-Compose wrappers (TeslaMap + VehicleMarker + Circle + Polyline + MapLayerSwitcher), and every visible literal
// resolves from res/values/strings.xml. SI values are formatted only at this render boundary (S5); the geofence
// radius is metres on the wire and drawn verbatim by the SI-native Google Maps `Circle`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + actions.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMapComposable
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.VehicleOption
import io.teslasync.android.components.forms.VehicleSelect
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.components.maps.MapLayerSwitcher
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.VehicleMarker
import io.teslasync.android.components.maps.geofenceColor
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.isGuardEventAcknowledged
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private val MAP_HEIGHT = 400.dp
private const val MAP_ZOOM = 15f
private val STATE_ICON_CIRCLE = 80.dp
private val TIMELINE_MAX_HEIGHT = 460.dp
private const val FENCE_FILL_ALPHA = 0.18f
private const val FENCE_STROKE_WIDTH = 2f
private const val TRAIL_WIDTH = 4f
private const val COORD_FORMAT = "%.6f"

// ── Entry points ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [GuardModePageViewModel] over the injected [source] + [logger] and renders the
 * content. Mirrors the sibling A7 surfaces (GeofencesPage / LocationsPage).
 */
@Composable
fun GuardModePage(
    source: GuardModePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GuardModePageViewModel =
        viewModel(
            key = GuardModePageRegistration.SLUG,
            factory = viewModelFactory { initializer { GuardModePageViewModel(source, logger) } },
        )
    GuardModePage(viewModel = vm, modifier = modifier)
}

/** Binds the [viewModel]'s feeds + interaction snapshot to the stateless content. */
@Composable
fun GuardModePage(
    viewModel: GuardModePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val configState by viewModel.configState.collectAsStateWithLifecycle()
    val eventsState by viewModel.eventsState.collectAsStateWithLifecycle()
    val vehicleStateState by viewModel.vehicleStateState.collectAsStateWithLifecycle()
    val geofencesState by viewModel.geofencesState.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            GuardModeActions(
                onSelectVehicle = viewModel::selectVehicle,
                onToggleGuard = viewModel::toggleGuard,
                onSetHomeGeofence = viewModel::setHomeGeofence,
                onSetSensitivity = viewModel::setSensitivity,
                onSetAutoPanic = viewModel::setAutoPanic,
                onSaveSettings = viewModel::saveSettings,
                onOpenPanic = viewModel::openPanicDialog,
                onClosePanic = viewModel::closePanicDialog,
                onConfirmPanic = viewModel::panic,
                onAcknowledge = viewModel::acknowledge,
                onRetry = viewModel::retry,
            )
        }

    GuardModePageContent(
        configState = configState,
        eventsState = eventsState,
        vehicleStateState = vehicleStateState,
        geofencesState = geofencesState,
        vehicles = vehiclesState.data.orEmpty(),
        selectedVehicleId = selectedVehicleId,
        interaction = interaction,
        actions = actions,
        modifier = modifier,
    )
}

/** The page's callback surface — one stable bundle so the stateless content takes no view-model reference. */
data class GuardModeActions(
    val onSelectVehicle: (Long) -> Unit,
    val onToggleGuard: () -> Unit,
    val onSetHomeGeofence: (String) -> Unit,
    val onSetSensitivity: (String) -> Unit,
    val onSetAutoPanic: (Boolean) -> Unit,
    val onSaveSettings: () -> Unit,
    val onOpenPanic: () -> Unit,
    val onClosePanic: () -> Unit,
    val onConfirmPanic: () -> Unit,
    val onAcknowledge: (Long) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The header is always drawn, then the triggered alert banner (when an unacknowledged
 * non-test event is latest), then the six panels — each owning its own loading / empty / error / success surface so
 * no region ever blanks. The panic confirmation dialog is mounted last and gates itself on the interaction snapshot.
 */
@Composable
fun GuardModePageContent(
    configState: UiState<GuardConfig?>,
    eventsState: UiState<List<GuardEvent>>,
    vehicleStateState: UiState<VehicleStateEnvelope?>,
    geofencesState: UiState<List<Geofence>>,
    vehicles: List<Vehicle>,
    selectedVehicleId: Long?,
    interaction: GuardInteraction,
    actions: GuardModeActions,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_guard_title)
    val config = configState.data
    val events = eventsState.data.orEmpty()
    val geofences = geofencesState.data.orEmpty()
    val state = vehicleStateState.data?.state
    val activeVehicle = vehicles.firstOrNull { it.id == selectedVehicleId }

    val armed = guardArmed(config)
    val triggered = guardTriggered(events)
    val unackCount = unacknowledgedCount(events)
    val latest = latestGuardEvent(events)

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = title },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        GuardHeader(
            title = title,
            vehicles = vehicles,
            selectedVehicleId = selectedVehicleId,
            freshness = vehicleStateState,
            onSelectVehicle = actions.onSelectVehicle,
        )

        if (triggered && latest != null) {
            GuardTriggeredBanner(event = latest)
        }

        GuardTogglePanel(
            armed = armed,
            triggered = triggered,
            pending = interaction.setConfigPending,
            onToggle = actions.onToggleGuard,
        )

        GuardStatusPanel(
            armed = armed,
            config = config,
            state = state,
            unackCount = unackCount,
        )

        GuardPanicPanel(
            pending = interaction.panicPending,
            enabled = (selectedVehicleId ?: 0L) > 0L,
            onOpenPanic = actions.onOpenPanic,
        )

        GuardSettingsPanel(
            config = config,
            geofences = geofences,
            interaction = interaction,
            actions = actions,
        )

        GuardLiveMapPanel(
            vehicleStateState = vehicleStateState,
            state = state,
            vehicleName = activeVehicle?.displayName.orEmpty(),
            homeGeofence = homeGeofenceFor(geofences, effectiveHomeGeofenceId(interaction.homeGeofenceOverride, config)),
            events = events,
            onRetry = actions.onRetry,
        )

        GuardEventTimelinePanel(
            eventsState = eventsState,
            events = events,
            unackCount = unackCount,
            ackPending = interaction.ackPending,
            onAcknowledge = actions.onAcknowledge,
            onRetry = actions.onRetry,
        )
    }

    if (interaction.panicDialogOpen) {
        ConfirmDialog(
            title = stringResource(R.string.translation_guard_panicConfirmTitle),
            message = stringResource(R.string.translation_guard_panicConfirmMessage),
            confirmLabel = stringResource(R.string.translation_guard_panicConfirmLabel),
            cancelLabel = stringResource(R.string.translation_Cancel),
            onConfirm = actions.onConfirmPanic,
            onCancel = actions.onClosePanic,
            severity = ConfirmSeverity.Danger,
        )
    }
}

// ── Header + triggered banner ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardHeader(
    title: String,
    vehicles: List<Vehicle>,
    selectedVehicleId: Long?,
    freshness: UiState<VehicleStateEnvelope?>,
    onSelectVehicle: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(title)
                HelperText(stringResource(R.string.translation_guard_subtitle))
            }
            DataFreshness(
                updatedAtMillis = freshness.fetchedAt?.takeIf { it > 0L },
                isFetching = freshness.refreshing,
                isStale = freshness.stale,
                isError = freshness.hasError,
                fetchingLabel = stringResource(R.string.translation_guard_updating),
                errorLabel = stringResource(R.string.translation_Error),
            )
        }
        VehicleSelect(
            vehicles = vehicles.map { VehicleOption(it.id, it.displayName) },
            selectedId = selectedVehicleId,
            onSelect = onSelectVehicle,
        )
    }
}

@Composable
private fun GuardTriggeredBanner(event: GuardEvent) {
    val label = guardEventLabel(event.eventType)
    AlertBanner(
        message = "$label — ${formatGuardTimestamp(event.ts)}",
        title = stringResource(R.string.translation_guard_alertTriggered),
        tone = Tone.Danger,
        icon = GuardModeGlyphs.ShieldAlert,
    )
}

// ── GlassPanel1 — guard toggle ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardTogglePanel(
    armed: Boolean,
    triggered: Boolean,
    pending: Boolean,
    onToggle: () -> Unit,
) {
    val accent =
        when {
            triggered -> PanelAccent.Danger
            armed -> PanelAccent.Success
            else -> PanelAccent.None
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), accent = accent) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            val tint =
                when {
                    triggered -> TeslaTokens.status.danger
                    armed -> TeslaTokens.status.success
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
            val glyph =
                when {
                    triggered -> GuardModeGlyphs.ShieldAlert
                    armed -> GuardModeGlyphs.ShieldCheck
                    else -> GuardModeGlyphs.ShieldOff
                }
            Box(
                modifier =
                    Modifier
                        .size(STATE_ICON_CIRCLE)
                        .clip(CircleShape)
                        .background(tint.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(glyph, contentDescription = null, size = IconSize.Xl, tint = tint)
            }
            SectionTitle(guardStateLabel(armed = armed, triggered = triggered))
            Toggle(
                checked = armed,
                onCheckedChange = { onToggle() },
                label = stringResource(R.string.translation_guard_enableGuard),
            )
            if (pending) {
                Caption(stringResource(R.string.translation_guard_updating))
            }
        }
    }
}

// ── GlassPanel2 — status ────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardStatusPanel(
    armed: Boolean,
    config: GuardConfig?,
    state: VehicleState?,
    unackCount: Int,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PanelTitle(stringResource(R.string.translation_guard_status))

            val armedText =
                if (armed && !config?.updatedAt.isNullOrBlank()) {
                    stringResource(R.string.translation_guard_armedSince, formatGuardTimestamp(config.updatedAt))
                } else {
                    stringResource(R.string.translation_guard_notArmed)
                }
            GuardStatusRow(icon = GuardModeGlyphs.Clock, text = armedText)

            val lockText =
                if (state?.isLocked == true) {
                    stringResource(R.string.translation_guard_locked)
                } else {
                    stringResource(R.string.translation_guard_unlocked)
                }
            GuardStatusRow(icon = GuardModeGlyphs.Lock, text = lockText)

            val sentryText =
                if (state?.sentryMode == true) {
                    stringResource(R.string.translation_guard_sentryOn)
                } else {
                    stringResource(R.string.translation_guard_sentryOff)
                }
            GuardStatusRow(icon = GuardModeGlyphs.Eye, text = sentryText)

            val alertsText =
                if (unackCount > 0) {
                    stringResource(R.string.translation_guard_unackEvents, unackCount.toString())
                } else {
                    stringResource(R.string.translation_guard_noEvents)
                }
            GuardStatusRow(icon = GuardModeGlyphs.AlertTriangle, text = alertsText)
        }
    }
}

@Composable
private fun GuardStatusRow(
    icon: ImageVector,
    text: String,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── GlassPanel3 — panic ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardPanicPanel(
    pending: Boolean,
    enabled: Boolean,
    onOpenPanic: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Icon(GuardModeGlyphs.Siren, contentDescription = null, size = IconSize.Xl, tint = TeslaTokens.status.danger)
            PanelTitle(stringResource(R.string.translation_guard_emergency))
            Button(
                label =
                    if (pending) {
                        stringResource(R.string.translation_guard_panicking)
                    } else {
                        stringResource(R.string.translation_guard_panicButton)
                    },
                onClick = onOpenPanic,
                modifier = Modifier.fillMaxWidth(),
                variant = ButtonVariant.Danger,
                enabled = enabled,
                loading = pending,
            )
            HelperText(stringResource(R.string.translation_guard_panicDesc))
        }
    }
}

// ── GlassPanel4 — settings ──────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardSettingsPanel(
    config: GuardConfig?,
    geofences: List<Geofence>,
    interaction: GuardInteraction,
    actions: GuardModeActions,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_guard_settings))

            val geofenceOptions =
                listOf(SelectOption("", stringResource(R.string.translation_guard_noGeofence))) +
                    geofences.map { SelectOption(it.id.toString(), it.name) }
            Select(
                options = geofenceOptions,
                selectedValue = effectiveHomeGeofenceId(interaction.homeGeofenceOverride, config),
                onSelect = actions.onSetHomeGeofence,
                modifier = Modifier.fillMaxWidth(),
                label = stringResource(R.string.translation_guard_homeGeofence),
                hint = stringResource(R.string.translation_guard_homeGeofenceHelp),
            )

            Select(
                options = GuardSensitivity.values.map { SelectOption(it, sensitivityLabel(it)) },
                selectedValue = effectiveSensitivity(interaction.sensitivityOverride, config),
                onSelect = actions.onSetSensitivity,
                modifier = Modifier.fillMaxWidth(),
                label = stringResource(R.string.translation_guard_sensitivity),
            )

            Toggle(
                checked = effectiveAutoPanic(interaction.autoPanicOverride, config),
                onCheckedChange = actions.onSetAutoPanic,
                label = stringResource(R.string.translation_guard_autoPanic),
            )
            HelperText(stringResource(R.string.translation_guard_autoPanicHelp))

            Button(
                label = stringResource(R.string.translation_guard_saveSettings),
                onClick = actions.onSaveSettings,
                loading = interaction.setConfigPending,
            )
        }
    }
}

// ── GlassPanel5 — live map ──────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardLiveMapPanel(
    vehicleStateState: UiState<VehicleStateEnvelope?>,
    state: VehicleState?,
    vehicleName: String,
    homeGeofence: Geofence?,
    events: List<GuardEvent>,
    onRetry: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().padding(Spacing.md),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(stringResource(R.string.translation_guard_liveMap), modifier = Modifier.weight(1f))
                DataFreshness(
                    updatedAtMillis = vehicleStateState.fetchedAt?.takeIf { it > 0L },
                    isFetching = vehicleStateState.refreshing,
                    isStale = vehicleStateState.stale,
                    isError = vehicleStateState.hasError,
                    fetchingLabel = stringResource(R.string.translation_guard_updating),
                    errorLabel = stringResource(R.string.translation_Error),
                )
            }
            Box(modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT)) {
                when {
                    vehicleStateState.isLoading -> {
                        Skeleton(modifier = Modifier.fillMaxWidth(), height = MAP_HEIGHT)
                    }
                    vehicleStateState.isError && state == null -> {
                        ErrorDisplay(
                            message = stringResource(R.string.translation_error_loadFailed),
                            modifier = Modifier.align(Alignment.Center),
                            onRetry = onRetry,
                            retryLabel = stringResource(R.string.translation_common_retry),
                        )
                    }
                    guardHasLocation(state) -> {
                        GuardLiveMap(
                            vehicleLat = state!!.latitude,
                            vehicleLng = state.longitude,
                            vehicleName = vehicleName,
                            homeGeofence = homeGeofence,
                            events = events,
                            mapDescription = stringResource(R.string.translation_guard_liveMap),
                        )
                    }
                    else -> {
                        EmptyState(
                            message = stringResource(R.string.translation_guard_noLocation),
                            modifier = Modifier.align(Alignment.Center),
                            icon = GuardModeGlyphs.MapPin,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GuardLiveMap(
    vehicleLat: Double,
    vehicleLng: Double,
    vehicleName: String,
    homeGeofence: Geofence?,
    events: List<GuardEvent>,
    mapDescription: String,
) {
    var style by remember { mutableStateOf(MapStyleId.Dark) }
    val vehiclePoint = GeoPoint(vehicleLat, vehicleLng)
    val camera = rememberMapCameraState(CameraSnapshot(vehiclePoint, MAP_ZOOM))
    LaunchedEffect(vehicleLat, vehicleLng) {
        camera.position = CameraSnapshot(vehiclePoint, MAP_ZOOM).toCameraPosition()
    }
    val trail = remember(events) { eventTrailPositions(events).map { GeoPoint(it.first, it.second) } }

    Box(modifier = Modifier.fillMaxSize()) {
        TeslaMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            style = style,
            contentDescription = mapDescription,
        ) {
            // Event trail — the Leaflet <Polyline>. The web memo resolves to an empty list (guard events carry no
            // coordinates), so the trail is omitted unless the backend re-attaches them (eventTrailPositions).
            if (trail.size > 1) {
                GuardEventTrail(points = trail)
            }
            // Home-geofence circle — the Leaflet <Circle>.
            if (homeGeofence != null) {
                GuardHomeGeofenceCircle(geofence = homeGeofence)
            }
            // Vehicle marker (Leaflet <Marker> icon={vehicleIcon()}) carrying the popup (Leaflet <Popup>) as its
            // info window: title = vehicle name, snippet = the 6-decimal coordinates, shown on tap.
            VehicleMarker(
                marker =
                    MapMarker(
                        id = "guard-vehicle",
                        point = vehiclePoint,
                        title = vehicleName.ifBlank { null },
                        snippet = guardCoordinateLabel(vehicleLat, vehicleLng),
                    ),
            )
        }
        MapLayerSwitcher(
            current = style,
            onChange = { style = it },
            modifier = Modifier.align(Alignment.BottomStart).padding(Spacing.sm),
        )
    }
}

@Composable
@GoogleMapComposable
private fun GuardHomeGeofenceCircle(geofence: Geofence) {
    val stroke = geofenceColor()
    Circle(
        center = LatLng(geofence.latitude, geofence.longitude),
        radius = geofence.radius,
        fillColor = stroke.copy(alpha = FENCE_FILL_ALPHA),
        strokeColor = stroke,
        strokeWidth = FENCE_STROKE_WIDTH,
    )
}

@Composable
@GoogleMapComposable
private fun GuardEventTrail(points: List<GeoPoint>) {
    Polyline(
        points = points.map { it.toLatLng() },
        color = TeslaTokens.status.danger,
        width = TRAIL_WIDTH,
    )
}

// ── GlassPanel6 — event timeline ────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GuardEventTimelinePanel(
    eventsState: UiState<List<GuardEvent>>,
    events: List<GuardEvent>,
    unackCount: Int,
    ackPending: Boolean,
    onAcknowledge: (Long) -> Unit,
    onRetry: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(stringResource(R.string.translation_guard_eventTimeline), modifier = Modifier.weight(1f))
                if (unackCount > 0) {
                    Badge(
                        text = "$unackCount ${stringResource(R.string.translation_guard_unack)}",
                        variant = BadgeVariant.Danger,
                    )
                }
            }

            when {
                eventsState.isLoading -> {
                    Skeleton(modifier = Modifier.fillMaxWidth(), height = 72.dp)
                }
                eventsState.isError && events.isEmpty() -> {
                    ErrorDisplay(
                        message = stringResource(R.string.translation_error_loadFailed),
                        onRetry = onRetry,
                        retryLabel = stringResource(R.string.translation_common_retry),
                    )
                }
                events.isEmpty() -> {
                    EmptyState(
                        message = stringResource(R.string.translation_guard_noEvents),
                        icon = GuardModeGlyphs.Info,
                    )
                }
                else -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().heightIn(max = TIMELINE_MAX_HEIGHT).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        events.forEach { event ->
                            GuardEventRow(event = event, ackPending = ackPending, onAcknowledge = onAcknowledge)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GuardEventRow(
    event: GuardEvent,
    ackPending: Boolean,
    onAcknowledge: (Long) -> Unit,
) {
    val acknowledged = isGuardEventAcknowledged(event)
    val accent = if (acknowledged) PanelAccent.None else PanelAccent.Danger
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Sm, accent = accent) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            val (glyph, glyphTint) = guardEventRowIcon(event)
            Icon(glyph, contentDescription = null, size = IconSize.Md, tint = glyphTint)

            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Badge(
                        text = guardEventLabel(event.eventType),
                        variant = toneToBadgeVariant(guardEventTone(event.eventType)),
                    )
                    Caption(formatGuardTimestamp(event.ts))
                }
                if (event.fromState != null || event.toState != null) {
                    HelperText("${event.fromState ?: "—"} → ${event.toState ?: "—"}")
                }
                event.acknowledgedBy?.let { by ->
                    HelperText("${stringResource(R.string.translation_guard_acknowledgedBy)}: $by")
                }
            }

            if (!acknowledged) {
                Button(
                    label = stringResource(R.string.translation_guard_acknowledge),
                    onClick = { onAcknowledge(event.id) },
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    loading = ackPending,
                )
            }
        }
    }
}

// ── Render-boundary helpers (string / icon / format resolution) ─────────────────────────────────────────────────

/** The big guard-state label (web `TRIGGERED` / `Armed` / `Disarmed`). */
@Composable
private fun guardStateLabel(
    armed: Boolean,
    triggered: Boolean,
): String =
    when {
        triggered -> stringResource(R.string.translation_guard_triggered)
        armed -> stringResource(R.string.translation_guard_armed)
        else -> stringResource(R.string.translation_guard_disarmed)
    }

/**
 * The event-type display label — the port of the web `EVENT_LABELS[event_type] ?? event_type` lookup-with-fallback.
 * A known token resolves from the string catalog (emoji + name, matching the web record); an unmapped token renders
 * verbatim so a newly-added backend type never crashes the timeline.
 */
@Composable
private fun guardEventLabel(eventType: String): String =
    when (eventType) {
        "vehicle_moved" -> stringResource(R.string.translation_guard_eventVehicleMoved)
        "unauthorized_unlock" -> stringResource(R.string.translation_guard_eventUnauthorizedUnlock)
        "unauthorized_drive" -> stringResource(R.string.translation_guard_eventUnauthorizedDrive)
        "sentry_triggered" -> stringResource(R.string.translation_guard_eventSentryTriggered)
        "manual_panic" -> stringResource(R.string.translation_guard_eventManualPanic)
        "test_alert" -> stringResource(R.string.translation_guard_eventTestAlert)
        "locked" -> stringResource(R.string.translation_guard_eventLocked)
        "sentry_mode" -> stringResource(R.string.translation_guard_eventSentryMode)
        "valet_mode_enabled" -> stringResource(R.string.translation_guard_eventValetMode)
        else -> eventType
    }

/** The sensitivity option label (web `SENSITIVITY_OPTIONS` labels), resolved from the catalog by stable value. */
@Composable
private fun sensitivityLabel(value: String): String =
    when (value) {
        GuardSensitivity.Low.value -> stringResource(R.string.translation_guard_sensitivityLow)
        GuardSensitivity.Medium.value -> stringResource(R.string.translation_guard_sensitivityMedium)
        GuardSensitivity.High.value -> stringResource(R.string.translation_guard_sensitivityHigh)
        else -> value
    }

/** Maps the model's [GuardEventTone] onto the shared [BadgeVariant]. */
private fun toneToBadgeVariant(tone: GuardEventTone): BadgeVariant =
    when (tone) {
        GuardEventTone.Danger -> BadgeVariant.Danger
        GuardEventTone.Warning -> BadgeVariant.Warning
        GuardEventTone.Info -> BadgeVariant.Info
    }

/** The event-row leading glyph + tint, the port of the web `EventRow` icon ladder. */
@Composable
private fun guardEventRowIcon(event: GuardEvent): Pair<ImageVector, Color> =
    when (guardEventIcon(event)) {
        GuardEventIcon.Acknowledged -> GuardModeGlyphs.CheckCircle to MaterialTheme.colorScheme.onSurfaceVariant
        GuardEventIcon.Panic -> GuardModeGlyphs.Siren to TeslaTokens.status.danger
        GuardEventIcon.Unlock -> GuardModeGlyphs.Unlock to TeslaTokens.status.warning
        GuardEventIcon.Drive -> GuardModeGlyphs.Car to TeslaTokens.status.danger
        GuardEventIcon.Alert -> GuardModeGlyphs.AlertTriangle to TeslaTokens.status.warning
    }

/** The popup coordinate line (web `${lat.toFixed(6)}, ${lng.toFixed(6)}`). */
private fun guardCoordinateLabel(
    lat: Double,
    lng: Double,
): String = "${COORD_FORMAT.format(lat)}, ${COORD_FORMAT.format(lng)}"

/**
 * Formats an ISO-8601 timestamp to a localized medium date-time (web `formatDateTime` / `<TimeStamp>`). Tolerates
 * both `Z` and explicit-offset stamps; an unparseable value falls back to the raw string rather than throwing.
 */
private fun formatGuardTimestamp(iso: String): String {
    val instant =
        runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: return iso
    return DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM)
        .withZone(ZoneId.systemDefault())
        .format(instant)
}
