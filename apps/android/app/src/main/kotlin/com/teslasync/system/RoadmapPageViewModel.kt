// The state holder backing the RoadmapPage surface (P1/S8) — the native counterpart of the web page's render of
// its static `roadmapItems` catalog (web/src/features/system/pages/RoadmapPage.tsx). The web page reads no API; it
// derives a four-phase progress tally and the per-phase card sections from an inline array. This holder mirrors
// that: it projects the framework-free [buildRoadmapSnapshot] over the static [io.teslasync.android.system.roadmap]
// catalog onto the shared lifecycle-aware [UiState] surface (loading → empty → success), so the stateless screen
// renders the same data-state matrix every parity page uses even though the source never goes to the network or
// errors. All derivation lives in the pure model (RoadmapPageModel.kt); this holder is the thin orchestration layer
// and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.roadmap

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param catalog the static roadmap catalog to project; production uses the canonical [roadmapCatalog], tests inject
 *   a fake (including an empty one to exercise the empty-data surface).
 * @param now the load-stamp clock; production uses the wall clock, tests inject a fixed value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class RoadmapPageViewModel(
    logger: Logger,
    private val catalog: List<RoadmapEntry> = roadmapCatalog,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val feed: MutableStateFlow<Resource<RoadmapSnapshot>> = MutableStateFlow(buildResource())

    /**
     * The resolved roadmap snapshot as a lifecycle-aware [UiState]: success (the catalog grouped into the progress
     * tally + the per-phase card sections) or empty (an empty catalog yields no card section, web's
     * nothing-to-render case). The catalog is static so there is no first-load spinner or hard-error surface, but
     * the projection flows through the same [UiState] contract every parity page renders.
     */
    val uiState: StateFlow<UiState<RoadmapSnapshot>> = feed.asUiState(isEmpty = { it.isEmpty })

    /** Re-derive the snapshot — the page's pull-to-refresh / retry affordance (re-stamps the synthetic load). */
    fun refresh() {
        logger.info("roadmap.refresh")
        feed.value = buildResource()
    }

    /** Retry affordance alias (no hard-error surface exists for a static catalog, but kept for parity symmetry). */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordRoadmapPageOpened(logger)
    }

    private fun buildResource(): Resource<RoadmapSnapshot> =
        roadmapSnapshotResource(buildRoadmapSnapshot(catalog), fetchedAt = now())

    companion object {
        /** Wire the surface with the canonical catalog. The holder runs on `viewModelScope`. */
        fun create(logger: Logger): RoadmapPageViewModel = RoadmapPageViewModel(logger = logger)
    }
}
