//
//  DriveDetailHeader.Previews.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  Xcode previews for each surface state (content / finished / fallback / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveDetailHeaderUpdate) -> DriveDetailHeaderModel {
        let source = InMemoryDriveDetailHeaderSource(initial: update)
        let model = DriveDetailHeaderModel(source: source)
        model.start()
        return model
    }

    private func previewDrive(
        startAddress: String? = "1 Infinite Loop, Cupertino",
        endAddress: String? = "Tesla HQ, Austin",
        ended: Bool = true
    ) -> DriveHeaderDTO {
        let start = Date(timeIntervalSince1970: 1_733_500_200) // 2024-12-06 ~14:30 PST
        return DriveHeaderDTO(
            driveID: "8421",
            vehicleName: "Model 3",
            startAddress: startAddress,
            endAddress: endAddress,
            startTs: start,
            endTs: ended ? start.addingTimeInterval(2400) : nil
        )
    }

    private func loadedUpdate(
        drive: DriveHeaderDTO,
        connection: DriveHeaderConnection = .live
    ) -> DriveDetailHeaderUpdate {
        DriveDetailHeaderUpdate(
            status: .loaded,
            connection: connection,
            drive: drive,
            prefs: DriveHeaderFormatPrefs(localeIdentifier: "en_US", timeZoneIdentifier: "America/Los_Angeles"),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: DriveDetailHeaderUpdate) -> some View {
        ScrollView {
            DriveDetailHeader(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (finished)") {
        previewSurface(loadedUpdate(drive: previewDrive()))
    }

    #Preview("Content (in progress)") {
        previewSurface(loadedUpdate(drive: previewDrive(ended: false)))
    }

    #Preview("Fallback title") {
        previewSurface(loadedUpdate(drive: previewDrive(startAddress: nil, endAddress: nil)))
    }

    #Preview("Empty") {
        previewSurface(DriveDetailHeaderUpdate(status: .empty, drive: nil))
    }

    #Preview("Loading") {
        previewSurface(DriveDetailHeaderUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(DriveDetailHeaderUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(drive: previewDrive(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(drive: previewDrive(), connection: .offline))
    }
#endif
