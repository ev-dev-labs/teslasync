//
//  CostSummaryCards.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  The composable charging "Cost Summary" feature view — the SwiftUI parity of
//  features/charging/components/cost-analysis/CostSummaryCards.tsx. Renders every state from
//  the web shell (loading / empty / error / stale / offline / content) around the six cost
//  summary tiles (Total Cost, Avg $/kWh, Cost Per Mile/km, Total Energy, Gas Savings,
//  Savings %), bound through `CostSummaryModel` (P1/S8). No networking lives here; the
//  freshness chip + banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable charging Cost Summary surface — the SwiftUI parity of
/// `features/charging/components/cost-analysis/CostSummaryCards.tsx`, binding through
/// `CostSummaryModel` (P1/S8). No networking lives here.
public struct CostSummaryCards: View {
    @State private var model: CostSummaryModel

    public init(model: CostSummaryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                CostConnectivityBanner(connection: model.connection)
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

private extension CostSummaryCards {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            CostFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension CostSummaryCards {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            CostCardsSkeleton()
        case .empty:
            TSStaggerContainer(spacing: TSSpacing.md) {
                CostCardsGrid(cards: model.cards)
                CostEmptyHint()
            }
        case let .error(message):
            CostErrorState(message: message) { model.refresh() }
        case .content:
            TSStaggerContainer(spacing: TSSpacing.md) {
                CostCardsGrid(cards: model.cards)
            }
        }
    }
}
