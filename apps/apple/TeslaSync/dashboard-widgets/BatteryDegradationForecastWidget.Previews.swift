//
//  BatteryDegradationForecastWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / empty /
//  loading / error / offline / stale). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: BatteryDegradationForecastUpdate) -> BatteryDegradationForecastModel {
        let source = InMemoryBatteryDegradationForecastSource(initial: update)
        let model = BatteryDegradationForecastModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = BatteryDegradationForecastVehicle(id: 7, displayName: "Lightning")

    /// A populated forecast: healthy-ish pack, a positive degradation rate, a
    /// projected 80% date ~3 years out, three risk factors and three
    /// recommendations.
    private func previewSnapshot(rate: Double = 0.11) -> BatteryDegradationForecastSnapshot {
        var components = DateComponents()
        components.year = 2027
        components.month = 4
        components.day = 1
        let projected = Calendar(identifier: .gregorian).date(from: components)
        return BatteryDegradationForecastSnapshot(
            currentHealthPct: 92.4,
            currentHealth: 91.0,
            degradationRatePctPerMonth: rate,
            projected80Date: projected,
            riskFactors: [
                BatteryDegradationForecastRiskFactor(
                    name: "High temperature exposure",
                    score: 8,
                    label: "Heat exposure",
                    detail: "Frequent charging above 35°C"
                ),
                BatteryDegradationForecastRiskFactor(
                    name: "DC fast charge ratio",
                    score: 5,
                    label: "Fast charging",
                    detail: "42% of sessions are Supercharger"
                ),
                BatteryDegradationForecastRiskFactor(
                    name: "Deep battery cycling",
                    score: 3,
                    label: "Depth of discharge",
                    detail: "Often discharged below 10%"
                )
            ],
            recommendations: [
                "Charge to 80% for daily driving to reduce calendar aging.",
                "Precondition in shade or a garage during summer months.",
                "Favor Level 2 home charging over frequent Supercharging."
            ]
        )
    }

    #Preview("Content (2×4)") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(
                    status: .loaded,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot(rate: 0.04),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(
                    status: .loaded,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot(rate: 0.2)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(status: .loaded, vehicle: previewVehicle, snapshot: .empty)
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BatteryDegradationForecastWidget(
            model: previewModel(BatteryDegradationForecastUpdate(status: .loading, snapshot: .empty))
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(status: .failed("Network unavailable"), snapshot: .empty)
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BatteryDegradationForecastWidget(
            model: previewModel(
                BatteryDegradationForecastUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    snapshot: previewSnapshot(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
