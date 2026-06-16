// The state holder backing the FleetAPIPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/admin/pages/FleetAPIPage.tsx). It projects the four
// cache-then-network reads (settings document, polling config, capture stats, version info) onto four
// lifecycle-aware [UiState] surfaces via [BaseFeedViewModel.asUiState], and orchestrates the two mutations
// (suspend/resume the Fleet API, save the polling config) off the UI thread — emitting the same toast
// outcomes the web page raises. All derivation logic lives in the framework-free model (FleetAPIPageModel.kt);
// this holder is the thin orchestration layer and performs no HTTP.
//
// Each panel binds to its own feed (web reads each query independently and renders the section with whatever
// has resolved), so the page never gates the whole surface behind one combined spinner — every section shows
// its own loading / content / empty / error state and never a blank region.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.fleetapi

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.CaptureStats
import io.teslasync.shared.core.presentation.settings.PollingConfig
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * The transient toast outcomes the page raises, mirroring the web `toast.*` calls one-for-one. The render
 * boundary owns the i18n lookup (ADR-014), so each case maps to its `stringResource` title (+ detail) in the
 * composable — the values stay out of this holder, which carries no localized prose.
 */
enum class FleetApiToast {
    /** A polling-endpoint toggle / retention change saved (web `toast.success('Polling config updated')`). */
    PollingUpdated,

    /** A polling-config save failed (web `toast.error('Failed to update polling config')`). */
    PollingFailed,

    /** Polling was suspended (web `toast.info('API suspended', 'All Tesla API calls have been paused')`). */
    ApiSuspended,

    /** Polling was resumed (web `toast.success('API resumed', 'Tesla API polling has been re-enabled')`). */
    ApiResumed,

    /** Suspend/resume failed (web `toast.error('Failed', 'Could not toggle API suspension')`). */
    SuspendFailed,
}

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, refresh, and the
 *   mutation outcomes — never any settings content.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetAPIPageViewModel(
    private val source: FleetApiSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val toastChannel = Channel<FleetApiToast>(Channel.BUFFERED)
    private val updatingState = MutableStateFlow(false)
    private var inFlightSaves = 0
    private var suspending = false
    private var viewOpenedRecorded = false

    /** One-shot toast outcomes (web `toast.*`); collected once by the screen, never replayed. */
    val toasts: Flow<FleetApiToast> = toastChannel.receiveAsFlow()

    /** Whether a polling-config save is in flight — disables the retention control (web `mut.isPending`). */
    val updating: StateFlow<Boolean> = updatingState.asStateFlow()

    /** The `GET /settings` projection (`api_suspended`) as cache-then-network UI state (web `useSettings`). */
    val settings: StateFlow<UiState<FleetApiSettings>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .map { it.asSettingsSnapshot() }
            .asUiState(isEmpty = { false })

    /** The `GET /settings/polling-config` feed as cache-then-network UI state (web `usePollingConfig`). */
    val pollingConfig: StateFlow<UiState<PollingConfig>> =
        refreshTrigger
            .flatMapLatest { source.pollingConfig() }
            .asUiState(isEmpty = { false })

    /** The `GET /dev-tools/telemetry-capture/stats` feed as cache-then-network UI state (web `useCaptureStats`). */
    val captureStats: StateFlow<UiState<CaptureStats>> =
        refreshTrigger
            .flatMapLatest { source.captureStats() }
            .asUiState(isEmpty = { false })

    /**
     * The `GET /system/version` feed as cache-then-network UI state (web `useVersionInfo`). A resolved version
     * with no configured endpoints is the page's Empty phase — it drives the API-Endpoints panel's empty state
     * (web `<EmptyState message={t('common.noData')} />`).
     */
    val version: StateFlow<UiState<VersionInfo>> =
        refreshTrigger
            .flatMapLatest { source.versionInfo() }
            .asUiState(isEmpty = { it.endpoints.isEmpty() })

    // ── Mutations (web `useToggleAPISuspend` / `useUpdatePollingConfig`) ─────────────────────────────────────

    /**
     * Suspends or resumes Fleet-API polling (web suspend toggle `onChange`). [suspend] is the NEW suspended
     * value (web `!settings?.api_suspended`). A second call while one is in flight is ignored. On success the
     * store refreshes the settings feed and this raises the matching toast.
     */
    fun setSuspended(suspend: Boolean) {
        if (suspending) return
        suspending = true
        launch {
            source
                .toggleApiSuspend(suspend)
                .onSuccess {
                    logger.info("fleetApi.suspend.ok", mapOf("suspended" to suspend.toString()))
                    emitToast(if (suspend) FleetApiToast.ApiSuspended else FleetApiToast.ApiResumed)
                }.onFailure {
                    logger.warn("fleetApi.suspend.fail")
                    emitToast(FleetApiToast.SuspendFailed)
                }
            suspending = false
        }
    }

    /**
     * Flips one polling-endpoint toggle and saves the full config (web `toggleEndpoint(key)`). No-op when the
     * config has not loaded yet (web `if (!pollingConfig) return`). On success the store refreshes the
     * polling-config + capture-stats feeds so the page self-updates.
     */
    fun toggleEndpoint(key: String) {
        val current = pollingConfig.value.data ?: return
        save(current.toggling(key))
    }

    /** Changes the telemetry-capture retention and saves the full config (web retention Select `onChange`). */
    fun setRetentionDays(days: Int) {
        val current = pollingConfig.value.data ?: return
        save(current.withRetentionDays(days))
    }

    // ── Refresh / retry (web query auto-refetch + the per-section retry affordance) ──────────────────────────

    /** Re-subscribe every read feed (the error-state retry affordance; the web page auto-refetches). */
    fun refresh() {
        logger.info("fleetApi.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for a hard-error section. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFleetApiPageOpened(logger)
    }

    private fun save(config: PollingConfig) {
        beginSave()
        launch {
            source
                .updatePollingConfig(config)
                .onSuccess {
                    logger.info("fleetApi.pollingConfig.ok")
                    emitToast(FleetApiToast.PollingUpdated)
                }.onFailure {
                    logger.warn("fleetApi.pollingConfig.fail")
                    emitToast(FleetApiToast.PollingFailed)
                }
            endSave()
        }
    }

    private fun emitToast(toast: FleetApiToast) {
        toastChannel.trySend(toast)
    }

    private fun beginSave() {
        inFlightSaves += 1
        updatingState.value = inFlightSaves > 0
    }

    private fun endSave() {
        inFlightSaves = (inFlightSaves - 1).coerceAtLeast(0)
        updatingState.value = inFlightSaves > 0
    }
}
