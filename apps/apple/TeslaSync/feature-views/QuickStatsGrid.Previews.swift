//
//  QuickStatsGrid.Previews.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  Xcode previews for each surface state (data / imperial / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum QuickStatsPreviewData {
        /// A representative SI vehicle state: 82 %, 386 km rated range, 32 500 km odometer,
        /// 100 km/h, 21.5 °C inside / 14 °C outside, 42 kW draw.
        static let state = QuickStatsVehicleState(
            batteryLevel: 82,
            ratedRange: 386_000,
            odometer: 32_500_000,
            speed: 27.78,
            insideTemp: 21.5,
            outsideTemp: 14,
            power: 42
        )

        static let parkedState = QuickStatsVehicleState(
            batteryLevel: 47,
            ratedRange: 221_000,
            odometer: 51_200_000,
            speed: 0,
            insideTemp: 19,
            outsideTemp: 8.5,
            power: 0
        )
    }

    @MainActor
    private func previewModel(_ input: QuickStatsInput) -> QuickStatsModel {
        let source = InMemoryQuickStatsSource(initial: input)
        let model = QuickStatsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — metric") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(
            state: QuickStatsPreviewData.state,
            status: "driving",
            units: .metric
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — imperial / parked") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(
            state: QuickStatsPreviewData.parkedState,
            status: "parked",
            units: .imperial
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QuickStatsGrid(model: previewModel(QuickStatsInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(
            state: QuickStatsPreviewData.state,
            status: "driving",
            units: .metric,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        QuickStatsGrid(model: previewModel(QuickStatsInput(
            state: QuickStatsPreviewData.state,
            status: "online",
            units: .metric,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
