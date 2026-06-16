// The state holder backing the StatusApiDocsPage surface (P1/S8) — the native counterpart of the web page's render
// of its static `<Endpoint>` catalog (web/src/features/system/pages/StatusApiDocsPage.tsx). The web page reads no
// API; it renders a hardcoded list of endpoint cards. This holder mirrors that: it projects the framework-free
// [buildStatusApiDocsSnapshot] over the static [statusApiDocsCatalog] onto the shared lifecycle-aware [UiState]
// surface (loading -> empty -> success), so the stateless screen renders the same data-state matrix every parity
// page uses even though the source never goes to the network or errors. All derivation lives in the pure model
// (StatusApiDocsPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.statusapidocs

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param catalog the static endpoint catalog to project; production uses the canonical [statusApiDocsCatalog], tests
 *   inject a fake (including an empty one to exercise the empty-data surface).
 * @param now the load-stamp clock; production uses the wall clock, tests inject a fixed value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class StatusApiDocsPageViewModel(
    logger: Logger,
    private val catalog: List<StatusEndpoint> = statusApiDocsCatalog,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val feed: MutableStateFlow<Resource<StatusApiDocsSnapshot>> = MutableStateFlow(buildResource())

    /**
     * The resolved docs snapshot as a lifecycle-aware [UiState]: success (the catalog projected into its endpoint
     * cards) or empty (an empty catalog yields no card, the nothing-to-render case). The catalog is static so there
     * is no first-load spinner or hard-error surface, but the projection flows through the same [UiState] contract
     * every parity page renders.
     */
    val uiState: StateFlow<UiState<StatusApiDocsSnapshot>> = feed.asUiState(isEmpty = { it.isEmpty })

    /** Re-derive the snapshot — the page's pull-to-refresh / retry affordance (re-stamps the synthetic load). */
    fun refresh() {
        logger.info("statusApiDocs.refresh")
        feed.value = buildResource()
    }

    /** Retry affordance alias (no hard-error surface exists for a static catalog, but kept for parity symmetry). */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordStatusApiDocsPageOpened(logger)
    }

    private fun buildResource(): Resource<StatusApiDocsSnapshot> =
        statusApiDocsSnapshotResource(buildStatusApiDocsSnapshot(catalog), fetchedAt = now())

    companion object {
        /** Wire the surface with the canonical catalog. The holder runs on `viewModelScope`. */
        fun create(logger: Logger): StatusApiDocsPageViewModel = StatusApiDocsPageViewModel(logger = logger)
    }
}
