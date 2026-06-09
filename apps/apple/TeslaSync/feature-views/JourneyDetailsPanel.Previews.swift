//
//  JourneyDetailsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  Xcode previews for each surface state (content-address / content-coordinate / in-progress / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: JourneyDetailsUpdate) -> JourneyDetailsModel {
        let source = InMemoryJourneyDetailsSource(initial: update)
        let model = JourneyDetailsModel(source: source)
        model.start()
        return model
    }

    private let previewPrefs = JourneyFormatPrefs(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles",
        decimalPrecision: 2
    )

    /// A finished drive with full street addresses (2024-12-06 ~14:30 PST).
    private func addressDrive() -> JourneyDriveDTO {
        let start = Date(timeIntervalSince1970: 1_733_500_200)
        return JourneyDriveDTO(
            startAddress: "1 Infinite Loop, Cupertino",
            startTimestamp: start,
            startBatteryPercent: 82,
            endAddress: "Tesla HQ, Austin",
            endTimestamp: start.addingTimeInterval(2400),
            endBatteryPercent: 64
        )
    }

    /// A finished drive with no addresses — renders the lat/lon coordinate lines.
    private func coordinateDrive() -> JourneyDriveDTO {
        let start = Date(timeIntervalSince1970: 1_733_500_200)
        return JourneyDriveDTO(
            startLatitude: 37.3318,
            startLongitude: -122.0312,
            startTimestamp: start,
            startBatteryPercent: 80,
            endLatitude: -33.8688,
            endLongitude: 151.2093,
            endTimestamp: start.addingTimeInterval(2400),
            endBatteryPercent: 61
        )
    }

    /// An in-progress drive (no end timestamp / address) — destination falls back to "In progress".
    private func inProgressDrive() -> JourneyDriveDTO {
        JourneyDriveDTO(
            startAddress: "1 Infinite Loop, Cupertino",
            startTimestamp: Date(timeIntervalSince1970: 1_733_500_200),
            startBatteryPercent: 90
        )
    }

    private func loadedUpdate(
        drive: JourneyDriveDTO,
        connection: JourneyConnection = .live
    ) -> JourneyDetailsUpdate {
        JourneyDetailsUpdate(
            status: .loaded,
            connection: connection,
            drive: drive,
            prefs: previewPrefs,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: JourneyDetailsUpdate) -> some View {
        ScrollView {
            JourneyDetailsPanel(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (addresses)") {
        previewSurface(loadedUpdate(drive: addressDrive()))
    }

    #Preview("Content (coordinates)") {
        previewSurface(loadedUpdate(drive: coordinateDrive()))
    }

    #Preview("In progress") {
        previewSurface(loadedUpdate(drive: inProgressDrive()))
    }

    #Preview("Empty") {
        previewSurface(JourneyDetailsUpdate(status: .empty, drive: nil))
    }

    #Preview("Loading") {
        previewSurface(JourneyDetailsUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(JourneyDetailsUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(drive: addressDrive(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(drive: addressDrive(), connection: .offline))
    }
#endif
