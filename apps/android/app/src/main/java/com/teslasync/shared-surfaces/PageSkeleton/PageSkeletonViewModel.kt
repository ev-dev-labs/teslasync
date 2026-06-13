// UI-thread-free state holder backing the PageSkeleton shared surface — the native port of the diagnostics
// boundary for web/src/components/feedback/PageSkeleton.tsx. The web component performs no work of its own
// (it imports only the `<Skeleton>` primitive and the `cn` class helper), so this holder owns exactly one
// concern: emitting the PII-safe one-shot `view.opened` diagnostic (P1/S11) the moment the surface opens.
//
// There is no data feed to bind (see PageSkeletonModel.kt for why the surface has no Source seam and no
// cache-then-network lifecycle), so unlike the data-backed sibling surfaces this holder exposes no state
// flow — the four shaped regions are driven entirely by the caller's layout parameters through the pure
// [PageSkeletonProjection] at the render boundary. Keeping the diagnostic here (rather than in the
// composable) preserves the "view is a thin renderer; the state holder owns the side effects" contract
// (ADR-002) and lets the emission be unit-tested off-device with a recording logger.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PageSkeleton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [PageSkeleton] surface.
 *
 * It owns no networking and no screen state — the surface is a pure shaped-loading primitive (the native
 * port of the web `PageSkeleton` building blocks). Its single responsibility is the one PII-safe
 * `view.opened` diagnostic (P1/S11): [onViewOpened] emits the surface slug exactly once per holder, never a
 * caller value. The view collects nothing from this holder beyond calling [onViewOpened] in its
 * first-composition effect.
 *
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PageSkeletonViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only — at most once
     * per holder. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPageSkeletonOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(logger: Logger): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PageSkeletonViewModel(logger) }
            }
    }
}
