// UI-thread-free state holder backing the CurrencyInput surface — the native port of the settings reads behind
// the web primitive's host (web/src/components/forms/CurrencyInput.tsx is given `currency`/`locale`; the
// native surface resolves their defaults from the shared `/settings` document via `useSettings`). It binds the
// settings feed through [CurrencyInputSettingsSource] and performs no HTTP itself (ADR-002): the view collects
// [settings] and combines it with the caller's overrides + the field's local value through the pure
// [CurrencyInputProjection]. The settings document is the genuine async dependency the default currency +
// locale come from, so its cache-then-network lifecycle drives the surface's loading / stale / offline / error
// states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CurrencyInput) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currencyinput

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
 * State holder for the CurrencyInput surface.
 *
 * The settings document feed (the default currency + locale source) is re-shared as a lifecycle-aware
 * [UiState] so the composable can switch surfaces — loading (first fetch), editable (the field, decided with
 * the caller's value + overrides), a hard error with retry, and the stale/offline freshness envelope — without
 * re-deriving the cache-then-network contract. [refresh]/[retry] re-collect the feed (the shared store
 * replays its latest and re-fetches on a mutation elsewhere), and [onViewOpened] emits the one PII-safe
 * `view.opened` diagnostic (P1/S11) — slug only, never a value.
 *
 * @param source the Settings document seam (a shared-store/-repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CurrencyInputViewModel(
    private val source: CurrencyInputSettingsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The settings document as lifecycle-aware [UiState]. The preferences blob is never treated as
     * structurally "empty" (a partial document still yields usable defaults — the web behaviour), so the
     * surface's empty state is the field's own `valueMicro == null` branch, not this feed.
     */
    val settings: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .asUiState(isEmpty = { false })

    /** Re-fetches the settings document after a hard error; backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the settings document; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no amount, symbol, or locale. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCurrencyInputOpened(logger)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to CURRENCY_INPUT_SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_REFRESH = "currencyInput.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: CurrencyInputSettingsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CurrencyInputViewModel(source, logger) }
            }
    }
}
