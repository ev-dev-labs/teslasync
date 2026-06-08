//
//  EnergySummaryPanel.Previews.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  Xcode previews for each surface state (data metric / data imperial / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EnergySummaryPreviewData {
        static let drive = EnergySummaryInputData(
            energyWh: 18450,
            regenWh: 3260,
            consumptionWhKm: 168,
            startRange: 412,
            endRange: 298,
            startBatteryPct: 86,
            endBatteryPct: 61
        )

        static let shortHop = EnergySummaryInputData(
            energyWh: 840,
            regenWh: 120,
            consumptionWhKm: 0,
            startRange: nil,
            endRange: nil,
            startBatteryPct: 74,
            endBatteryPct: nil
        )
    }

    @MainActor
    private func previewModel(_ input: EnergySummaryInput) -> EnergySummaryModel {
        let source = InMemoryEnergySummarySource(initial: input)
        let model = EnergySummaryModel(source: source)
        model.start()
        return model
    }

    #Preview("Data · Metric") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(
            data: EnergySummaryPreviewData.drive,
            measurementSystem: .metric
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · Imperial") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(
            data: EnergySummaryPreviewData.drive,
            measurementSystem: .imperial
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · Partial") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(
            data: EnergySummaryPreviewData.shortHop,
            measurementSystem: .metric
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(data: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(
            data: EnergySummaryPreviewData.drive,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EnergySummaryPanel(model: previewModel(EnergySummaryInput(
            data: EnergySummaryPreviewData.drive,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
