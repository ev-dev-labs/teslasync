//
//  TirePressureSection.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  The composable drive-detail "Tire Pressure During Drive" surface — the SwiftUI
//  parity of features/driving/components/drive-detail/TirePressureSection.tsx. Renders
//  inside a GlassPanel-equivalent card fading in on appear (web `ChartContainer` +
//  `FadeIn`), and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box.
//  Binds through `TirePressureSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable drive-detail Tire Pressure chart — the SwiftUI parity of the web
/// `TirePressureSection`, binding through `TirePressureSectionModel` (P1/S8).
public struct TirePressureSection: View {
    @State private var model: TirePressureSectionModel

    public init(model: TirePressureSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TPSectionHeader(connection: model.connection)
                if model.connection != .live {
                    TPSectionConnectivityBanner(connection: model.connection)
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

    /// The web `stats.hasTirePressure ? <tiles + chart> : <empty>` branch, widened to
    /// the full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TPSectionLoading()
        case let .error(message):
            TPSectionError(message: message) { model.refresh() }
        case .empty:
            TPSectionEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TPSectionStatGrid(projection: model.projection, locale: model.displayLocale)
                TPSectionLineChart(
                    projection: model.projection,
                    locale: model.displayLocale,
                    summary: model.accessibilitySummary
                )
                TPSectionLegend(
                    wheels: model.projection.presentWheels,
                    unitSymbol: model.projection.unitSymbol
                )
            }
        }
    }
}
