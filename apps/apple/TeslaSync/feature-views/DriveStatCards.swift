//
//  DriveStatCards.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  The composable drive-detail "stat cards" feature view — the SwiftUI parity of
//  features/driving/components/drive-detail/DriveStatCards.tsx. Renders every state from the
//  web shell (loading / empty / error / stale / offline / content) around the eight always-on
//  tiles (Distance, Duration, Max Speed, Avg Speed, SOC, Max Power, Elev. Gain, Elev. Loss)
//  plus the two conditional cost tiles (Trip Cost, Cost / unit), bound through
//  `DriveStatCardsModel` (P1/S8). No networking lives here; the freshness chip + banner
//  reflect the bound source's live-state.
//

import SwiftUI

/// The composable drive-detail stat-cards surface — the SwiftUI parity of
/// `features/driving/components/drive-detail/DriveStatCards.tsx`, binding through
/// `DriveStatCardsModel` (P1/S8). No networking lives here.
public struct DriveStatCards: View {
    @State private var model: DriveStatCardsModel

    public init(model: DriveStatCardsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                DriveStatCardsConnectivityBanner(connection: model.connection)
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

private extension DriveStatCards {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            DriveStatCardsFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension DriveStatCards {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            DriveStatCardsSkeleton()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DriveStatCardsGrid(cards: model.cards)
                DriveStatCardsEmptyHint()
            }
        case let .error(message):
            DriveStatCardsErrorState(message: message) { model.refresh() }
        case .content:
            DriveStatCardsGrid(cards: model.cards)
        }
    }
}
