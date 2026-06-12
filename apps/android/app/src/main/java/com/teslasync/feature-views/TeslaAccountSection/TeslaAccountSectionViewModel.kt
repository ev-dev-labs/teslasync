// UI-thread-free state holder backing the Compose [TeslaAccountSection] feature view — the native port of
// the Tesla Fleet auth hook composition the web component owns
// (web/src/features/settings/components/TeslaAccountSection.tsx). It binds the shared cache-then-network
// [TeslaAccountSource] (P1/S8), projects the `/auth/status` read onto the shared [UiState] surface
// (loading / content / stale / offline / error), mirrors the global "token expired" re-auth signal,
// tracks each mutation's in-flight flag, runs the four mutations (web `useAuthURL` / `useRefreshAuth` /
// `useSyncVehicles` / `useDisconnectAuth`) raising typed [TeslaAccountToast]s, exposes the inline
// "Synced N vehicle(s)" count and the one-shot "open this OAuth URL" effect, and emits the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaAccountSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaaccountsection

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The set of in-flight mutation flags the action buttons bind to — the native analogue of the web
 * mutations' `isPending` flags (web `authUrlMut.isPending` / `refreshMut.isPending` / `syncMut.isPending`
 * / `disconnectMut.isPending`). Each gates its button's loading/disabled state so a double-tap can't
 * re-fire an in-flight call.
 *
 * @property connecting the OAuth-URL request is in flight (web `authUrlMut.isPending`).
 * @property refreshingToken the token refresh is in flight (web `refreshMut.isPending`).
 * @property syncing the vehicle sync is in flight (web `syncMut.isPending`).
 * @property disconnecting the disconnect is in flight (web `disconnectMut.isPending`).
 */
data class TeslaAccountActions(
    val connecting: Boolean = false,
    val refreshingToken: Boolean = false,
    val syncing: Boolean = false,
    val disconnecting: Boolean = false,
)

