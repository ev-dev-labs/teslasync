//
//  PatternsSlide.Previews.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / content / stale / offline) and
//  both unit preferences. DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func patternsPreviewModel(_ update: PatternsUpdate) -> PatternsSlideModel {
        let source = InMemoryPatternsReviewSource(initial: update)
        let model = PatternsSlideModel(source: source)
        model.start()
        return model
    }

    private let patternsSampleStats = PatternsReviewDTO(
        avgDistancePerDriveKm: 42.6,
        avgEfficiencyWhKm: 174.0,
        mostActiveHour: 18,
        mostActiveDayOfWeek: "Saturday",
        avgDrivesPerWeek: 9.4
    )

    private let patternsMilesUnits = PatternsUnitPrefs(distance: .miles, localeIdentifier: "en_US")
    private let patternsKmUnits = PatternsUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")

    #Preview("Content (miles)") {
        PatternsSlide(
            model: patternsPreviewModel(
                PatternsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: patternsSampleStats,
                    units: patternsMilesUnits,
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Content (kilometres)") {
        PatternsSlide(
            model: patternsPreviewModel(
                PatternsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: patternsSampleStats,
                    units: patternsKmUnits,
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Loading") {
        PatternsSlide(
            model: patternsPreviewModel(PatternsUpdate(status: .loading, stats: nil))
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Empty") {
        PatternsSlide(
            model: patternsPreviewModel(PatternsUpdate(status: .loaded, stats: nil))
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Error") {
        PatternsSlide(
            model: patternsPreviewModel(
                PatternsUpdate(status: .failed("Network unavailable"), stats: nil)
            )
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Stale (cached)") {
        PatternsSlide(
            model: patternsPreviewModel(
                PatternsUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    stats: patternsSampleStats,
                    units: patternsMilesUnits,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 420, height: 720)
    }

    #Preview("Offline (cached)") {
        PatternsSlide(
            model: patternsPreviewModel(
                PatternsUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: patternsSampleStats,
                    units: patternsKmUnits,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 420, height: 720)
    }
#endif
