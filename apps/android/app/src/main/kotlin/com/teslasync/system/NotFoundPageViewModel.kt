// The state holder backing the NotFoundPage surface (P1/S8) — the native counterpart of the web page's render of its
// closest-route suggestions (web/src/features/system/pages/NotFoundPage.tsx). The web page reads no API; it derives a
// ranked suggestion list from the current `location.pathname` via Levenshtein distance over the route registry. This
// holder mirrors that: it projects the framework-free [buildNotFoundSnapshot] over the [attemptedPath] (the unmatched
// URL, threaded from navigation/local state) onto the shared lifecycle-aware [UiState] surface (loading → empty →
// success), so the stateless screen renders through the same data-state contract every parity page uses even though
// the source never goes to the network or errors. All derivation lives in the pure model (NotFoundPageModel.kt); this
// holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.notfound

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param attemptedPath the unmatched URL to explain + rank suggestions against (web `location.pathname`); blank/null
 *   falls back to the canonical not-found path inside the model.
 * @param candidates the navigable route registry to rank; production uses the canonical [defaultRouteCandidates]
 *   (projected from [io.teslasync.android.navigation.Destinations]), tests inject a fake (including an empty one).
 * @param now the load-stamp clock; production uses the wall clock, tests inject a fixed value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class NotFoundPageViewModel(
    logger: Logger,
    private val attemptedPath: String?,
    private val candidates: List<RouteCandidate> = defaultRouteCandidates(),
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val feed: MutableStateFlow<Resource<NotFoundSnapshot>> = MutableStateFlow(buildResource())

    /**
     * The resolved not-found snapshot as a lifecycle-aware [UiState]: always success (the attempted path plus its
     * ranked closest-route suggestions). The surface is static — the informational 404 page always has content to
     * render — so there is no first-load spinner or hard-error surface, but the projection still flows through the
     * same [UiState] contract every parity page renders.
     */
    val uiState: StateFlow<UiState<NotFoundSnapshot>> = feed.asUiState(isEmpty = { it.isEmpty })

    /** Re-derive the snapshot — the page's pull-to-refresh / retry affordance (re-stamps the synthetic load). */
    fun refresh() {
        logger.info("notFound.refresh")
        feed.value = buildResource()
    }

    /** Retry affordance alias (no hard-error surface exists for the static surface, but kept for parity symmetry). */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNotFoundPageOpened(logger)
    }

    private fun buildResource(): Resource<NotFoundSnapshot> =
        notFoundSnapshotResource(
            snapshot = buildNotFoundSnapshot(attemptedPath = attemptedPath, candidates = candidates),
            fetchedAt = now(),
        )

    companion object {
        /** Wire the surface with the canonical route candidates. The holder runs on `viewModelScope`. */
        fun create(
            logger: Logger,
            attemptedPath: String?,
        ): NotFoundPageViewModel = NotFoundPageViewModel(logger = logger, attemptedPath = attemptedPath)
    }
}
