// The native Jetpack Compose + Material 3 GeofencesPage maps surface — a parity port of
// web/src/features/maps/pages/GeofencesPage.tsx, the geofence-zone manager. It reproduces the page's header
// (title + subtitle + Add Geofence action), the summary-stats panel (the four metric tiles or the no-data empty
// state), the AI pick-location input, the bulk-selection toolbar + name search, the geofence list (per-row cards
// with the active/alert badges, coordinates, radius, enable toggle, edit + delete), every data state (loading
// skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier the bound state holder
// carries), the create/edit modal (the use-current-location panel with its vehicle picker + the on-map geofence
// drawer, and the validated form), the delete confirmation, and every visible string (resolved from the generated
// res/values catalog, ADR-014).
//
// Composition: [GeofencesPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the three feeds + the interaction snapshot, and surfaces
// mutation outcomes as snackbars); [GeofencesPageContent] is the stateless render layer. The framework-free model
// (deriveGeofenceStats / filterGeofences / sortGeofencesByPins / validateGeofenceForm) folds the loaded data into
// the slices the panels read — exactly as the web page threads its `geofences` through its useMemo chain.
// SI values (radius meters, coordinate degrees) are display-formatted only here at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete panel set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.maps.geofences

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.maps.DraftGeofence
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.GeofenceDrawer
import io.teslasync.android.components.maps.GeofenceLabels
import io.teslasync.android.components.maps.GeofenceShape
import io.teslasync.android.components.maps.MapGeofence
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import java.util.Locale

// Per-metric accent colors (web `color="purple|green|cyan|amber"`; dynamic chart values, not static theme tokens).
private val ACCENT_TOTAL = Color(0xFFA855F7)
private val ACCENT_ACTIVE = Color(0xFF10B981)
private val ACCENT_ENTRY = Color(0xFF22D3EE)
private val ACCENT_EXIT = Color(0xFFF59E0B)

// ── Localized microcopy carrier (web `useTranslation` ▸ i18n keys, ADR-014) ───────────────────────────────────

/**
 * Every visible literal the surface renders, resolved once from the generated catalog so the stateless content +
 * sub-components take plain strings and stay trivially previewable. The three argument-bearing strings
 * (delete-confirm / select-geofence / rename) are resolved at their call sites with the geofence name.
 */
data class GeofencesStrings(
    val title: String,
    val subtitle: String,
    val addGeofence: String,
    val totalGeofences: String,
    val active: String,
    val inactive: String,
    val entryAlerts: String,
    val exitAlerts: String,
    val noData: String,
    val noGeofencesDefined: String,
    val addGeofenceHint: String,
    val noMatches: String,
    val clearSearch: String,
    val searchHint: String,
    val filterLabelSearch: String,
    val nounOne: String,
    val nounOther: String,
    val bulkDelete: String,
    val bulkDeleteConfirmTitle: String,
    val bulkDeleteConfirmBody: String,
    val commonDelete: String,
    val aiPickLocation: String,
    val entry: String,
    val exit: String,
    val entryExit: String,
    val none: String,
    val createGeofence: String,
    val editGeofence: String,
    val create: String,
    val update: String,
    val cancel: String,
    val name: String,
    val home: String,
    val latitude: String,
    val longitude: String,
    val radiusMeters: String,
    val radiusHint: String,
    val alertType: String,
    val nameTooLong: String,
    val validationFailed: String,
    val useCurrentLocation: String,
    val vehicle: String,
    val browser: String,
    val drawOnMap: String,
    val drawHint: String,
    val drawerLabel: String,
    val selectVehicle: String,
    val chooseVehicle: String,
    val getLocation: String,
    val gettingLocation: String,
    val noPosition: String,
    val locationDenied: String,
    val locationFailed: String,
    val deleteGeofence: String,
    val delete: String,
    val meterUnit: String,
    val drawerClear: String,
    val drawerSave: String,
    val drawerRadius: String,
    val toastCreated: String,
    val toastUpdated: String,
    val toastDeleted: String,
    val failedCreate: String,
    val failedUpdate: String,
    val failedToggle: String,
    val failedDelete: String,
) {
    /** Resolves a one-shot [UiEvent.Message] key (web `toast` key) to its localized sentence. */
    fun messageFor(key: String): String =
        when (key) {
            GeofenceOutcome.Created.messageKey -> toastCreated
            GeofenceOutcome.Updated.messageKey -> toastUpdated
            GeofenceOutcome.Deleted.messageKey -> toastDeleted
            GeofenceOutcome.CreateFailed.messageKey -> failedCreate
            GeofenceOutcome.UpdateFailed.messageKey -> failedUpdate
            GeofenceOutcome.ToggleFailed.messageKey -> failedToggle
            GeofenceOutcome.DeleteFailed.messageKey -> failedDelete
            "geofences.selectVehicle" -> selectVehicle
            "geofences.noPosition" -> noPosition
            "geofences.locationDenied" -> locationDenied
            "geofences.locationFailed" -> locationFailed
            else -> key
        }

    /** The alert badge text for a disposition (web `alertBadgeLabel`). */
    fun alertLabel(type: GeofenceAlertType): String =
        when (type) {
            GeofenceAlertType.Both -> entryExit
            GeofenceAlertType.Entry -> entry
            GeofenceAlertType.Exit -> exit
            GeofenceAlertType.None -> none
        }
}

