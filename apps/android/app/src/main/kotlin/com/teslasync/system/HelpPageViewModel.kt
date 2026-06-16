// The state holder backing the HelpPage surface (P1/S8) — the native counterpart of the web page's render
// (web/src/features/system/pages/HelpPage.tsx, the deterministic /help baseline). The web page reads no API: it
// renders a static, curated link palette unconditionally. This holder therefore exposes a single resolved [UiState]
// in the content phase, carrying the [HelpContent] (the curated [HELP_LINKS]) the page renders — no loading / empty /
// error transitions are reachable because the content is local + always available, so none are fabricated. All
// derivation lives in the framework-free model (HelpPageModel.kt); this holder performs no HTTP and owns no business
// logic, only the one-shot diagnostic.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.help

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives the one-shot `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class HelpPageViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val state =
        MutableStateFlow(
            UiState(phase = UiPhase.Content, data = HelpContent(links = HELP_LINKS)),
        )

    /**
     * The resolved page snapshot as a lifecycle-aware [UiState]. Always [UiPhase.Content]: the curated link palette
     * is static + local, so it is available on the first frame with no artificial blank — mirroring the web page,
     * which renders its links unconditionally.
     */
    val uiState: StateFlow<UiState<HelpContent>> = state.asStateFlow()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordHelpPageOpened(logger)
    }

    companion object {
        /** Wire the surface from the app's redacting [logger]. The holder runs on `viewModelScope`. */
        fun create(logger: Logger): HelpPageViewModel = HelpPageViewModel(logger = logger)
    }
}
