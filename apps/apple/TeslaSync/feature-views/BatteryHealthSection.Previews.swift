//
//  BatteryHealthSection.Previews.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  Xcode previews for each surface state (loading / data / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: BatteryHealthInput) -> BatteryHealthModel {
        let source = InMemoryBatteryHealthSource(initial: input)
        let model = BatteryHealthModel(source: source)
        model.start()
        return model
    }

    private let previewMetrics = BatteryHealthMetrics(
        batteryStart: 42.4,
        batteryEnd: 78.9,
        chargingSessionCount: 5,
        chargeEnergyAdded: 142.5
    )

    private let lowMetrics = BatteryHealthMetrics(
        batteryStart: 12.2,
        batteryEnd: 47.6,
        chargingSessionCount: 2,
        chargeEnergyAdded: 38.0
    )

    private let emptyMetrics = BatteryHealthMetrics(
        batteryStart: 0,
        batteryEnd: 0,
        chargingSessionCount: 0,
        chargeEnergyAdded: 0
    )

    #Preview("Loading") {
        BatteryHealthSection(model: previewModel(BatteryHealthInput(isLoading: true, isFetching: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        BatteryHealthSection(model: previewModel(BatteryHealthInput(metrics: previewMetrics)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · low band") {
        BatteryHealthSection(model: previewModel(BatteryHealthInput(metrics: lowMetrics)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryHealthSection(model: previewModel(BatteryHealthInput(metrics: emptyMetrics)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryHealthSection(model: previewModel(
            BatteryHealthInput(errorMessage: "Drives request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BatteryHealthSection(model: previewModel(
            BatteryHealthInput(isFetching: true, metrics: previewMetrics, isStale: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        BatteryHealthSection(model: previewModel(
            BatteryHealthInput(metrics: previewMetrics, isOffline: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
