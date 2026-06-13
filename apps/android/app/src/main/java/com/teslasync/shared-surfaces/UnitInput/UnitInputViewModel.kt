// UI-thread-free state holder backing the UnitInput surface — the native port of the settings read behind
// the web component's `useSettings()` call (web/src/components/forms/UnitInput.tsx). It binds the shared
// Settings document through [UnitInputSettingsSource] and performs no HTTP itself (ADR-002): the view
// collects [settings] and combines it with the caller-provided canonical value through the pure
// [UnitInputProjection]. The settings document is the genuine async dependency the display unit + symbol
// come from, so its cache-then-network lifecycle drives the surface's loading / stale / offline / error
// states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UnitInput) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.unitinput

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * State holder for the UnitInput surface.
 *
 * The settings document feed (the display-unit preference source) is re-shared as a lifecycle-aware
 * [UiState] so the composable can switch surfaces — loading (first fetch), content/empty (the field
 * seeded with the value vs the blank field, decided with the caller's value), a hard error with retry,
 * and the stale/offline freshness envelope — without re-deriving the cache-then-network contract.
 * [refresh]/[retry] re-collect the feed (web `refetch`; the shared store replays its latest and re-fetches
 * on a mutation elsewhere), and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) —
 * slug only, never the typed value.
 *
 * @param source the Settings document seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UnitInputViewModel(
    private val source: UnitInputSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The settings document as lifecycle-aware [UiState]. The preferences blob is never treated as
     * structurally "empty" (a partial document still yields usable metric defaults, the web behaviour), so
     * the surface's empty state is driven by the caller's value, not by this feed.
     */
    val settings: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .asUiState(isEmpty = { false })

    /** Re-fetches the settings document after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(UnitInputDiagnostics.EVENT_REFRESH, UnitInputDiagnostics.surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the settings document; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no typed value, unit, or symbol. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(UnitInputDiagnostics.EVENT_VIEW_OPENED, UnitInputDiagnostics.surfaceField)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: UnitInputSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { UnitInputViewModel(source, logger) }
            }
    }
}
