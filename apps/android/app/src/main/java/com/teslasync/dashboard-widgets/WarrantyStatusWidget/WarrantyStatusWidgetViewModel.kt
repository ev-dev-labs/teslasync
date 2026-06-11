// UI-thread-free state holder backing the Warranty Status widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). It binds the shared
// account-level warranty feed (P1/S8) through [WarrantyStatusSource] and projects its cache-then-network
// envelope onto the shared [UiState] surface (loading / content / empty / stale / offline / error). Empty
// mirrors the web `envelope?.data ?? null` ⇒ `<EmptyState/>` gate — a `JsonNull`/dataless envelope is the
// empty surface, a hard warranty error with no cache raises the retry surface (web shell `isError`). The
// display preferences (distance unit + locale) are derived separately from the live `/settings` feed (web
// `useUnits`/`useDateFormat`). It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] / [displayPrefs] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WarrantyStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.warrantystatus

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network warranty + settings seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WarrantyStatusWidgetViewModel(
    private val source: WarrantyStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The account-level warranty envelope as a lifecycle-aware [UiState]: loading / content / empty (no `data`
     * object) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web
     * `warrantyData = envelope?.data ?? null` ⇒ `!warrantyData` gate — a `JsonNull`/dataless envelope is the
     * empty surface, and a hard warranty error with no cache raises the retry surface (web shell `isError`).
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.warrantyDetails() }
            .asUiState { warrantyData(it) == null }

    /** The live display preferences (distance unit + locale), re-derived as settings change (web `useUnits`). */
    val displayPrefs: StateFlow<WarrantyStatusDisplayPrefs> =
        source
            .settings()
            .map { resource -> WarrantyStatusDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = WarrantyStatusDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("warrantyStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no warranty / expiry / mileage payload, so a diagnostics line can never leak the owner's
     * warranty details. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to WarrantyStatusRegistration.SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: WarrantyStatusSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WarrantyStatusWidgetViewModel(source, logger) }
            }
    }
}