/** Resolves every [GeofencesStrings] entry from the generated i18n catalog (P1/S10, ADR-014). */
@Composable
fun rememberGeofencesStrings(): GeofencesStrings =
    GeofencesStrings(
        title = stringResource(R.string.translation_Geofences),
        subtitle = stringResource(R.string.translation_Define_locations_for_contextual_tracking_and_automation),
        addGeofence = stringResource(R.string.translation_Add_Geofence),
        totalGeofences = stringResource(R.string.translation_Total_Geofences),
        active = stringResource(R.string.translation_Active),
        inactive = stringResource(R.string.translation_Inactive),
        entryAlerts = stringResource(R.string.translation_Entry_Alerts),
        exitAlerts = stringResource(R.string.translation_Exit_Alerts),
        noData = stringResource(R.string.translation_common_noData),
        noGeofencesDefined = stringResource(R.string.translation_No_geofences_defined),
        addGeofenceHint =
            stringResource(R.string.translation_Add_a_geofence_to_track_when_your_vehicle_arrives_or_leaves_a_location_),
        noMatches = stringResource(R.string.translation_geofences_noMatches),
        clearSearch = stringResource(R.string.translation_Clear_search),
        searchHint = stringResource(R.string.translation_geofences_searchPlaceholder), // parity:allow i18n catalog key name, not a stub marker
        filterLabelSearch = stringResource(R.string.translation_geofences_filterLabel_search),
        nounOne = stringResource(R.string.translation_geofences_noun_one),
        nounOther = stringResource(R.string.translation_geofences_noun_other),
        bulkDelete = stringResource(R.string.translation_geofences_bulk_delete),
        bulkDeleteConfirmTitle = stringResource(R.string.translation_geofences_bulk_deleteConfirm_title),
        bulkDeleteConfirmBody = stringResource(R.string.translation_geofences_bulk_deleteConfirm_body),
        commonDelete = stringResource(R.string.translation_common_delete),
        aiPickLocation = stringResource(R.string.translation_geofences_aiSuggest_pickLocation),
        entry = stringResource(R.string.translation_Entry),
        exit = stringResource(R.string.translation_Exit),
        entryExit = stringResource(R.string.translation_Entry___Exit),
        none = stringResource(R.string.translation_None),
        createGeofence = stringResource(R.string.translation_Create_Geofence),
        editGeofence = stringResource(R.string.translation_Edit_Geofence),
        create = stringResource(R.string.translation_Create),
        update = stringResource(R.string.translation_Update),
        cancel = stringResource(R.string.translation_Cancel),
        name = stringResource(R.string.translation_Name),
        home = stringResource(R.string.translation_Home),
        latitude = stringResource(R.string.translation_Latitude),
        longitude = stringResource(R.string.translation_Longitude),
        radiusMeters = stringResource(R.string.translation_Radius__meters_),
        radiusHint = stringResource(R.string.translation_Minimum_10m__maximum_50000m),
        alertType = stringResource(R.string.translation_Alert_Type),
        nameTooLong = stringResource(R.string.translation_geofences_error_nameTooLong),
        validationFailed = stringResource(R.string.translation_forms_validationFailed),
        useCurrentLocation = stringResource(R.string.translation_geofences_useCurrentLocation),
        vehicle = stringResource(R.string.translation_geofences_vehicle),
        browser = stringResource(R.string.translation_geofences_browser),
        drawOnMap = stringResource(R.string.translation_geofences_drawOnMap),
        drawHint = stringResource(R.string.translation_geofences_drawHint),
        drawerLabel = stringResource(R.string.translation_geofences_drawerLabel),
        selectVehicle = stringResource(R.string.translation_geofences_selectVehicle),
        chooseVehicle = stringResource(R.string.translation_geofences_chooseVehicle),
        getLocation = stringResource(R.string.translation_geofences_getLocation),
        gettingLocation = stringResource(R.string.translation_geofences_gettingLocation),
        noPosition = stringResource(R.string.translation_geofences_noPosition),
        locationDenied = stringResource(R.string.translation_geofences_locationDenied),
        locationFailed = stringResource(R.string.translation_geofences_locationFailed),
        deleteGeofence = stringResource(R.string.translation_Delete_Geofence),
        delete = stringResource(R.string.translation_Delete),
        meterUnit = stringResource(R.string.translation_m),
        drawerClear = stringResource(R.string.translation_common_clear),
        drawerSave = stringResource(R.string.translation_common_save),
        drawerRadius = stringResource(R.string.translation_geofences_aiSuggest_radiusLabel),
        toastCreated = stringResource(R.string.translation_Geofence_created),
        toastUpdated = stringResource(R.string.translation_Geofence_updated),
        toastDeleted = stringResource(R.string.translation_Geofence_deleted),
        failedCreate = stringResource(R.string.translation_Failed_to_create_geofence),
        failedUpdate = stringResource(R.string.translation_Failed_to_update_geofence),
        failedToggle = stringResource(R.string.translation_Failed_to_toggle_geofence),
        failedDelete = stringResource(R.string.translation_Failed_to_delete_geofence),
    )

