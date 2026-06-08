//
//  HeroGauges.Previews.swift
//  TeslaSync — P4 feature view · 0103 · HeroGauges (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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

    private func previewStats() -> ChargingStatsDTO {
        ChargingStatsDTO(
            count: 42,
            totalEnergy: 318.6,
            totalCost: 87.4,
            avgPower: 48.2,
            avgCostPerKwh: 0.274
        )
    }

    private func loadedUpdate(connection: HeroConnection = .live) -> HeroGaugesUpdate {
        HeroGaugesUpdate(
            status: .loaded,
            connection: connection,
            stats: previewStats(),
            units: HeroUnitPrefs(),
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

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (euro)") {
        previewSurface(
            HeroGaugesUpdate(
                status: .loaded,
                stats: previewStats(),
                units: HeroUnitPrefs(currencySymbol: "€", localeIdentifier: "de_DE"),
                updatedAt: Date()
            )
        )
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
