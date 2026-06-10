//
//  SignalStatsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  Xcode previews for each surface state (data / data-with-empty-rows / loading /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SignalStatsPreviewData {
        static let stats: [SignalStat] = [
            SignalStat(signal: "VehicleSpeed", min: 0, max: 112.4, avg: 47.21, sampleCount: 8421),
            SignalStat(signal: "BatteryLevel", min: 18, max: 82, avg: 54.6, sampleCount: 1980),
            SignalStat(signal: "ChargeRate", min: -3.2, max: 11.0, avg: 2.45, sampleCount: 640)
        ]

        /// One selected signal has no samples in range → an em-dash "no data" row.
        static let selected = ["VehicleSpeed", "BatteryLevel", "ChargeRate", "TpmsFrontLeft"]
    }

    @MainActor
    private func previewModel(_ input: SignalStatsInput) -> SignalStatsModel {
        let source = InMemorySignalStatsSource(initial: input)
        let model = SignalStatsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(stats: SignalStatsPreviewData.stats)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · empty rows") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(
            stats: SignalStatsPreviewData.stats,
            selectedSignals: SignalStatsPreviewData.selected
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(stats: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(
            stats: SignalStatsPreviewData.stats,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SignalStatsPanel(model: previewModel(SignalStatsInput(
            stats: SignalStatsPreviewData.stats,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