// ── Interaction callbacks (web event handlers) ────────────────────────────────────────────────────────────────

/** The page's interaction callbacks, wired to the [GeofencesPageViewModel] (web event handlers). */
data class GeofencesActions(
    val onSetSearch: (String) -> Unit,
    val onClearSearch: () -> Unit,
    val onSetAiLocation: (String) -> Unit,
    val onToggleSelected: (Long, Boolean) -> Unit,
    val onClearSelection: () -> Unit,
    val onRetainSelection: (Set<Long>) -> Unit,
    val onBulkDelete: () -> Unit,
    val onOpenCreate: () -> Unit,
    val onOpenEdit: (Geofence) -> Unit,
    val onCloseModal: () -> Unit,
    val onUpdateForm: (GeofenceFormData) -> Unit,
    val onSetLocationSource: (GeofenceLocationSource) -> Unit,
    val onSetVehicle: (Long) -> Unit,
    val onApplyDrawnCircle: (Double, Double, Double) -> Unit,
    val onGetLocation: () -> Unit,
    val onSubmit: () -> Unit,
    val onToggleEnabled: (Geofence, Boolean) -> Unit,
    val onRequestDelete: (Geofence) -> Unit,
    val onCancelDelete: () -> Unit,
    val onConfirmDelete: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [GeofencesPageViewModel] over the supplied [source] (the host wires the shared
 * location/vehicles/pin repositories + the resilient client via [geofencesPageSourceOf]). [logger] defaults to the
 * app's redacting logger.
 */
@Composable
fun GeofencesPage(
    source: GeofencesPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: GeofencesPageViewModel =
        viewModel(
            key = GeofencesPageRegistration.SLUG,
            factory = viewModelFactory { initializer { GeofencesPageViewModel(source, logger) } },
        )
    GeofencesPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the content, surfacing outcomes as snackbars. */
@Composable
fun GeofencesPage(
    viewModel: GeofencesPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val strings = rememberGeofencesStrings()
    val geofencesState by viewModel.geofencesState.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val pins by viewModel.pins.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(viewModel, strings) {
        viewModel.events.collect { event ->
            if (event is UiEvent.Message) snackbar.showSnackbar(strings.messageFor(event.messageKey))
        }
    }

    val actions =
        remember(viewModel) {
            GeofencesActions(
                onSetSearch = viewModel::setSearch,
                onClearSearch = viewModel::clearSearch,
                onSetAiLocation = viewModel::setAiLocationRaw,
                onToggleSelected = viewModel::toggleSelected,
                onClearSelection = viewModel::clearSelection,
                onRetainSelection = viewModel::retainSelection,
                onBulkDelete = viewModel::bulkDelete,
                onOpenCreate = viewModel::openCreate,
                onOpenEdit = viewModel::openEdit,
                onCloseModal = viewModel::closeModal,
                onUpdateForm = viewModel::updateForm,
                onSetLocationSource = viewModel::setLocationSource,
                onSetVehicle = viewModel::setSelectedVehicle,
                onApplyDrawnCircle = viewModel::applyDrawnCircle,
                onGetLocation = viewModel::getLocation,
                onSubmit = viewModel::submit,
                onToggleEnabled = viewModel::toggleEnabled,
                onRequestDelete = viewModel::requestDelete,
                onCancelDelete = viewModel::cancelDelete,
                onConfirmDelete = viewModel::confirmDelete,
                onRetry = viewModel::retry,
            )
        }

    Box(modifier = modifier.fillMaxSize()) {
        GeofencesPageContent(
            geofencesState = geofencesState,
            vehicles = vehiclesState.data.orEmpty(),
            pins = pins,
            interaction = interaction,
            strings = strings,
            actions = actions,
        )
        SnackbarHost(hostState = snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed with nothing cached renders the full-page skeleton; otherwise the
 * header is drawn, then the hard-error retry surface or the loaded body (summary stats, AI input, bulk toolbar +
 * search, the geofence list and its inline empty states). The create/edit modal + delete dialog are always mounted
 * and gate themselves on the interaction snapshot, so no region ever blanks.
 */
@Composable
fun GeofencesPageContent(
    geofencesState: UiState<List<Geofence>>,
    vehicles: List<Vehicle>,
    pins: List<PinnedItem>,
    interaction: GeofencesInteraction,
    strings: GeofencesStrings,
    actions: GeofencesActions,
    modifier: Modifier = Modifier,
) {
    if (geofencesState.isLoading) {
        GeofencesLoading(modifier)
        return
    }

    val geofences = geofencesState.data.orEmpty()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        GeofencesHeader(geofencesState = geofencesState, strings = strings, onAdd = actions.onOpenCreate)

        if (geofencesState.isError) {
            GeofencesError(onRetry = actions.onRetry)
        } else {
            FadeIn { GeofencesSummary(geofences = geofences, strings = strings) }

            GeofencesAiInput(value = interaction.aiLocationRaw, strings = strings, onChange = actions.onSetAiLocation)

            if (geofences.isEmpty()) {
                GeofencesEmpty(strings = strings, onAdd = actions.onOpenCreate)
            } else {
                GeofencesListSection(
                    geofences = geofences,
                    pins = pins,
                    interaction = interaction,
                    strings = strings,
                    actions = actions,
                )
            }
        }
    }

    interaction.modal?.let { modal ->
        GeofenceFormModal(modal = modal, vehicles = vehicles, strings = strings, actions = actions)
    }

    interaction.deleteTarget?.let { target ->
        ConfirmDialog(
            title = strings.deleteGeofence,
            message =
                stringResource(
                    R.string.translation_Are_you_sure_you_want_to_delete____name_____This_action_cannot_be_undone_,
                    target.name,
                ),
            confirmLabel = strings.delete,
            cancelLabel = strings.cancel,
            onConfirm = actions.onConfirmDelete,
            onCancel = actions.onCancelDelete,
            severity = ConfirmSeverity.Danger,
            loading = interaction.deleting,
        )
    }
}

/** The page header — the title + muted subtitle + the Add Geofence action + the query-freshness chip. */
@Composable
private fun GeofencesHeader(
    geofencesState: UiState<List<Geofence>>,
    strings: GeofencesStrings,
    onAdd: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(strings.title)
            BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            DataFreshness(
                updatedAtMillis = geofencesState.fetchedAt?.takeIf { it > 0L },
                isFetching = geofencesState.refreshing,
                isStale = geofencesState.stale,
                isError = geofencesState.hasError,
                compact = true,
            )
        }
        Button(label = strings.addGeofence, onClick = onAdd, leadingIcon = TeslaGlyphs.Plus)
    }
}

/** The hard-error surface for the geofences feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun GeofencesError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_serverError_message),
                title = stringResource(R.string.translation_error_serverError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

/** The full-page loading skeleton shown while the first geofences load is in flight with nothing cached. */
@Composable
private fun GeofencesLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(widthFraction = 0.5f, height = 24.dp)
                Skeleton(height = 80.dp)
                Skeleton(height = 80.dp)
                Skeleton(height = 80.dp)
            }
        }
    }
}

