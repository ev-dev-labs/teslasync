//
//  HeroGauges.Previews.swift
//  TeslaSync — P4 feature view · 0143 · HeroGauges (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline) plus
//  the metric/imperial unit variants and the no-efficiency four-gauge variant. DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: HeroGaugesUpdate) -> HeroGaugesModel {
        let source = InMemoryHeroGaugesSource(initial: update)
        let model = HeroGaugesModel(source: source)
        model.start()
        return model
    }

    private func previewStats(efficiency: Double? = 14.2) -> DriveGaugeStats {
        DriveGaugeStats(
            distanceM: 41840,
            durationS: 2220,
            maxSpeed: 118,
            consumptionWhKm: 168,
            efficiencyPctPer100: efficiency
        )
    }

    private func loadedUpdate(
        connection: HeroConnection = .live,
        units: HeroUnitPrefs = .metric,
        efficiency: Double? = 14.2
    ) -> HeroGaugesUpdate {
        HeroGaugesUpdate(
            status: .loaded,
            connection: connection,
            stats: previewStats(efficiency: efficiency),
            units: units,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: HeroGaugesUpdate) -> some View {
        ScrollView {
            HeroGauges(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (metric)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (imperial)") {
        previewSurface(loadedUpdate(units: .imperial))
    }

    #Preview("Content (no efficiency)") {
        previewSurface(loadedUpdate(efficiency: nil))
    }

    #Preview("Empty") {
        previewSurface(HeroGaugesUpdate(status: .empty, stats: nil))
    }

    #Preview("Loading") {
        previewSurface(HeroGaugesUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(HeroGaugesUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
