// UI-thread-free state holder backing the Compose [GasPriceSettings] feature view — the native port of the
// gas-price hook composition the web component owns
// (web/src/features/settings/components/GasPriceSettings.tsx). It binds the shared cache-then-network
// [GasPriceSettingsSource] (P1/S8), projects the status feed onto the shared [UiState] surface (loading /
// content / stale / offline / error), derives the currency + fuel-unit display preferences from the settings
// document, tracks the in-flight manual poll, runs the three mutations (web `useToggleGasPrice` /
// `useUpdateGasPriceConfig` / `usePollGasPrice`) raising typed [GasPriceToast]s, and emits the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GasPriceSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.gaspricesettings

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [GasPriceSettings]. It consumes the cache-then-network
 * [GasPriceSettingsSource] (P1/S8) and re-shares the status read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A resolved status
 * always maps to content (the web panel always renders its controls with `?.` fallbacks — there is no empty
 * branch), so the emptiness predicate is `{ false }`; loading (no cache), hard error (no cache), and the
 * stale/offline cached view are all surfaced by the shared `Resource → UiState` projection. The display
 * preferences (currency symbol, precision, fuel unit) are derived from the `/settings` document feed and default
 * to the web fallbacks during loading, so formatting never gates the panel.
 *
 * It owns no networking. [refresh]/[retry] re-collect both feeds; the three mutations delegate to the source,
 * raise the matching [GasPriceToast], and (for toggle/config, which the web invalidates) restart the read
 * collection so the write is reflected regardless of which source binding the host wired. [recordViewOpened]
 * emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network gas-price seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GasPriceSettingsViewModel(
    private val source: GasPriceSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network reads (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val pollInFlight = MutableStateFlow(false)
    private val toastChannel = Channel<GasPriceToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The gas-price status as cache-then-network UI state: loading / content / stale / offline / error, carrying
     * the freshness stamp + error kind. The emptiness predicate is `false` so a resolved status always renders
     * the panel (web parity: the controls show even with a zero-value status — price → "—", last poll → "Never").
     */
    val status: StateFlow<UiState<GasPriceStatus>> =
        refreshTrigger
            .flatMapLatest { source.gasPriceStatus() }
            .asUiState { false }

    /**
     * The currency + fuel-unit display preferences derived from the `/settings` document (web `useFormatting` +
     * `gasUnitLabel`). Falls back to the web defaults ("$", 2 dp, gallons) whenever the document is absent /
     * loading / errored, so the panel always formats sensibly. It never gates the surface — formatting only.
     */
    val displayPrefs: StateFlow<GasDisplayPrefs> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .map { GasDisplayPrefs.from(it.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = GasDisplayPrefs.DEFAULT,
            )

    /** Whether the manual "Poll Now" mutation is in flight (web `gasPollMut.isPending`) — drives the button spinner. */
    val polling: StateFlow<Boolean> = pollInFlight

    /** Typed gas-price toasts the composable maps to localized [ToastItem]s (web `useToast`). */
    val toasts: Flow<GasPriceToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load of both reads (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to GasPriceSettingsRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Toggles auto-poll (web `useToggleGasPrice`). The web sends the NEGATED current state and toasts based on it,
     * so this takes [currentlyEnabled] and submits its inverse. Raises [GasPriceToast.AutoPollEnabled] /
     * [GasPriceToast.AutoPollDisabled] on success (web `toast.info(!enabled ? gas.enabled : gas.disabled)`) or
     * [GasPriceToast.ToggleFailed] on failure, then restarts the reads.
     */
    fun toggle(currentlyEnabled: Boolean) {
        val next = !currentlyEnabled
        launch {
            source.toggleGasPrice(next).fold(
                onSuccess = {
                    emitToast(if (next) GasPriceToast.AutoPollEnabled else GasPriceToast.AutoPollDisabled)
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { emitToast(GasPriceToast.ToggleFailed) },
            )
        }
    }

    /**
     * Saves the poll cadence (web `useUpdateGasPriceConfig`). Raises [GasPriceToast.IntervalUpdated] on success
     * (web `toast.info(gas.intervalUpdated)`) or [GasPriceToast.IntervalFailed] on failure, then restarts the
     * reads. [interval] is the backend wire value (`daily` / `7d` / `15d` / `30d`).
     */
    fun updateInterval(interval: String) {
        launch {
            source.updateGasPriceConfig(interval).fold(
                onSuccess = {
                    emitToast(GasPriceToast.IntervalUpdated)
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { emitToast(GasPriceToast.IntervalFailed) },
            )
        }
    }

    /**
     * Triggers a manual poll (web `usePollGasPrice`). Tracks [polling] for the button spinner and raises
     * [GasPriceToast.Polled] on success (web `toast.info(gas.pollTriggered)`) or [GasPriceToast.PollFailed] on
     * failure. The web mutation invalidates nothing, so the reads are NOT restarted here.
     */
    fun pollNow() {
        if (pollInFlight.value) return
        pollInFlight.value = true
        launch {
            try {
                source.pollGasPrice().fold(
                    onSuccess = { emitToast(GasPriceToast.Polled) },
                    onFailure = { emitToast(GasPriceToast.PollFailed) },
                )
            } finally {
                pollInFlight.value = false
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no price, cadence, or timestamp, so a diagnostics line can never leak what a user has configured.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGasPriceSettingsViewOpened(logger)
    }

    private fun emitToast(toast: GasPriceToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        private const val EVENT_REFRESH = "gasPriceSettings.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: GasPriceSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { GasPriceSettingsViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [SettingsStore]. */
        fun create(
            store: SettingsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): GasPriceSettingsViewModel = GasPriceSettingsViewModel(gasPriceSettingsSource(store), logger, scope)

        /** Wire the surface from the shared **S7** [SettingsRepository] (refetch-on-retry binding). */
        fun create(
            repository: SettingsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): GasPriceSettingsViewModel = GasPriceSettingsViewModel(gasPriceSettingsSource(repository), logger, scope)
    }
}