/** The summary-stats panel — the four metric tiles, or the no-data empty state when the list is empty. */
@Composable
private fun GeofencesSummary(
    geofences: List<Geofence>,
    strings: GeofencesStrings,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        if (geofences.isEmpty()) {
            EmptyState(message = strings.noData, icon = DataDisplayGlyphs.MapPin)
        } else {
            val stats = remember(geofences) { deriveGeofenceStats(geofences) }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    MetricCard(
                        label = strings.totalGeofences,
                        value = stats.total.toString(),
                        modifier = Modifier.weight(1f),
                        icon = DataDisplayGlyphs.MapPin,
                        accent = ACCENT_TOTAL,
                    )
                    MetricCard(
                        label = strings.active,
                        value = stats.active.toString(),
                        modifier = Modifier.weight(1f),
                        icon = TeslaGlyphs.Check,
                        accent = ACCENT_ACTIVE,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    MetricCard(
                        label = strings.entryAlerts,
                        value = stats.entryAlerts.toString(),
                        modifier = Modifier.weight(1f),
                        icon = DataDisplayGlyphs.ArrowRight,
                        accent = ACCENT_ENTRY,
                    )
                    MetricCard(
                        label = strings.exitAlerts,
                        value = stats.exitAlerts.toString(),
                        modifier = Modifier.weight(1f),
                        icon = DataDisplayGlyphs.ExternalLink,
                        accent = ACCENT_EXIT,
                    )
                }
            }
        }
    }
}

