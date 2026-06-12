//
//  WidgetEventFeed.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The WidgetEventFeed widget primitive — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetEventFeed.tsx`. A shared building block used by many
//  dashboard widgets: a recent-events timeline that sorts the supplied items newest-first, caps them
//  at `maxItems ?? (compact ? 3 : 10)`, renders each as a connected `TimelineItem`, and shows a
//  friendly empty state when there are none. Driven by the documented data sources (`useTranslation`
//  + `useDateFormat`) through `WidgetEventFeedModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — the host's query is resolving → skeleton timeline rows.
//    • empty    — no events → the shared `TSEmptyState` (web `EmptyState`, key `widget.noEvents`).
//    • error    — the feed failed → a retryable error tile (web `QueryError` peer).
//    • feed     — the surface itself: the sorted + capped timeline list (web body).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip above the list with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - WidgetEventFeed (the widget primitive)

/// The WidgetEventFeed widget primitive — renders every state plus the P4 leaf freshness states,
/// binding through `WidgetEventFeedModel`.
public struct WidgetEventFeed: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "WidgetEventFeed"

    /// The absolute date renderer used as the relative-time fallback past 24h (web `formatDateTime`).
    /// Locale-aware via `Date.FormatStyle`, so it tracks the user's region without a retained
    /// formatter.
    static let absoluteDateFormat: WidgetEventFeedDateFormat = { date in
        date.formatted(date: .abbreviated, time: .shortened)
    }

    @State private var model: WidgetEventFeedModel

    public init(model: WidgetEventFeedModel) {
        _model = State(initialValue: model)
    }

    /// Convenience for the common controlled-host usage — the parity of a widget mounting
    /// `<WidgetEventFeed items=… compact=… maxItems=… />`. A wired `onSelect` makes rows that carry an
    /// `href` tappable for drill-through (web row `<Link>`); a missing handler leaves them static.
    public init(
        items: [WidgetEventFeedItem],
        compact: Bool = false,
        maxItems: Int? = nil,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        connection: WidgetEventFeedConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onSelect: (@MainActor (WidgetEventFeedItem) -> Void)? = nil
    ) {
        let input = WidgetEventFeedInput(
            items: items,
            compact: compact,
            maxItems: maxItems,
            emptyMessage: emptyMessage,
            emptyIconSymbol: emptyIconSymbol,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        let source = StaticWidgetEventFeedSource(input)
        _model = State(initialValue: WidgetEventFeedModel(source: source, onSelect: onSelect))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                WidgetEventFeedFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WidgetEventFeedLoadingView()
        case .empty:
            emptyView
        case let .error(message):
            WidgetEventFeedErrorView(message: message) { model.refresh() }
        case .feed:
            WidgetEventFeedListView(
                items: model.resolved.items,
                canSelect: model.canSelect,
                relativeTime: relativeTime,
                onSelect: { model.select($0) }
            )
        }
    }

    /// The empty branch — the shared `TSEmptyState` (web `EmptyState`). The message is the caller's
    /// verbatim override or the web `widget.noEvents` copy; the glyph is the caller's `emptyIcon` or
    /// the default bell-slash.
    private var emptyView: some View {
        let message = model.resolved.emptyMessage
            ?? WidgetEventFeedStrings.string(WidgetEventFeedKeys.noEvents, "No events yet")
        let icon = model.resolved.emptyIconSymbol ?? WidgetEventFeedSymbols.empty
        return TSEmptyState(title: LocalizedStringKey(message), systemImage: icon)
            .frame(maxWidth: .infinity)
    }

    /// Resolves a row's relative time at render (web `formatRelativeTime`): "Just now" / "{n}m ago" /
    /// "{n}h ago" against the current clock, falling back to the absolute date past 24h.
    private func relativeTime(_ date: Date) -> String {
        WidgetEventFeedRelativeTime.format(
            date,
            now: Date(),
            resolve: WidgetEventFeedStrings.string,
            absolute: Self.absoluteDateFormat
        )
    }
}
