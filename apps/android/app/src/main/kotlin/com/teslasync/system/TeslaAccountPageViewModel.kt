// The state holder backing the TeslaAccountPage surface (P1/S8) — the native counterpart of the web page's two
// TanStack-Query bindings (web/src/features/system/pages/TeslaAccountPage.tsx): the `useTeslaUserProfile()` read
// and the `useRefreshTeslaProfile()` mutation. It projects the shared User/Account holder's profile feed onto
// the lifecycle-aware [UiState] surface (loading → empty → success → error, plus stale/offline) and drives the
// refresh mutation, exposing its in-flight flag so the view disables the Refresh control (web
// `disabled={refreshMutation.isPending}`). All derivation logic lives in the framework-free model
// (TeslaAccountPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.teslaaccount

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * @param source the P1/S8 data seam (the real shared User/Account holder ↔ a test fake); the view never performs
 *   HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class TeslaAccountPageViewModel(
    private val source: TeslaAccountPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val _refreshing = MutableStateFlow(false)

    /**
     * Whether the Refresh mutation is in flight — the web `refreshMutation.isPending`. The view disables the
     * Refresh control and spins its icon while this is `true`.
     */
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]: loading (first profile load with nothing
     * cached) → empty (no profile yet, web `profile ?` false branch) → content (a synced profile) → error (a
     * hard read failure with no cache), plus stale/offline. Empty is keyed on the model guard
     * (`profile == null`), mirroring the web page's `profile ? … : <EmptyState/>` split.
     */
    val uiState: StateFlow<UiState<TeslaProfileEnvelope>> =
        source.teslaUserProfile().asUiState(isEmpty = { TeslaAccountProjection.isEmpty(it) })

    /**
     * Re-sync from Tesla — the web `refreshMutation.mutate()`. Guarded so a second tap while in flight is a
     * no-op (web `disabled` while pending); the shared holder re-collects the profile feed on success, so the
     * bound [uiState] updates in place. The mutation is non-throwing, so a failure simply clears the in-flight
     * flag (the feed's own error/stale surface carries any read failure).
     */
    fun refresh() {
        if (_refreshing.value) return
        logger.info("teslaAccount.refresh")
        _refreshing.value = true
        launch {
            source.refreshTeslaProfile()
            _refreshing.value = false
        }
    }

    /** Retry affordance for the profile feed's hard-error surface — re-runs the refresh. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaAccountPageOpened(logger)
    }

    companion object {
        /** Wire the surface from a host-supplied [source]. The holder runs on `viewModelScope`. */
        fun create(
            source: TeslaAccountPageSource,
            logger: Logger,
        ): TeslaAccountPageViewModel = TeslaAccountPageViewModel(source = source, logger = logger)
    }
}
