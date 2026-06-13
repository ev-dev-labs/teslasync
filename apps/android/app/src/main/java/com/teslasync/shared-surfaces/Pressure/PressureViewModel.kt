// UI-thread-free state holder backing the Pressure shared surface — the native port of the live unit
// preference the web component reads from `useUnits()` (web/src/components/data-display/format/Pressure.tsx).
// It binds the [PressureSource] seam (P1/S8), folds each emission into the [UnitFormatter] the render
// boundary formats with, and exposes the PII-safe one-shot `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] and calls [onViewOpened].
//
// The pressure value is caller-supplied and the unit preference always resolves to at least the metric
// default (the holder seeds `UnitFormatter.default()`), so apart from the live formatter there is no async
// cache-then-network lifecycle to model — the same documented rationale as the accepted Avatar /
// AnimatedNumber / VisuallyHidden presentational siblings. The holder therefore stays a thin reducer over the
// seam (ADR-002) and owns no networking.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Pressure) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Lifecycle-aware state holder backing the Compose [io.teslasync.android.sharedsurfaces.pressure.Pressure]
 * surface — the Android port of the web `Pressure` component's `useUnits()` binding.
 *
 * It subscribes to the injected [PressureSource] seam (the P1/S8 boundary) for its whole lifetime and folds
 * each emission into [state], so the render boundary can format the supplied kPa value in the user's current
 * unit. The unit preference always resolves to at least the metric default, so there is no further lifecycle
 * to model (the same documented rationale as the accepted Avatar sibling); the view stays a thin renderer. It
 * owns no networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the live display-unit seam (a shared-S8 `unitFormatter` adapter in production, a fake in
 *   tests). The view-model owns no networking — it only reduces this port's emissions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying
 *   only the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PressureViewModel(
    private val source: PressureSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(UnitFormatter.default())
    private var viewOpenedRecorded = false

    /** The live display-unit formatter the render boundary formats with; the metric default until the seam emits. */
    val state: StateFlow<UnitFormatter> = mutableState.asStateFlow()

    init {
        // Bind the unit seam for the holder's lifetime so a settings unit change re-renders the value in place.
        launch { source.units().collect { formatter -> mutableState.value = formatter } }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no pressure value or caller input, so a diagnostics line can never leak the reading shown. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        PressureDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: PressureSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { PressureViewModel(source, logger) }
            }
    }
}
