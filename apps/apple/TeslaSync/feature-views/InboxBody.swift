//
//  InboxBody.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The shared notification-log inbox — the SwiftUI parity of
//  features/notifications/components/InboxBody.tsx. Composes the filter summary,
//  the (ai-gated) categorization hand-off, the bulk-actions toolbar, and the
//  glass panel that holds the header chrome (select-all · count · grouped/flat
//  toggle · mark-all) and the list, rendering every state (loading / error /
//  empty / content) plus the native stale / offline freshness chrome. Binds
//  through `InboxBodyModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The shared notification-log inbox surface used by the Inbox tab
/// (`archived = false`) and the Archive tab (`archived = true`), binding through
/// `InboxBodyModel` (P1/S8). No networking lives here.
public struct InboxBody: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = InboxDiagnostics.surface

    @State private var model: InboxBodyModel

    /// - Parameter model: the bound view-model (built over an `InboxSource`).
    public init(model: InboxBodyModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSFadeIn(delay: 0.1) {
                InboxFilterSummaryBar(model: model)
            }
            if !model.selection.isEmpty {
                InboxBulkActionsToolbar(model: model)
            }
            panel
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.localize(
            "notifications.inbox.a11y.surface", "Notifications inbox"
        )))
    }

    private var panel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                InboxPanelHeader(model: model)
                if model.connection != .live {
                    InboxFreshnessBanner(
                        connection: model.connection,
                        localize: model.localize
                    ) { model.refresh() }
                }
                listContent
            }
        }
    }

    @ViewBuilder
    private var listContent: some View {
        switch model.listPhase {
        case .loading:
            InboxLoadingView(localize: model.localize)
        case let .error(message):
            InboxErrorView(message: message, localize: model.localize) { model.refresh() }
        case .empty:
            InboxEmptyView(model: model)
        case .content:
            InboxListView(model: model)
        }
    }
}
