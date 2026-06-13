//
//  TreeSelect.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The public API of the tri-state tree multi-select — the SwiftUI parity of `components/forms/TreeSelect.tsx`.
//  Like the web component it is a CONTROLLED surface driven by its props (`groups`, `selectedIds`,
//  `searchValue`, optional `expandedGroupIds`, the `search-prompt` / `emptyState` / `noResultsState` /
//  `ariaLabel` overrides) and reports edits through `onChange` / `onSearchChange` / `onExpandedChange`. The
//  view binds through ``TreeSelectModel`` for the once-only `view.opened` telemetry (P1/S11), the filter /
//  selection / expansion logic, and the polite selection-summary announcements (web sr-only live region);
//  composes the token-driven chrome (P1/S9); and reproduces every state — the parent's loading / error /
//  connectivity (the P4 leaf axis) plus the ready tree's empty / no-results / populated branches. No
//  networking, no Tailwind ports.
//
//  States (every one renders — no hidden surface):
//    • loading  — the catalog fetch in flight → skeleton picker.
//    • ready    — the search + header + bordered tree; renders empty (friendly "No items available."),
//                 no-results (friendly "No matches for …") OR the populated tree — never a blank box.
//    • error    — the parent's catalog fetch failed → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the tree with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TreeSelect (the shared surface)

/// The tri-state tree multi-select — the SwiftUI parity of `components/forms/TreeSelect.tsx`. Renders a
/// search box that filters the two-level tree, a select-all-visible header with live counts, and group
/// headers (tri-state checkbox + disclosure) over their leaves, plus the P4 leaf states. Binds through
/// ``TreeSelectModel`` (P1/S8); no networking lives here.
public struct TreeSelect: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = TreeSelectMeta.surfaceSlug

    @State private var model: TreeSelectModel
    private let maxHeight: CGFloat

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8 source
    /// through it; previews + tests inject an in-memory source).
    public init(model: TreeSelectModel, maxHeight: CGFloat = TreeSelectMeta.defaultMaxBodyHeight) {
        _model = State(initialValue: model)
        self.maxHeight = maxHeight
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting `<TreeSelect
    /// groups={…} selectedIds={…} onChange={…} searchValue={…} onSearchChange={…} … />`. Wires a
    /// `LiveTreeSelectSource` over the snapshot and forwards selection / search / expansion edits.
    public init(
        groups: [TreeSelectGroup],
        selectedIDs: [String],
        searchValue: String,
        expandedGroupIDs: [String]? = nil,
        ariaLabel: String? = nil,
        searchPrompt: String? = nil,
        emptyText: String? = nil,
        noResultsText: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TreeSelectConnection = .live,
        maxHeight: CGFloat = TreeSelectMeta.defaultMaxBodyHeight,
        telemetry: any TreeSelectTelemetry = OSLogTreeSelectTelemetry(),
        announcer: any TreeSelectAnnouncer = LiveTreeSelectAnnouncer(),
        onChange: @escaping @MainActor ([String]) -> Void,
        onSearchChange: @escaping @MainActor (String) -> Void,
        onExpandedChange: (@MainActor ([String]) -> Void)? = nil
    ) {
        let snapshot = TreeSelectSnapshot(
            groups: groups,
            selectedIDs: selectedIDs,
            searchValue: searchValue,
            expandedGroupIDs: expandedGroupIDs,
            ariaLabel: ariaLabel,
            searchPrompt: searchPrompt,
            emptyText: emptyText,
            noResultsText: noResultsText,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
        let source = LiveTreeSelectSource(
            value: snapshot,
            onChangeSelection: onChange,
            onChangeSearch: onSearchChange,
            onChangeExpanded: onExpandedChange
        )
        _model = State(initialValue: TreeSelectModel(source: source, telemetry: telemetry, announcer: announcer))
        self.maxHeight = maxHeight
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                TreeSelectFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            TreeSelectLoadingView()
        case let .error(message):
            TreeSelectErrorView(message: message) { model.refresh() }
        case .ready:
            TreeSelectReadyView(model: model, maxHeight: maxHeight)
        }
    }
}