/** The AI pick-location input (web `geofences.aiSuggest.pickLocation` ▸ AISuggestNewGeofences seed). */
@Composable
private fun GeofencesAiInput(
    value: String,
    strings: GeofencesStrings,
    onChange: (String) -> Unit,
) {
    Input(
        value = value,
        onValueChange = onChange,
        label = strings.aiPickLocation,
        keyboardType = KeyboardType.Number,
    )
}

/** The no-geofences empty state — the web `Shield` empty panel with the Add Geofence CTA. */
@Composable
private fun GeofencesEmpty(
    strings: GeofencesStrings,
    onAdd: () -> Unit,
) {
    EmptyState(
        message = strings.addGeofenceHint,
        icon = DataDisplayGlyphs.Shield,
        title = strings.noGeofencesDefined,
        action = EmptyStateAction(label = strings.addGeofence, onClick = onAdd),
    )
}

/** The bulk toolbar + search + the pinned-first, name-filtered geofence list (or the no-matches empty state). */
@Composable
private fun GeofencesListSection(
    geofences: List<Geofence>,
    pins: List<PinnedItem>,
    interaction: GeofencesInteraction,
    strings: GeofencesStrings,
    actions: GeofencesActions,
) {
    val filtered = remember(geofences, interaction.search) { filterGeofences(geofences, interaction.search) }
    val sorted = remember(filtered, pins) { sortGeofencesByPins(filtered, pins) }
    val visibleIds = remember(filtered) { filtered.map { it.id }.toSet() }
    LaunchedEffect(visibleIds) { actions.onRetainSelection(visibleIds) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BulkActionToolbar(
            selectedCount = interaction.selectedIds.size,
            onClear = actions.onClearSelection,
            total = sorted.size,
            countText = { n -> "$n " + if (n == 1) strings.nounOne else strings.nounOther },
            actions =
                listOf(
                    BulkAction(
                        id = "delete",
                        label = strings.bulkDelete,
                        onClick = actions.onBulkDelete,
                        danger = true,
                        loading = interaction.deleting,
                    ),
                ),
        )

        SearchInput(
            value = interaction.search,
            onValueChange = actions.onSetSearch,
            hint = strings.searchHint,
            clearLabel = strings.clearSearch,
        )

        if (sorted.isEmpty()) {
            EmptyState(
                message = strings.noMatches,
                icon = DataDisplayGlyphs.MapPin,
                action = EmptyStateAction(label = strings.clearSearch, onClick = actions.onClearSearch),
            )
        } else {
            sorted.forEach { geofence ->
                GeofenceRow(
                    geofence = geofence,
                    selected = interaction.selectedIds.contains(geofence.id),
                    strings = strings,
                    actions = actions,
                )
            }
        }
    }
}

