// The data seam the ImpersonationBanner surface binds to for the impersonation state it reads and the end
// mutation it fires — the native analogue of the web `useImpersonationStatus` + `useEndImpersonation` hooks
// (web/src/api/hooks/useImpersonation.ts). The view (composable) performs NO HTTP — it only collects state
// from the [ImpersonationBannerViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP
// from the view" contract. A concrete adapter over the shared S8 [ImpersonationStore] backs it in production;
// a test fake backs it in unit tests. Mirrors the dual-shape (real adapter ↔ fake) of the sibling UserCell /
// Range surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ImpersonationBanner) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `ImpersonationBanner*` filename cannot match the
// `ImpersonationBannerSource` seam plus its co-located store adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.impersonationbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStore
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [ImpersonationBannerViewModel] depends on so it binds to an abstraction (real store
 * adapter ↔ test fake), never a concrete client — the Android counterpart of the web `useImpersonation`
 * read + end. No HTTP touches the view.
 *
 * @property status the shared cache-then-network impersonation-state feed (web `useImpersonationStatus`).
 */
interface ImpersonationBannerSource {
    /** The live impersonation-state feed as a hot cache-then-network [Resource] stream (web `useImpersonationStatus`). */
    val status: StateFlow<Resource<ImpersonationStatus>>

    /** Ends the current impersonation session (web `useEndImpersonation`). Idempotent; non-throwing [Result]. */
    suspend fun endImpersonation(): Result<Unit>

    /** Re-fetches the [status] feed (web hook's polling / `refetch`); backs retry + the stale auto-refresh. */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [ImpersonationStore] — the single memoized impersonation feed every
 * Impersonation surface shares, so ending elsewhere (or the button starting a session) refreshes this bar too.
 * The store owns the endpoints, query keys, open-mode normalisation, and the invalidate-all rule; this adapter
 * only forwards the read feed + the end/refresh actions. No HTTP touches the view.
 */
fun ImpersonationStore.asImpersonationBannerSource(): ImpersonationBannerSource {
    val store = this
    return object : ImpersonationBannerSource {
        override val status: StateFlow<Resource<ImpersonationStatus>> get() = store.status

        override suspend fun endImpersonation(): Result<Unit> = store.endImpersonation()

        override fun refresh() = store.refresh()
    }
}
