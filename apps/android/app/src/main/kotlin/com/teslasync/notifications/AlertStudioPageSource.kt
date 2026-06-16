// The data seam the AlertStudioPage surface binds to, plus its production binding over the shared-core
// Notifications + Vehicles repositories. The view (composable) performs NO HTTP — it only collects state from
// the view-model, which drives this seam, reproducing the web page's reads (`useAlertRules`, `useAlertMetrics`,
// `useNotificationChannels`, `useVehicles`) and its mutations (`useSaveAlertRule`, `useDeleteAlertRule`,
// `useToggleAlertRule`, `useBulkEnableRules`, `useBulkDisableRules`, `useTestAlertRule`, `useSnoozeAlertRule`).
//
// The reads are the shared-core cache-then-network `Resource` streams the S7 repositories already expose; the
// mutations are the non-throwing suspend `Result`s. The Android DI graph wires no NotificationsStore yet, so
// the host constructs the shared `HttpNotificationsRepository` + `HttpVehiclesRepository` over the SAME
// resilient client + offline cache every other repository uses (so the ADR-013 freshness contract + SI-verbatim
// caching are identical) and hands them in here. A narrow seam so the view-model depends on an abstraction
// (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertstudio

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleSnoozeRequest
import io.teslasync.shared.core.presentation.notifications.AlertTestRequest
import io.teslasync.shared.core.presentation.notifications.BulkRulesResult
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [AlertStudioPageViewModel] depends on so it binds to an abstraction (the shared
 * Notifications + Vehicles repositories in production, a fake in tests), never to a concrete repository or the
 * network. The reads are cache-then-network `Resource` flows (the web read hooks); the mutations are the
 * non-throwing suspend `Result`s the web mutation hooks wrap. No HTTP touches the view.
 */
interface AlertStudioPageSource {
    /** `GET /alerts/rules` — the alert-rule list (web `useAlertRules`). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** `GET /alerts/metrics` — the computed-metric registry (web `useAlertMetrics`). */
    fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>>

    /** `GET /notifications` — the notification-channel list (web `useNotificationChannels`). */
    fun notificationChannels(): Flow<Resource<List<NotificationChannel>>>

    /** `GET /vehicles` — the fleet vehicle list for the rule-scope picker (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** `POST /alerts/rules` (create) or `PUT /alerts/rules/{id}` (update) (web `useSaveAlertRule`). */
    suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule>

    /** `DELETE /alerts/rules/{id}` (web `useDeleteAlertRule`). */
    suspend fun deleteAlertRule(id: Long): Result<Unit>

    /** `PUT /alerts/rules/{id}` with `{ enabled }` (web `useToggleAlertRule`). */
    suspend fun toggleAlertRule(
        id: Long,
        enabled: Boolean,
    ): Result<AlertRule>

    /** `POST /alerts/rules/bulk/enable` with `{ ids }` (web `useBulkEnableRules`). */
    suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult>

    /** `POST /alerts/rules/bulk/disable` with `{ ids }` (web `useBulkDisableRules`). */
    suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult>

    /** `POST /alerts/test` with the full test body (web `useTestAlertRule`). */
    suspend fun testAlertRule(request: AlertTestRequest): Result<Unit>

    /** `POST /alerts/rules/{id}/snooze` with `{ minutes?, until? }` (web `useSnoozeAlertRule`). */
    suspend fun snoozeAlertRule(
        id: Long,
        request: AlertRuleSnoozeRequest,
    ): Result<AlertRule>
}

/**
 * Binds the surface to the shared **S7** [NotificationsRepository] + [VehiclesRepository] — the cache-then-
 * network feeds every notifications/vehicles surface shares. The live values flow through unchanged so the
 * view-model renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP
 * touches the view.
 */
fun alertStudioPageSourceOf(
    notificationsRepository: NotificationsRepository,
    vehiclesRepository: VehiclesRepository,
): AlertStudioPageSource =
    object : AlertStudioPageSource {
        override fun alertRules(): Flow<Resource<List<AlertRule>>> = notificationsRepository.alertRules()

        override fun alertMetrics(): Flow<Resource<List<ComputedMetricSummary>>> = notificationsRepository.alertMetrics()

        override fun notificationChannels(): Flow<Resource<List<NotificationChannel>>> = notificationsRepository.notificationChannels()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

        override suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule> =
            notificationsRepository.saveAlertRule(request)

        override suspend fun deleteAlertRule(id: Long): Result<Unit> = notificationsRepository.deleteAlertRule(id)

        override suspend fun toggleAlertRule(
            id: Long,
            enabled: Boolean,
        ): Result<AlertRule> = notificationsRepository.toggleAlertRule(id, enabled)

        override suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult> = notificationsRepository.bulkEnableRules(ids)

        override suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult> = notificationsRepository.bulkDisableRules(ids)

        override suspend fun testAlertRule(request: AlertTestRequest): Result<Unit> = notificationsRepository.testAlertRule(request)

        override suspend fun snoozeAlertRule(
            id: Long,
            request: AlertRuleSnoozeRequest,
        ): Result<AlertRule> = notificationsRepository.snoozeAlertRule(id, request)
    }
