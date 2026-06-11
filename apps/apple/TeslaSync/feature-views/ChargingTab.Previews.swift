//
//  ChargingTab.Previews.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  Xcode previews for each surface state (content / content-empty-payload / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargingTabUpdate) -> ChargingTabModel {
        let source = InMemoryChargingTabSource(initial: update)
        let model = ChargingTabModel(source: source)
        model.start()
        return model
    }

    private func sampleAnalytics() -> ChargingTabAnalyticsInput {
        ChargingTabAnalyticsInput(
            totalSessions: 412,
            totalEnergyKwh: 8423.6,
            totalCost: 1187.42,
            powerStats: ChargingTabStatInput(avg: 32.4),
            durationStats: ChargingTabStatInput(avg: 47),
            efficiencyStats: ChargingTabStatInput(avg: 91.8),
            chargerTypes: [
                ChargingTabChargerTypeInput(type: "Supercharger", count: 184),
                ChargingTabChargerTypeInput(type: "Home (AC)", count: 142),
                ChargingTabChargerTypeInput(type: "Destination", count: 61),
                ChargingTabChargerTypeInput(type: "Public DC", count: 25)
            ],
            startBatteryDist: [
                ChargingTabBatteryBinInput(range: "0–10%", count: 12),
                ChargingTabBatteryBinInput(range: "10–20%", count: 48),
                ChargingTabBatteryBinInput(range: "20–40%", count: 121),
                ChargingTabBatteryBinInput(range: "40–60%", count: 138),
                ChargingTabBatteryBinInput(range: "60–80%", count: 71),
                ChargingTabBatteryBinInput(range: "80%+", count: 22)
            ],
            hourlyPattern: (0 ..< 24).map { hour in
                let intensity = Double(max(0, 10 - abs(hour - 22)))
                return ChargingTabHourlyPointInput(
                    hour: hour,
                    charges: intensity,
                    energy: intensity * 6.2
                )
            }
        )
    }

    private func loadedUpdate(connection: ChargingTabConnection = .live) -> ChargingTabUpdate {
        ChargingTabUpdate(
            status: .loaded,
            analytics: sampleAnalytics(),
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: ChargingTabUpdate) -> some View {
        ScrollView {
            ChargingTab(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Empty (resolved, no rows)") {
        previewSurface(ChargingTabUpdate(status: .loaded, analytics: ChargingTabAnalyticsInput()))
    }

    #Preview("Loading") {
        previewSurface(ChargingTabUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(ChargingTabUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
