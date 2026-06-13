// UI-thread-free state holder backing the Currency shared surface — the native port of the web component's
// `useFormatting()` data dependency (web/src/components/data-display/format/Currency.tsx →
// web/src/hooks/useFormatting.ts). It binds the symbol/locale feed (P1/S8) through [CurrencySource], projects
// it onto the shared lifecycle-aware [UiState] surface (loading / content / stale / offline / error), and
// exposes the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [format] and
// calls [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces/
// Currency) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currency

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * @param source the symbol/locale feed seam (a shared-settings-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying
 *   only the non-PII surface slug (never the amount or the symbol).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class CurrencyViewModel(
    private val source: CurrencySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The live currency format as a lifecycle-aware [UiState]: loading / content / stale / offline / error,
     * carrying the freshness stamp + error kind. The render boundary classifies this (with the call-site value)
     * into a [CurrencyRender] so every state the settings feed can carry renders a non-blank amount (P3). A
     * resolved [CurrencyFormat] is never structurally empty, so the feed never reports an "empty" phase — the
     * surface's own empty state is the web's null / non-finite value fallback, handled at the render boundary.
     */
    val format: StateFlow<UiState<CurrencyFormat>> = source.currencyFormat().asUiState { false }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no amount or symbol, so a diagnostics line can never leak the operator's costs. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCurrencyOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: CurrencySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { CurrencyViewModel(source, logger) }
            }
    }
}
