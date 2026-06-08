//
//  DetailCards.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  The drivetrain-health "Detail Cards" feature view — the SwiftUI parity of the
//  web features/driving/components/drivetrain-health/DetailCards.tsx. Renders the
//  two cards ("Temperature Details" + "Power Summary") inside a fade-in, responsive
//  two-up grid, and every state (loading / loaded / empty / error / stale /
//  offline), binding through `DetailCardsModel` (P1/S8). No networking lives here —
//  the web component takes its data as props; the native model is fed by a
//  `DetailCardsSource`.
//

import SwiftUI

// MARK: - DetailCards (the feature surface)

/// The drivetrain detail-cards section. Switches over the model's render phase and,
/// in the loaded phase, shows an optional freshness banner above the cards; the
/// cards themselves always render (web parity — each row self-fills with an em dash
/// when a value is absent) rather than hiding.
public struct DetailCards: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DetailCards"

    @State private var model: DetailCardsModel

    /// - Parameter model: the bound view-model (built over a `DetailCardsSource`).
    public init(model: DetailCardsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: model.localize(
                "drivetrain.detailCards.a11y",
                "Drivetrain temperature and power details"
            )))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DetailCardsSkeleton(localize: model.localize)
        case let .error(message):
            DetailCardsErrorView(message: message, localize: model.localize) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                DetailCardsFreshnessBanner(connection: model.connection, localize: model.localize) {
                    model.refresh()
                }
            }
            TSFadeIn(delay: 0.4) {
                DetailCardsGrid {
                    DetailCardView(
                        title: model.localize("drivetrain.temperatures", "Temperature Details"),
                        rows: model.temperatureRows,
                        localize: model.localize
                    )
                    DetailCardView(
                        title: model.localize("drivetrain.powerSummary", "Power Summary"),
                        rows: model.powerRows,
                        localize: model.localize
                    )
                }
            }
        }
    }
}
