// The state holder backing the AutomationsListPage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/automations/pages/AutomationsListPage.tsx). It owns the
// page's local interaction state (the status filter, the search query, the preset-gallery expansion) as a single
// immutable [AutomationsInteraction] snapshot, and projects three cache-then-network reads onto the
// lifecycle-aware [UiState] surface: the automation list (the spine that drives loading/empty/error, with the
// vehicles + pins side feeds folded in best-effort), the execution history (the activity feed), and the preset
// gallery (GlassPanel6). The four row mutations + the import write run off the UI thread and the shared holder
// refreshes exactly the feeds each web hook invalidates, so the list self-updates without a manual reload.
//
// All derivation logic lives in the framework-free model (AutomationsListPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP. `InvalidPackageDeclaration` is suppressed: the mandated surface
// directory (com/teslasync/automations) diverges from the `io.teslasync.android.*` package the rest of the app
// uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The page's local interaction snapshot — the union of the web component's `statusFilter`/`search` `useState`
 * params + the preset-gallery `<details>` open state, folded into one immutable value so the composable reads a
 * single source.
 */
data class AutomationsInteraction(
    val statusFilter: AutomationStatusFilter = AutomationStatusFilter.All,
    val search: String = "",
    val presetsExpanded: Boolean = false,
)

/**
 * @param source the P1/S8 data seam (real holder adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutomationsListPageViewModel(
    private val source: AutomationsListPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(AutomationsInteraction())
    private val busy = MutableStateFlow<Set<Long>>(emptySet())
    private val importingState = MutableStateFlow(false)
    private val importErrorState = MutableStateFlow<AutomationImportError?>(null)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<AutomationsInteraction> = mutableInteraction.asStateFlow()

    /** The set of automation ids with a mutation in flight — disables just those rows' controls. */
    val busyIds: StateFlow<Set<Long>> = busy.asStateFlow()

    /** Whether an import POST is in flight — disables the Import affordance + shows a spinner. */
    val importing: StateFlow<Boolean> = importingState.asStateFlow()

    /** The last import failure to surface (web `window.alert(importFailedWithReason)`), or null. */
    val importError: StateFlow<AutomationImportError?> = importErrorState.asStateFlow()

    /**
     * The combined list + vehicles + pins surface as cache-then-network UI state. The list feed drives the phase
     * + freshness; vehicles + pins fold in best-effort (web `?? []`) so a still-loading or failed side feed never
     * blanks the list. Re-collected whenever the refresh trigger bumps (the web `refetch()`).
     */
    val state: StateFlow<UiState<AutomationsData>> =
        refreshTrigger
            .flatMapLatest {
                combine(
                    source.automations(),
                    source.vehicles(),
                    source.automationPins(),
                ) { automations, vehicles, pins ->
                    combineResources(automations, vehicles, pins)
                }
            }.asUiState(isEmpty = { it.isEmpty })

    /** The activity-feed history surface (web `useAutomationHistory(20)`). */
    val historyState: StateFlow<UiState<AutomationHistoryListResponse>> =
        refreshTrigger
            .flatMapLatest { source.automationHistory(AutomationsListPageRegistration.HISTORY_LIMIT) }
            .asUiState(isEmpty = { it.items.isEmpty() })

    /** The Quick-Start preset gallery surface (web `useAutomationPresets`, backing GlassPanel6). */
    val presetsState: StateFlow<UiState<AutomationPresetsResponse>> =
        refreshTrigger
            .flatMapLatest { source.automationPresets() }
            .asUiState(isEmpty = { it.presets.isEmpty() })

    // ── Filters + expansion (web `setStatusFilter` / `setSearch` / `<details>` toggle) ──────────────────────────

    fun setStatusFilter(filter: AutomationStatusFilter) {
        mutableInteraction.update { it.copy(statusFilter = filter) }
    }

    fun setSearch(query: String) {
        mutableInteraction.update { it.copy(search = query) }
    }

    fun togglePresets() {
        mutableInteraction.update { it.copy(presetsExpanded = !it.presetsExpanded) }
    }

    /** Reset both filters (web empty-state "Reset filters" CTA). */
    fun clearFilters() {
        mutableInteraction.update { it.copy(statusFilter = AutomationStatusFilter.All, search = "") }
    }

    // ── Row mutations (web `useToggle/ReEnable/Delete/TestRun` mutations) ───────────────────────────────────────

    fun toggle(
        id: Long,
        enabled: Boolean,
    ): Unit = mutate(id, "automations.toggle") { source.toggleAutomation(id, enabled) }

    fun reEnable(id: Long): Unit = mutate(id, "automations.reEnable") { source.reEnableAutomation(id) }

    fun delete(id: Long): Unit = mutate(id, "automations.delete") { source.deleteAutomation(id) }

    fun testRun(id: Long): Unit = mutate(id, "automations.testRun") { source.testRunAutomation(id) }

    private fun mutate(
        id: Long,
        label: String,
        block: suspend () -> Result<Unit>,
    ) {
        if (busy.value.contains(id)) return
        launch {
            busy.update { it + id }
            block()
                .onSuccess { logger.info(label) }
                .onFailure { logger.warn("$label.failed") }
            busy.update { it - id }
        }
    }

    // ── Import (web `handleImportFile`) ─────────────────────────────────────────────────────────────────────────

    /**
     * Validate a picked file's [text] against the typed-envelope contract, then POST it. A null [text] means the
     * file could not be read (web read failure → unknown-error reason). Every failure path sets [importError],
     * which the page renders through the `importFailedWithReason` wrapper.
     */
    fun importFromText(text: String?) {
        if (text == null) {
            importErrorState.value = AutomationImportError.Failed(reason = null)
            return
        }
        when (val parsed = parseImportEnvelope(text)) {
            ImportParse.NotTypedEnvelope -> importErrorState.value = AutomationImportError.TypedEnvelopeRequired
            is ImportParse.Unreadable -> importErrorState.value = AutomationImportError.Failed(parsed.reason)
            is ImportParse.Valid -> submitImport(parsed.payload)
        }
    }

    private fun submitImport(payload: JsonElement) {
        if (importingState.value) return
        launch {
            importErrorState.value = null
            importingState.update { true }
            source
                .importAutomations(payload)
                .onSuccess {
                    logger.info("automations.import")
                    refresh()
                }.onFailure { importErrorState.value = AutomationImportError.Failed(it.message) }
            importingState.update { false }
        }
    }

    /** Dismiss the import error banner. */
    fun dismissImportError() {
        importErrorState.value = null
    }

    // ── Refresh / retry / diagnostics ──────────────────────────────────────────────────────────────────────────

    /** Re-collect every cache-then-network feed (the web query `refetch` / error retry affordance). */
    fun refresh() {
        logger.info("automations.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened ${AutomationsListPageRegistration.SLUG}")
    }

    /**
     * Composes the list (spine) + vehicles + pins (best-effort) resources into one [Resource] of the combined
     * payload, mirroring the sibling surfaces: the list feed dictates the phase + freshness while the side feeds
     * are read from whatever is cached so a still-loading / failed side read never blanks the list.
     */
    private fun combineResources(
        automations: Resource<List<Automation>>,
        vehicles: Resource<List<Vehicle>>,
        pins: Resource<List<PinnedItem>>,
    ): Resource<AutomationsData> {
        val data = AutomationsData.from(automations.cached, vehicles.cached, pins.cached)
        return when {
            automations is Resource.Error && automations.cached == null ->
                Resource.Error(cached = null, fetchedAt = automations.fetchedAt, stale = automations.stale, error = automations.error)
            automations is Resource.Loading && automations.cached == null ->
                Resource.Loading(cached = null, fetchedAt = automations.fetchedAt, stale = automations.stale)
            automations is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = automations.fetchedAt, stale = automations.stale)
            automations is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = automations.fetchedAt, stale = true, error = automations.error)
            else ->
                Resource.Success(data = data, fetchedAt = (automations as Resource.Success).fetchedAt, stale = automations.stale)
        }
    }
}
