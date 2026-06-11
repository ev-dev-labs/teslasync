// The data port the Automation History widget binds to — the native analogue of the web
// `useAutomationHistory` hook (web/src/api/hooks/useAutomations.ts). The view never performs HTTP; a
// concrete adapter over the shared Automations data layer (or a test fake) drives this seam, mirroring
// the WinUI `IAutomationHistorySource` reference. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/AutomationHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.automationhistory

import io.teslasync.shared.core.data.repo.AutomationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the cache-then-network `GET /automations/history?limit=` history snapshots the widget renders.
 * A single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface AutomationHistorySource {
    /** The cache-then-network history feed (cached value first for an instant cold start, then refreshed). */
    fun history(): Flow<Resource<AutomationHistoryListResponse>>
}

/**
 * Binds the widget to the shared **S7** [AutomationsRepository] history feed (the cold cache-then-network
 * `Flow` that the S8 [AutomationsStore] also wraps). Re-collecting this feed performs a genuine
 * cache-then-network re-fetch, which is what backs the widget's manual retry/refresh affordance (the web
 * `useAutomationHistory().refetch()`); `AutomationsStore` intentionally exposes no public per-feed refresh,
 * so the widget reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
fun AutomationsRepository.asAutomationHistorySource(limit: Int = AutomationHistoryRegistration.DEFAULT_LIMIT): AutomationHistorySource =
    AutomationHistorySource { automationHistory(limit) }

/**
 * Binds the widget to the shared **S8** [AutomationsStore] history holder — the memoized, multi-observer
 * feed every Automations surface shares. Use this when a host wants the widget to fold into the same shared
 * collection as the rest of the app; the live value (incl. the store's background refresh) flows through
 * unchanged. No HTTP touches the view.
 */
fun AutomationsStore.asAutomationHistorySource(limit: Int = AutomationHistoryRegistration.DEFAULT_LIMIT): AutomationHistorySource =
    AutomationHistorySource { automationHistory(limit) }
