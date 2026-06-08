//
//  ChargingDetailSection.Previews.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample analytics here are also reused by the
//  unit tests' fixtures-by-hand, kept in lock-step with the web shapes.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative analytics for previews/tests (no network). Values are shaped
    /// like the web `charging_analytics` slice.
    enum ChargingDetailSample {
        static let analytics = ChargingAnalytics(
            brands: [
                ChargerBrandDatum(brand: "Tesla", count: 1204),
                ChargerBrandDatum(brand: "Electrify America", count: 642),
                ChargerBrandDatum(brand: "ChargePoint", count: 318),
                ChargerBrandDatum(brand: "EVgo", count: 121)
            ],
            chargerTypes: [
                ChargerTypeDatum(type: "Supercharger", count: 980),
                ChargerTypeDatum(type: "Level 2", count: 410),
                ChargerTypeDatum(type: "CHAdeMO", count: 60),
                ChargerTypeDatum(type: "Level 1", count: 22)
            ],
            monthlyTrend: [
                MonthlyChargePoint(month: "Jan", energy: 312, avgPower: 48, sessions: 22, cost: 41.2),
                MonthlyChargePoint(month: "Feb", energy: 288, avgPower: 51, sessions: 19, cost: 37.9),
                MonthlyChargePoint(month: "Mar", energy: 401, avgPower: 62, sessions: 27, cost: 52.4),
                MonthlyChargePoint(month: "Apr", energy: 356, avgPower: 58, sessions: 24, cost: 47.1),
                MonthlyChargePoint(month: "May", energy: 422, avgPower: 66, sessions: 29, cost: 55.0),
                MonthlyChargePoint(month: "Jun", energy: 389, avgPower: 60, sessions: 26, cost: 50.3)
            ],
            costStats: CostStats(min: 1.2, avg: 8.43, median: 7.1, max: 24.9, p95: 19.8, count: 147)
        )
    }

    @MainActor
    private func previewModel(_ update: ChargingAnalyticsUpdate) -> ChargingDetailModel {
        let source = InMemoryChargingDetailSource(initial: update)
        let model = ChargingDetailModel(source: source)
        model.start()
        return model
    }

    private func previewShell(_ section: ChargingDetailSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 920)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            ChargingDetailSection(
                model: previewModel(
                    ChargingAnalyticsUpdate(
                        status: .loaded,
                        analytics: ChargingDetailSample.analytics,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty (loaded, no data)") {
        previewShell(
            ChargingDetailSection(
                model: previewModel(
                    ChargingAnalyticsUpdate(status: .empty, analytics: ChargingAnalytics(), updatedAt: Date())
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(
            ChargingDetailSection(model: previewModel(ChargingAnalyticsUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        previewShell(
            ChargingDetailSection(
                model: previewModel(ChargingAnalyticsUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            ChargingDetailSection(
                model: previewModel(
                    ChargingAnalyticsUpdate(
                        status: .loaded,
                        connection: .stale,
                        analytics: ChargingDetailSample.analytics,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            ChargingDetailSection(
                model: previewModel(
                    ChargingAnalyticsUpdate(
                        status: .loaded,
                        connection: .offline,
                        analytics: ChargingDetailSample.analytics,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
