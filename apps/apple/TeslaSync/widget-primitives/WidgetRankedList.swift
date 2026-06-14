//
//  WidgetRankedList.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The public API of the ranked list — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetRankedList.tsx`. A shared widget building block used by many
//  dashboard widgets: an ordered leaderboard that sorts the supplied items by value descending, caps them
//  at `maxItems ?? (compact ? 3 : 5)`, renders each as a rank + (optional) magnitude bar + label +
//  (optional) badge + formatted value, and shows a friendly empty state when there are none. Driven by the
//  controlled props through ``WidgetRankedListModel`` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — the host's query is resolving → skeleton ranked rows.
//    • empty    — no items → the shared `TSEmptyState` (web `EmptyState`, default "No data available").
//    • error    — the data failed → a retryable error tile (web `QueryError` peer).
//    • list     — the surface itself: the sorted + capped ranked list (web body).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip above the list with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - WidgetRankedList (the widget primitive)

/// The ranked list — the SwiftUI parity of `WidgetRankedList.tsx`. Renders every state plus the P4 leaf
/// freshness states, binding through ``WidgetRankedListModel``. A shared widget building block — mount it
/// inside a dashboard widget that supplies the already-formatted, already-converted items.
public struct WidgetRankedList: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetRankedListSurface.slug

    @State private var model: WidgetRankedListModel

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded source).
    public init(model: WidgetRankedListModel) {
        _model = State(initialValue: model)
    }

    /// The prop-style initializer — the parity of `<WidgetRankedList items maxItems compact showBars
    /// emptyMessage emptyIcon />`. `items` are the already-formatted, already-converted rows; `compact`
    /// (default `false`) caps at 3 and hides bars; `showBars` (default `true`) toggles the magnitude bars.
    /// The leaf-contract inputs (`connection` / `isLoading` / `errorMessage`) let a widget host wire its
    /// query lifecycle without the primitive ever hiding.
    public init(
        items: [RankedItem],
        maxItems: Int? = nil,
        compact: Bool = false,
        showBars: Bool = true,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        connection: WidgetRankedListConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        telemetry: any WidgetRankedListTelemetry = OSLogWidgetRankedListTelemetry()
    ) {
        let input = WidgetRankedListInput(
            items: items,
            maxItems: maxItems,
            compact: compact,
            showBars: showBars,
            emptyMessage: emptyMessage,
            emptyIconSymbol: emptyIconSymbol,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        let source = StaticWidgetRankedListSource(input)
        _model = State(initialValue: WidgetRankedListModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                WidgetRankedListFreshnessChip(connection: model.connection) {
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

    /// The resolved body — the native peer of the web render decision (`visible.length === 0 ?
    /// <EmptyState/> : <ul>…</ul>`), extended with the P4 loading / error leaves.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WidgetRankedListLoadingView()
        case .empty:
            emptyView
        case let .error(message):
            WidgetRankedListErrorView(message: message) { model.refresh() }
        case .list:
            WidgetRankedListView(rows: model.resolved.rows, hideBars: model.resolved.hideBars)
        }
    }

    /// The empty branch — the shared `TSEmptyState` (web `EmptyState message="No data available"`). The
    /// message is the caller's verbatim override or the web default copy; the glyph is the caller's
    /// `emptyIcon` peer or the default numbered-list symbol.
    private var emptyView: some View {
        let message = model.resolved.emptyMessage ?? WidgetRankedListStrings.emptyMessage
        let icon = model.resolved.emptyIconSymbol ?? WidgetRankedListSymbols.empty
        return TSEmptyState(
            title: LocalizedStringKey(message),
            message: LocalizedStringKey(WidgetRankedListStrings.emptyHint),
            systemImage: icon
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}
