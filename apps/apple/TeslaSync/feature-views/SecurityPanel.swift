//
//  SecurityPanel.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  The composable SecurityPanel feature view — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/SecurityPanel.tsx. A glass panel
//  with the "Security" title and the security rows (lock badge, sentry chip, doors,
//  windows, user present, detail, remote start), binding through `SecurityPanelModel`
//  (P1/S8). No networking lives here. Reproduces every state from the web source —
//  the `hasData` content branch and the `EmptyState` — extended with the Apple HIG
//  states contract: a loading skeleton, a QueryError-equivalent failure with retry,
//  and a freshness chip + stale/offline banner that keep the last-known snapshot
//  visible while reconnecting (stale) or offline. Emits the P1/S11 `view.opened`
//  diagnostics event on appear.
//

import SwiftUI

/// The composable SecurityPanel surface — the SwiftUI parity of the web
/// `SecurityPanel`, binding through `SecurityPanelModel` (P1/S8). No networking lives
/// here.
public struct SecurityPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SecurityPanelSurface.slug
    }

    @State private var model: SecurityPanelModel

    public init(model: SecurityPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    SecurityPanelHeader(
                        connection: model.connection,
                        showsFreshness: model.showsFreshness
                    )
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SecurityPanelLoadingContent()
        case let .error(message):
            SecurityPanelErrorView(message: message) { model.refresh() }
        case .empty:
            SecurityPanelEmptyState()
        case .content:
            SecurityPanelContentView(
                content: model.content,
                connection: model.connection,
                onRefresh: { model.refresh() }
            )
        }
    }
}
