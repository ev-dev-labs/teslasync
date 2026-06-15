// The state holder backing the SharedDrivePage sharing surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/sharing/pages/SharedDrivePage.tsx). It projects the public
// `useSharedDrive(token)` read onto the shared lifecycle-aware [UiState] surface and derives the live display
// preferences from the `/settings` document (web `useUnits`). All decode/derivation logic lives in the
// framework-free model (SharedDrivePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The share feed re-collects whenever the refresh trigger bumps (the error/expired-surface retry). The decode
// ([parseSharedDrive]) returns `null` for an absent / non-object payload, which resolves to UiPhase.Empty — the web
// `error || !data` short-circuit to the unavailable surface; a hard transport failure (expired / revoked / missing
// token) resolves to UiPhase.Error, also the unavailable surface. A decoded payload is UiPhase.Content (the report).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharing.shareddrive

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared resilient client + the shared settings holder in production ↔ a
 *   test fake); the view never performs HTTP.
 * @param token the public share token from the route (web `useParams().token`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SharedDrivePageViewModel(
    private val source: SharedDrivePageSource,
    val token: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The decoded shared-drive report as cache-then-network UI state (web `useSharedDrive`). Re-collected when
     * refresh bumps. A null decode (web `!data`) resolves to the empty surface and a transport failure (web `error`)
     * to the error surface — both rendered as the "share link unavailable" view; a decoded payload is the report.
     */
    val state: StateFlow<UiState<SharedDrive?>> =
        refreshTrigger
            .flatMapLatest { source.sharedDrive(token) }
            .map { resource -> resource.mapData(::parseSharedDrive) }
            .asUiState(isEmpty = { it == null })

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric. */
    val displayPrefs: StateFlow<SharedDriveDisplayPrefs> =
        source
            .settings()
            .map { resource -> SharedDriveDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SharedDriveDisplayPrefs.DEFAULT,
            )

    /** Re-runs the share load (the unavailable-surface retry affordance). */
    fun refresh() {
        logger.info("sharedDrive.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the unavailable surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no token or drive payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSharedDrivePageOpened(logger)
    }
}
