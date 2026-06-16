// The state holder backing the SystemStatusPage system surface (P1/S8) — the native counterpart of the web page's
// seven TanStack-Query reads + the cross-cutting `overallStatus`/`healthStale` derivations
// (web/src/features/system/pages/SystemStatusPage.tsx). It projects the seven shared cache-then-network feeds onto
// the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]: the `/system/health` feed is the
// spine that drives the loading / empty / error phase; the other six (maintenance, backup runs, backup configs,
// auth status, notification stats, vehicles) fold in best-effort (web `?? 0` / `stats?.…`) so a still-loading or
// failed sibling read never blanks the dashboard. All derivation logic lives in the framework-free model
// (SystemStatusPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.systemstatus

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.settings.AuthStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/** The four Admin-holder reads, combined into one tuple so the outer combine stays within arity. */
private data class AdminFeeds(
    val health: Resource<JsonElement>,
    val maintenance: Resource<JsonElement>,
    val backupRuns: Resource<JsonElement>,
    val backupConfigs: Resource<JsonElement>,
)

/**
 * @param source the P1/S8 data seam (real shared-holder adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param now wall-clock seam for token-expiry + backup-staleness arithmetic; injectable for deterministic tests.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemStatusPageViewModel(
    private val source: SystemStatusSource,
    logger: Logger,
    private val now: () -> Long = System::currentTimeMillis,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined seven-read surface as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps. The `/system/health` feed drives the phase +
     * freshness; the other six fold in best-effort.
     */
    val state: StateFlow<UiState<SystemStatusData>> =
        refreshTrigger
            .flatMapLatest {
                combine(
                    combine(
                        source.systemHealth(),
                        source.maintenanceState(),
                        source.backupRuns(),
                        source.backupConfigs(),
                    ) { health, maintenance, runs, configs -> AdminFeeds(health, maintenance, runs, configs) },
                    source.authStatus(),
                    source.notificationStats(),
                    source.vehicles(),
                ) { admin, auth, notif, vehicles -> combineResources(admin, auth, notif, vehicles) }
            }
            .asUiState(isEmpty = { it.isEmpty })

    /** Re-collect every cache-then-network feed (the web `refetchInterval` / error-state retry affordance). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSystemStatusPageOpened(logger)
    }

    /**
     * Composes the seven reads into one [Resource] of the combined payload, mirroring the sibling Admin surfaces:
     * the `/system/health` feed dictates the phase + freshness, while the rest are read from whatever is cached so
     * a still-loading / failed sibling read never blanks the dashboard.
     */
    private fun combineResources(
        admin: AdminFeeds,
        auth: Resource<AuthStatus>,
        notif: Resource<NotificationStats>,
        vehicles: Resource<List<Vehicle>>,
    ): Resource<SystemStatusData> {
        val health = admin.health
        val data =
            SystemStatusData.from(
                health = health.cached,
                maintenance = admin.maintenance.cached,
                backupRuns = admin.backupRuns.cached,
                backupConfigs = admin.backupConfigs.cached,
                auth = auth.cached,
                notifications = notif.cached,
                vehicles = vehicles.cached,
                nowMs = now(),
            )
        return when {
            health is Resource.Error && health.cached == null ->
                Resource.Error(cached = null, fetchedAt = health.fetchedAt, stale = health.stale, error = health.error)
            health is Resource.Loading && health.cached == null ->
                Resource.Loading(cached = null, fetchedAt = health.fetchedAt, stale = health.stale)
            health is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = health.fetchedAt, stale = health.stale)
            health is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = health.fetchedAt, stale = true, error = health.error)
            else ->
                Resource.Success(data = data, fetchedAt = (health as Resource.Success).fetchedAt, stale = health.stale)
        }
    }

    private companion object {
        const val EVENT_REFRESH = "systemStatus.refresh"
    }
}
