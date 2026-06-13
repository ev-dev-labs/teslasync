// UI-thread-free state holder backing the InsightsEngine surface — the native port of the web
// component's settings dependency (web/src/components/data-display/InsightsEngine.tsx reading
// `useFormatting`, over web/src/hooks/useSettings.ts). It binds the [InsightsFormattingSource] seam
// (P1/S8), re-shares the live [InsightsFormatting] as a lifecycle-aware [StateFlow] (collected only
// while an InsightsEngine is on-screen), and emits the PII-safe one-shot `view.opened` diagnostic.
// The view never performs work of its own — it only collects [formatting], classifies the
// caller-supplied data with the pure [classifyInsights], and renders.
//
// Settings is the surface's only async dependency; the eight analyzers are a pure projection of the
// caller-supplied [InsightData] + feed status, so there is no fetch lifecycle to own here (the
// surface's loading / content / empty / failed branches are derived per-render by [classifyInsights]).
// The view stays a thin renderer (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/InsightsEngine) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose [io.teslasync.android.sharedsurfaces.insightsengine.InsightsEngine]
 * — the Android port of the web `InsightsEngine`'s `useFormatting` subscription.
 *
 * It re-shares the injected [source]'s [InsightsFormatting] stream (the P1/S8 boundary) as a
 * lifecycle-aware [formatting] flow, so every insight reflects the latest currency / precision
 * preference without the view owning any state itself. The analysis is a pure projection of
 * caller-supplied data, so there is no loading / empty / error / stale / offline FEED lifecycle to
 * model here — those surface branches are derived per-render by [classifyInsights] from the parent's
 * [InsightsFeedStatus].
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared formatting-context seam (settings-backed in production, a fresh instance
 *   in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
class InsightsEngineViewModel(
    source: InsightsFormattingSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The live display-formatting context (web `useFormatting`), collected only while observed. */
    val formatting: StateFlow<InsightsFormatting> =
        source.context.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = InsightsFormatting.DEFAULT,
        )

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordInsightsOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: InsightsFormattingSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { InsightsEngineViewModel(source, logger) }
            }
    }
}
