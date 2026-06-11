// UI-thread-free state holder backing the Compose [SentryEventLogWidget] — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx). It binds the
// injected [SentryEventLogSource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState] of the
// security-event snapshot via [BaseFeedViewModel.asUiState], covering every state the web widget renders:
// loading (no cache), content, empty (no vehicle / no events), hard error, and — through the ADR-013
// freshness contract — stale / offline (the cached feed stays visible with the staleness + error flags).
// The view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SentryEventLogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sentryeventlog

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [SentryEventLogWidget].
 *
 * It consumes the injected cache-then-network [SentryEventLogSource] (P1/S8) and re-shares it as a single
 * [UiState] stream (loading / content / empty / stale / offline / error), exposing the single refresh
 * action plus the PII-safe `view.opened` diagnostic. A snapshot whose `/security` response carried no rows
 * maps to the empty surface (web `WidgetEventFeed` empty state).
 *
 * It owns no networking. [refresh] bumps a trigger that restarts a fresh upstream collection (the web
 * `refetch()`), and [onAppear] emits the one-shot `view.opened` diagnostics event with the surface
 * [SentryEventLogRegistration.SLUG] (P1/S11) at most once per holder.
 *
 * @param source the shared cache-then-network security-event seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SentryEventLogWidgetViewModel(
    private val source: SentryEventLogSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent security events as cache-then-network UI state (no rows → empty). */
    val state: StateFlow<UiState<SentryEventLogSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasRows }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SentryEventLogRegistration.SLUG))
    }

    /** Re-fetches the security events (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "sentryEventLog.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SentryEventLogSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SentryEventLogWidgetViewModel(source, logger) }
            }
    }
}
