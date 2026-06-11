// UI-thread-free state holder backing the Onboarding Checklist widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx + the
// web/src/features/onboarding/checklist.ts `useChecklistTasks`). It binds the aggregated checklist-input
// feed (P1/S8) through [OnboardingChecklistSource], projects each cache-then-network emission onto the
// shared [UiState] surface (loading / content / stale / offline), owns the dismiss / restart write
// affordances (web `setChecklistDismissed` / `restartChecklist`), reproduces the web "stamp `completedAt`
// the first render after 100%" effect, the manual refresh, and the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] and calls [dismiss] / [restart] / [refresh] /
// [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/OnboardingChecklistWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.onboardingchecklist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network checklist-input seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param preferences the persisted-flag write port (web `setChecklistDismissed` / `setChecklistCompletedAt`);
 *   a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, `dismiss`,
 *   `restart`, and `refresh` events. None carry PII.
 * @param now wall-clock seam for the 100%-complete stamp; production uses `System.currentTimeMillis`,
 *   tests inject a fixed instant.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingChecklistWidgetViewModel(
    source: OnboardingChecklistSource,
    private val preferences: OnboardingChecklistPreferences,
    logger: Logger,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The aggregated checklist feed as a lifecycle-aware [UiState]: loading (cold start) / content (the
     * checklist) / stale / offline, carrying the freshness stamp + error kind. The payload is never
     * treated as structurally empty — the widget reproduces the web's own internal empty / dismissed
     * branches inside the content surface (the web `WidgetShell` does the same), so the phase only ever
     * flips between Loading and Content. The `onEach` reproduces the web `useChecklistTasks` effect that
     * stamps `completedAt` the first render after hitting 100% and clears it if a task is later undone;
     * it runs only while the screen observes the feed (the web effect's mount/unmount cadence).
     */
    val state: StateFlow<UiState<OnboardingChecklistInputs>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .onEach { stampCompletionIfNeeded(it) }
            .map { it.toUiState(isEmpty = { false }) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /**
     * The web `useChecklistTasks` completion-stamping effect: when the checklist first reaches 100% with
     * no stamp, record the instant (driving the 24h celebration window); if a task is later undone while
     * a stamp exists, clear it so completing again re-celebrates.
     */
    private suspend fun stampCompletionIfNeeded(resource: Resource<OnboardingChecklistInputs>) {
        val inputs = resource.cached ?: return
        val allComplete = OnboardingChecklistProjection.allComplete(inputs)
        when {
            allComplete && inputs.completedAt == null -> preferences.setCompletedAt(now())
            !allComplete && inputs.completedAt != null -> preferences.setCompletedAt(null)
        }
    }

    /** Dismisses the checklist (web `dismiss` → `setChecklistDismissed(true)`). */
    fun dismiss() {
        logger.info("onboardingChecklist.dismiss")
        launch { preferences.setDismissed(true) }
    }

    /** Restarts the checklist (web `restart` → `restartChecklist`: un-dismiss + clear the stamp). */
    fun restart() {
        logger.info("onboardingChecklist.restart")
        launch {
            preferences.setDismissed(false)
            preferences.setCompletedAt(null)
        }
    }

    /** Re-runs the cache-then-network load (the error-surface retry + manual refresh). */
    fun refresh() {
        logger.info("onboardingChecklist.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no fleet data. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to OnboardingChecklistRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] + [NotificationsStore] + [SettingsStore] (P1/S8)
         * and the persisted [preferences]. The holder runs on `viewModelScope`; a custom scope is a
         * test-only concern handled via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            notificationsStore: NotificationsStore,
            settingsStore: SettingsStore,
            preferences: OnboardingChecklistPreferences,
            logger: Logger,
        ): OnboardingChecklistWidgetViewModel =
            OnboardingChecklistWidgetViewModel(
                source = StoreOnboardingChecklistSource(vehiclesStore, notificationsStore, settingsStore, preferences),
                preferences = preferences,
                logger = logger,
            )
    }
}
