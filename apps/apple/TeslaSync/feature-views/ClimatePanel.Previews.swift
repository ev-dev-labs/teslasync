//
//  ClimatePanel.Previews.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  Xcode previews for each surface state (loading / content-active / content-idle / content-°F /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: CabinClimatePanelUpdate) -> CabinClimatePanelModel {
        let source = InMemoryCabinClimatePanelSource(initial: update)
        let model = CabinClimatePanelModel(source: source)
        model.start()
        return model
    }

    private let activeSnapshot = CabinClimatePanelSnapshot(
        insideTempC: 21.5,
        outsideTempC: 8.0,
        driverSetpointC: 22.0,
        passengerSetpointC: 21.0,
        hvacState: "On",
        defrostMode: "Front",
        isClimateOn: true,
        isPreconditioning: true,
        fanStatus: 4
    )

    private let idleSnapshot = CabinClimatePanelSnapshot(
        insideTempC: 14.0,
        outsideTempC: nil,
        driverSetpointC: 20.0,
        passengerSetpointC: nil,
        hvacState: nil,
        defrostMode: "Off",
        isClimateOn: false,
        isPreconditioning: false,
        fanStatus: 0
    )

    #Preview("Loading") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(status: .loading)))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content — active") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: activeSnapshot
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — idle") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: idleSnapshot
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — Fahrenheit") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .loaded,
            connection: .live,
            snapshot: activeSnapshot,
            prefs: CabinClimatePanelUnitPrefs(temperature: .fahrenheit)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(status: .empty, snapshot: nil)))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .failed("Tesla API returned 503 Service Unavailable"),
            snapshot: nil
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .loaded,
            connection: .stale,
            snapshot: activeSnapshot
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ClimatePanel(model: previewModel(CabinClimatePanelUpdate(
            status: .loaded,
            connection: .offline,
            snapshot: idleSnapshot
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
