// The data seam the AutomationBuilderPage automations surface binds to, plus its production binding over the shared S8
// holders and a page-local channel-list read. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's data reads + writes: the edit-mode `useAutomation`
// (`GET /automations/{id}`), `useAutomationPreset` (`GET /automations/presets/{id}`), `useVehicles` (`GET /vehicles`),
// `useNotificationChannels` (`GET /notifications`), and the three mutations `useCreateAutomationFull`
// (`POST /automations`), `useUpdateAutomationFull` (`PUT /automations/{id}`) and `useTestRunAutomation`
// (`POST /automations/{id}/test-run`).
//
// Six of the seven feeds + mutations are served by the shared S8 holders the app already exposes — the Automations
// control-plane holder (the two reads + all three mutations) and the Vehicles holder (the vehicle list). The seventh —
// the full notification-channel list — has no public shared-store read (the NotificationChannelsStore publicly exposes
// only the webhook-filtered feed), so it is served directly by the shared S7 [NotificationChannelsRepository]: the SAME
// cache-then-network repository the store wraps, so the ADR-013 freshness contract is identical. A narrow seam so the
// view-model depends on an abstraction (real adapters ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations.builder

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AutomationsRepository
import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationFullInput
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [AutomationBuilderPageViewModel] depends on so it binds to an abstraction (the shared
 * Automations + Vehicles holders and the shared channels repository in production; a fake in tests), never to a
 * concrete store or the network. The four reads are cache-then-network `Resource` flows (the web read hooks); the
 * three mutations are non-throwing suspend `Result`s (the web mutation hooks). No HTTP touches the view.
 */
interface AutomationBuilderPageSource {
    /** The cache-then-network `GET /automations/{id}` feed (web `useAutomation`) — the edit-mode source of truth. */
    fun automation(id: Long): Flow<Resource<AutomationFull>>

    /** The cache-then-network `GET /automations/presets/{id}` feed (web `useAutomationPreset`) — install-preset mode. */
    fun automationPreset(id: String): Flow<Resource<AutomationPreset>>

    /** The cache-then-network `GET /vehicles` feed (web `useVehicles`) — the vehicle-scope picker options. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /notifications` feed (web `useNotificationChannels`) — the notify-action targets. */
    fun notificationChannels(): Flow<Resource<List<NotificationChannel>>>

    /** Creates an automation from the full input body (web `useCreateAutomationFull`). */
    suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull>

    /** Updates an automation from the full input body (web `useUpdateAutomationFull`). */
    suspend fun updateAutomationFull(
        id: Long,
        input: AutomationFullInput,
    ): Result<AutomationFull>

    /** Starts a test run of an already-saved automation (web `useTestRunAutomation`). */
    suspend fun testRunAutomation(id: Long): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [AutomationsStore] (the preset read + all three mutations) + the shared
 * Automations **S7** [AutomationsRepository] for the edit-mode detail read + the shared [VehiclesStore] (the vehicle
 * list) + the shared S7 [NotificationChannelsRepository] (the full channel list the store does not publicly expose).
 *
 * The detail read binds to the S7 repository's COLD cache-then-network feed (not the memoized store feed) so the error
 * surface's retry genuinely re-runs the network fetch (the store memoizes reads and exposes no public read-refresh — the
 * same reason the sibling StatisticsPage serves its primary read from a cache-then-network repository). The mutations
 * stay on the S8 store so a successful save still refreshes the automation-list feed (the web `invalidateQueries`). The
 * live values flow through unchanged so the view-model renders the full state matrix. No HTTP touches the view.
 */
fun automationBuilderPageSourceOf(
    automationsStore: AutomationsStore,
    detailRepository: AutomationsRepository,
    vehiclesStore: VehiclesStore,
    notificationChannelsRepository: NotificationChannelsRepository,
): AutomationBuilderPageSource =
    object : AutomationBuilderPageSource {
        override fun automation(id: Long): Flow<Resource<AutomationFull>> = detailRepository.automation(id)

        override fun automationPreset(id: String): Flow<Resource<AutomationPreset>> = automationsStore.automationPreset(id)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun notificationChannels(): Flow<Resource<List<NotificationChannel>>> =
            notificationChannelsRepository.channels()

        override suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull> =
            automationsStore.createAutomationFull(input)

        override suspend fun updateAutomationFull(
            id: Long,
            input: AutomationFullInput,
        ): Result<AutomationFull> = automationsStore.updateAutomationFull(id, input)

        override suspend fun testRunAutomation(id: Long): Result<Unit> = automationsStore.testRunAutomation(id)
    }
