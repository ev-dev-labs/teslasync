// UI-thread-free state holder backing the ServiceStatus surface — the native port of the reads behind the web
// component's two pieces (web/src/components/data-display/ServiceStatus.tsx: `getConnectionStatus`/`onStatusChange`
// and the `useQuery(fetchSystemStatus)` poll). It binds the app-scoped live pipeline (P1/S8, ADR-009) through
// [ServiceStatusSource] and re-shares each PII-free [ServiceStatusSnapshot] as a lifecycle-aware flow the
// composable renders, exposes the offline banner's [reconnect] retry affordance, and emits the one-shot PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [snapshot] and calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.servicestatus

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `ServiceStatus` surface — the Android port of the web `ServiceStatusBanner` +
 * `SystemHealthDot` over the app-global service-reachability signal.
 *
 * It re-collects the injected [source]'s lifecycle-aware wire-health feed (the P1/S8 boundary) and re-shares the
 * PII-free [ServiceStatusSnapshot] as a lifecycle-aware [snapshot] flow — so the surface reflects the latest
 * wire health without owning any state itself. The snapshot carries only the status, last-message stamp, and
 * staleness flag, never any vehicle id or signals. [reconnect] forwards the offline banner's retry to the live
 * layer, and [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the live wire-health seam (a shared-live-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only projects the feed's wire health and nudges its reconnect.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` / reconnect events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ServiceStatusViewModel(
    private val source: ServiceStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The live pipeline's wire health as a lifecycle-aware [ServiceStatusSnapshot], carrying the status,
     * last-message stamp, and staleness flag without any signals. Collected only while the surface is on-screen
     * ([SharingStarted.WhileSubscribed]); the initial value is the cold-start `unknown` snapshot so the first
     * frame is never an artificial blank.
     */
    val snapshot: StateFlow<ServiceStatusSnapshot> =
        source
            .connection()
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ServiceStatusSnapshot.unknown(),
            )

    /**
     * Forces a fresh connection now (the offline banner's retry affordance). Logs a PII-safe, slug-only event
     * and forwards to the live layer's reconnect; a no-op effect while the stream is gated closed.
     */
    fun reconnect() {
        logger.info(EVENT_RECONNECT, mapOf(FIELD_SURFACE to ServiceStatusRegistration.SLUG))
        source.reconnect()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / connection payload, so a diagnostics line can never leak which session the user
     * was viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordServiceStatusOpened(logger)
    }

    companion object {
        private const val EVENT_RECONNECT = "serviceStatus.reconnect"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ServiceStatusSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ServiceStatusViewModel(source, logger) }
            }
    }
}
