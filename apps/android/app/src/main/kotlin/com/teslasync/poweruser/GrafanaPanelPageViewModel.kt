// UI-thread-free state holder backing the GrafanaPanelPage surface — the native port of the local state the web
// page owns (web/src/features/power-user/pages/GrafanaPanelPage.tsx): the manual editor draft (`panelJson`,
// persisted to localStorage) and the copy-to-clipboard status (`statusMessage`). The page has no API feed, so
// this exposes a single [StateFlow] of local [GrafanaPanelUiState] (the manifest's one declared "success" data
// state) rather than a cache-then-network projection. The view never persists or formats anything itself — it
// collects [state] and calls the intent methods; durability flows through the injected [GrafanaDraftStore]
// (SharedPreferences in production, a fake in tests), so this holder stays framework-free and unit-tested
// off-device.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.grafanapanel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelDraft
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param draftStore the editor-draft persistence seam (web localStorage `'ai.grafanaPanel.draft'`); seeds the
 *   initial state and receives every edit so a long draft survives navigation away + back and a process restart.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the non-PII `view.opened` slug,
 *   never the editor draft, the prompt, or any generated content.
 */
class GrafanaPanelPageViewModel(
    private val draftStore: GrafanaDraftStore,
    private val logger: Logger,
) : ViewModel() {
    private val mutableState = MutableStateFlow(GrafanaPanelUiState(panelJson = draftStore.load()))
    private var viewOpenedRecorded = false

    /**
     * The live editor surface state: the persisted draft + the most recent copy outcome. The render boundary
     * always draws the deterministic editor + curated catalog from this state, so no region is ever blank.
     */
    val state: StateFlow<GrafanaPanelUiState> = mutableState.asStateFlow()

    /** Update the editor contents as the user types (web `setPanelJson(e.target.value)`) and persist them. */
    fun setPanelJson(value: String) {
        if (mutableState.value.panelJson == value) return
        mutableState.update { it.copy(panelJson = value) }
        draftStore.save(value)
    }

    /**
     * Apply a Helix draft to the editor (web `handleApplyAiDraft`): render the proposed panel envelope as
     * pretty-printed JSON, clear any stale copy status, and persist. The LLM never mutates editor state directly —
     * the user explicitly applies, then copies, exactly as the web propose-only contract requires.
     */
    fun applyAiDraft(draft: GrafanaPanelDraft) {
        val json = prettyPrintPanelEnvelope(draft.panel)
        mutableState.update { it.copy(panelJson = json, status = null) }
        draftStore.save(json)
    }

    /** Clear the editor (web `handleClear`): empty the draft, drop the copy status, and remove the persisted entry. */
    fun clear() {
        mutableState.update { it.copy(panelJson = "", status = null) }
        draftStore.save("")
    }

    /** Record the outcome of a copy-to-clipboard attempt (web `setStatusMessage`); the view performs the write. */
    fun reportCopyStatus(status: GrafanaCopyStatus) {
        mutableState.update { it.copy(status = status) }
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGrafanaPanelPageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel. */
        fun factory(
            draftStore: GrafanaDraftStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { GrafanaPanelPageViewModel(draftStore, logger) }
            }
    }
}
