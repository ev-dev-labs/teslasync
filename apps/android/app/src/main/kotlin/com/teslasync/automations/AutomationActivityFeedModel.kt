// Pure, framework-free metadata + local-state model for the AutomationActivityFeed A7 page surface — the
// native analogue of the cross-cutting concerns the web page owns
// (web/src/features/automations/pages/AutomationActivityFeed.tsx). The web component is purely
// presentational: it receives `history`, `historyStats`, `isLoading`, `liveEvents`, and `connectionState`
// as props from its parent (it calls no API hook of its own — only `useTranslation`), so this page renders
// from navigation args / local state rather than a network feed (parity-manifest: no API data sources).
//
// No Compose, no Android framework, no HTTP lives here. The page reuses the shared A3 feature view
// (io.teslasync.android.featureviews.automationactivityfeed) for the actual panel/states/strings (DRY,
// ADR-006); this file only carries the page's navigation identity + diagnostics and the local snapshot the
// host binds, projected onto the shared lifecycle-aware [UiState] the feature view consumes. No field is
// unit-bearing (counts, a 0-100 percent, and the millisecond durations the backend already computed), so
// there is no SI conversion at this layer — the feature view formats at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/automations — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path —
// exactly as the sibling A7 surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// registration + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations.activityfeed

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.automationactivityfeed.AutomationActivityData
import io.teslasync.android.featureviews.automationactivityfeed.AutomationHistoryEntry
import io.teslasync.android.featureviews.automationactivityfeed.AutomationHistoryStatsModel
import io.teslasync.android.featureviews.automationactivityfeed.AutomationLiveEvent
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for this surface. The web component is an unrouted presentational sub-surface (it is
 * rendered inside the Automations page on the web, not at its own path), so there is no web route to mirror
 * as a deep link — this object carries the navigation identity the host wires through the page-host seam
 * ([ROUTE_ID]) and the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11). There is
 * no page-size or feed metadata because the page renders no network data of its own; it binds a local
 * snapshot and reuses the shared A3 feature view for the rendering.
 */
object AutomationActivityFeedPageRegistration {
    /** The navigation seam id the page host registers under (PageHosts.register). */
    const val ROUTE_ID: String = "automationActivityFeed"

    /** The web source this surface mirrors. */
    const val WEB_SOURCE: String = "web/src/features/automations/pages/AutomationActivityFeed.tsx"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no automation payload. */
    const val SLUG: String = "AutomationActivityFeedPage"
}

/**
 * The page's immutable local-state snapshot — the union of the web component's five props folded into one
 * value so the view-model projects a single source of truth (web `{ history, historyStats, isLoading,
 * liveEvents, connectionState }`). The host supplies it through the [AutomationActivityFeedSource] local
 * seam (navigation args / local state); with no API feed wired the production default is a connected,
 * empty snapshot, which resolves to the friendly empty surface — exactly what the web component renders
 * when it is handed no execution history.
 *
 * @property history the execution-history rows (web `history`).
 * @property stats the run-summary aggregate, or null when there are no runs (web `historyStats`).
 * @property isLoading whether a first load is in flight (web `isLoading`).
 * @property liveEvents the most recent live SSE events (web `liveEvents`).
 * @property connectionState the SSE wire health (web `connectionState`).
 */
data class AutomationActivitySnapshot(
    val history: List<AutomationHistoryEntry> = emptyList(),
    val stats: AutomationHistoryStatsModel? = null,
    val isLoading: Boolean = false,
    val liveEvents: List<AutomationLiveEvent> = emptyList(),
    val connectionState: LiveConnectionStatus = LiveConnectionStatus.Connected,
)

/**
 * Projects the local [AutomationActivitySnapshot] onto the shared lifecycle-aware [UiState] the feature view
 * consumes. The phase mirrors the web component's branch order exactly: a first load (`isLoading`) is the
 * loading surface, an empty history is the empty surface (web `items.length > 0`), and anything else is the
 * content surface (the execution-history rows). The history + summary travel together as the feature view's
 * [AutomationActivityData] payload (the web `AutomationHistoryListResponse` `items` + `summary`).
 */
fun AutomationActivitySnapshot.toUiState(): UiState<AutomationActivityData> {
    val phase =
        when {
            isLoading -> UiPhase.Loading
            history.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(phase = phase, data = AutomationActivityData(history = history, stats = stats))
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the page [AutomationActivityFeedPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no automation name, status, or run payload, so a diagnostics line can never leak
 * what an automation did.
 */
fun recordAutomationActivityFeedPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutomationActivityFeedPageRegistration.SLUG))
}
