// UI-thread-free state holder backing the FormatterPrefsBridge surface — the native port of the headless web
// coordinator (web/src/components/FormatterPrefsBridge.tsx). It binds the shared `/settings` document through
// [FormatterPrefsBridgeSource] and performs no HTTP itself (ADR-002): it projects the document into the resolved
// [FormatterPrefsState] the app observes app-wide, and reproduces the web bridge's three effects (permanent
// settings subscriber, guarded apply, defense-in-depth refetch). The settings document is the genuine async
// dependency the locale + decimal precision come from, so its cache-then-network lifecycle drives the freshness
// metadata the published prefs carry.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FormatterPrefsBridge) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
import kotlinx.serialization.json.JsonElement

/**
 * State holder for the FormatterPrefsBridge surface.
 *
 * It reproduces the web bridge's three effects exactly:
 *  1. a PERMANENT settings subscriber — an [init] collector holds the cache-then-network feed warm for the
 *     holder's whole lifetime (web: "creates a permanent subscriber for the ['settings'] query"), so the
 *     resolved formatter prefs stay current regardless of which screen is mounted;
 *  2. a GUARDED apply — [applyIfChanged] records the PII-safe `formatterPrefsBridge.applied` diagnostic only
 *     when the resolved prefs actually change (web: `setGlobalLocale`/`setGlobalPrecision` fire only on a value
 *     change, via the `lastLocale`/`lastDecimals` refs);
 *  3. a defense-in-depth refetch — [source].settingsChanged() re-fetches the document (web:
 *     `subscribe(TOPICS.SETTINGS_CHANGED)` → `qc.invalidateQueries(['settings'])`).
 *
 * [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug only, never a preference value.
 *
 * @param source the Settings document seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FormatterPrefsBridgeViewModel(
    private val source: FormatterPrefsBridgeSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false
    private var lastApplied: FormatterPrefs? = null

    /**
     * The settings document as lifecycle-aware [UiState]. The preferences blob is never treated as structurally
     * "empty" (a partial document still yields usable metric defaults, the web behaviour), so the bridge always
     * has prefs to publish.
     */
    val settings: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .asUiState(isEmpty = { false })

    /**
     * The resolved formatter globals (web `_globalLocale` + `_globalPrecision`, plus the full display
     * [io.teslasync.shared.core.units.UnitPref]) the app observes app-wide. Derived from [settings] so a
     * locale/precision change re-emits with no other work; the initial value is the metric defaults the web
     * globals start at.
     */
    val formatterPrefs: StateFlow<FormatterPrefsState> =
        settings
            .map { FormatterPrefsProjection.project(it) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FormatterPrefsProjection.project(settings.value),
            )

    init {
        // (1) permanent subscriber + (2) guarded apply: a lifetime collector keeps the feed warm and records the
        // apply diagnostic only when the resolved prefs change.
        launch { formatterPrefs.collect { applyIfChanged(it) } }
        // (3) defense-in-depth: an out-of-band settings-changed signal forces a refetch.
        launch { source.settingsChanged().collect { refresh() } }
    }

    /** Re-fetches the settings document (web `refetch` / `invalidateQueries(['settings'])`). */
    fun refresh() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no locale, precision, or any preference value. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    /**
     * Records the guarded apply (web `setGlobalLocale`/`setGlobalPrecision` only-on-change): emits the PII-safe
     * `formatterPrefsBridge.applied` diagnostic — slug only — the first time a settings document resolves and on
     * every later change to the resolved prefs, and never for an identical refetch or while unresolved.
     */
    private fun applyIfChanged(state: FormatterPrefsState) {
        if (!state.resolved) return
        if (state.prefs == lastApplied) return
        lastApplied = state.prefs
        logger.info(EVENT_APPLIED, surfaceField)
    }

    private val surfaceField: Map<String, String>
        get() = mapOf(SURFACE_KEY to FormatterPrefsBridgeRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_APPLIED = "formatterPrefsBridge.applied"
        private const val EVENT_REFRESH = "formatterPrefsBridge.refresh"

        // Keep the shared settings feed alive briefly across config changes / fast re-subscribes.
        private const val STOP_TIMEOUT_MILLIS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: FormatterPrefsBridgeSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { FormatterPrefsBridgeViewModel(source, logger) }
            }
    }
}
