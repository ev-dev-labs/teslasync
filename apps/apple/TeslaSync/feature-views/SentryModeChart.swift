//
//  SentryModeChart.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  The composable "Sentry Mode Activity" surface — the SwiftUI parity of
//  features/admin/components/security-access/SentryModeChart.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-4 mb-6">`) fading in
//  on appear (web `<FadeIn delay={0.2}>`), and switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `SentryModeChartModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable Sentry Mode Activity chart — the SwiftUI parity of the web
/// `SentryModeChart`, binding through `SentryModeChartModel` (P1/S8).
public struct SentryModeChart: View {
    @State private var model: SentryModeChartModel

    public init(model: SentryModeChartModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SentryModeHeader(connection: model.connection)
                if model.connection != .live {
                    SentryModeConnectivityBanner(connection: model.connection)
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

    /// The web `sentryBuckets.length > 0 ? <chart> : <EmptyState>` branch, widened
    /// to the full load envelope (loading / error / empty / content) so no state is
    /// hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SentryModeLoadingChart()
        case let .error(message):
            SentryModeError(message: message) { model.refresh() }
        case .empty:
            SentryModeEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                SentryModeBarChart(points: model.points, rows: model.rows)
                SentryModeLegend()
            }
        }
    }
}
