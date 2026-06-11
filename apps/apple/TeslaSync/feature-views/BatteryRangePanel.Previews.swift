//
//  BatteryRangePanel.Previews.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  Xcode previews for each surface state (loading / content-charging / content-idle / content-low /
//  content-imperial / empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: BatteryRangePanelUpdate) -> BatteryRangePanelModel {
        let source = InMemoryBatteryRangePanelSource(initial: update)
        let model = BatteryRangePanelModel(source: source)
        model.start()
        return model
    }

    private let chargingSnapshot = BatteryRangePanelSnapshot(
        batteryLevel: 82,
        ratedRangeMeters: 402_000,
        idealRangeMeters: 431_000,
        isCharging: true,
        chargeRateMeters: 48000,
        timeToFullChargeHours: 1.5
    )

    private let idleSnapshot = BatteryRangePanelSnapshot(
        batteryLevel: 47,
        ratedRangeMeters: 231_000,
        idealRangeMeters: 250_000,
        isCharging: false,
        chargeRateMeters: 0,
        timeToFullChargeHours: 0
    )

    private let lowSnapshot = BatteryRangePanelSnapshot(
        batteryLevel: 12,
        ratedRangeMeters: 58000,
        idealRangeMeters: 64000,
        isCharging: false,
        chargeRateMeters: 0,
        timeToFullChargeHours: 0
    )

    #Preview("Loading") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(status: .loading)))
            .frame(width: 480)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content — charging") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: chargingSnapshot
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — idle") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: idleSnapshot
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — low") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: lowSnapshot
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — imperial") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: chargingSnapshot,
            prefs: BatteryRangePanelUnitPrefs(distance: .miles)
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(status: .empty, snapshot: nil)))
            .frame(width: 480)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .failed("Tesla API returned 503 Service Unavailable"),
            snapshot: nil
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .stale,
            snapshot: chargingSnapshot
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        BatteryRangePanel(model: previewModel(BatteryRangePanelUpdate(
            status: .loaded,
            connection: .offline,
            snapshot: idleSnapshot
        )))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }
#endif
