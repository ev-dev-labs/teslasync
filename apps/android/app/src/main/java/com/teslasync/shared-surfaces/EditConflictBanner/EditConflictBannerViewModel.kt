// UI-thread-free state holder backing the EditConflictBanner surface — the native port of the web component's
// `useEditLease(resourceKey)` binding (web/src/components/feedback/EditConflictBanner.tsx →
// web/src/hooks/useEditLease.ts). It binds exactly one edit-lease holder through [EditLeaseSource] (the P1/S8
// boundary, ADR-002) and re-shares that holder's [EditLeaseSnapshot] as a lifecycle-aware flow the composable
// renders, plus the one-shot PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [snapshot] and calls [claim] / [onViewOpened].
//
// The holder is acquired in the constructor and released in [onCleared] — the faithful analogue of the web
// hook's `useEffect` that joins the election on mount and posts `lease.released` on unmount. The surface
// therefore participates in the election for its whole on-screen lifetime, exactly like an open browser tab,
// independent of whether the banner is currently visible.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EditConflictBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editconflictbanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `EditConflictBanner` — the Android port of the web component over a
 * `useEditLease(resourceKey)` result.
 *
 * It [EditLeaseSource.acquire]s one edit-lease holder for [resourceKey] and re-shares its live
 * [EditLeaseSnapshot] as a lifecycle-aware [snapshot] flow, so the banner reflects the latest lease state
 * (this holder owns it / a peer owns it) without owning any coordination itself. The snapshot carries only the
 * lease flags and the opaque peer id, never the `resourceKey` or any payload.
 *
 * [claim] forwards the web "Take over editing" affordance to the lease (bumping this holder past the current
 * owner). [onViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open. [onCleared]
 * releases the holder so a surviving holder is promoted (web `release`).
 *
 * @param source the edit-lease seam (the shared in-process registry in production, a fake in tests). The
 *   ViewModel owns no coordination of its own — it only binds one holder.
 * @param resourceKey the stable identifier of the resource being edited (web `resourceKey`); distinct keys are
 *   independent races.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class EditConflictBannerViewModel(
    source: EditLeaseSource,
    resourceKey: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val lease: EditLease = source.acquire(resourceKey)
    private var viewOpenedRecorded = false

    /**
     * This holder's lease state as a lifecycle-aware [EditLeaseSnapshot]. Collected only while the banner is
     * on-screen ([SharingStarted.WhileSubscribed]); the initial value is the holder's current state so the
     * first frame is never an artificial banner. The underlying holder stays in the election regardless of
     * subscription — only the re-shared flow is lifecycle-scoped.
     */
    val snapshot: StateFlow<EditLeaseSnapshot> =
        lease.state.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = lease.current(),
        )

    /** Forcibly take over the edit lease for this holder — backs the "Take over editing" affordance. */
    fun claim() = lease.claim()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no `resourceKey`, peer id, or lease payload, so a diagnostics line can never leak which resource
     * a user was editing. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordEditConflictBannerOpened(logger)
    }

    override fun onCleared() {
        lease.release()
        super.onCleared()
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for a resource. */
        fun factory(
            source: EditLeaseSource,
            resourceKey: String,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { EditConflictBannerViewModel(source, resourceKey, logger) }
            }
    }
}
