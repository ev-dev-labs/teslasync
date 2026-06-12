// UI-thread-free state holder backing the Compose [GeneralSettings] surface — the native port of the
// hook composition the web component owns (web/src/features/settings/components/GeneralSettings.tsx +
// web/src/api/hooks/useSettings.ts). It binds the shared Settings layer through [GeneralSettingsSource]:
// it collects the cache-then-network `/settings` document, the first vehicle's car preferences (web
// `useVehicles` → first id → `useCarPreferences`), holds the user's in-progress form edits, and runs the
// full-replace save (web `useSaveSettings`) and the "Sync from Car" flow. The view never performs HTTP —
// it only collects [state] and calls the trigger methods.
//
// The single combined [state] folds five inputs — the settings feed, the user's form override, the
// resolved car preferences, the saving flag, and any transient feedback — which the pure
// [GeneralSettingsProjection] (in the composable) turns into the render-ready display, covering every
// state the surface draws: loading (the first fetch), the editable form (content / cold-start defaults),
// a hard error + retry, and the stale/offline envelope. Two render-layer concerns the web owns are
// reproduced here so the view stays declarative: the form is hydrated lazily from the server document and
// kept independent once the user edits (the web `formInited` guard), and `isDirty` is the diff of the
// edited form against the saved document (the web nav-guard). The auto-dismiss of the transient feedback
// is a UI-clock concern left to the composable (so this holder stays deterministic under test).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GeneralSettings) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.generalsettings

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.CarPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [GeneralSettings].
 *
 * @param source the cache-then-network Settings seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + re-shares the feeds and runs mutations.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the PII-safe `view.opened`,
 *   `generalSettings.save`, `generalSettings.sync`, and `generalSettings.refresh` events — never a value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GeneralSettingsViewModel(
    private val source: GeneralSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val formOverride = MutableStateFlow<GeneralSettingsForm?>(null)
    private val saving = MutableStateFlow(false)
    private val feedback = MutableStateFlow<GeneralSettingsFeedback?>(null)
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    // Re-collected on every refresh()/retry() and after a successful save, so a cold repository source
    // re-fetches; a shared store source replays its latest (and refreshes itself on save).
    private val settingsFeed = refreshTrigger.flatMapLatest { source.settings() }

    // Web `useVehicles` → first id → `useCarPreferences`: the first vehicle's car-reported units, or null
    // when there is no vehicle (the web `firstVehicleId ?? null` + `enabled: vehicleId !== null` gate).
    private val carPrefsFeed: Flow<CarPreferences?> =
        source
            .vehicles()
            .map { it.cached?.firstOrNull()?.id }
            .distinctUntilChanged()
            .flatMapLatest { id -> if (id != null) source.carPreferences(id).map { it.cached } else flowOf(null) }

    /** The combined surface inputs as a lifecycle-aware [StateFlow]; the projection renders it. */
    val state: StateFlow<GeneralSettingsState> =
        combine(settingsFeed, formOverride, carPrefsFeed, saving, feedback) { settings, form, carPrefs, isSaving, fb ->
            GeneralSettingsState(
                settings = settings,
                formOverride = form,
                carPreferences = carPrefs,
                saving = isSaving,
                feedback = fb,
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = GeneralSettingsState.INITIAL,
        )

    /**
     * Applies [transform] to the shown form (the user's prior edits, else the server document, else
     * DEFAULT), recording it as the in-progress override — the web `setForm({ ...form, … })`.
     */
    fun edit(transform: (GeneralSettingsForm) -> GeneralSettingsForm) {
        formOverride.value = transform(currentForm())
    }

    /**
     * Saves the full settings document — the editable fields overlaid on the last-known server document so
     * unknown keys are preserved (web `settingsMut.mutate(form)`). Surfaces [GeneralSettingsFeedback.Saved]
     * / [GeneralSettingsFeedback.SaveFailed] and re-fetches the document on success.
     */
    fun save() {
        logger.info(EVENT_SAVE, surfaceField())
        val form = currentForm()
        formOverride.value = form
        persist(form) { GeneralSettingsFeedback.Saved }
    }

    /**
     * Applies the first vehicle's reported units to the form and saves — the web `syncUnitsFromCar`. When
     * no units are detectable it surfaces [GeneralSettingsFeedback.NoChanges] without saving; otherwise it
     * persists the synced form and surfaces [GeneralSettingsFeedback.UnitsSynced] naming the resulting units.
     */
    fun syncFromCar() {
        logger.info(EVENT_SYNC, surfaceField())
        val car = state.value.carPreferences ?: return
        val result = computeSyncFromCar(car, currentForm())
        if (!result.changed) {
            feedback.value = GeneralSettingsFeedback.NoChanges
            return
        }
        formOverride.value = result.form
        persist(result.form) {
            GeneralSettingsFeedback.UnitsSynced(
                distanceMiles = result.form.distanceUnit == "mi",
                temperatureFahrenheit = result.form.temperatureUnit == "F",
                pressurePsi = result.form.pressureUnit == "psi",
            )
        }
    }

    /** Re-fetches the settings document after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField())
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the settings document over the shown form; backs the stale/offline freshness chip. */
    fun refresh() = retry()

    /** Clears the transient feedback once the composable's auto-dismiss timer elapses. */
    fun clearFeedback() {
        feedback.value = null
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no preference value, VIN, or vehicle id. Call from the composable's first-composition
     * effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        GeneralSettingsDiagnostics.recordViewOpened(logger)
    }

    /** PUTs [form] over the last-known server document, then surfaces [onSuccess] feedback + re-fetches. */
    private fun persist(
        form: GeneralSettingsForm,
        onSuccess: () -> GeneralSettingsFeedback,
    ) {
        val base = state.value.settings?.cached
        saving.value = true
        launch {
            source.saveSettings(GeneralSettingsFormCodec.encode(form, base)).fold(
                onSuccess = {
                    saving.value = false
                    feedback.value = onSuccess()
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { error ->
                    saving.value = false
                    logger.warn(EVENT_SAVE_FAIL, surfaceField(KIND_KEY to errorKindOf(error).name))
                    feedback.value = GeneralSettingsFeedback.SaveFailed
                },
            )
        }
    }

    /** The shown form: the user's edits, else the decoded server document, else DEFAULT. */
    private fun currentForm(): GeneralSettingsForm =
        state.value.let { it.formOverride ?: GeneralSettingsFormCodec.decode(it.settings?.cached) }

    private fun surfaceField(vararg extra: Pair<String, String>): Map<String, String> =
        mapOf(SURFACE_KEY to GeneralSettingsDiagnostics.SLUG, *extra)

    companion object {
        private const val STOP_TIMEOUT_MILLIS = 5_000L
        private const val SURFACE_KEY = "surface"
        private const val KIND_KEY = "kind"
        private const val EVENT_SAVE = "generalSettings.save"
        private const val EVENT_SAVE_FAIL = "generalSettings.saveFailed"
        private const val EVENT_SYNC = "generalSettings.sync"
        private const val EVENT_REFRESH = "generalSettings.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: GeneralSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { GeneralSettingsViewModel(source, logger) }
            }
    }
}
