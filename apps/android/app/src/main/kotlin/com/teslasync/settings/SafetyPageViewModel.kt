// The state holder backing the SafetyPage settings surface (P1/S8) — the native counterpart of the web page's
// React state + the `useSettings` hook (web/src/features/settings/pages/SafetyPage.tsx). It projects the shared
// `/settings` document feed onto the lifecycle-aware [UiState] surface as the seven decoded safety values. All decode
// logic lives in the framework-free model (SafetyPageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP itself (ADR-002).
//
// Single data state by design (the manifest declares only `success`): the web page reads `settings ?? defaults`, so it
// always has a value to render — it never shows loading/empty/error. This holder mirrors that exactly: every emission
// of the settings document (cached-or-null) is folded through [SafetySettings.fromDocument], which applies the web
// defaults, so [state] is always a populated [UiPhase.Content] surface (defaults before the document loads, the live
// values after). There is no API data source that can blank the listing.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/settings) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin/battery surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.settings.safety

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * @param settingsStore the shared S8 Settings holder whose `/settings` document feed backs the listing (web
 *   `useSettings`); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the one-shot `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SafetyPageViewModel(
    settingsStore: SettingsStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The decoded safety values as a cache-then-network UI state. Always a populated [UiPhase.Content] surface: the
     * settings document's cached value (or `null` before first load) is folded through [SafetySettings.fromDocument],
     * which applies the web defaults, so the seven badges always have a value (web `settings ?? defaults`). The initial
     * value is the defaults projection so the first frame is never an artificial blank.
     */
    val state: StateFlow<UiState<SafetySettings>> =
        settingsStore
            .settings()
            .map { resource -> UiState(phase = UiPhase.Content, data = SafetySettings.fromDocument(resource.cached)) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState(phase = UiPhase.Content, data = SafetySettings.DEFAULT),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no setting values. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSafetyPageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from the shared holder. */
        fun factory(
            settingsStore: SettingsStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SafetyPageViewModel(settingsStore, logger) }
            }
    }
}
