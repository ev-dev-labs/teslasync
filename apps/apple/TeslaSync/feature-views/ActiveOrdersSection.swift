//
//  ActiveOrdersSection.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  The composable settings "Active Orders" surface — the SwiftUI parity of
//  features/settings/components/ActiveOrdersSection.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-6 space-y-4">`) fading
//  in on appear (web `<FadeIn delay={0.045}>`), and switches over the bound model's
//  phase so every prompt-required state renders (loading / content / two empty
//  variants / error / stale / offline) — never a blank box. Binds through
//  `ActiveOrdersModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable settings "Active Orders" section — the SwiftUI parity of the web
/// `ActiveOrdersSection`, binding through `ActiveOrdersModel` (P1/S8).
public struct ActiveOrdersSection: View {
    @State private var model: ActiveOrdersModel

    public init(model: ActiveOrdersModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.045) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    OrdersHeader(
                        fetchedAt: model.fetchedAt,
                        connection: model.connection,
                        refreshing: model.refreshing,
                        onRefresh: { model.refresh() }
                    )
                    if model.connection != .live {
                        OrdersConnectivityBanner(connection: model.connection)
                    }
                    content
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `orders.length > 0 ? <grid> : <EmptyState …>` branch, widened to the
    /// full load envelope (loading / error) and the two empty messages so no state is
    /// hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            OrdersLoading()
        case .content:
            OrdersContent(rows: model.rows)
        case .emptyFetched:
            OrdersEmpty(hasFetchedAt: true)
        case .emptyNoData:
            OrdersEmpty(hasFetchedAt: false)
        case let .error(message):
            OrdersError(message: message) { model.retry() }
        }
    }
}
