// The data seam the RequiresAuth surface binds to for the deployment auth-mode contract it reads — the native
// analogue of the web `useAuthMode` hook (web/src/api/hooks/useAuthMode.ts) that the component reads before
// gating its children. The view (composable) performs NO HTTP — it only collects state from the
// [RequiresAuthViewModel], which drives this seam (ADR-002), satisfying the "no direct HTTP from the view"
// contract. A concrete adapter over the shared S8 [AuthModeStore] backs it in production; a test fake backs it in
// unit tests. Mirrors the dual-shape (real adapter ↔ fake) of the sibling ImpersonationBanner / withAiFeature
// surfaces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RequiresAuth) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `RequiresAuth*` filename cannot match the
// `RequiresAuthSource` seam plus its co-located store adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.requiresauth

import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [RequiresAuthViewModel] depends on so it binds to an abstraction (real store adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `useAuthMode` read. No HTTP touches the
 * view.
 *
 * @property authMode the shared cache-then-network auth-mode contract feed (web `useAuthMode`).
 */
interface RequiresAuthSource {
    /** The live auth-mode contract as a hot cache-then-network [Resource] stream (web `useAuthMode().data`). */
    val authMode: StateFlow<Resource<AuthModeResponse>>

    /** Re-fetches the [authMode] contract (web's window-focus refetch); backs retry + the stale auto-refresh. */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [AuthModeStore] — the single memoized auth-mode feed every auth-coupled
 * native surface shares, so an operator reconfiguring the deployment (open → forward_auth) flips every wrapped
 * section together. The store owns the endpoint, the long staleTime, the `forward_auth` derivation, and the
 * cache; this adapter only forwards the read feed + the refresh action. No HTTP touches the view.
 */
fun AuthModeStore.asRequiresAuthSource(): RequiresAuthSource {
    val store = this
    return object : RequiresAuthSource {
        override val authMode: StateFlow<Resource<AuthModeResponse>> get() = store.authMode

        override fun refresh() = store.refresh()
    }
}
