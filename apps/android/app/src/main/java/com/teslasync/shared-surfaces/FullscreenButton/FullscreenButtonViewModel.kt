// UI-thread-free state holder backing the FullscreenButton surface — the native port of the web
// `FullscreenButton`'s support probe, `fullscreenchange` sync, and `toggle` handler
// (web/src/components/ui/FullscreenButton.tsx) over the [FullscreenController] seam. It seeds its state from
// the controller's support + current-state reads, mirrors every change the controller observes onto
// [FullscreenUiState] (the web `fullscreenchange` listener), resolves a tap to the enter/exit action, and emits
// the PII-safe diagnostics. The view performs NO window I/O — it only collects [state] and calls [toggle] /
// [onViewOpened] (ADR-002).
//
// It extends [BaseFeedViewModel] for the sanctioned redacting [logger] and the scope-bound collection helpers,
// exactly like the sibling state holders. Because a FullscreenButton is a reusable leaf, the composable binds
// it with a stable surface key; the holder tracks its own [FullscreenUiState].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FullscreenButton) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update

/**
 * State holder backing one Compose [io.teslasync.android.sharedsurfaces.fullscreenbutton.FullscreenButton] —
 * the Android port of the web `FullscreenButton`'s support probe + `fullscreenchange` sync + `toggle` handler
 * over the [FullscreenController] seam.
 *
 * It seeds [state] from the [controller]'s [FullscreenController.isSupported] + [FullscreenController.isFullscreen]
 * reads (web initial `useState(probeSupport)` / `useState(false)`), then keeps `isFullscreen` in sync with the
 * controller's [FullscreenController.fullscreenChanges] stream — the native analogue of the web effect that
 * listens for `fullscreenchange`, so the icon stays honest when the host exits fullscreen without a tap.
 *
 * On [toggle] it reads the controller's current state fresh (web `readFullscreenElement()` at click time),
 * resolves the [FullscreenAction], drives the controller's [FullscreenController.enter] / [FullscreenController.exit],
 * and records the PII-safe outcome. It does NOT optimistically flip the state — exactly like the web handler,
 * which lets the `fullscreenchange` event own the state transition. An unsupported controller makes [toggle] a
 * no-op (web's hidden button is never clickable).
 *
 * @param controller the fullscreen platform seam (the host window in production, a recording fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + toggle events
 *   carrying only the non-PII surface slug (never a target id, route, or payload).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class FullscreenButtonViewModel(
    private val controller: FullscreenController,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState =
        MutableStateFlow(
            FullscreenUiState(
                supported = controller.isSupported,
                isFullscreen = controller.isFullscreen(),
            ),
        )

    /** This button's render state — `supported` gates visibility, `isFullscreen` selects the glyph + label. */
    val state: StateFlow<FullscreenUiState> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    init {
        controller
            .fullscreenChanges()
            .onEach { active -> mutableState.update { current -> current.copy(isFullscreen = active) } }
            .launchIn(stateScope)
    }

    /**
     * Toggles the host's fullscreen state — the native port of the web `toggle`. Reads the controller's current
     * state fresh (web `readFullscreenElement()`), resolves the [FullscreenAction], drives the controller, and
     * records the PII-safe outcome. The state itself flips through the [FullscreenController.fullscreenChanges]
     * stream (web `fullscreenchange`), never optimistically here. A no-op on an unsupported host.
     */
    fun toggle() {
        if (!controller.isSupported) return
        val action = nextFullscreenAction(controller.isFullscreen())
        when (action) {
            FullscreenAction.Enter -> controller.enter()
            FullscreenAction.Exit -> controller.exit()
        }
        recordFullscreenToggle(logger, action)
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per placement. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordFullscreenOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the composable binds this surface's holder through. */
        fun factory(
            controller: FullscreenController,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { FullscreenButtonViewModel(controller, logger) }
            }
    }
}
