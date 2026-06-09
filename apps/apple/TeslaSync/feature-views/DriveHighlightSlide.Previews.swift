//
//  DriveHighlightSlide.Previews.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / content-km / content-mi / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveHighlightSlideUpdate) -> DriveHighlightSlideModel {
        let source = InMemoryDriveHighlightSlideSource(initial: update)
        let model = DriveHighlightSlideModel(source: source)
        model.start()
        return model
    }

    /// A long road-trip highlight: 412.5 km over 4h 47m at 168 Wh/km.
    private let sampleDrive = DriveHighlightReviewDTO(
        date: "July 15, 2024",
        distanceKm: 412.5,
        durationMin: 287,
        startAddress: "San Francisco, CA",
        endAddress: "Los Angeles, CA",
        efficiencyWhKm: 168
    )

    private let sampleLabel = "Longest Drive"
    private let sampleEmoji = "🏆"

    #Preview("Loading") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(status: .loading, drive: nil, label: sampleLabel, emoji: sampleEmoji)
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(status: .loaded, drive: nil, label: sampleLabel, emoji: sampleEmoji)
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(
                    status: .failed("The analytics service is unavailable (503)."),
                    drive: nil,
                    label: sampleLabel,
                    emoji: sampleEmoji
                )
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Content — km") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(
                    status: .loaded,
                    drive: sampleDrive,
                    label: sampleLabel,
                    emoji: sampleEmoji,
                    units: DriveHighlightSlideUnitPrefs(distance: .kilometers)
                )
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Content — mi") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(
                    status: .loaded,
                    drive: sampleDrive,
                    label: sampleLabel,
                    emoji: sampleEmoji,
                    units: DriveHighlightSlideUnitPrefs(distance: .miles)
                )
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    drive: sampleDrive,
                    label: sampleLabel,
                    emoji: sampleEmoji
                )
            )
        )
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DriveHighlightSlide(
            model: previewModel(
                DriveHighlightSlideUpdate(
                    status: .loaded,
                    connection: .offline,
                    drive: sampleDrive,
                    label: sampleLabel,
                    emoji: sampleEmoji
                )
            )
        )
        .background(Color.TS.bg)
    }
#endif
