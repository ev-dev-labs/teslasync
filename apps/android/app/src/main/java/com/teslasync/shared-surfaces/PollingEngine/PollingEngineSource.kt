// The data seam the PollingEngine surface binds to for the two feeds the web component composes — the native
// analogue of the web `useQuery(getPollingStatus)` + `useQuery(getPollingSavings)` reads
// (web/src/components/data-display/PollingEngine.tsx). The view (composable) performs NO HTTP — it only
// collects state from the [PollingEngineViewModel], which drives this seam (ADR-002), satisfying the "no
// direct HTTP from the view" contract.
//
// There is deliberately no concrete store binding here the way the Range surface binds the shared S8
// SettingsStore: the shared core ships no polling store/repository (the adaptive-polling endpoints have no
// KMP port yet), so the production adapter is wired by the host from the two shared cache-then-network feeds
// via [pollingEngineSource] — exactly the approach the sibling AIChargingDiagnosis surface takes for its own
// not-yet-ported domain. A test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PollingEngine) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed: the mandated `PollingEngine*` filename cannot match the `PollingEngineSource` seam name plus
// its co-located factory.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.pollingengine

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [PollingEngineViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `getPollingStatus` + `getPollingSavings`
 * reads. Both feeds are cache-then-network [Resource] streams so the surface can render the loading / stale /
 * offline / error matrix honestly. No HTTP touches the view.
 */
interface PollingEngineSource {
    /** Cache-then-network `GET /polling/status` feed (web `getPollingStatus`, refetch 15s). */
    fun status(): Flow<Resource<PollingStatusData>>

    /** Cache-then-network `GET /polling/savings` feed (web `getPollingSavings`, refetch 30s). */
    fun savings(): Flow<Resource<PollingSavingsData>>
}

/**
 * Builds a [PollingEngineSource] from the two flows a host wires to the shared layer — the production seam.
 * Re-collecting either flow performs a genuine cache-then-network re-fetch, which backs the surface's
 * refresh / error-retry affordance (the web `refetch`). A test fake implements [PollingEngineSource] directly
 * instead. No HTTP touches the view.
 */
fun pollingEngineSource(
    status: () -> Flow<Resource<PollingStatusData>>,
    savings: () -> Flow<Resource<PollingSavingsData>>,
): PollingEngineSource =
    object : PollingEngineSource {
        override fun status(): Flow<Resource<PollingStatusData>> = status()

        override fun savings(): Flow<Resource<PollingSavingsData>> = savings()
    }
