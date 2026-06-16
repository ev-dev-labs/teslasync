// The data seam the AutomationListPage surface binds to, plus its production binding over the shared S8
// AutomationsStore. The view (composable) performs NO HTTP — it only collects state from the view-model, which
// drives this seam, reproducing the web page's two TanStack-Query bindings (`useAutomations` read +
// `useBulkAutomationsUpdate` mutation).
//
// The read is the shared-core cache-then-network `Resource` StateFlow the S8 AutomationsStore already exposes
// (`GET /automations` ▸ automations()); [bulkUpdate] is the store's allowlisted `POST /automations/bulk`
// mutation (web `useBulkAutomationsUpdate`), which on success refreshes the list feed itself (the web
// `invalidateQueries(automationKeys.all)` analogue), so the table self-updates without the view reloading. A
// narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations.list

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import io.teslasync.shared.core.presentation.automations.AutomationBulkResult
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [AutomationListPageViewModel] depends on so it binds to an abstraction (the shared
 * Automations holder in production, a fake in tests), never to a concrete store or the network. The read is a
 * cache-then-network typed `Resource` StateFlow of the automation list (web `useAutomations`); [bulkUpdate]
 * applies the allowlisted enable/disable/delete operation (web `useBulkAutomationsUpdate`) and lets the shared
 * store refresh the list feed on success. No HTTP touches the view.
 */
interface AutomationListSource {
    /** The typed `GET /automations` list feed as a cache-then-network `Resource` (web `useAutomations`). */
    fun automations(): StateFlow<Resource<List<Automation>>>

    /**
     * Runs the allowlisted bulk [op] over [ids] (web `useBulkAutomationsUpdate` ▸ `POST /automations/bulk`).
     * Non-throwing: returns a [Result]; on success the shared store refreshes the list (+ history) feeds.
     */
    suspend fun bulkUpdate(
        ids: List<Long>,
        op: AutomationBulkOp,
    ): Result<AutomationBulkResult>
}

/**
 * Binds the surface to the shared **S8** [AutomationsStore] — the memoized, multi-observer automations feed the
 * app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun AutomationsStore.asAutomationListSource(): AutomationListSource {
    val store = this
    return object : AutomationListSource {
        override fun automations(): StateFlow<Resource<List<Automation>>> = store.automations()

        override suspend fun bulkUpdate(
            ids: List<Long>,
            op: AutomationBulkOp,
        ): Result<AutomationBulkResult> = store.bulkAutomationsUpdate(ids, op)
    }
}
