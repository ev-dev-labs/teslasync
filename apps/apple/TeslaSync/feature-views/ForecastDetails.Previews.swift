//
//  ForecastDetails.Previews.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  Xcode previews for each surface state (content / empty / no-insights / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope. The sample forecast here is also reused by the
//  unit tests' fixtures-by-hand, kept in lock-step with the web `CostForecastData`
//  shape.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative forecast for previews/tests (no network). Values are shaped like
    /// the web `CostForecastData` slice the section reads.
    enum ForecastDetailsSample {
        static let forecast = CostForecast(
            breakdown: ForecastBreakdown(
                home: ForecastCategory(pct: 68, avgCostPerKwh: 0.142, monthlyAvg: 41.20),
                supercharger: ForecastCategory(pct: 32, avgCostPerKwh: 0.392, monthlyAvg: 58.40)
            ),
            gasComparison: ForecastGasComparison(
                avgKmPerMonth: 1842,
                gasCostPerMonth: 246.50,
                evCostPerMonth: 58.90,
                monthlySavings: 187.60,
                annualSavings: 2251,
                lifetimeSavings: 33765
            ),
            insights: [
                "Charging overnight at home keeps your blended rate near $0.14/kWh.",
                "You save about $188/month versus an equivalent gasoline vehicle.",
                "Supercharging is 32% of sessions but a bigger share of cost — favor home top-ups for trips."
            ]
        )

        static let forecastNoInsights = CostForecast(
            breakdown: forecast.breakdown,
            gasComparison: forecast.gasComparison,
            insights: []
        )
    }

    @MainActor
    private func previewModel(_ update: ForecastUpdate) -> ForecastDetailsModel {
        let source = InMemoryForecastSource(initial: update)
        let model = ForecastDetailsModel(source: source)
        model.start()
        return model
    }

    private func previewShell(_ section: ForecastDetails) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 1100)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            ForecastDetails(
                model: previewModel(
                    ForecastUpdate(status: .loaded, forecast: ForecastDetailsSample.forecast, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty (loaded, no forecast)") {
        previewShell(
            ForecastDetails(model: previewModel(ForecastUpdate(status: .empty, forecast: nil, updatedAt: Date())))
        )
    }

    #Preview("No insights (partial)") {
        previewShell(
            ForecastDetails(
                model: previewModel(
                    ForecastUpdate(
                        status: .loaded,
                        forecast: ForecastDetailsSample.forecastNoInsights,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(ForecastDetails(model: previewModel(ForecastUpdate(status: .loading))))
    }

    #Preview("Error") {
        previewShell(
            ForecastDetails(model: previewModel(ForecastUpdate(status: .failed("Network unavailable"))))
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            ForecastDetails(
                model: previewModel(
                    ForecastUpdate(
                        status: .loaded,
                        connection: .stale,
                        forecast: ForecastDetailsSample.forecast,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            ForecastDetails(
                model: previewModel(
                    ForecastUpdate(
                        status: .loaded,
                        connection: .offline,
                        forecast: ForecastDetailsSample.forecast,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