/** One geofence row — the select checkbox, name + status/alert badges, coordinates + radius, and the row actions. */
@Composable
private fun GeofenceRow(
    geofence: Geofence,
    selected: Boolean,
    strings: GeofencesStrings,
    actions: GeofencesActions,
) {
    val alertType = remember(geofence) { alertTypeOf(geofence) }
    val selectLabel = stringResource(R.string.translation_geofences_selectGeofence, geofence.name)
    val renameLabel = stringResource(R.string.translation_editableText_rename_geofence, geofence.name)

    FadeIn {
        GlassPanel(padding = PanelPadding.Md) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.semantics { contentDescription = selectLabel }) {
                    Checkbox(checked = selected, onCheckedChange = { actions.onToggleSelected(geofence.id, it) })
                }
                Icon(imageVector = DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Md)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    PanelTitle(geofence.name, modifier = Modifier.semantics { contentDescription = renameLabel })
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Badge(
                            text = if (geofence.enabled) strings.active else strings.inactive,
                            variant = if (geofence.enabled) BadgeVariant.Success else BadgeVariant.Neutral,
                        )
                        Badge(text = strings.alertLabel(alertType), variant = alertBadgeVariant(alertType))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                        Caption(formatCoordinates(geofence.latitude, geofence.longitude))
                        Caption("${geofence.radius.toLong()}${strings.meterUnit}")
                    }
                }
                Toggle(
                    checked = geofence.enabled,
                    onCheckedChange = { actions.onToggleEnabled(geofence, it) },
                )
                IconButton(
                    imageVector = TeslaGlyphs.Edit,
                    contentDescription = renameLabel,
                    onClick = { actions.onOpenEdit(geofence) },
                    size = IconSize.Sm,
                )
                IconButton(
                    imageVector = MapsGlyphs.Trash,
                    contentDescription = strings.delete,
                    onClick = { actions.onRequestDelete(geofence) },
                    size = IconSize.Sm,
                )
            }
        }
    }
}

// ── Create / edit modal ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The create/edit modal — the use-current-location panel (vehicle picker + on-map geofence drawer) shown only when
 * creating, then the validated name / coordinate / radius / alert-type / active form, and the cancel + submit
 * actions. Mirrors the web `<Modal>` body.
 */
