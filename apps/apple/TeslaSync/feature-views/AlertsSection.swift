//
//  AlertsSection.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  The composable "Alerts" surface — the SwiftUI parity of
//  features/analytics/components/weekly-digest/AlertsSection.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="space-y-6 p-6">`) fading
//  in on appear (web `<FadeIn delay={0.25}>`), and switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `AlertsSectionModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable weekly-digest Alerts section — the SwiftUI parity of the web
/// `AlertsSection`, binding through `AlertsSectionModel` (P1/S8).
public struct AlertsSection: View {
    @State private var model: AlertsSectionModel

    public init(model: AlertsSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.25) {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                AlertsHeader(total: model.total, connection: model.connection)
                if model.connection != .live {
                    AlertsConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `alertTotal === 0 ? <EmptyState> : <grid>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AlertsLoading()
        case let .error(message):
            AlertsError(message: message) { model.refresh() }
        case .empty:
            AlertsEmpty()
        case .content:
            AlertsContent(data: model.data)
        }
    }
}
