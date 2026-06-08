//
//  QuickMetrics.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  The composable charging-list "Quick Metrics" strip — the SwiftUI parity of
//  features/charging/components/charging-list/QuickMetrics.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-3 sm:p-5">`) fading in on appear,
//  and switches over the bound model's phase so every prompt-required state renders (loading /
//  empty / error / stale / offline / content) — never a blank box. Binds through
//  `QuickMetricsModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable charging Quick Metrics strip — the SwiftUI parity of the web `QuickMetrics`,
/// binding through `QuickMetricsModel` (P1/S8).
public struct QuickMetrics: View {
    @State private var model: QuickMetricsModel

    public init(model: QuickMetricsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.connection != .live {
                    HStack(spacing: TSSpacing.sm) {
                        Spacer(minLength: 0)
                        QuickMetricsFreshnessChip(connection: model.connection)
                    }
                    QuickMetricsConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
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

    /// The web `stats ? <grid> : <EmptyState>` branch, widened to the full load envelope
    /// (loading / error / empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            QuickMetricsLoading()
        case let .error(message):
            QuickMetricsError(message: message) { model.refresh() }
        case .empty:
            QuickMetricsEmpty()
        case .content:
            QuickMetricsGrid(metrics: model.metrics)
        }
    }
}
