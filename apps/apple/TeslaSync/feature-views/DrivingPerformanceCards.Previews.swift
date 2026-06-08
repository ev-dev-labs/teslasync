//
//  DrivingPerformanceCards.Previews.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline) across metric + imperial unit preferences. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DrivingPerformanceUpdate) -> DrivingPerformanceModel {
        let source = InMemoryDrivingPerformanceSource(initial: update)
        let model = DrivingPerformanceModel(source: source)
        model.start()
        return model
    }

    /// Representative backend stats (km/h, kW, km) — the shape the web reads from
    /// `drive_analytics.{speed,power,regen,distance}_stats`.
    private func previewInput() -> DrivingPerformanceInput {
        DrivingPerformanceInput(
            speed: DrivingStat(max: 201.0, avg: 64.3),
            power: DrivingStat(max: 285.0, avg: 41.2),
            regen: DrivingStat(max: 92.0, avg: 15.4),
            distance: DrivingStat(max: 412.7, avg: 38.4)
        )
    }

    private func loadedUpdate(
        prefs: DrivingUnitPrefs,
        connection: DrivingPerformanceConnection = .live
    ) -> DrivingPerformanceUpdate {
        DrivingPerformanceUpdate(
            status: .loaded,
            input: previewInput(),
            unitPrefs: prefs,
            connection: connection,
            updatedAt: Date()
        )
    }

    private let imperialPrefs = DrivingUnitPrefs(distance: "mi", speed: "mph", locale: "en-US")
    private let metricPrefs = DrivingUnitPrefs(distance: "km", speed: "km/h", locale: "en-US")

    @MainActor
    private func previewSurface(_ update: DrivingPerformanceUpdate) -> some View {
        ScrollView {
            DrivingPerformanceCards(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · imperial") {
        previewSurface(loadedUpdate(prefs: imperialPrefs))
    }

    #Preview("Content · metric") {
        previewSurface(loadedUpdate(prefs: metricPrefs))
    }

    #Preview("Empty") {
        previewSurface(DrivingPerformanceUpdate(status: .empty, input: nil, unitPrefs: imperialPrefs))
    }

    #Preview("Loading") {
        previewSurface(DrivingPerformanceUpdate(status: .loading, input: nil, unitPrefs: imperialPrefs))
    }

    #Preview("Error") {
        previewSurface(
            DrivingPerformanceUpdate(status: .failed("Network unavailable"), input: nil, unitPrefs: imperialPrefs)
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(prefs: imperialPrefs, connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(prefs: imperialPrefs, connection: .offline))
    }
#endif
