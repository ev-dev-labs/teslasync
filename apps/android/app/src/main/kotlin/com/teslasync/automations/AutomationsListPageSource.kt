// The data seam the AutomationsListPage surface binds to, plus its production binding over the shared S8
// AutomationsStore / VehiclesStore / PinnedStore (+ the resilient ApiHttpClient for the one write the shared
// Automations repository does not model: `POST /automations/import`). The view (composable) performs NO HTTP —
// it only collects state from the view-model, which drives this seam, reproducing the web page's TanStack-Query
// hook fan-out (`useAutomations`, `useAutomationHistory`, `useVehicles`, `usePinned`) and the action hooks
// (`useToggleAutomation`, `useReEnableAutomation`, `useDeleteAutomation`, `useTestRunAutomation`) plus the
// inline `request('/automations/import', …)` import call.
//
// The reads are the shared cache-then-network [Resource] feeds the S8 holders already expose; each (re)collection
// re-subscribes the shared upstream so the view-model's refresh trigger performs the web `refetch()`. The
// mutations are the holders' non-throwing suspend [Result]s (which already refresh exactly the feeds the web
// hooks invalidate); they are narrowed to `Result<Unit>` here because the page ignores the payload.
//
// `InvalidPackageDeclaration` / `MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/automations) diverges from the `io.teslasync.android.*` package, and the binding helper is
// co-located with the seam interface.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [AutomationsListPageViewModel] depends on so it binds to an abstraction (the shared
 * holders in production, a fake in tests), never to a concrete store or the network. The five reads are
 * cache-then-network `Resource` flows (the web read hooks); the five writes are non-throwing suspend `Result`s
 * (the web action hooks + the inline import call). No HTTP touches the view.
 */
interface AutomationsListPageSource {
    /** `GET /automations` — the automation list (web `useAutomations`). */
    fun automations(): Flow<Resource<List<Automation>>>

    /** `GET /automations/history?limit=` — the execution history (web `useAutomationHistory`). */
    fun automationHistory(limit: Int): Flow<Resource<AutomationHistoryListResponse>>

    /** `GET /automations/presets` — the preset gallery (web `useAutomationPresets`, backing GlassPanel6). */
    fun automationPresets(): Flow<Resource<AutomationPresetsResponse>>

    /** `GET /vehicles` — the id→name lookup source (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** `GET /pinned?type=automation` — pin rows for ordering (web `usePinned('automation')`). */
    fun automationPins(): Flow<Resource<List<PinnedItem>>>

    /** `PATCH /automations/{id}/toggle` (web `useToggleAutomation`). */
    suspend fun toggleAutomation(
        id: Long,
        enabled: Boolean,
    ): Result<Unit>

    /** `PATCH /automations/{id}/re-enable` (web `useReEnableAutomation`). */
    suspend fun reEnableAutomation(id: Long): Result<Unit>

    /** `DELETE /automations/{id}` (web `useDeleteAutomation`). */
    suspend fun deleteAutomation(id: Long): Result<Unit>

    /** `POST /automations/{id}/test-run` (web `useTestRunAutomation`). */
    suspend fun testRunAutomation(id: Long): Result<Unit>

    /** `POST /automations/import` with the verbatim typed export (web inline `request('/automations/import')`). */
    suspend fun importAutomations(payload: JsonElement): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds + mutations every native
 * Automations surface shares — and to the resilient [ApiHttpClient] for the single import write the shared
 * Automations repository does not model. Live values flow through unchanged so the view-model renders the full
 * state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun automationsListSource(
    automationsStore: AutomationsStore,
    vehiclesStore: VehiclesStore,
    pinnedStore: PinnedStore,
    api: ApiHttpClient,
): AutomationsListPageSource =
    object : AutomationsListPageSource {
        override fun automations(): Flow<Resource<List<Automation>>> = automationsStore.automations()

        override fun automationHistory(limit: Int): Flow<Resource<AutomationHistoryListResponse>> =
            automationsStore.automationHistory(limit)

        override fun automationPresets(): Flow<Resource<AutomationPresetsResponse>> = automationsStore.automationPresets()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun automationPins(): Flow<Resource<List<PinnedItem>>> = pinnedStore.pinned(PinnedItemType.Automation)

        override suspend fun toggleAutomation(
            id: Long,
            enabled: Boolean,
        ): Result<Unit> = automationsStore.toggleAutomation(id, enabled).map {}

        override suspend fun reEnableAutomation(id: Long): Result<Unit> = automationsStore.reEnableAutomation(id).map {}

        override suspend fun deleteAutomation(id: Long): Result<Unit> = automationsStore.deleteAutomation(id)

        override suspend fun testRunAutomation(id: Long): Result<Unit> = automationsStore.testRunAutomation(id)

        override suspend fun importAutomations(payload: JsonElement): Result<Unit> =
            api
                .safeRequest<JsonElement>(
                    method = HttpMethodKind.POST,
                    path = "/automations/import",
                    body = payload,
                ).map {}
    }