@Composable
private fun GeofenceFormModal(
    modal: GeofenceModalState,
    vehicles: List<Vehicle>,
    strings: GeofencesStrings,
    actions: GeofencesActions,
) {
    Modal(
        onDismissRequest = actions.onCloseModal,
        title = if (modal.editingId != null) strings.editGeofence else strings.createGeofence,
        accessibleName = if (modal.editingId != null) strings.editGeofence else strings.createGeofence,
        closeLabel = strings.cancel,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (modal.showValidationBanner) {
                BodyText(strings.validationFailed, color = MaterialTheme.colorScheme.error)
            }

            if (modal.editingId == null) {
                GeofenceLocationPanel(modal = modal, vehicles = vehicles, strings = strings, actions = actions)
            }

            Input(
                value = modal.form.name,
                onValueChange = { actions.onUpdateForm(modal.form.copy(name = it)) },
                label = strings.name,
                hint = strings.home,
                errorText = if (modal.errors.nameTooLong) strings.nameTooLong else null,
            )

            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Input(
                    value = modal.form.latitude,
                    onValueChange = { actions.onUpdateForm(modal.form.copy(latitude = it)) },
                    modifier = Modifier.weight(1f),
                    label = strings.latitude,
                    keyboardType = KeyboardType.Decimal,
                    leadingIcon = MapsGlyphs.Map,
                )
                Input(
                    value = modal.form.longitude,
                    onValueChange = { actions.onUpdateForm(modal.form.copy(longitude = it)) },
                    modifier = Modifier.weight(1f),
                    label = strings.longitude,
                    keyboardType = KeyboardType.Decimal,
                    leadingIcon = MapsGlyphs.Map,
                )
            }

            Input(
                value = modal.form.radius,
                onValueChange = { actions.onUpdateForm(modal.form.copy(radius = it)) },
                label = strings.radiusMeters,
                hint = strings.radiusHint,
                keyboardType = KeyboardType.Number,
                leadingIcon = MapsGlyphs.Crosshair,
            )

            Select(
                options =
                    listOf(
                        SelectOption(GeofenceAlertType.Both.wire, strings.entryExit),
                        SelectOption(GeofenceAlertType.Entry.wire, strings.entry),
                        SelectOption(GeofenceAlertType.Exit.wire, strings.exit),
                        SelectOption(GeofenceAlertType.None.wire, strings.none),
                    ),
                selectedValue = modal.form.alertType.wire,
                onSelect = { actions.onUpdateForm(modal.form.copy(alertType = GeofenceAlertType.fromWire(it))) },
                label = strings.alertType,
            )

            Toggle(
                checked = modal.form.enabled,
                onCheckedChange = { actions.onUpdateForm(modal.form.copy(enabled = it)) },
                label = strings.active,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            ) {
                Button(
                    label = strings.cancel,
                    onClick = actions.onCloseModal,
                    variant = ButtonVariant.Secondary,
                    leadingIcon = TeslaGlyphs.Close,
                )
                Button(
                    label = if (modal.editingId != null) strings.update else strings.create,
                    onClick = actions.onSubmit,
                    enabled = hasMinimalInput(modal.form) && !modal.saving,
                    loading = modal.saving,
                    leadingIcon = TeslaGlyphs.Check,
                )
            }
        }
    }
}

/**
 * The "Use Current Location" panel — the vehicle / browser / draw-on-map source tabs, the vehicle picker + Get
 * Location action, and the inline on-map geofence drawer (which renders the map container + dark tile layer and
 * emits a drawn circle back to the form).
 */
