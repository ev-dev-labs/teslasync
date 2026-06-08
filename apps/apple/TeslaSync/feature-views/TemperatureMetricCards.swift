//
//  TemperatureMetricCards.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  The composable "Temperature Metric Cards" drivetrain-health feature view — the SwiftUI
//  parity of features/driving/components/drivetrain-health/TemperatureMetricCards.tsx. Renders
//  every state from the native shell (loading / empty / error / stale / offline / content)
//  around the six metric cards (four thermal sensors + Health Score + Peak Power), bound
//  through `TemperatureMetricCardsModel` (P1/S8). No networking lives here; the freshness chip
//  + banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Temperature Metric Cards drivetrain-health surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/TemperatureMetricCards.tsx`, binding through
/// `TemperatureMetricCardsModel` (P1/S8). No networking lives here.
public struct TemperatureMetricCards: View {
    @State private var model: TemperatureMetricCardsModel

    public init(model: TemperatureMetricCardsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                TemperatureConnectivityBanner(connection: model.connection)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Surface identity

public extension TemperatureMetricCards {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        TemperatureMetricCardsSurface.slug
    }
}

// MARK: - Header

private extension TemperatureMetricCards {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TemperatureFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension TemperatureMetricCards {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            TemperatureCardsSkeleton()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TemperatureCardsGrid(cards: model.cards)
                TemperatureEmptyHint()
            }
        case let .error(message):
            TemperatureErrorState(message: message) { model.refresh() }
        case .content:
            TemperatureCardsGrid(cards: model.cards)
        }
    }
}
