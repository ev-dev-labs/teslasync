// UI-thread-free state holder backing the ReloadPrompt surface — the native port of the state the web
// component owns (web/src/components/feedback/ReloadPrompt.tsx: the `useRegisterSW().needRefresh` signal plus
// the local `countdown`/`setInterval` auto-reload clock). It binds the update-availability signal through the
// shared [ReloadPromptSource] (no HTTP touches the view, ADR-002), runs the virtual countdown clock (the
// native `setInterval`), owns the dismiss choice, and emits the one PII-safe `view.opened` diagnostic
// (P1/S11). The actual reload (activating the new build) is a host capability — the web `updateServiceWorker`
// reloads the page — so the holder surfaces it as a one-shot [ReloadRequest] the host fulfils, never an HTTP
// call from the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ReloadPrompt) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located one-shot [ReloadRequest] effect type.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.reloadprompt

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A one-shot request that the host activate the newest build and restart the surface — the native analogue of
 * the web `updateServiceWorker(true)` page reload. Delivered through a [Channel]-backed flow (consumed once,
 * never replayed on recomposition), it carries only whether the reload was [automatic] (the countdown
 * expiring) or manual (the "Reload Now" tap), so the host can apply the update and so telemetry can attribute
 * it. It carries no PII.
 */
data class ReloadRequest(
    val automatic: Boolean,
)

/**
 * State holder for the new-build banner.
 *
 * The update-availability signal is folded from the shared [ReloadPromptSource] (web `useRegisterSW`) through
 * the data layer's `Resource → UiState` contract — a record whose `updateAvailable` is `false` is treated as
 * structurally empty, so the surface's "up to date" state is honest rather than a blank content frame. On top
 * of it the holder runs the virtual countdown clock: when an update becomes available it arms a one-second
 * ticker that auto-reloads after [ReloadCountdown.SECONDS] (web's `setInterval`), [dismiss] cancels the clock
 * (web "Later"), and [reloadNow] applies immediately (web "Reload Now"). Both [dismiss] and the auto-expiry
 * leave the surface honest — a dismissed banner keeps its manual "Reload Now" affordance rather than hiding a
 * pending update. [onViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param source the update-availability seam (a version-comparing/host adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ReloadPromptViewModel(
    private val source: ReloadPromptSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val availabilityUi = MutableStateFlow(UiState.loading<ReloadAvailability>())
    private val countdown = MutableStateFlow(ReloadCountdown.SECONDS)
    private val armed = MutableStateFlow(false)
    private val dismissed = MutableStateFlow(false)

    private val reloadChannel = Channel<ReloadRequest>(Channel.BUFFERED)

    /** One-shot reload requests the host fulfils (web `updateServiceWorker(true)`); collected once by the view. */
    val reloadRequests: Flow<ReloadRequest> = reloadChannel.receiveAsFlow()

    private val mutableState =
        MutableStateFlow(
            ReloadPromptProjection.project(
                UiState.loading(),
                ReloadCountdown.SECONDS,
                autoReloadArmed = false,
                dismissed = false,
            ),
        )

    /** The live banner state the view collects; `.value` is always the latest folded snapshot. */
    val state: StateFlow<ReloadPromptDisplay> = mutableState.asStateFlow()

    private var collectionJob: Job? = null
    private var tickerJob: Job? = null
    private var viewOpenedRecorded = false

    init {
        // Re-fold the snapshot whenever the availability lifecycle, countdown, armed, or dismissed state changes.
        stateScope.launch {
            combine(availabilityUi, countdown, armed, dismissed) { ui, seconds, isArmed, isDismissed ->
                ReloadPromptProjection.project(ui, seconds, isArmed, isDismissed)
            }.collect { mutableState.value = it }
        }
        startCollecting()
    }

    // ── Actions (web ReloadPrompt controls) ────────────────────────────────────

    /** Web "Later" (`dismiss`): cancel the auto-reload but keep the banner's manual "Reload Now" affordance. */
    fun dismiss() {
        if (state.value.phase != ReloadPromptPhase.Available) return
        logger.info(EVENT_DISMISS, surfaceField)
        dismissed.value = true
        stopCountdown(reset = false)
    }

    /** Web "Reload Now" (`doReload`): apply the new build immediately. */
    fun reloadNow() {
        requestReload(automatic = false)
    }

    /** Re-collects the availability feed after a failure — backs the error/offline surface's retry affordance. */
    fun retry() {
        logger.info(EVENT_RETRY, surfaceField)
        dismissed.value = false
        restartCollecting()
    }

    /** Re-collects the availability feed quietly — backs the stale freshness chip's auto-refresh. */
    fun refresh() {
        restartCollecting()
    }

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private fun startCollecting() {
        collectionJob =
            stateScope.launch {
                source.availability().collect { resource ->
                    val ui = resource.toUiState { !it.updateAvailable }
                    availabilityUi.value = ui
                    onAvailabilityResolved(ui)
                }
            }
    }

    private fun restartCollecting() {
        collectionJob?.cancel()
        startCollecting()
    }

    private fun onAvailabilityResolved(ui: UiState<ReloadAvailability>) {
        when {
            // A fresh "update available" signal arms the auto-reload countdown (web `needRefresh`).
            ui.phase == UiPhase.Content && !ui.stale -> if (!dismissed.value) startCountdown()
            // A stale/offline "available" cache still shows the banner + manual reload, but never auto-reloads
            // toward a server we may not be able to reach.
            ui.phase == UiPhase.Content -> stopCountdown(reset = false)
            // The update resolved or vanished — clear any earlier dismiss so a freshly-detected build re-prompts.
            else -> {
                dismissed.value = false
                stopCountdown(reset = true)
            }
        }
    }

    private fun startCountdown() {
        if (armed.value) return
        armed.value = true
        countdown.value = ReloadCountdown.SECONDS
        tickerJob?.cancel()
        tickerJob =
            stateScope.launch {
                while (isActive && armed.value) {
                    delay(COUNTDOWN_INTERVAL_MS)
                    if (armed.value) {
                        val tick = ReloadCountdown.next(countdown.value)
                        countdown.value = tick.value
                        if (tick.reload) requestReload(automatic = true)
                    }
                }
            }
    }

    private fun stopCountdown(reset: Boolean) {
        armed.value = false
        tickerJob?.cancel()
        tickerJob = null
        if (reset) countdown.value = ReloadCountdown.SECONDS
    }

    private fun requestReload(automatic: Boolean) {
        logger.info(EVENT_RELOAD, mapOf(SURFACE_KEY to ReloadPromptRegistration.SLUG, AUTO_KEY to automatic.toString()))
        reloadChannel.trySend(ReloadRequest(automatic))
        stopCountdown(reset = false)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to ReloadPromptRegistration.SLUG)

    companion object {
        private const val COUNTDOWN_INTERVAL_MS = 1_000L
        private const val SURFACE_KEY = "surface"
        private const val AUTO_KEY = "auto"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_DISMISS = "reloadPrompt.dismiss"
        private const val EVENT_RELOAD = "reloadPrompt.reload"
        private const val EVENT_RETRY = "reloadPrompt.retry"

        /** Wires the surface from any [ReloadPromptSource] (the host's platform update-check seam). */
        fun create(
            source: ReloadPromptSource,
            logger: Logger,
        ): ReloadPromptViewModel = ReloadPromptViewModel(source, logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ReloadPromptSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ReloadPromptViewModel(source, logger) }
            }
    }
}
