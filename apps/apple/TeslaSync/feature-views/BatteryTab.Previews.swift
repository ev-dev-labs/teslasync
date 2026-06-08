//
//  BatteryTab.Previews.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: BatteryTabUpdate) -> BatteryTabModel {
        let source = InMemoryBatteryTabSource(initial: update)
        let model = BatteryTabModel(source: source)
        model.start()
        return model
    }

    private func previewTrend() -> [BatteryTrendPointDTO] {
        (0 ..< 8).map { week in
            let step = Double(week)
            return BatteryTrendPointDTO(
                date: String(format: "2026-04-%02d", week + 1),
                healthScore: 99.1 - step * 0.6,
                capacityWh: 75000 - step * 350,
                degradationPct: 0.9 + step * 0.6,
                rangeKm: 505 - step * 6.5,
                cycleCount: 96 + step * 7.7
            )
        }
    }

    private func loadedUpdate(
        connection: BatteryConnection = .live,
        units: BatteryUnitPrefs = BatteryUnitPrefs()
    ) -> BatteryTabUpdate {
        BatteryTabUpdate(
            status: .loaded,
            connection: connection,
            trend: previewTrend(),
            units: units,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: BatteryTabUpdate) -> some View {
        ScrollView {
            BatteryTab(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (miles)") {
        previewSurface(loadedUpdate(units: BatteryUnitPrefs(distance: .miles)))
    }

    #Preview("Empty") {
        previewSurface(BatteryTabUpdate(status: .loaded, trend: []))
    }

    #Preview("Loading") {
        previewSurface(BatteryTabUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(BatteryTabUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
