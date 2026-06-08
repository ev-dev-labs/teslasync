//
//  ForecastDetails.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  The cost-forecast detail section — the SwiftUI parity of the web
//  features/charging/components/cost-analysis/ForecastDetails.tsx. Renders the three
//  glass panels (Charging Breakdown donut, Gas vs EV Savings, Insights) inside a
//  responsive grid (web `grid-cols-1 lg:grid-cols-3`) and every state (loading /
//  loaded / per-panel empty / error / stale / offline), binding through
//  `ForecastDetailsModel` (P1/S8). No networking lives here — the web component takes
//  `forecastData` as a prop; the native model is fed by a `ForecastSource`.
//

import SwiftUI

// MARK: - ForecastDetails (the feature surface)

/// The cost-forecast detail section. Switches over the model's render phase and, in
/// the loaded phase, composes the three panels (each self-empties rather than hiding,
/// matching the web) below an optional freshness banner.
public struct ForecastDetails: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ForecastDetails"

    @State private var model: ForecastDetailsModel

    private let columns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg, alignment: .top)]

    /// - Parameter model: the bound view-model (built over a `ForecastSource`).
    public init(model: ForecastDetailsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ForecastStrings.text("costAnalysis.forecast.a11y", "Charging cost forecast"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ForecastDetailsSkeleton()
        case let .error(message):
            ForecastErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                ForecastFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                TSFadeIn {
                    ForecastBreakdownPanel(
                        slices: model.breakdownSlices,
                        hasForecast: model.hasForecast,
                        localize: model.localize,
                        formatting: model.formatting
                    )
                }
                TSFadeIn(delay: 0.05) {
                    ForecastSavingsPanel(
                        savings: model.savings,
                        localize: model.localize,
                        formatting: model.formatting
                    )
                }
                TSFadeIn(delay: 0.10) {
                    ForecastInsightsPanel(
                        insights: model.insights,
                        localize: model.localize
                    )
                }
            }
        }
    }
}
