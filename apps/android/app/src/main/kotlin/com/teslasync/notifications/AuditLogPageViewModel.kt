// The state holder backing the AuditLogPage notifications surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hook (web/src/features/notifications/pages/AuditLogPage.tsx). It owns the
// page's local interaction state (the free-text search) as a single [StateFlow], and projects the
// cache-then-network `/system/audit` read onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState]. All derivation logic lives in the framework-free model
// (AuditLogPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.auditlog

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.admin.AdminStore] adapter ↔
 *   test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuditLogPageViewModel(
    private val source: AuditLogSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableSearch = MutableStateFlow("")
    private var viewOpenedRecorded = false

    /** The page's free-text search query (web `useState('')`). */
    val search: StateFlow<String> = mutableSearch.asStateFlow()

    /**
     * The `/system/audit` feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps. The audit array drives the phase + freshness;
     * an empty array resolves to the Empty phase so the surface renders the "no entries" message, never a blank.
     */
    val state: StateFlow<UiState<AuditLogData>> =
        refreshTrigger
            .flatMapLatest { source.auditLogs() }
            .map(::projectResource)
            .asUiState(isEmpty = { it.isEmpty })

    /** Update the free-text search (web `setSearch`). */
    fun setSearch(value: String): Unit = mutableSearch.update { value }

    /** Clear the free-text search (web `() => setSearch('')`). */
    fun clearSearch(): Unit = mutableSearch.update { "" }

    /** Re-collect the cache-then-network feed (the web query `refetch` / error retry affordance). */
    fun refresh() {
        logger.info("auditLog.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAuditLogPageOpened(logger)
    }

    /**
     * Projects the raw-JSON [Resource] onto a [Resource] of the parsed payload, preserving the ADR-013 phase +
     * freshness: a null cache stays null (so the first load shows the spinner, not an empty state).
     */
    private fun projectResource(res: Resource<JsonElement>): Resource<AuditLogData> =
        when (res) {
            is Resource.Loading ->
                Resource.Loading(cached = res.cached?.let(AuditLogData::from), fetchedAt = res.fetchedAt, stale = res.stale)
            is Resource.Success ->
                Resource.Success(data = AuditLogData.from(res.data), fetchedAt = res.fetchedAt, stale = res.stale)
            is Resource.Error ->
                Resource.Error(cached = res.cached?.let(AuditLogData::from), fetchedAt = res.fetchedAt, stale = res.stale, error = res.error)
        }
}
