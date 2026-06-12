// The data port the OnboardingGate feature view binds to — the native analogue of the web hook the guard
// composes (web/src/features/onboarding/components/OnboardingGate.tsx → `useOnboardingStatus`; the
// P1/S8 state-holder boundary). The view never performs HTTP itself, and a test fake stands in for the whole
// domain so the guard logic is verified off-device.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OnboardingGate) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located binding adapter.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.onboardinggate

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import io.teslasync.shared.core.presentation.onboarding.OnboardingStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [OnboardingGateViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [status] streams the cache-then-network gate
 * read (web `useOnboardingStatus`); [refresh] re-runs it (the web hook's `refetchInterval` poll / a manual
 * re-check after the user kicks off a Tesla connect or vehicle sync). No HTTP touches the view.
 */
interface OnboardingGateSource {
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
fun bindOnboardingGateSource(store: OnboardingStore): OnboardingGateSource =
    object : OnboardingGateSource {
        override fun status(): Flow<Resource<OnboardingStatus>> = store.status

        override fun refresh() = store.refresh()
    }
