// UI-thread-free state holder backing the MaintenanceBanner surface — the native port of the reads behind the
// web component (web/src/components/feedback/MaintenanceBanner.tsx: the `useSystemHealth` poll, the
// per-snapshot dismissal keyed on a fingerprint, and the once-a-second countdown clock). It binds the
// app-scoped `/system/health` feed (P1/S8, ADR-013) through [MaintenanceBannerSource], folds each emission
// onto a lifecycle-aware [MaintenanceBannerRender] the composable paints, owns the per-snapshot [dismiss]
// state (with the web's stale-dismissal reset), drives the countdown via [tick], and emits the one-shot
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [render] and calls the
// actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MaintenanceBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maintenancebanner

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `MaintenanceBanner` surface — the Android port of the web
 * `MaintenanceBanner` over the shared `/system/health` service-mode feed.
 *
 * It maps the injected [source]'s cache-then-network `/system/health` `Resource` through [mapToSnapshot] onto a
 * lifecycle-aware [UiState] (the P1/S8 boundary), then re-shares a [MaintenanceBannerRender] that folds the
 * snapshot with the countdown clock and the per-snapshot dismissal — so the surface reflects the latest service
 * mode without owning any state itself. The render carries no vehicle id and no signals. [dismiss] hides the
 * current banner (keyed on its fingerprint, with the web's stale-dismissal reset so a freshly-pushed operator
 * banner re-surfaces), [tick] advances the once-a-second countdown, and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open.
 *
 * @param source the shared Admin `/system/health` seam (an `AdminStore` adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` / dismiss events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for the countdown; injectable for tests (defaults to the system clock).
 */
class MaintenanceBannerViewModel(
    source: MaintenanceBannerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val nowMs = MutableStateFlow(clock())
    private val dismissedKey = MutableStateFlow<String?>(null)

    /**
     * The mapped `/system/health` snapshot as cache-then-network UI state. A `Loading` / `Error` with nothing
     * cached stays a first load (web `!data`); a resolved `ok` snapshot is [UiState.isEmpty] (banner hidden);
     * a `degraded` / `maintenance` snapshot is content (the banner renders).
     */
    val uiState: StateFlow<UiState<MaintenanceBannerSnapshot>> =
        source.systemHealth().map { it.mapToSnapshot() }.asUiState { !it.isActive }

    /**
     * The fully-resolved banner render as a lifecycle-aware flow, folding the latest snapshot with the
     * countdown clock and the per-snapshot dismissal. Collected only while the surface is on-screen
     * ([SharingStarted.WhileSubscribed]); the initial value is the cold-start projection (an absent, hidden
     * banner) so the first frame is never an artificial blank.
     */
    val render: StateFlow<MaintenanceBannerRender> =
        combine(uiState, nowMs, dismissedKey) { ui, now, dismissed -> projectRender(ui, now, dismissed) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(RENDER_STOP_TIMEOUT_MS),
                initialValue = projectRender(uiState.value, nowMs.value, dismissedKey.value),
            )

    /**
     * Dismisses the banner for the snapshot identified by [key] (web `handleDismiss` → persist the current
     * fingerprint). Logs a PII-safe, slug-only event and hides the banner until the operator pushes a new
     * snapshot (a different fingerprint), which re-surfaces it.
     */
    fun dismiss(key: String) {
        logger.info(EVENT_DISMISS, mapOf(FIELD_SURFACE to MaintenanceBannerRegistration.SLUG))
        dismissedKey.value = key
    }

    /**
     * Advances the countdown clock (web's once-a-second `setInterval`). Driven by the composable only while a
     * countdown is on-screen, so an idle banner never churns the subtree.
     */
    fun tick() {
        nowMs.value = clock()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no maintenance message / mode / end time, so a diagnostics line can never leak the fleet's
     * operational posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMaintenanceBannerOpened(logger)
    }

    /**
     * Folds a [ui] state, the current [now], and the active [dismissed] key into the render. Mirrors the web
     * dismissal-reset effect: a dismissal only applies to the snapshot it was made for, so once the upstream
     * fingerprint moves on the stored key is dropped and a later identical window re-surfaces. [UiState.stale]
     * is the ADR-013 offline / last-known flag forwarded onto the render's "Stale" chip.
     */
    private fun projectRender(
        ui: UiState<MaintenanceBannerSnapshot>,
        now: Long,
        dismissed: String?,
    ): MaintenanceBannerRender {
        val snapshot = ui.data ?: MaintenanceBannerSnapshot.ABSENT
        val key = MaintenanceBannerProjection.fingerprint(snapshot)
        val effective = dismissed?.takeIf { it == key }
        if (dismissed != null && effective == null) {
            dismissedKey.value = null
        }
        return MaintenanceBannerProjection.render(snapshot, now, effective, stale = ui.stale)
    }

    companion object {
        private const val EVENT_DISMISS = "maintenanceBanner.dismiss"

        /** Keep the render's upstream alive briefly across config changes / fast re-subscribes. */
        private const val RENDER_STOP_TIMEOUT_MS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: MaintenanceBannerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { MaintenanceBannerViewModel(source, logger) }
            }
    }
}
