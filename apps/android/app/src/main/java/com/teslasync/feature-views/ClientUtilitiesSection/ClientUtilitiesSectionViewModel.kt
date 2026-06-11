// UI-thread-free state holder backing the Compose [ClientUtilitiesSection] — the native port of the web
// component's hook composition (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx). It
// binds the injected [ClientUtilitiesSource] (the P1/S8 shared-layer seam) to a lifecycle-aware [UiState]
// of the tool-registry snapshot via [BaseFeedViewModel.asUiState], covering every state the surface can
// render: loading (no cache), content, data-empty (no registry entries), hard error + retry, and — through
// the ADR-013 freshness contract — stale / offline (the cached registry stays visible with the staleness +
// error flags). The static registry resolves immediately to content; the other phases are reachable via a
// fake source (tests / previews), so no state is hidden. The view performs no HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClientUtilitiesSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.clientutilities

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
 * State holder backing the Compose [ClientUtilitiesSection].
 *
 * It consumes the injected [ClientUtilitiesSource] (P1/S8) and re-shares it as a single [UiState] stream
 * (loading / content / empty / stale / offline / error), exposing the refresh + retry actions plus the
 * PII-safe `view.opened` diagnostic. A snapshot whose registry carried no entries maps to the data-empty
 * surface; the composable further narrows to the "No tools match your search" empty state when the search
 * filter leaves no rows (web `filtered.length === 0`). It owns no networking.
 *
 * @param source the shared tool-registry seam (the static catalog in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClientUtilitiesSectionViewModel(
    private val source: ClientUtilitiesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val restart = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The tool registry as cache-then-network UI state (no registry entries → empty). */
    val state: StateFlow<UiState<ClientUtilitiesSnapshot>> =
        restart
            .flatMapLatest { clientUtilitiesResource(source) }
            .asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ClientUtilitiesRegistration.SLUG))
    }

    /** Re-collects the registry feed (web has no refetch; the static binding re-emits the same catalog). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to ClientUtilitiesRegistration.SLUG))
        restart.update { it + 1 }
        launch { source.refresh() }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "clientUtilities.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ClientUtilitiesSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ClientUtilitiesSectionViewModel(source, logger) }
            }
    }
}

/** Surface registration metadata — the diagnostics slug emitted with `view.opened` (P1/S11). */
object ClientUtilitiesRegistration {
    /** The stable surface slug (matches the prompt + web component name). */
    const val SLUG = "ClientUtilitiesSection"
}
