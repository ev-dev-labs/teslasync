// UI-thread-free state holder backing the Compose [ScheduledMaintenanceCard] feature view — the native port
// of the maintenance hook composition the web component owns
// (web/src/features/system/components/status/ScheduledMaintenanceCard.tsx). It binds the shared
// cache-then-network [ScheduledMaintenanceSource] (P1/S8), projects the `/admin/maintenance` read onto the
// shared [UiState] surface (loading / content / stale / offline / error), tracks each write's in-flight flag,
// runs the two mutations (web `handleSchedule` / `handleClear` over `useUpdateMaintenance`) raising typed
// [MaintenanceToast]s, and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ScheduledMaintenanceCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.scheduledmaintenancecard

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.time.Instant

/**
 * The in-flight write flags the action controls bind to — the native analogue of the web mutation's
 * `isPending` flag (web `mutation.isPending`), split per action so each control gates its own loading/disabled
 * state and a double-tap can't re-fire an in-flight call.
 *
 * @property scheduling a schedule write is in flight (web `mutation.isPending` over `handleSchedule`).
 * @property clearing a clear write is in flight (web `mutation.isPending` over `handleClear`).
 */
data class MaintenanceActions(
    val scheduling: Boolean = false,
    val clearing: Boolean = false,
)

/**
 * Lifecycle-aware state holder backing the Compose [ScheduledMaintenanceCard]. It consumes the
 * cache-then-network [ScheduledMaintenanceSource] (P1/S8) and re-shares the maintenance-state read as a
 * [UiState] stream, so the screen stays a stateless Composable that only renders. A resolved state always maps
 * to content (the panel always renders its chrome — the not-active scheduler IS the friendly content, there is
 * no empty branch), surfaced by the model's `Resource → UiState` projection with a `false` emptiness predicate;
 * loading (no cache), hard error (no cache), and the stale/offline cached view are all surfaced by that same
 * projection.
 *
 * It owns no networking. [retry] re-collects the maintenance feed; [schedule] writes a new window
 * (web `handleSchedule`) and [clear] clears the active one (web `handleClear`), each raising a typed
 * [MaintenanceToast] and — on success — restarting the read (the web invalidates the maintenance query).
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network maintenance seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param clock supplies "now" for the scheduled window's end instant; tests pin it for determinism.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduledMaintenanceCardViewModel(
    private val source: ScheduledMaintenanceSource,
    logger: Logger,
    private val clock: () -> Long = System::currentTimeMillis,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + post-write refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val actionState = MutableStateFlow(MaintenanceActions())
    private val toastChannel = Channel<MaintenanceToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The maintenance state as cache-then-network UI state: loading / content / stale / offline / error,
     * carrying the freshness stamp + error kind. The emptiness predicate is `false` (folded into the model's
     * mapper) so a resolved state always renders the panel (web parity: the surface always renders).
     */
    val maintenanceState: StateFlow<UiState<MaintenanceSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.maintenanceState() }
            .map { it.toMaintenanceUiState() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UiState.loading())

    /** The in-flight flags the action controls bind to (web `mutation.isPending`). */
    val actions: StateFlow<MaintenanceActions> = actionState.asStateFlow()

    /** Typed toasts the composable maps to localized [io.teslasync.android.components.feedback.ToastItem]s (web `useToast`). */
    val toasts: Flow<MaintenanceToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load of the maintenance read (web `refetch()`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to SCHEDULED_MAINTENANCE_SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Schedules a maintenance window (web `handleSchedule`): writes `mode = maintenance` with an
     * auto-clear instant [clock] + [durationMinutes] minutes out, and the optional operator [message]. The
     * duration is floored at [MIN_DURATION_MINUTES], mirroring the web `Math.max(5, …)`. Raises
     * [MaintenanceToast.Saved] on success (web `toast.success`) then restarts the read (the web invalidates the
     * maintenance query), or [MaintenanceToast.Failed] on failure. Tracks [MaintenanceActions.scheduling].
     */
    fun schedule(
        durationMinutes: Int,
        message: String?,
    ) {
        if (actionState.value.scheduling) return
        actionState.update { it.copy(scheduling = true) }
        val durationMin = durationMinutes.coerceAtLeast(MIN_DURATION_MINUTES)
        val untilIso = Instant.ofEpochMilli(clock() + durationMin * MILLIS_PER_MINUTE).toString()
        val input =
            MaintenanceUpdateInput(
                mode = MAINTENANCE_MODE,
                message = message?.trim()?.ifBlank { null },
                until = untilIso,
            )
        runWrite(input) { it.copy(scheduling = false) }
    }

    /**
     * Clears the active maintenance window (web `handleClear`): writes `mode = ok`, an empty message, and a
     * `null` auto-clear. Raises [MaintenanceToast.Saved] on success (web `toast.success`) then restarts the
     * read, or [MaintenanceToast.Failed] on failure. Tracks [MaintenanceActions.clearing].
     */
    fun clear() {
        if (actionState.value.clearing) return
        actionState.update { it.copy(clearing = true) }
        val input = MaintenanceUpdateInput(mode = OK_MODE, message = "", until = null)
        runWrite(input) { it.copy(clearing = false) }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no mode, message, or end time, so a diagnostics line can never leak the operational posture.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ScheduledMaintenanceCardDiagnostics.recordViewOpened(logger)
    }

    private fun runWrite(
        input: MaintenanceUpdateInput,
        resetFlag: (MaintenanceActions) -> MaintenanceActions,
    ) {
        launch {
            try {
                source.updateMaintenance(input).fold(
                    onSuccess = {
                        toastChannel.trySend(MaintenanceToast.Saved)
                        refreshTrigger.update { it + 1 }
                    },
                    onFailure = { toastChannel.trySend(MaintenanceToast.Failed) },
                )
            } finally {
                actionState.update(resetFlag)
            }
        }
    }

    companion object {
        /** Minimum schedulable window length — web `Math.max(5, Number(duration) || 60)`. */
        const val MIN_DURATION_MINUTES: Int = 5

        /** Default window length pre-filled in the scheduler form — web `useState('60')`. */
        const val DEFAULT_DURATION_MINUTES: Int = 60

        private const val MILLIS_PER_MINUTE = 60_000L
        private const val EVENT_REFRESH = "scheduledMaintenance.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: ScheduledMaintenanceSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ScheduledMaintenanceCardViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [AdminStore] (the production binding). */
        fun create(
            store: AdminStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ScheduledMaintenanceCardViewModel =
            ScheduledMaintenanceCardViewModel(scheduledMaintenanceSource(store), logger, System::currentTimeMillis, scope)
    }
}
