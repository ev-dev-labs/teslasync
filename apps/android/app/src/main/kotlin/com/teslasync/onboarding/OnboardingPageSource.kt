// The data seam the OnboardingPage surface binds to, plus its production binding over the shared S8
// OnboardingStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's single TanStack-Query read (`useOnboardingStatus`).
//
// The read is the shared-core cache-then-network `Resource` stream the S8 OnboardingStore already exposes
// (`GET /onboarding/status` ▸ the hot `status` flow: cached gate first, then the network refresh, polled every
// 30s while incomplete and stopped once complete); [refresh] restarts that poll loop from the top (the web
// hook's `refetchInterval` / `refetch` analogue consumers call after a Tesla connect or vehicle sync). A narrow
// seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the
// network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/onboarding) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.onboarding

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import io.teslasync.shared.core.presentation.onboarding.OnboardingStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [OnboardingPageViewModel] depends on so it binds to an abstraction (the shared
 * OnboardingStore in production, a fake in tests), never to a concrete store or the network. [status] streams
 * the cache-then-network onboarding gate (web `useOnboardingStatus`); [refresh] re-runs it (the web hook's
 * `refetchInterval` poll / a manual re-check after the user kicks off a Tesla connect or vehicle sync). No HTTP
 * touches the view.
 */
interface OnboardingPageSource {
    /** Stream the cache-then-network onboarding gate (web `useOnboardingStatus`). */
    fun status(): Flow<Resource<OnboardingStatus>>

    /** Re-run the gate read immediately (web `refetchInterval` / `refetch`); a no-op when nothing observes it. */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [OnboardingStore] — the memoized, multi-observer holder every native
 * onboarding surface shares (the cross-platform port of the web `useOnboarding` hook domain). [status] is the
 * store's hot gate flow (cached gate first, then the network refresh, polled every 30s while incomplete and
 * stopped once complete); [refresh] restarts that poll loop from the top. No HTTP touches the view — the store
 * delegates entirely to the shared-core `OnboardingRepository` (S7).
 */
fun OnboardingStore.asOnboardingPageSource(): OnboardingPageSource {
    val store = this
    return object : OnboardingPageSource {
        override fun status(): Flow<Resource<OnboardingStatus>> = store.status

        override fun refresh() = store.refresh()
    }
}
