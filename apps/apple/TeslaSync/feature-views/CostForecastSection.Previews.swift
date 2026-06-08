//
//  CostForecastSection.Previews.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error /
//  stale / offline) plus the trend-only state (≥ 2 historical months but < 3, so
//  the forecast panel empties while the cost-per-kWh panel renders). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. The
//  sample slice here is shaped like the web `CostForecastData`.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative forecast slice for previews/tests (no network). Values are
    /// shaped like the web `CostForecastData` (`historical` + `forecast`).
    enum CostForecastSample {
        static let data = CostForecastData(
            historical: [
                CostHistoricalMonth(month: "Jan", cost: 41.20, costPerKwh: 0.142, kwh: 290, sessions: 22),
                CostHistoricalMonth(month: "Feb", cost: 37.90, costPerKwh: 0.138, kwh: 275, sessions: 19),
                CostHistoricalMonth(month: "Mar", cost: 52.40, costPerKwh: 0.151, kwh: 347, sessions: 27),
                CostHistoricalMonth(month: "Apr", cost: 47.10, costPerKwh: 0.147, kwh: 320, sessions: 24),
                CostHistoricalMonth(month: "May", cost: 55.00, costPerKwh: 0.158, kwh: 348, sessions: 29),
                CostHistoricalMonth(month: "Jun", cost: 50.30, costPerKwh: 0.153, kwh: 329, sessions: 26)
            ],
            forecast: [
                CostForecastMonth(month: "Jul", cost: 53.80, costLow: 47.20, costHigh: 60.40, kwh: 351),
                CostForecastMonth(month: "Aug", cost: 56.10, costLow: 48.10, costHigh: 64.10, kwh: 366),
                CostForecastMonth(month: "Sep", cost: 54.40, costLow: 45.90, costHigh: 62.90, kwh: 358)
            ]
        )

        /// Two historical months, no forecast: the forecast panel empties while the
        /// cost-per-kWh panel still renders (web `hasCostPerKwhTrend` but not
        /// `hasForecast`).
        static let trendOnly = CostForecastData(
            historical: [
                CostHistoricalMonth(month: "May", cost: 55.00, costPerKwh: 0.158, kwh: 348, sessions: 29),
                CostHistoricalMonth(month: "Jun", cost: 50.30, costPerKwh: 0.153, kwh: 329, sessions: 26)
            ]
        )
    }

    @MainActor
    private func previewModel(_ update: CostForecastUpdate) -> CostForecastModel {
        let source = InMemoryCostForecastSource(initial: update)
        let model = CostForecastModel(source: source)
        model.start()
        return model
    }

    private func previewShell(_ section: CostForecastSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 920)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            CostForecastSection(
                model: previewModel(
                    CostForecastUpdate(status: .loaded, data: CostForecastSample.data, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Trend only (no forecast)") {
        previewShell(
            CostForecastSection(
                model: previewModel(
                    CostForecastUpdate(status: .loaded, data: CostForecastSample.trendOnly, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty (loaded, no data)") {
        previewShell(
            CostForecastSection(
                model: previewModel(
                    CostForecastUpdate(status: .empty, data: CostForecastData(), updatedAt: Date())
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(
            CostForecastSection(model: previewModel(CostForecastUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        previewShell(
            CostForecastSection(
                model: previewModel(CostForecastUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            CostForecastSection(
                model: previewModel(
                    CostForecastUpdate(
                        status: .loaded,
                        connection: .stale,
                        data: CostForecastSample.data,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            CostForecastSection(
                model: previewModel(
                    CostForecastUpdate(
                        status: .loaded,
                        connection: .offline,
                        data: CostForecastSample.data,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
