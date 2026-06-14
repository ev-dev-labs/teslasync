//
//  RecentActivityFeed.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The RecentActivityFeed shared surface — the SwiftUI parity of
//  `components/data-display/RecentActivityFeed.tsx`. A chronological list of audit-log entries scoped to
//  a user: each row maps an action to a tinted glyph, a localized title (with an optional click-through
//  to the entity), a subtitle from the entity + detail, and a relative timestamp. Driven by the
//  documented data source (`useTranslation`) and the controlled `entries`, binding through
//  `RecentActivityFeedModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the entries are resolving → a skeleton timeline.
//    • empty   — the window has no activity → the friendly web empty state, never a blank box.
//    • error   — the feed failed → a retryable error tile (web `QueryError` peer).
//    • content — the surface itself: the timeline of rows (web `Timeline`).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip beneath the feed with a
//                  one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - RecentActivityFeed (the shared surface)

/// The RecentActivityFeed shared surface — renders every state plus the P4 leaf freshness states,
/// binding through `RecentActivityFeedModel`.
public struct RecentActivityFeed: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Backed by the SwiftUI-free
    /// `RecentActivityFeedSurface.slug` so the state-holder layer is verifiable without the view.
    public static let surfaceSlug = RecentActivityFeedSurface.slug

    @State private var model: RecentActivityFeedModel

    public init(model: RecentActivityFeedModel) {
        _model = State(initialValue: model)
    }

    /// Convenience for the controlled-host usage — the parity of a web host mounting
    /// `<RecentActivityFeed entries=… emptyMessage=… />`. A missing `onNavigate` keeps the row titles as
    /// plain text (no dangling link), exactly as the web `<Link>` is inert without a router.
    public init(
        entries: [RecentActivityFeedEntry],
        emptyMessage: String? = nil,
        connection: RecentActivityFeedConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onNavigate: (@MainActor (String) -> Void)? = nil
    ) {
        let source = StaticRecentActivityFeedSource(
            RecentActivityFeedInput(
                entries: entries,
                emptyMessage: emptyMessage,
                connection: connection,
                isLoading: isLoading,
                errorMessage: errorMessage
            )
        )
        _model = State(initialValue: RecentActivityFeedModel(source: source, onNavigate: onNavigate))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                RecentActivityFeedFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RecentActivityFeedStrings.string(
            "recentActivityFeed.a11yContainer", "Recent activity"
        )))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            RecentActivityFeedLoadingView()
        case .empty:
            RecentActivityFeedEmptyView(message: model.emptyMessage)
        case let .error(message):
            RecentActivityFeedErrorView(message: message) { model.refresh() }
        case .content:
            RecentActivityFeedTimeline(rows: model.rows, canNavigate: model.canNavigate) { route in
                model.navigate(to: route)
            }
        }
    }
}
