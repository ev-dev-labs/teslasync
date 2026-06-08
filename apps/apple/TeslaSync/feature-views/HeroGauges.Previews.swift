//
//  HeroGauges.Previews.swift
//  TeslaSync — P4 feature view · 0058 · HeroGauges (Apple)
//
//  Xcode previews for each surface state (content km / content mi / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
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

    private func previewAnalytics() -> HeroAnalyticsDTO {
        HeroAnalyticsDTO(
            totalDistanceKm: 12863.4,
            totalDrives: 1234,
            totalEnergyKwh: 2945.6,
            totalCost: 412.5,
            avgEfficiencyWhKm: 165.0
        )
    }

    private func loadedUpdate(
        units: HeroUnitPrefs,
        connection: HeroConnection = .live
    ) -> HeroGaugesUpdate {
        HeroGaugesUpdate(
            status: .loaded,
            connection: connection,
            analytics: previewAnalytics(),
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

    #Preview("Content (km)") {
        previewSurface(loadedUpdate(units: HeroUnitPrefs(distance: .kilometers)))
    }

    #Preview("Content (mi)") {
        previewSurface(loadedUpdate(units: HeroUnitPrefs(distance: .miles, currencySymbol: "$")))
    }

    #Preview("Empty") {
        previewSurface(HeroGaugesUpdate(status: .empty, analytics: nil))
    }

    #Preview("Loading") {
        previewSurface(HeroGaugesUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(HeroGaugesUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(units: HeroUnitPrefs(distance: .kilometers), connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(units: HeroUnitPrefs(distance: .kilometers), connection: .offline))
    }
#endif
