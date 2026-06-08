//
//  StatHeroSlide.Previews.swift
//  TeslaSync — P4 feature view · 0068 · StatHeroSlide (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error / stale / offline) and
//  each field (distance / energy). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func statHeroPreviewModel(_ update: StatHeroSlideUpdate) -> StatHeroSlideModel {
        let source = InMemoryStatHeroSlideSource(initial: update)
        let model = StatHeroSlideModel(source: source)
        model.start()
        return model
    }

    private let statHeroSampleStats = StatHeroSlideStats(totalDistanceKm: 18540, totalEnergyKwh: 3120.6)
    private let statHeroSampleUnits = StatHeroSlideUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    #Preview("Distance (live, mi)") {
        StatHeroSlide(
            model: statHeroPreviewModel(
                StatHeroSlideUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: statHeroSampleStats,
                    units: statHeroSampleUnits,
                    field: .distance,
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Energy (live)") {
        StatHeroSlide(
            model: statHeroPreviewModel(
                StatHeroSlideUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: statHeroSampleStats,
                    units: statHeroSampleUnits,
                    field: .energy,
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Loading") {
        StatHeroSlide(
            model: statHeroPreviewModel(StatHeroSlideUpdate(status: .loading, stats: nil))
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Empty") {
        StatHeroSlide(
            model: statHeroPreviewModel(StatHeroSlideUpdate(status: .loaded, stats: nil))
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Error") {
        StatHeroSlide(
            model: statHeroPreviewModel(
                StatHeroSlideUpdate(status: .failed("Network unavailable"), stats: nil)
            )
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Stale (km)") {
        StatHeroSlide(
            model: statHeroPreviewModel(
                StatHeroSlideUpdate(
                    status: .loaded,
                    connection: .stale,
                    stats: statHeroSampleStats,
                    units: StatHeroSlideUnitPrefs(distance: .kilometers),
                    field: .distance,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 390, height: 640)
    }

    #Preview("Offline (cached)") {
        StatHeroSlide(
            model: statHeroPreviewModel(
                StatHeroSlideUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: statHeroSampleStats,
                    units: statHeroSampleUnits,
                    field: .energy,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 390, height: 640)
    }
#endif
