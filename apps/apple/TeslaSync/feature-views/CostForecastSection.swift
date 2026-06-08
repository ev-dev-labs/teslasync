//
//  CostForecastSection.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  The cost-forecast section — the SwiftUI parity of the web
//  features/charging/components/cost-analysis/CostForecastSection.tsx. Renders the
//  two stacked glass panels it owns (the "Cost Forecast" composed chart with its
//  95%-confidence band, and the "Cost per kWh Trend" line chart) and every state
//  (loading / loaded / per-panel empty / error / stale / offline), binding through
//  `CostForecastModel` (P1/S8). No networking lives here — the web section takes
//  `forecastData` as a prop; the native model is fed by a `CostForecastSource`.
//
//  Scope note: the web component also composes `<ForecastDetails forecastData=… />`
//  between the two charts. That is a sibling surface with its OWN prompt (the
//  cost-analysis `ForecastDetails`); the parent cost-analysis page composes it
//  alongside this surface. None of its i18n keys belong to this prompt, so it is
//  intentionally out of scope here (per "Out of Scope: other surfaces in the same
//  feature").
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension CostForecastStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - CostForecastSection (the feature surface)

/// The cost-forecast section. Switches over the model's render phase and, in the
/// loaded phase, composes the two chart panels (each self-empties rather than
/// hiding, matching the web) below an optional freshness banner.
public struct CostForecastSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CostForecastSection"

    @State private var model: CostForecastModel

    /// - Parameter model: the bound view-model (built over a `CostForecastSource`).
    public init(model: CostForecastModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(CostForecastStrings.text("costAnalysis.forecast.a11y", "Charging cost forecast"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            CostForecastSkeleton()
        case let .error(message):
            CostForecastErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                CostForecastFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            ForecastChartPanel(
                chart: model.forecastChart,
                hasForecast: model.hasForecast,
                localize: model.localize,
                formatting: model.formatting
            )
            CostPerKwhPanel(
                points: model.costPerKwhPoints,
                upperBound: model.costPerKwhUpperBound,
                hasTrend: model.hasCostPerKwhTrend,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }
}
