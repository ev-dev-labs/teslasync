// UI-thread-free state holder backing the Tooltip surface — the native port of the web `Tooltip`'s single
// dependency (web/src/components/ui/Tooltip.tsx calling React `useId`). It binds the [TooltipIdSource] seam
// (P1/S8), exposes the stable [tooltipId] it mints from that seam exactly once (the `useId` render-invariant
// guarantee), and emits the PII-safe one-shot `view.opened` diagnostic (P1/S11). The view never performs work
// of its own — it reads [tooltipId] to identify the tooltip body and wire the trigger's `aria-describedby`.
//
// There is no loading / empty / error / stale / offline feed lifecycle to model here: the surface fetches
// nothing (it wraps the caller's trigger and shows the caller's content), and its one dependency — the minted
// id — is a synchronous value, not a stream. The surface's real hidden / revealed branches are derived
// per-render by the pure model from the hover / focus / tap inputs. The view stays a thin renderer (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Tooltip) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [io.teslasync.android.sharedsurfaces.tooltip.Tooltip] — the Android port of
 * the web `Tooltip`'s `useId` subscription.
 *
 * It mints the surface's [tooltipId] once from the injected [idSource] (the P1/S8 boundary), so the id is
 * stable for the surface's lifetime and survives recomposition — the web `useId` render-invariance. The
 * tooltip owns no other state: its hidden / revealed branches are a pure projection of the hover / focus / tap
 * inputs, so there is no feed lifecycle to model. The view stays a thin renderer (ADR-002).
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param idSource the shared id seam (process-counter-backed in production, a fixed instance in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam forwarded to the base holder; production uses `viewModelScope`.
 */
class TooltipViewModel(
    idSource: TooltipIdSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The stable tooltip id minted once from the `useId` seam (P1/S8); the web `useId()` return value. */
    val tooltipId: String = idSource.nextId()

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTooltipOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            idSource: TooltipIdSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TooltipViewModel(idSource, logger) }
            }
    }
}
