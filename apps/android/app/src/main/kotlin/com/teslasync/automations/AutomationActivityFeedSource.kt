// The local-state seam the AutomationActivityFeed A7 page binds to. The web component is purely
// presentational — its parent hands it `history`, `historyStats`, `isLoading`, `liveEvents`, and
// `connectionState`, and it performs no fetch of its own (parity-manifest: no API data sources). This seam
// is the native analogue of "the props the host already holds": a single method returning the current
// [AutomationActivitySnapshot], so the view-model depends on an abstraction (a real provider ↔ a test fake)
// rather than on any concrete store or the network. No HTTP touches the view.
//
// With no automations feed wired into the Android data graph, the production binding
// ([automationActivityFeedSource]) yields a connected, empty snapshot — the honest local state for an
// unrouted surface that has been handed no execution history. That resolves to the friendly empty surface
// (web `<EmptyState>`), exactly as the web component renders with empty props; a host that already holds the
// shared Automations history (P1/S8) + live SSE inputs can supply a populated snapshot through this same seam.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located production binding.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations.activityfeed

/**
 * The single seam the [AutomationActivityFeedViewModel] depends on so it binds to an abstraction (a local
 * snapshot provider in production, a fake in tests), never to a concrete store or the network. The page
 * reads its render state entirely from the returned [AutomationActivitySnapshot] (the web props), so no HTTP
 * touches the view.
 */
fun interface AutomationActivityFeedSource {
    /** The current local snapshot of the activity feed (web `{ history, historyStats, isLoading, … }`). */
    fun snapshot(): AutomationActivitySnapshot
}

/**
 * The production binding: a connected, empty [AutomationActivitySnapshot]. There is no automations feed in
 * the Android data graph, so this is the honest local state for the unrouted presentational surface — an
 * empty execution history with a live SSE connection — which the page renders as the friendly empty surface
 * with the "Live" indicator, mirroring the web component handed empty props. A host embedding this page can
 * pass a different provider that folds in the shared Automations history and live SSE inputs.
 */
fun automationActivityFeedSource(): AutomationActivityFeedSource = AutomationActivityFeedSource { AutomationActivitySnapshot() }
