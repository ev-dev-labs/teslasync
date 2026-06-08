//
//  DrivingPerformanceCards.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  The composable "Driving Performance" analytics feature view — the SwiftUI parity of
//  features/analytics/components/analytics/DrivingPerformanceCards.tsx. Renders every state
//  from the web shell (loading / empty / error / stale / offline / content) around the six
//  unit-aware metric tiles (Top Speed, Avg Speed, Peak Power, Peak Regen, Avg Drive
//  Distance, Longest Drive), bound through `DrivingPerformanceModel` (P1/S8). No networking
//  lives here; the freshness chip + banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable Driving Performance analytics surface — the SwiftUI parity of
/// `features/analytics/components/analytics/DrivingPerformanceCards.tsx`, binding through
/// `DrivingPerformanceModel` (P1/S8). No networking lives here.
public struct DrivingPerformanceCards: View {
    @State private var model: DrivingPerformanceModel

    public init(model: DrivingPerformanceModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                DrivingConnectivityBanner(connection: model.connection)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

private extension DrivingPerformanceCards {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            DrivingFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension DrivingPerformanceCards {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            DrivingCardsSkeleton()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCardsGrid(cards: model.cards)
                DrivingEmptyHint()
            }
        case let .error(message):
            DrivingErrorState(message: message) { model.refresh() }
        case .content:
            DrivingCardsGrid(cards: model.cards)
        }
    }
}
