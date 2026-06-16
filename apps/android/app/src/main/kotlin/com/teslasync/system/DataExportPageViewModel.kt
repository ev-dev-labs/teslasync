// The state holder backing the DataExportPage system surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/system/pages/DataExportPage.tsx). It projects the three
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface and owns the page's local
// interaction state: the export [wizard] snapshot (type / format / vehicle / date range / column allowlist) and
// the [account] download form. The jobs feed is the spine that drives the loading / empty / error phase; the
// vehicles feed folds in best-effort so a still-loading vehicle list never blanks the page, and the columns feed
// is re-derived whenever the wizard's export type changes (the web `useExportColumns(type)` gate). All derivation
// lives in the framework-free model (DataExportPageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP.
//
// The two create mutations are non-throwing: each guards a double-submit via an in-flight flag, raises the
// Export-Started / Export-Failed toast as a localized i18n key (ADR-014), and relies on the shared store to
// refresh the job feeds on success (the web `invalidateQueries(['export-jobs'])` analogue).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.dataexport

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** i18n key the success toast carries (resolved to `Export Started` + msg at the render boundary). */
internal const val EXPORT_STARTED_KEY: String = "dataExport.export.started"

/** i18n key the failure toast carries (resolved to `Export Failed` + msg at the render boundary). */
internal const val EXPORT_FAILED_KEY: String = "dataExport.export.failed"

/**
 * The export-wizard snapshot — the union of the web component's `useState` group folded into one immutable value
 * so the composable reads a single source. [selectedColumns] `null` means "user has not narrowed the catalog;
 * submit without `columns`".
 */
data class DataExportWizard(
    val exportType: ExportType = ExportType.Drives,
    val exportFormat: ExportFormat = ExportFormat.Csv,
    val vehicleId: String = "",
    val presetDays: Int = DatePreset.Last30.days,
    val customStart: String = "",
    val customEnd: String = "",
    val useCustomRange: Boolean = false,
    val selectedColumns: List<String>? = null,
)

/** The account "Download my data" form snapshot (web `AccountExportPanel` `useState` group). */
data class AccountExportForm(
    val vehicleId: String = ACCOUNT_ALL_VEHICLES,
    val startDate: String = "",
    val endDate: String = "",
)

