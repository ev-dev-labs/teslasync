//
//  MoreDetailsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline)
//  across metric + imperial unit preferences. DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MoreDetailsUpdate) -> MoreDetailsModel {
        let source = InMemoryMoreDetailsSource(initial: update)
        let model = MoreDetailsModel(source: source)
        model.start()
        return model
    }

    /// Representative computed drive aggregate (already in display units, the shape the web reads
    /// from `useDriveDetailData(...).stats` + `drive`).
    private func previewInput() -> MoreDetailsInput {
        MoreDetailsInput(
            odometerStart: 12345.0,
            odometerEnd: 12378.5,
            startRange: 412.0,
            endRange: 375.0,
            elevGain: 120.0,
            elevLoss: 85.0,
            energyWh: 6800.0,
            regenWh: 950.0,
            consumptionWhKm: 168.0,
            avgPower: 22.5,
            avgOutsideTemp: 14.0,
            avgInsideTemp: 21.5,
            minSpd: 8.0,
            startBatteryPct: 82,
            endBatteryPct: 68
        )
    }

    private func loadedUpdate(
        prefs: MoreDetailsUnitPrefs,
        connection: MoreDetailsConnection = .live
    ) -> MoreDetailsUpdate {
        MoreDetailsUpdate(
            status: .loaded,
            input: previewInput(),
            unitPrefs: prefs,
            connection: connection,
            updatedAt: Date()
        )
    }

    private let metricPrefs = MoreDetailsUnitPrefs(distance: "km", speed: "km/h", temperature: "°C", locale: "en-US")
    private let imperialPrefs = MoreDetailsUnitPrefs(distance: "mi", speed: "mph", temperature: "°F", locale: "en-US")

    @MainActor
    private func previewSurface(_ update: MoreDetailsUpdate) -> some View {
        ScrollView {
            MoreDetailsPanel(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · metric") {
        previewSurface(loadedUpdate(prefs: metricPrefs))
    }

    #Preview("Content · imperial") {
        previewSurface(loadedUpdate(prefs: imperialPrefs))
    }

    #Preview("Empty") {
        previewSurface(MoreDetailsUpdate(status: .empty, input: nil, unitPrefs: metricPrefs))
    }

    #Preview("Loading") {
        previewSurface(MoreDetailsUpdate(status: .loading, input: nil, unitPrefs: metricPrefs))
    }

    #Preview("Error") {
        previewSurface(
            MoreDetailsUpdate(status: .failed("Network unavailable"), input: nil, unitPrefs: metricPrefs)
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(prefs: metricPrefs, connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(prefs: imperialPrefs, connection: .offline))
    }
#endif
