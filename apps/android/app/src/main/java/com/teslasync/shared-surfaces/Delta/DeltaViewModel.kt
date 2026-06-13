// UI-thread-free state holder backing the Delta surface — the native port of the web `Delta`'s settings
// dependency (web/src/components/data-display/Delta.tsx reading `useUnits` + `useFormatting`, both over
// web/src/hooks/useSettings.ts). It binds the [DeltaUnitSource] seam (P1/S8), re-shares the live
// [DeltaUnitContext] as a lifecycle-aware [StateFlow] (collected only while a Delta is on-screen), and
// emits the PII-safe one-shot `view.opened` diagnostic. The view never performs work of its own — it
// only collects [context], builds a [DeltaInput] from its render parameters, and projects.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Delta) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

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
 * State holder backing the Compose [io.teslasync.android.sharedsurfaces.delta.Delta] — the Android port
 * of the web `Delta`'s `useUnits` + `useFormatting` subscription.
 *
 * It re-shares the injected [source]'s [DeltaUnitContext] stream (the P1/S8 boundary) as a
 * lifecycle-aware [context] flow, so every Delta reflects the latest unit / currency preference without
 * owning any state itself. Settings is the surface's only async dependency; the delta math is a pure
 * projection of caller-supplied numbers, so there is no loading / empty / error / stale / offline feed
 * lifecycle to model here (the surface's loading / empty / resolved branches are derived per-render by
 * [DeltaProjection.project]). The view stays a thin renderer (ADR-002).
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared unit-context seam (settings-backed in production, a fresh instance in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
class DeltaViewModel(
    source: DeltaUnitSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The live display-unit context (web `useUnits` + `useFormatting`), collected only while observed. */
    val context: StateFlow<DeltaUnitContext> =
        source.context.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = DeltaUnitContext.DEFAULT,
        )

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDeltaOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: DeltaUnitSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DeltaViewModel(source, logger) }
            }
    }
}
