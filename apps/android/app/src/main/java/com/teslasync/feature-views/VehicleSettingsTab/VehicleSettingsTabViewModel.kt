// UI-thread-free state holder backing the Compose [VehicleSettingsTab] surface — the native port of the hook
// composition the web component owns (web/src/features/vehicles/components/VehicleSettingsTab.tsx +
// web/src/api/hooks/useVehicleSettings.ts). It binds the shared P1/S8 layer through
// [VehicleSettingsTabSource]: it collects the cache-then-network resolver feed, holds the user's per-key
// in-progress draft edits + inline validation (the web `VehicleSettingRow` local `useState`), and runs the
// per-key override save (web `useUpsertVehicleSetting`) and reset-to-default (web `useResetVehicleSetting`).
// The view never performs HTTP — it only collects [state] and calls the trigger methods.
//
// The single combined [state] folds five inputs — the settings feed, the per-key draft map, the per-key
// validation map, and the per-key saving / resetting in-flight sets — which the pure
// [VehicleSettingsTabProjection] (in the composable) turns into the render-ready display, covering every
// state the surface draws: loading, the editable rows, a hard error + retry, and the stale/offline envelope.
// A successful mutation clears that key's draft + validation and re-fetches the feed (so the row follows the
// new effective value and stops being dirty), then emits a one-shot success toast; a failure refreshes
// nothing and emits an error toast — the web `onSuccess`/`onError` split. Toasts are surfaced as one-shot
// [io.teslasync.android.data.UiEvent]s (the render boundary owns the string lookup), never held as state.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleSettingsTab) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclesettingstab

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import io.teslasync.shared.core.presentation.vehiclesettings.findEffectiveSetting
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [VehicleSettingsTab].
 *
 * @param source the cache-then-network per-vehicle settings seam (a shared S8 adapter in production, a fake
 *   in tests). The view-model owns no networking — it only collects + re-shares the feed and runs mutations.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the PII-safe `view.opened`,
 *   `vehicleSettings.save`, `vehicleSettings.reset`, and `vehicleSettings.refresh` events — never a value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSettingsTabViewModel(
    private val source: VehicleSettingsTabSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val drafts = MutableStateFlow<Map<String, String>>(emptyMap())
    private val validation = MutableStateFlow<Map<String, VehicleSettingValidation>>(emptyMap())
    private val savingKeys = MutableStateFlow<Set<String>>(emptySet())
    private val resettingKeys = MutableStateFlow<Set<String>>(emptySet())
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    // Re-collected on every refresh()/retry() and after a successful mutation, so the shared store re-fetches
    // rather than replaying a stale entry.
    private val settingsFeed = refreshTrigger.flatMapLatest { source.settings() }

    /** The combined surface inputs as a lifecycle-aware [StateFlow]; the projection renders it. */
    val state: StateFlow<VehicleSettingsTabState> =
        combine(settingsFeed, drafts, validation, savingKeys, resettingKeys) { settings, edits, errors, saving, resetting ->
            VehicleSettingsTabState(
                settings = settings,
                drafts = edits,
                validation = errors,
                savingKeys = saving,
                resettingKeys = resetting,
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = VehicleSettingsTabState.INITIAL,
        )

    /** Records the user's in-progress draft for [key] — the web `setDraft(e.target.value)`. */
    fun edit(
        key: String,
        value: String,
    ) {
        drafts.update { it + (key to value) }
    }

    /**
     * Validates and saves the override for [key] (web `handleSave`). A blank/invalid draft surfaces the
     * inline validation message and does not PUT; a valid draft forwards the typed value through the source,
     * then on success clears the row's draft + validation, re-fetches the feed, and surfaces the saved toast.
     */
    fun save(key: String) {
        val descriptor = descriptorForKey(key) ?: return
        validation.update { it - key }
        val draft = state.value.drafts[key] ?: effectiveDraftFor(descriptor)
        when (val parsed = parseDraft(descriptor, draft)) {
            is DraftParse.Invalid -> validation.update { it + (key to parsed.reason) }
            is DraftParse.Valid -> {
                logger.info(EVENT_SAVE, surfaceField())
                runMutation(key, savingKeys, SAVE_FEEDBACK) { source.upsert(key, parsed.value) }
            }
        }
    }

    /**
     * Reverts [key] to its inherited default (web `handleReset`). Guarded to the override case (the web
     * disables the button otherwise); on success it clears the row's draft, re-fetches the feed, and
     * surfaces the reset toast.
     */
    fun reset(key: String) {
        if (!isOverride(key)) return
        logger.info(EVENT_RESET, surfaceField())
        runMutation(key, resettingKeys, RESET_FEEDBACK) { source.reset(key) }
    }

    /** Re-fetches the settings feed after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField())
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the settings feed over the shown rows; backs the stale/offline freshness chip. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no setting value, VIN, or vehicle id. Call from the composable's first-composition
     * effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        VehicleSettingsTabDiagnostics.recordViewOpened(logger)
    }

    /** Runs [block], tracking [key] in [inFlight]; on success clears the draft + re-fetches, else logs + toasts. */
    private fun runMutation(
        key: String,
        inFlight: MutableStateFlow<Set<String>>,
        feedback: MutationFeedback,
        block: suspend () -> Result<Unit>,
    ) {
        inFlight.update { it + key }
        launch {
            block().fold(
                onSuccess = {
                    inFlight.update { it - key }
                    clearDraft(key)
                    refreshTrigger.update { it + 1 }
                    emitEvent(UiEvent.Message(feedback.successToast, severity = UiEvent.Severity.Success))
                },
                onFailure = { error ->
                    inFlight.update { it - key }
                    logger.warn(feedback.failEvent, surfaceField(KIND_KEY to errorKindOf(error).name))
                    emitEvent(UiEvent.Message(feedback.failToast, severity = UiEvent.Severity.Error))
                },
            )
        }
    }

    /** Clears the user's draft + validation for [key] so the row follows the refreshed effective value. */
    private fun clearDraft(key: String) {
        drafts.update { it - key }
        validation.update { it - key }
    }

    /** The effective value's draft form for [descriptor], read from the latest resolver payload. */
    private fun effectiveDraftFor(descriptor: VehicleSettingDescriptor): String =
        effectiveToDraft(descriptor, findEffectiveSetting(state.value.settings.cached, descriptor.key))

    /** Whether [key]'s effective value is a per-vehicle override (the web `source === 'override'` guard). */
    private fun isOverride(key: String): Boolean =
        findEffectiveSetting(state.value.settings.cached, key)?.source == EffectiveSettingSource.OVERRIDE

    private fun surfaceField(vararg extra: Pair<String, String>): Map<String, String> =
        mapOf(SURFACE_KEY to VehicleSettingsTabDiagnostics.SLUG, *extra)

    /** The toast keys + log event a save or reset mutation surfaces, bundled to keep the runner small. */
    private data class MutationFeedback(
        val successToast: String,
        val failToast: String,
        val failEvent: String,
    )

    companion object {
        private const val STOP_TIMEOUT_MILLIS = 5_000L
        private const val SURFACE_KEY = "surface"
        private const val KIND_KEY = "kind"
        private const val EVENT_SAVE = "vehicleSettings.save"
        private const val EVENT_SAVE_FAIL = "vehicleSettings.saveFailed"
        private const val EVENT_RESET = "vehicleSettings.reset"
        private const val EVENT_RESET_FAIL = "vehicleSettings.resetFailed"
        private const val EVENT_REFRESH = "vehicleSettings.refresh"

        private val SAVE_FEEDBACK =
            MutationFeedback(VEHICLE_SETTINGS_SAVED_KEY, VEHICLE_SETTINGS_SAVE_FAILED_KEY, EVENT_SAVE_FAIL)
        private val RESET_FEEDBACK =
            MutationFeedback(VEHICLE_SETTINGS_RESET_KEY, VEHICLE_SETTINGS_RESET_FAILED_KEY, EVENT_RESET_FAIL)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehicleSettingsTabSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehicleSettingsTabViewModel(source, logger) }
            }
    }
}