/**
 * @param source the P1/S8 data seam (real store adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + submit events.
 * @param now wall-clock seam for the date-range payload builder; injectable for deterministic tests.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataExportPageViewModel(
    private val source: DataExportSource,
    logger: Logger,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableWizard = MutableStateFlow(DataExportWizard())
    private val mutableAccount = MutableStateFlow(AccountExportForm())
    private val mutableSubmitting = MutableStateFlow(false)
    private val mutableAccountSubmitting = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The export-wizard interaction snapshot (web `useState` group). */
    val wizard: StateFlow<DataExportWizard> = mutableWizard.asStateFlow()

    /** The account download-form snapshot (web `AccountExportPanel` state). */
    val account: StateFlow<AccountExportForm> = mutableAccount.asStateFlow()

    /** Whether the wizard submit is in flight (web `submitExport.isPending`) — disables the Start button. */
    val submitting: StateFlow<Boolean> = mutableSubmitting.asStateFlow()

    /** Whether the account export is in flight (web `createAccount.isPending`) — disables the Start button. */
    val accountSubmitting: StateFlow<Boolean> = mutableAccountSubmitting.asStateFlow()

    /**
     * The combined jobs + vehicles surface as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). The jobs feed drives the phase + freshness; vehicles fold in best-effort. Re-collected
     * when the refresh trigger bumps (the web `refetch` / error-state retry affordance).
     */
    val state: StateFlow<UiState<DataExportData>> =
        refreshTrigger
            .flatMapLatest {
                combine(source.exportJobs(), source.vehicles()) { jobs, vehicles ->
                    combineResources(jobs, vehicles)
                }
            }.asUiState(isEmpty = { it.isEmpty })

    /**
     * The wizard's column catalog as cache-then-network UI state, re-derived whenever the selected export type
     * changes (web `useExportColumns(catalogTypeFor(type))`). A type with no catalog feeds a blank type, which
     * the store maps to a stable non-fetching feed.
     */
    val columns: StateFlow<UiState<ExportColumnsResponse>> =
        mutableWizard
            .map { catalogTypeFor(it.exportType) }
            .distinctUntilChanged()
            .flatMapLatest { catalogType -> source.exportColumns(catalogType.ifEmpty { null }) }
            .asUiState()

    // ── Wizard setters ──────────────────────────────────────────────────────────────────────────────────────

    /** Select the export data type, resetting the column selection (web `handleExportTypeChange`). */
    fun setExportType(type: ExportType): Unit = mutableWizard.update { it.copy(exportType = type, selectedColumns = null) }

    /** Select the output format (web `setExportFormat`). */
    fun setExportFormat(format: ExportFormat): Unit = mutableWizard.update { it.copy(exportFormat = format) }

    /** Select the vehicle filter (web `setVehicleId`). An empty value means "all vehicles". */
    fun setWizardVehicle(vehicleId: String): Unit = mutableWizard.update { it.copy(vehicleId = vehicleId) }

    /** Apply a date preset, leaving custom-range mode (web `handlePresetChange`). */
    fun setPreset(days: Int): Unit = mutableWizard.update { it.copy(presetDays = days, useCustomRange = false) }

    /** Toggle the custom date-range editor (web `setUseCustomRange(!useCustomRange)`). */
    fun toggleCustomRange(): Unit = mutableWizard.update { it.copy(useCustomRange = !it.useCustomRange) }

    /** Set the custom start date (web `setCustomStart`). */
    fun setCustomStart(value: String): Unit = mutableWizard.update { it.copy(customStart = value) }

    /** Set the custom end date (web `setCustomEnd`). */
    fun setCustomEnd(value: String): Unit = mutableWizard.update { it.copy(customEnd = value) }

    /** Reset the column selection to "every column" (web `handleSelectAll`). */
    fun selectAllColumns(): Unit = mutableWizard.update { it.copy(selectedColumns = null) }

    /** Clear the column selection down to the required columns (web `handleClear`). */
    fun clearColumns() {
        val catalog = columns.value.data ?: return
        mutableWizard.update {
            it.copy(selectedColumns = clearedColumns(allColumnNames(catalog), requiredColumnNames(catalog)))
        }
    }

    /** Toggle one column in the allowlist, preserving catalog order (web `toggleColumn`). */
    fun toggleColumnSelection(name: String) {
        val catalog = columns.value.data ?: return
        val all = allColumnNames(catalog)
        val required = requiredColumnNames(catalog)
        mutableWizard.update { it.copy(selectedColumns = toggleColumn(it.selectedColumns, all, required, name)) }
    }

    // ── Account form setters ────────────────────────────────────────────────────────────────────────────────

    /** Select the account-export vehicle filter (web `setVehicleId`); `"all"` means every vehicle. */
    fun setAccountVehicle(vehicleId: String): Unit = mutableAccount.update { it.copy(vehicleId = vehicleId) }

    /** Set the account-export start date (web `setStartDate`). */
    fun setAccountStart(value: String): Unit = mutableAccount.update { it.copy(startDate = value) }

    /** Set the account-export end date (web `setEndDate`). */
    fun setAccountEnd(value: String): Unit = mutableAccount.update { it.copy(endDate = value) }

    // ── Mutations ───────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Queues the wizard export (web `submitExport.mutate`): a no-op while one is in flight, building the payload
     * from the current wizard snapshot, raising the Export-Started / Export-Failed toast on settle. The store
     * refreshes the job feeds on success.
     */
    fun submitExport() {
        if (mutableSubmitting.value) return
        mutableSubmitting.value = true
        logger.info("dataExport.submit")
        val w = mutableWizard.value
        val payload =
            buildExportPayload(
                type = w.exportType,
                format = w.exportFormat,
                vehicleId = w.vehicleId,
                useCustomRange = w.useCustomRange,
                customStart = w.customStart,
                customEnd = w.customEnd,
                presetDays = w.presetDays,
                selectedColumns = w.selectedColumns,
                nowMillis = now(),
            )
        launch {
            source.createExport(payload).fold(
                onSuccess = { emitEvent(UiEvent.Message(EXPORT_STARTED_KEY, severity = UiEvent.Severity.Success)) },
                onFailure = { emitEvent(UiEvent.Message(EXPORT_FAILED_KEY, severity = UiEvent.Severity.Error)) },
            )
            mutableSubmitting.value = false
        }
    }

    /**
     * Queues the full account export (web `createAccount.mutate`): a no-op while one is in flight, building the
     * payload from the account form, raising the Export-Started / Export-Failed toast on settle.
     */
    fun startAccountExport() {
        if (mutableAccountSubmitting.value) return
        mutableAccountSubmitting.value = true
        logger.info("dataExport.account.submit")
        val form = mutableAccount.value
        val payload = buildAccountPayload(form.vehicleId, form.startDate, form.endDate)
        launch {
            source.createAccountExport(payload).fold(
                onSuccess = { emitEvent(UiEvent.Message(EXPORT_STARTED_KEY, severity = UiEvent.Severity.Success)) },
                onFailure = { emitEvent(UiEvent.Message(EXPORT_FAILED_KEY, severity = UiEvent.Severity.Error)) },
            )
            mutableAccountSubmitting.value = false
        }
    }

    // ── Refresh / lifecycle ─────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the jobs + vehicles feeds (the web `refetch` / error-state retry affordance). */
    fun refresh() {
        logger.info("dataExport.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDataExportPageOpened(logger)
    }

    /**
     * Composes the jobs (spine) + vehicles (best-effort) resources into one [Resource] of the combined payload:
     * the jobs feed dictates the phase + freshness, while vehicles are read from whatever is cached so a
     * still-loading / failed vehicle list never blanks the page.
     */
    private fun combineResources(
        jobs: Resource<List<ExportJobSummary>>,
        vehicles: Resource<List<Vehicle>>,
    ): Resource<DataExportData> {
        val data = DataExportData(jobs = jobs.cached ?: emptyList(), vehicles = vehicles.cached ?: emptyList())
        return when {
            jobs is Resource.Error && jobs.cached == null ->
                Resource.Error(cached = null, fetchedAt = jobs.fetchedAt, stale = jobs.stale, error = jobs.error)
            jobs is Resource.Loading && jobs.cached == null ->
                Resource.Loading(cached = null, fetchedAt = jobs.fetchedAt, stale = jobs.stale)
            jobs is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = jobs.fetchedAt, stale = jobs.stale)
            jobs is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = jobs.fetchedAt, stale = true, error = jobs.error)
            else ->
                Resource.Success(data = data, fetchedAt = (jobs as Resource.Success).fetchedAt, stale = jobs.stale)
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel from a bound source. */
        fun factory(
            source: DataExportSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DataExportPageViewModel(source, logger) }
            }
    }
}
