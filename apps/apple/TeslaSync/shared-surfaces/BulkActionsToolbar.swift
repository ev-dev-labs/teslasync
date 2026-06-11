//
//  BulkActionsToolbar.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The bulk-action toolbar surface — the SwiftUI parity of
//  `web/src/components/data-display/BulkActionsToolbar.tsx`. The web component renders a sticky bar
//  at the top of a list-page content area when one or more rows are selected: a live count chip, an
//  optional noun (+ "of total"), one button per action (each with a per-action spinner and an
//  optional confirm gate), and a Clear button. It renders nothing while the selection is empty. The
//  native parity surface presents that same bar and adds the P4 leaf states so it never collapses to
//  a blank box. Binds through `BulkActionsToolbarModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton toolbar bar.
//    • empty    — no rows selected (web `count === 0` → `null`) → friendly empty state.
//    • error    — source feed failure → retry affordance (web `QueryError` peer).
//    • active   — the live count chip + optional noun, the action buttons (spinner / disabled /
//                 confirm), and the Clear button (the web toolbar body).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the bar with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - BulkActionsToolbar (the shared surface)

/// The bulk-action toolbar surface — the SwiftUI parity of `BulkActionsToolbar.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through `BulkActionsToolbarModel`.
public struct BulkActionsToolbar: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BulkActionsToolbar"

    @State private var model: BulkActionsToolbarModel

    public init(model: BulkActionsToolbarModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production selection source — the parity of the web
    /// `<BulkActionsToolbar>` mounting and waiting for the list page to push the first selection.
    public init() {
        _model = State(initialValue: BulkActionsToolbarModel(source: LiveBulkActionsToolbarSource()))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                BulkActionsFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .bulkActionsConfirmDialog(model: model)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BulkActionsLoadingView()
        case .empty:
            BulkActionsEmptyView()
        case let .error(message):
            BulkActionsErrorView(message: message) { model.refresh() }
        case .active:
            BulkActionsActiveView(
                resolved: model.resolved,
                onRun: { id in Task { await model.runAction(id) } },
                onClear: { model.clear() }
            )
        }
    }
}
