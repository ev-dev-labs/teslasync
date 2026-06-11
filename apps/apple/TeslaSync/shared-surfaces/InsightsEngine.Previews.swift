//
//  InsightsEngine.Previews.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  Xcode previews for each surface state (ready, loading, empty, error, stale, offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. The ready sample
//  exercises all eight analyzers so the full grid renders.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: InsightsEngineInput) -> InsightsEngineModel {
        let source = InMemoryInsightsEngineSource(initial: input)
        let model = InsightsEngineModel(source: source, calendar: .current)
        model.start()
        return model
    }

    private func sampleData() -> InsightsEngineData {
        let now = Date(timeIntervalSince1970: 1_717_000_000)
        let day: TimeInterval = 86400
        return InsightsEngineData(
            drives: [
                InsightsEngineDrive(distanceM: 10000, energyUsedWh: 1500, startTs: now),
                InsightsEngineDrive(distanceM: 12000, energyUsedWh: 1700, startTs: now - day),
                InsightsEngineDrive(distanceM: 11000, energyUsedWh: 2000, startTs: now - 2 * day),
                InsightsEngineDrive(distanceM: 9000, energyUsedWh: 1800, startTs: now - 3 * day)
            ],
            chargingSessions: [
                InsightsEngineCharging(cost: 5.0, chargeEnergyAdded: 40, fastChargerType: nil, endBatteryLevel: 70),
                InsightsEngineCharging(cost: 6.0, chargeEnergyAdded: 45, fastChargerType: nil, endBatteryLevel: 75),
                InsightsEngineCharging(
                    cost: 12.0,
                    chargeEnergyAdded: 30,
                    fastChargerType: "supercharger",
                    endBatteryLevel: 90
                )
            ],
            energyStats: InsightsEngineEnergyStats(
                totalEnergyUsedKwh: 500,
                totalDistanceKm: 3000,
                totalCost: 60,
                co2SavedKg: 400,
                avgEfficiencyWhKm: 160
            ),
            batteryReport: InsightsEngineBatteryReport(
                healthScore: 92,
                currentCapacityPct: 94,
                degradationPct: 6,
                monthlyTrend: [
                    InsightsEngineBatteryTrendPoint(capacityPct: 96),
                    InsightsEngineBatteryTrendPoint(capacityPct: 94)
                ],
                estimatedRangeNewKm: 500,
                estimatedRangeCurrentKm: 470
            ),
            vampireDrainStats: InsightsEngineVampireDrain(
                avgDrainRate: 0.8,
                totalRangeLost: 25.4,
                avgSentryDrain: 1.2,
                avgNosentryDrain: 0.9,
                eventCount: 14
            )
        )
    }

    private func readyInput(connection: InsightsEngineConnection = .live) -> InsightsEngineInput {
        InsightsEngineInput(load: .loaded(sampleData()), connection: connection)
    }

    #Preview("Ready") {
        ScrollView { InsightsEngine(model: previewModel(readyInput())).padding() }
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        InsightsEngine(model: previewModel(InsightsEngineInput(load: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        InsightsEngine(model: previewModel(InsightsEngineInput(load: .loaded(InsightsEngineData()))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        InsightsEngine(model: previewModel(InsightsEngineInput(load: .failed("Network request timed out"))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView { InsightsEngine(model: previewModel(readyInput(connection: .stale))).padding() }
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView { InsightsEngine(model: previewModel(readyInput(connection: .offline))).padding() }
            .background(Color.TS.bg)
    }
#endif
