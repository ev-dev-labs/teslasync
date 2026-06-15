// The state holder backing the GeofencesPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/maps/pages/GeofencesPage.tsx). It owns the page's local
// interaction state (search / bulk selection / AI pick-location / the create-edit modal / the delete target) as an
// immutable [GeofencesInteraction] snapshot, projects the three cache-then-network reads (`useGeofences`,
// `useVehicles`, `usePinned('geofence')`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and runs the mutations (`useBulkGeofencesDelete` plus the inline create/update/
// toggle). All derivation logic lives in the framework-free model (GeofencesPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP. Mutation outcomes are surfaced as one-shot [UiEvent.Message]s carrying
// the web i18n key (the web `toast.success`/`toast.error`), which the screen resolves at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.maps.geofences

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * @param source the P1/S8 data seam (real shared repositories + resilient client ↔ test fake); the view never
 *   performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation diagnostics.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GeofencesPageViewModel(
    private val source: GeofencesPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(GeofencesInteraction())
    private val geofencesRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL/useState cells + the bulk-selection set). */
    val interaction: StateFlow<GeofencesInteraction> = mutableInteraction.asStateFlow()

    /**
     * The geofence list as cache-then-network UI state (web `useGeofences`). Re-collected whenever the refresh
     * trigger bumps (after a mutation / retry). Empty success renders the page's no-geofences empty state.
     */
    val geofencesState: StateFlow<UiState<List<Geofence>>> =
        geofencesRefresh
            .flatMapLatest { source.geofences() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The enrolled-vehicle list as UI state (web `useVehicles`) — backs the create modal's vehicle picker. */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> =
        source.vehicles().asUiState(isEmpty = { it.isEmpty() })

    /**
     * The geofence pins (web `usePinned('geofence')`). Exposed as the last-known list so the loaded body can order
     * the list pinned-first without a phase switch; shared while observed, defaulting to empty before it loads.
     */
    val pins: StateFlow<List<PinnedItem>> =
        source.pinnedGeofences()
            .map { it.cached ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    // ── List interaction (web setSearch / bulk selection) ─────────────────────────────────────────────────────

    /** Updates the search query (web `setSearch`). */
    fun setSearch(query: String) = mutableInteraction.update { it.copy(search = query) }

    /** Clears the search query (web empty-state `Clear search` CTA). */
    fun clearSearch() = mutableInteraction.update { it.copy(search = "") }

    /** Updates the AI pick-location raw input (web `setAiLocationIdRaw`). */
    fun setAiLocationRaw(raw: String) = mutableInteraction.update { it.copy(aiLocationRaw = raw) }

    /** Toggles a geofence's bulk selection (web `sel.toggle`). */
    fun toggleSelected(
        id: Long,
        on: Boolean,
    ) = mutableInteraction.update {
        val next = it.selectedIds.toMutableSet()
        if (on) next.add(id) else next.remove(id)
        it.copy(selectedIds = next)
    }

    /** Clears the bulk selection (web `sel.clear`). */
    fun clearSelection() = mutableInteraction.update { it.copy(selectedIds = emptySet()) }

    /** Prunes the bulk selection to the currently-visible [visibleIds] (web `sel` clear-on-filter-change). */
    fun retainSelection(visibleIds: Set<Long>) =
        mutableInteraction.update { state ->
            if (state.selectedIds.isEmpty()) return@update state
            val pruned = state.selectedIds.intersect(visibleIds)
            if (pruned.size == state.selectedIds.size) state else state.copy(selectedIds = pruned)
        }

    // ── Modal lifecycle (web openCreate / openEdit / closeModal) ──────────────────────────────────────────────

    /** Opens the create modal with an empty form (web `openCreate`). */
    fun openCreate() = mutableInteraction.update { it.copy(modal = GeofenceModalState()) }

    /** Opens the edit modal pre-filled from [geofence] (web `openEdit`). */
    fun openEdit(geofence: Geofence) =
        mutableInteraction.update {
            it.copy(modal = GeofenceModalState(editingId = geofence.id, form = GeofenceFormData.fromGeofence(geofence)))
        }

    /** Closes the create/edit modal, discarding its state (web `closeModal`). */
    fun closeModal() = mutableInteraction.update { it.copy(modal = null) }

    /** Replaces the open modal's form snapshot (web `setForm`). A no-op when the modal is closed. */
    fun updateForm(form: GeofenceFormData) = setModal { it.copy(form = form) }

    /** Switches the create modal's location source tab (web `setLocationSource`). */
    fun setLocationSource(locationSource: GeofenceLocationSource) = setModal { it.copy(locationSource = locationSource) }

    /** Selects a vehicle to source the current location from (web `setSelectedVehicleId`). */
    fun setSelectedVehicle(vehicleId: Long) = setModal { it.copy(selectedVehicleId = vehicleId) }

    /** Applies a drawn circle from the on-map drawer to the form (web `handleDrawerCreate`). */
    fun applyDrawnCircle(
        latitude: Double,
        longitude: Double,
        radiusMeters: Double,
    ) = setModal {
        it.copy(
            form =
                it.form.copy(
                    latitude = latitude.toString(),
                    longitude = longitude.toString(),
                    radius = radiusMeters.toLong().toString(),
                ),
        )
    }

    // ── Get location (web handleGetLocation) ──────────────────────────────────────────────────────────────────

    /**
     * Resolves the create modal's coordinates from the selected vehicle's latest position (web `handleGetLocation`).
     * Surfaces `geofences.selectVehicle` when no vehicle is chosen, `geofences.locationDenied` when the browser
     * source has no fallback vehicle, `geofences.noPosition` when the vehicle has no position yet, and
     * `geofences.locationFailed` on a network failure — exactly the web error branches.
     */
    fun getLocation() {
        val modal = mutableInteraction.value.modal ?: return
        val vehicleId = modal.selectedVehicleId
        if (modal.locationSource == GeofenceLocationSource.Vehicle && vehicleId <= 0L) {
            emitMessage("geofences.selectVehicle", isError = true)
            return
        }
        if (modal.locationSource == GeofenceLocationSource.Browser && vehicleId <= 0L) {
            emitMessage("geofences.locationDenied", isError = true)
            return
        }
        setModal { it.copy(locationLoading = true) }
        launch {
            val result = source.latestVehiclePosition(vehicleId)
            val coord = result.getOrNull()
            when {
                result.isSuccess && coord != null ->
                    setModal { m ->
                        m.copy(
                            form = m.form.copy(latitude = coord.latitude.toString(), longitude = coord.longitude.toString()),
                            locationLoading = false,
                        )
                    }
                result.isSuccess -> {
                    setModal { it.copy(locationLoading = false) }
                    emitMessage("geofences.noPosition", isError = true)
                }
                else -> {
                    setModal { it.copy(locationLoading = false) }
                    emitMessage("geofences.locationFailed", isError = true)
                }
            }
        }
    }

    // ── Mutations (web createMut / updateMut / toggleMut / deleteMut / bulkDelete) ────────────────────────────

    /** Validates + persists the open form, creating or updating (web `handleSubmit`). */
    fun submit() {
        val modal = mutableInteraction.value.modal ?: return
        val errors = validateGeofenceForm(modal.form)
        if (errors.hasError) {
            setModal { it.copy(errors = errors, showValidationBanner = true) }
            return
        }
        setModal { it.copy(errors = GeofenceFormErrors(), showValidationBanner = false, saving = true) }
        val body = geofenceRequestBody(modal.form)
        val editingId = modal.editingId
        logger.info("geofences.submit", mapOf("mode" to if (editingId != null) "update" else "create"))
        launch {
            val result = if (editingId != null) source.updateGeofence(editingId, body) else source.createGeofence(body)
            if (result.isSuccess) {
                closeModal()
                geofencesRefresh.update { it + 1 }
                emitOutcome(if (editingId != null) GeofenceOutcome.Updated else GeofenceOutcome.Created)
            } else {
                setModal { it.copy(saving = false) }
                emitOutcome(if (editingId != null) GeofenceOutcome.UpdateFailed else GeofenceOutcome.CreateFailed)
            }
        }
    }

    /** Flips a geofence's enabled flag (web `toggleMut` ▸ `PUT /geofences/{id}` with `{ enabled }`). */
    fun toggleEnabled(
        geofence: Geofence,
        enabled: Boolean,
    ) {
        launch {
            val result = source.updateGeofence(geofence.id, buildJsonObject { put("enabled", enabled) })
            if (result.isSuccess) geofencesRefresh.update { it + 1 } else emitOutcome(GeofenceOutcome.ToggleFailed)
        }
    }

    /** Stages a geofence for deletion (web `setDeleteTarget`). */
    fun requestDelete(geofence: Geofence) = mutableInteraction.update { it.copy(deleteTarget = geofence) }

    /** Dismisses the delete confirmation (web `onCancel`). */
    fun cancelDelete() = mutableInteraction.update { it.copy(deleteTarget = null) }

    /** Deletes the staged geofence via the bulk endpoint (web `deleteMut`; one id through `POST /geofences/bulk`). */
    fun confirmDelete() {
        val target = mutableInteraction.value.deleteTarget ?: return
        if (mutableInteraction.value.deleting) return
        mutableInteraction.update { it.copy(deleting = true) }
        launch {
            val result = source.bulkDeleteGeofences(listOf(target.id))
            mutableInteraction.update { it.copy(deleting = false, deleteTarget = if (result.isSuccess) null else it.deleteTarget) }
            if (result.isSuccess) {
                geofencesRefresh.update { it + 1 }
                emitOutcome(GeofenceOutcome.Deleted)
            } else {
                emitOutcome(GeofenceOutcome.DeleteFailed)
            }
        }
    }

    /** Bulk-deletes the currently-selected geofences (web `bulkDelete.mutateAsync`). */
    fun bulkDelete() {
        val ids = mutableInteraction.value.selectedIds.toList()
        if (ids.isEmpty() || mutableInteraction.value.deleting) return
        mutableInteraction.update { it.copy(deleting = true) }
        logger.info("geofences.bulkDelete", mapOf("count" to ids.size.toString()))
        launch {
            val result = source.bulkDeleteGeofences(ids)
            mutableInteraction.update {
                it.copy(deleting = false, selectedIds = if (result.isSuccess) emptySet() else it.selectedIds)
            }
            if (result.isSuccess) {
                geofencesRefresh.update { it + 1 }
                emitOutcome(GeofenceOutcome.Deleted)
            } else {
                emitOutcome(GeofenceOutcome.DeleteFailed)
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the geofence feed — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("geofences.refresh")
        geofencesRefresh.update { it + 1 }
    }

    /** Retry affordance for the geofences feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGeofencesPageOpened(logger)
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────

    private fun setModal(transform: (GeofenceModalState) -> GeofenceModalState) =
        mutableInteraction.update { state ->
            val modal = state.modal ?: return@update state
            state.copy(modal = transform(modal))
        }

    private fun emitOutcome(outcome: GeofenceOutcome) = emitMessage(outcome.messageKey, isError = outcome.isError)

    private fun emitMessage(
        messageKey: String,
        isError: Boolean,
    ) = emitEvent(
        UiEvent.Message(
            messageKey = messageKey,
            severity = if (isError) UiEvent.Severity.Error else UiEvent.Severity.Success,
        ),
    )
}
