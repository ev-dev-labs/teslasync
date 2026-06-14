// UI-thread-free state holder backing the Tabs surface — the native port of the web `Tabs`'s single
// dependency (web/src/components/ui/Tabs.tsx calling React `useId`). It binds the [TabsIdSource] seam
// (P1/S8), exposes the stable [tablistId] it mints from that seam exactly once (the `useId` render-invariant
// guarantee), and emits the PII-safe one-shot `view.opened` diagnostic (P1/S11). The view never performs work
// of its own — it reads [tablistId] to build each tab's id and projects its render parameters with the pure
// model.
//
// There is no loading / empty / error / stale / offline feed lifecycle to model here: the surface fetches
// nothing (it renders the controlled collection the parent passes), and its one dependency — the minted id —
// is a synchronous value, not a stream. The surface's real empty / populated branches are derived per-render
// by [TabsProjection.project]. The view stays a thin renderer (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Tabs) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [io.teslasync.android.sharedsurfaces.tabs.Tabs] — the Android port of the
 * web `Tabs`'s `useId` subscription.
 *
 * It mints the surface's [tablistId] once from the injected [idSource] (the P1/S8 boundary), so the id is
 * stable for the surface's lifetime and survives recomposition — the web `useId` render-invariance. The strip
 * owns no other state: its empty / populated branches are a pure projection of the parent-supplied collection,
 * so there is no feed lifecycle to model. The view stays a thin renderer (ADR-002).
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param idSource the shared id seam (process-counter-backed in production, a fixed instance in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam forwarded to the base holder; production uses `viewModelScope`.
 */
class TabsViewModel(
    idSource: TabsIdSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The stable tablist id minted once from the `useId` seam (P1/S8); the web `useId()` return value. */
    val tablistId: String = idSource.nextId()

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTabsOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            idSource: TabsIdSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TabsViewModel(idSource, logger) }
            }
    }
}
