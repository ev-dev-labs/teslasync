//
//  SpeedGearPanel.Previews.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  Xcode previews for each surface state (content / partial / mph / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SpeedGearPreviewData {
        static let reading = SpeedGearMotorReading(shiftState: "D", powerKW: 142.6)

        /// A fleet of drives with varied SI speeds so the average + top differ visibly.
        static let drives: [SpeedGearDriveSample] = [
            SpeedGearDriveSample(avgSpeedMps: 13.4, maxSpeedMps: 31.2),
            SpeedGearDriveSample(avgSpeedMps: 18.1, maxSpeedMps: 38.6),
            SpeedGearDriveSample(avgSpeedMps: 9.7, maxSpeedMps: 22.4)
        ]

        /// Sparse snapshot: parked, power absent (→ em-dash), a single drive with a missing average.
        static let partialReading = SpeedGearMotorReading(shiftState: "P", powerKW: nil)
        static let partialDrives: [SpeedGearDriveSample] = [
            SpeedGearDriveSample(avgSpeedMps: nil, maxSpeedMps: 16.0)
        ]
    }

    @MainActor
    private func previewModel(_ update: SpeedGearUpdate) -> SpeedGearPanelModel {
        let source = InMemorySpeedGearSource(initial: update)
        let model = SpeedGearPanelModel(source: source)
        model.start()
        return model
    }

    #Preview("Content") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .loaded,
            reading: SpeedGearPreviewData.reading,
            drives: SpeedGearPreviewData.drives
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Partial") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .loaded,
            reading: SpeedGearPreviewData.partialReading,
            drives: SpeedGearPreviewData.partialDrives
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · mph") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .loaded,
            reading: SpeedGearPreviewData.reading,
            drives: SpeedGearPreviewData.drives,
            units: SpeedGearUnitPrefs(speed: .milesPerHour)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(status: .empty)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .failed("Network request timed out")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .loaded,
            connection: .stale,
            reading: SpeedGearPreviewData.reading,
            drives: SpeedGearPreviewData.drives
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SpeedGearPanel(model: previewModel(SpeedGearUpdate(
            status: .loaded,
            connection: .offline,
            reading: SpeedGearPreviewData.reading,
            drives: SpeedGearPreviewData.drives
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
