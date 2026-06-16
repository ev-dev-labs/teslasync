// The data seam the TrueCostPage analytics surface binds to, plus its production binding over the shared S8 holders.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's data reads: `useCostBreakdown` (the rendered `GET /analytics/tco` feed), the global
// `useSelectedVehicle` scope, and `useUnits`/`useFormatting`/`useSettings` (all read the `/settings` document).
//
// Each feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose
// (`GET /analytics/tco` ▸ AnalyticsStore.costBreakdown(...); `GET /settings` ▸ SettingsStore.settings()), and the
// active-vehicle scope is the app-scoped SelectedVehicleStore selection. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete store or the network. Each (re)collection of the cost
// feed is a fresh cache-then-network stream, so the view-model's refresh trigger re-subscribing performs the web
// `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.truecost

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [TrueCostPageViewModel] depends on so it binds to an abstraction (the shared Analytics +
 * Settings holders + the app-scoped selection in production, a fake in tests), never to a concrete store or the
 * network. The two read feeds are cache-then-network `Resource` flows (the web read hooks); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface TrueCostPageSource {
    /**
     * The cache-then-network `GET /analytics/tco?vehicle_id={id}` feed (web `useCostBreakdown`). A non-null
     * [vehicleId] scopes the breakdown to that vehicle — mirroring the web `enabled: !!vehicleId` gate, the view-model
     * only opens this feed once a vehicle is selected.
     */
    fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`/`useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared **S8** [AnalyticsStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] —
 * the memoized, multi-observer feeds every surface shares app-wide. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the
 * view.
 */
fun trueCostPageSourceOf(
    analyticsStore: AnalyticsStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): TrueCostPageSource =
    object : TrueCostPageSource {
        override fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.costBreakdown(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
