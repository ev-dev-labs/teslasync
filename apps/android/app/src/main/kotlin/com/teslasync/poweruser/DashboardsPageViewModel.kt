// The state holder backing the DashboardsPage power-user surface (P1/S8) — the native counterpart of the web page's
// React state (web/src/features/power-user/pages/DashboardsPage.tsx). The web page renders no API feed: it owns a
// manual JSON draft, a copy-to-clipboard outcome, and the static curated catalog. This holder projects those onto the
// lifecycle-aware [UiState] surface and the two interactive flows, and performs no HTTP. All outcome logic lives in
// the framework-free model (DashboardsPageModel.kt); this is the thin orchestration layer.
//
// There is no async data source (the parity manifest declares the single `success` state), so [state] is an
// immediate, never-changing [UiPhase.Content] over the static [DashboardsCatalog] — the genuine "success" surface.
// The JSON [draft] and [copyStatus] are local UI state the editor panel drives: [updateDraft] mirrors the web
// `setDashboardJson`; [clear] mirrors `handleClear` (reset draft + status); [copy] runs the web `handleCopy` state
// machine through the injected [ClipboardTarget]. The draft is retained for the holder's lifetime, so it survives
// configuration changes (rotation) the way the web localStorage draft survives a reload; cross-process persistence is
// out of this surface's parity scope.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.dashboards

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives the one-shot `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class DashboardsPageViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val mutableState =
        MutableStateFlow(UiState(phase = UiPhase.Content, data = DashboardsCatalog.DEFAULT))

    /**
     * The single, immediate `success` surface: the static curated catalog as [UiPhase.Content]. There is no async
     * feed to load, so this never transitions to loading / empty / error — it is the genuine success state the
     * editor + catalog panels render from.
     */
    val state: StateFlow<UiState<DashboardsCatalog>> = mutableState.asStateFlow()

    private val mutableDraft = MutableStateFlow("")

    /** The manual dashboard-JSON editor contents (web `dashboardJson`). */
    val draft: StateFlow<String> = mutableDraft.asStateFlow()

    private val mutableCopyStatus = MutableStateFlow(CopyStatus.None)

    /** The latest copy-to-clipboard outcome (web `statusMessage`), resolved to a localized string at the boundary. */
    val copyStatus: StateFlow<CopyStatus> = mutableCopyStatus.asStateFlow()

    /** Updates the editor contents (web `setDashboardJson`); leaves any existing status message untouched. */
    fun updateDraft(value: String) {
        mutableDraft.value = value
    }

    /** Resets the editor and clears the status message (web `handleClear`). */
    fun clear() {
        mutableDraft.value = ""
        mutableCopyStatus.value = CopyStatus.None
    }

    /** Runs the web `handleCopy` outcome machine over [clipboard], publishing the resulting [CopyStatus]. */
    fun copy(clipboard: ClipboardTarget) {
        mutableCopyStatus.value = evaluateCopyStatus(mutableDraft.value, clipboard)
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no draft / dashboard JSON payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDashboardsOpened(logger)
    }
}
