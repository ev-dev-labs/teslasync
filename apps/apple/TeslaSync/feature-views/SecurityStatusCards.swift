//
//  SecurityStatusCards.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  The composable Security Status Cards surface — the SwiftUI parity of
//  features/admin/components/security-access/SecurityStatusCards.tsx. Renders the
//  six security cards (Lock / Sentry / Doors / Windows / HomeLink / Guest) bound
//  through `SecurityCardsModel` (P1/S8); no networking lives here. Reproduces every
//  state from the web source — loading (skeleton grid) and the resolved grid (which
//  the web renders with optional-chaining fallbacks when `latest` is undefined) —
//  extended with the Apple HIG states contract: a friendly empty grid, a
//  QueryError-equivalent failure state with retry, and a freshness chip + banner
//  that keep the last-known cards visible while reconnecting (stale) or offline.
//

import SwiftUI

/// The composable Security Status Cards surface — the SwiftUI parity of
/// `features/admin/components/security-access/SecurityStatusCards.tsx`, binding
/// through `SecurityCardsModel` (P1/S8). No networking lives here.
public struct SecurityStatusCards: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SecurityStatusCards"

    @State private var model: SecurityCardsModel

    public init(model: SecurityCardsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SecurityCardsLoadingGrid()
        case let .error(message):
            SecurityCardsErrorView(message: message) { model.refresh() }
        case .empty:
            resolvedGrid(isEmpty: true)
        case .content:
            resolvedGrid(isEmpty: false)
        }
    }

    /// The resolved card grid (web `FadeIn` → `grid`). When the source resolved with
    /// no event the same six cards render their optional-chaining fallbacks, topped
    /// with a friendly hint so the surface never reads as blank. The freshness chip +
    /// banner appear only when the bound source is not live, keeping the live grid as
    /// clean as the web source.
    private func resolvedGrid(isEmpty: Bool) -> some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.connection != .live {
                    HStack(spacing: TSSpacing.sm) {
                        Spacer(minLength: 0)
                        SecurityCardsFreshnessChip(connection: model.connection)
                    }
                    SecurityCardsConnectivityBanner(connection: model.connection)
                }
                SecurityCardsGrid(cards: model.cards)
                if isEmpty {
                    SecurityCardsEmptyHint()
                }
            }
        }
    }
}