@Composable
private fun GeofenceLocationPanel(
    modal: GeofenceModalState,
    vehicles: List<Vehicle>,
    strings: GeofencesStrings,
    actions: GeofencesActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Icon(imageVector = MapsGlyphs.Navigation, contentDescription = null, size = IconSize.Sm)
                BodyText(strings.useCurrentLocation)
            }

            Tabs(
                tabs =
                    listOf(
                        TabItem(GeofenceLocationSource.Vehicle.name, strings.vehicle),
                        TabItem(GeofenceLocationSource.Browser.name, strings.browser),
                        TabItem(GeofenceLocationSource.Map.name, strings.drawOnMap),
                    ),
                selectedKey = modal.locationSource.name,
                onSelect = { actions.onSetLocationSource(GeofenceLocationSource.valueOf(it)) },
            )

            when (modal.locationSource) {
                GeofenceLocationSource.Map ->
                    GeofenceMapDrawer(form = modal.form, strings = strings, onApply = actions.onApplyDrawnCircle)
                else -> {
                    if (modal.locationSource == GeofenceLocationSource.Vehicle) {
                        Select(
                            options =
                                listOf(SelectOption("0", strings.chooseVehicle)) +
                                    vehicles.map { SelectOption(it.id.toString(), it.displayName.ifBlank { it.vin }) },
                            selectedValue = modal.selectedVehicleId.toString(),
                            onSelect = { actions.onSetVehicle(it.toLongOrNull() ?: 0L) },
                            label = strings.selectVehicle,
                        )
                    }
                    Button(
                        label = if (modal.locationLoading) strings.gettingLocation else strings.getLocation,
                        onClick = actions.onGetLocation,
                        variant = ButtonVariant.Secondary,
                        enabled = !modal.locationLoading,
                        loading = modal.locationLoading,
                        leadingIcon = MapsGlyphs.Navigation,
                    )
                }
            }
        }
    }
}

/**
 * The inline on-map geofence drawer — the A3 maps wrapper. It renders the `MapContainer` (the `TeslaMap` Google Map
 * surface) + the dark `MapTileLayer` (`MapStyleId.Dark`) and the `GeofenceDrawer` editor; a drawn circle is folded
 * back into the form's coordinates + radius (web `GeofenceDrawer` ▸ `handleDrawerCreate`).
 */
@Composable
private fun GeofenceMapDrawer(
    form: GeofenceFormData,
    strings: GeofencesStrings,
    onApply: (Double, Double, Double) -> Unit,
) {
    val draft = remember(form.latitude, form.longitude, form.radius, form.name) { draftFence(form) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HelperText(strings.drawHint)
        Box(modifier = Modifier.fillMaxWidth().height(280.dp)) {
            GeofenceDrawer(
                fences = draft,
                onCreate = { drawn -> applyDrawnCircle(drawn, onApply) },
                modes = listOf(GeofenceShape.Circle),
                heightDp = 280,
                mapContentDescription = strings.drawerLabel,
                summaryLabel = strings.title,
                labels =
                    GeofenceLabels(
                        circle = strings.drawOnMap,
                        polygon = strings.drawOnMap,
                        rectangle = strings.drawOnMap,
                        clear = strings.drawerClear,
                        save = strings.drawerSave,
                        radius = strings.drawerRadius,
                        delete = strings.delete,
                    ),
            )
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

private fun draftFence(form: GeofenceFormData): List<MapGeofence> {
    val lat = parseFormNumber(form.latitude)
    val lng = parseFormNumber(form.longitude)
    val radius = parseFormNumber(form.radius)
    if (lat == null || lng == null || radius == null || (lat == 0.0 && lng == 0.0)) return emptyList()
    return listOf(
        MapGeofence(id = "draft", name = form.name.ifBlank { null }, center = GeoPoint(lat, lng), radiusMeters = radius),
    )
}

private fun applyDrawnCircle(
    drawn: DraftGeofence,
    onApply: (Double, Double, Double) -> Unit,
) {
    val center = drawn.center
    val radius = drawn.radiusMeters
    if (drawn.shape == GeofenceShape.Circle && center != null && radius != null) {
        onApply(center.lat, center.lng, radius)
    }
}

private fun formatCoordinates(
    latitude: Double,
    longitude: Double,
): String = String.format(Locale.US, "%.6f, %.6f", latitude, longitude)

/** The alert badge color for a disposition (web `alertBadgeVariant`). */
private fun alertBadgeVariant(type: GeofenceAlertType): BadgeVariant =
    when (type) {
        GeofenceAlertType.Both -> BadgeVariant.Success
        GeofenceAlertType.Entry -> BadgeVariant.Info
        GeofenceAlertType.Exit -> BadgeVariant.Warning
        GeofenceAlertType.None -> BadgeVariant.Neutral
    }
