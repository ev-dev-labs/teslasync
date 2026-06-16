// The data seam the AlertRulesPage surface binds to, plus its production binding over the shared-core S7
// NotificationsRepository. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's one read (`useAlertRules` ▸ `GET /alerts/rules`) and its
// four mutations (`useBulkEnableRules`, `useBulkDisableRules`, `useDeleteAlertRule`, `useSaveAlertRule`).
//
// The rules feed is the shared-core cache-then-network `Resource` stream the S7 NotificationsRepository already
// exposes (`GET /alerts/rules` ▸ alert-rules). The Android DI graph wires no NotificationsStore yet, so the host
// constructs the shared HttpNotificationsRepository over the SAME resilient client + offline cache the other
// repositories use (so the ADR-013 freshness contract is identical) and hands it in here — exactly as the
// sibling DrivesList surface does with HttpDrivingRepository. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertrules

import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.BulkRulesResult
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [AlertRulesPageViewModel] depends on so it binds to an abstraction (the shared
 * notifications repository in production, a fake in tests), never to a concrete repository or the network. The
 * rules feed is the cache-then-network `Resource` flow (the web `useAlertRules` read); the four suspend members
 * are the page's mutations. No HTTP touches the view.
 */
interface AlertRulesPageSource {
    /** The cache-then-network `GET /alerts/rules` feed (web `useAlertRules`, `safeArray`-guarded). */
    fun alertRules(): Flow<Resource<List<AlertRule>>>

    /** Bulk-enables [ids] (web `useBulkEnableRules` ▸ `POST /alerts/rules/bulk/enable`). */
    suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult>

    /** Bulk-disables [ids] (web `useBulkDisableRules` ▸ `POST /alerts/rules/bulk/disable`). */
    suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult>

    /** Deletes one rule (web `useDeleteAlertRule` ▸ `DELETE /alerts/rules/{id}`). */
    suspend fun deleteAlertRule(id: Long): Result<Unit>

    /** Saves a rule create/update (web `useSaveAlertRule` ▸ `POST /alerts/rules` | `PUT /alerts/rules/{id}`). */
    suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule>
}

/**
 * Binds the surface to the shared **S7** [NotificationsRepository] — the memoized cache-then-network alert-rules
 * feed plus the rule mutations. The live values flow through unchanged so the view-model renders the full state
 * matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun alertRulesPageSourceOf(repository: NotificationsRepository): AlertRulesPageSource =
    object : AlertRulesPageSource {
        override fun alertRules(): Flow<Resource<List<AlertRule>>> = repository.alertRules()

        override suspend fun bulkEnableRules(ids: List<Long>): Result<BulkRulesResult> = repository.bulkEnableRules(ids)

        override suspend fun bulkDisableRules(ids: List<Long>): Result<BulkRulesResult> = repository.bulkDisableRules(ids)

        override suspend fun deleteAlertRule(id: Long): Result<Unit> = repository.deleteAlertRule(id)

        override suspend fun saveAlertRule(request: AlertRuleSaveRequest): Result<AlertRule> = repository.saveAlertRule(request)
    }
