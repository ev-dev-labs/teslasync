// UI-thread-free state holder backing the TourLauncher misc surface — the native analogue of the state the
// web component owns (web/src/features/onboarding/TourLauncher.tsx: the `open` lifecycle, the re-render on
// `TOUR_START_EVENT`, and the `markTourListSeen` / `resetAllTours` / `dispatchTourStart` actions). It binds
// the shared **S8** completion holder through [TourLauncherSource], re-exposes the live completion snapshot,
// and owns the surface's actions + the PII-safe `view.opened` diagnostic. The view never touches persistence —
// it only collects [completions] and calls the actions; the per-row projection itself is computed at the
// render boundary from [completions] + the hoisted path (the web `tours.map` inputs).
//
// The web data is synchronous local state, so — exactly like the sibling synchronous surfaces — there is no
// cache-then-network UiState to fold here (covenant: no silent drift); the holder simply re-publishes the
// store's hot completion flow and re-reads it when the launcher re-opens.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/misc-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.tourlauncher

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/**
 * @param source the per-tour completion seam (a shared-S8-store adapter in production, a fake in tests). The
 *   view-model owns no persistence — it only re-publishes this snapshot and forwards the surface's actions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events.
 */
class TourLauncherViewModel(
    private val source: TourLauncherSource,
    private val logger: Logger,
) : ViewModel() {
    private var viewOpenedRecorded = false

    /**
     * The live per-tour completion snapshot (web `isTourCompleted` reads), re-emitting after a reset or an
     * external completion write. The render boundary turns this — together with the hoisted path — into the
     * [TourRow] list via [TourLauncherProjection]; the launcher never reads persistence directly.
     */
    val completions: StateFlow<TourCompletions> = source.completions()

    /**
     * Emits the one mandated PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no path / tour payload, so a diagnostics line can never leak the user's onboarding
     * posture. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        TourLauncherDiagnostics.recordViewOpened(logger)
    }

    /**
     * Web "on open → `markTourListSeen()`": records the launcher has been seen and re-reads persistence so any
     * completion written since the last open is reflected. Call when the launcher transitions to open.
     */
    fun onLauncherOpened() {
        TourLauncherDiagnostics.recordLauncherOpened(logger)
        source.markListSeen()
        source.refresh()
    }

    /**
     * Web `dispatchTourStart(id)`: records the Start/Replay action. The actual hand-off to the tour player is
     * the host's responsibility (the launcher emits the id through its `onStartTour` callback), keeping this
     * surface free of tour-player coupling.
     */
    fun startTour(id: String) {
        TourLauncherDiagnostics.recordTourStart(logger, id)
    }

    /** Web `resetAllTours()`: clears every stored completion flag; the live [completions] re-emits empty. */
    fun resetAll() {
        TourLauncherDiagnostics.recordResetAll(logger)
        source.resetAll()
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TourLauncherSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TourLauncherViewModel(source, logger) }
            }
    }
}