/**
 * Lifecycle-aware state holder backing the Compose [TeslaAccountSection]. It consumes the
 * cache-then-network [TeslaAccountSource] (P1/S8) and re-shares the auth-status read as a [UiState] stream
 * via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A
 * resolved status always maps to content (the web panel always renders its chrome + controls — there is
 * no empty branch; "no connection" is the friendly Not-connected content), so the emptiness predicate is
 * `{ false }`; loading (no cache), hard error (no cache), and the stale/offline cached view are all
 * surfaced by the shared `Resource → UiState` projection.
 *
 * It owns no networking. [retry] re-collects the auth-status feed; [connect] requests an OAuth URL and
 * emits it as the one-shot [openUrls] effect (web `handleLogin` → `window.location.href`); [refreshToken]
 * / [disconnect] raise their toast and restart the read (the web invalidates `auth-status`); [syncVehicles]
 * stores the synced count for the inline success line and raises only a failure toast (web parity — sync
 * shows no success toast). [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network Tesla-auth seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaAccountSectionViewModel(
    private val source: TeslaAccountSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val actionState = MutableStateFlow(TeslaAccountActions())
    private val syncedCountState = MutableStateFlow<Int?>(null)
    private val toastChannel = Channel<TeslaAccountToast>(Channel.BUFFERED)
    private val openUrlChannel = Channel<String>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The Tesla auth status as cache-then-network UI state: loading / content / stale / offline / error,
     * carrying the freshness stamp + error kind. The emptiness predicate is `false` so a resolved status
     * always renders the panel (web parity: the surface always renders, connected or not).
     */
    val authStatus: StateFlow<UiState<AuthStatus>> =
        refreshTrigger
            .flatMapLatest { source.authStatus() }
            .asUiState { false }

    /**
     * The global "token expired, re-auth required" signal (web `pillDisconnected`). Drives the
     * "Disconnected" status pill + reconnect copy even while the server still reports authenticated, so the
     * surface warns before the next failed call. Defaults to `false` until a host wires a real signal.
     */
    val reauthNeeded: StateFlow<Boolean> =
        source
            .reauthNeeded()
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), false)

    /** The in-flight flags the action buttons bind to (web each mutation's `isPending`). */
    val actions: StateFlow<TeslaAccountActions> = actionState.asStateFlow()

    /** The count from the last successful sync, shown as the inline "Synced N vehicle(s)." line (web `syncMut.data.synced`). */
    val syncedCount: StateFlow<Int?> = syncedCountState.asStateFlow()

    /** Typed toasts the composable maps to localized [io.teslasync.android.components.feedback.ToastItem]s (web `useToast`). */
    val toasts: Flow<TeslaAccountToast> = toastChannel.receiveAsFlow()

    /** One-shot "open this Tesla OAuth URL in the browser" effects (web `window.location.href = auth_url`). */
    val openUrls: Flow<String> = openUrlChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load of the auth-status read (web `refetch()`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to TeslaAccountSectionRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Requests a Tesla OAuth authorize URL and, on success, emits it as the one-shot [openUrls] effect for
     * the host to open in a browser (web `handleLogin` → `authUrlMut.mutate({ onSuccess: href = auth_url })`).
     * Backs both the "Connect Tesla Account" and "Re-authorize" affordances. Tracks [TeslaAccountActions.connecting]
     * for their loading/disabled state. The web component shows no toast here (success navigates, failure is
     * swallowed by the page), so a failure is only logged — no PII (no URL) is recorded.
     */
    fun connect() {
        if (actionState.value.connecting) return
        actionState.update { it.copy(connecting = true) }
        launch {
            try {
                source.authUrl().fold(
                    onSuccess = { openUrlChannel.trySend(it.authUrl) },
                    onFailure = { logger.warn(EVENT_CONNECT_FAILED, mapOf(FIELD_SURFACE to TeslaAccountSectionRegistration.SLUG)) },
                )
            } finally {
                actionState.update { it.copy(connecting = false) }
            }
        }
    }

    /**
     * Refreshes the Fleet token (web `useRefreshAuth`). Raises [TeslaAccountToast.TokenRefreshed] on success
     * (web `toast.success`) then restarts the read (the web invalidates `auth-status`), or
     * [TeslaAccountToast.TokenRefreshFailed] on failure. Tracks [TeslaAccountActions.refreshingToken].
     */
    fun refreshToken() {
        if (actionState.value.refreshingToken) return
        actionState.update { it.copy(refreshingToken = true) }
        launch {
            try {
                source.refreshAuth().fold(
                    onSuccess = {
                        emitToast(TeslaAccountToast.TokenRefreshed)
                        refreshTrigger.update { it + 1 }
                    },
                    onFailure = { emitToast(TeslaAccountToast.TokenRefreshFailed) },
                )
            } finally {
                actionState.update { it.copy(refreshingToken = false) }
            }
        }
    }

    /**
     * Re-syncs vehicles from the Fleet account (web `useSyncVehicles`). Clears any prior count, then on
     * success stores the synced count for the inline "Synced N vehicle(s)." line (web `syncMut.data.synced`)
     * — raising NO success toast, exactly like the web — or [TeslaAccountToast.SyncFailed] on failure. The
     * web mutation invalidates the vehicles feed, which this surface does not read, so the auth-status read
     * is not restarted. Tracks [TeslaAccountActions.syncing].
     */
    fun syncVehicles() {
        if (actionState.value.syncing) return
        actionState.update { it.copy(syncing = true) }
        syncedCountState.value = null
        launch {
            try {
                source.syncVehicles().fold(
                    onSuccess = { syncedCountState.value = it.synced },
                    onFailure = { emitToast(TeslaAccountToast.SyncFailed) },
                )
            } finally {
                actionState.update { it.copy(syncing = false) }
            }
        }
    }

    /**
     * Disconnects the Tesla account (web `useDisconnectAuth`, behind the confirm dialog the composable
     * owns). Raises [TeslaAccountToast.Disconnected] on success (web `toast.success`) then restarts the
     * read (the web invalidates `auth-status`), or [TeslaAccountToast.DisconnectFailed] on failure. Tracks
     * [TeslaAccountActions.disconnecting] (also drives the confirm dialog's loading state).
     */
    fun disconnect() {
        if (actionState.value.disconnecting) return
        actionState.update { it.copy(disconnecting = true) }
        launch {
            try {
                source.disconnectAuth().fold(
                    onSuccess = {
                        emitToast(TeslaAccountToast.Disconnected)
                        refreshTrigger.update { it + 1 }
                    },
                    onFailure = { emitToast(TeslaAccountToast.DisconnectFailed) },
                )
            } finally {
                actionState.update { it.copy(disconnecting = false) }
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no token, expiry, or vehicle data, so a diagnostics line can never leak the account
     * connection state.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaAccountSectionViewOpened(logger)
    }

    private fun emitToast(toast: TeslaAccountToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        private const val EVENT_REFRESH = "teslaAccount.refresh"
        private const val EVENT_CONNECT_FAILED = "teslaAccount.connectFailed"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: TeslaAccountSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TeslaAccountSectionViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [SettingsStore], with an optional re-auth signal. */
        fun create(
            store: SettingsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
            reauthSignal: Flow<Boolean> = flowOf(false),
        ): TeslaAccountSectionViewModel = TeslaAccountSectionViewModel(teslaAccountSource(store, reauthSignal), logger, scope)

        /** Wire the surface from the shared **S7** [SettingsRepository] (refetch-on-retry binding). */
        fun create(
            repository: SettingsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
            reauthSignal: Flow<Boolean> = flowOf(false),
        ): TeslaAccountSectionViewModel = TeslaAccountSectionViewModel(teslaAccountSource(repository, reauthSignal), logger, scope)
    }
}
