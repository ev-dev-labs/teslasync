//
//  DrivingTemperatureStats.Previews.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  Xcode previews for each surface state (content / inside-only / outside-only / Fahrenheit /
//  empty / loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DrivingTemperatureUpdate) -> DrivingTemperatureStatsModel {
        let source = InMemoryDrivingTemperatureSource(initial: update)
        let model = DrivingTemperatureStatsModel(source: source)
        model.start()
        return model
    }

    private func previewStats(inside: Bool = true, outside: Bool = true) -> DrivingTemperatureStatsInput {
        DrivingTemperatureStatsInput(
            inside: inside ? TemperatureTripleInput(min: 18.5, avg: 21.4, max: 24.8) : nil,
            outside: outside ? TemperatureTripleInput(min: 6.2, avg: 12.7, max: 19.3) : nil
        )
    }

    private func loadedUpdate(
        inside: Bool = true,
        outside: Bool = true,
        unit: DrivingTemperatureUnit = .celsius,
        connection: DrivingTemperatureConnection = .live
    ) -> DrivingTemperatureUpdate {
        DrivingTemperatureUpdate(
            status: .loaded,
            connection: connection,
            stats: previewStats(inside: inside, outside: outside),
            units: DrivingTemperatureUnitPrefs(temperature: unit),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: DrivingTemperatureUpdate) -> some View {
        ScrollView {
            DrivingTemperatureStats(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (°C)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Inside only") {
        previewSurface(loadedUpdate(outside: false))
    }

    #Preview("Outside only") {
        previewSurface(loadedUpdate(inside: false))
    }

    #Preview("Content (°F)") {
        previewSurface(loadedUpdate(unit: .fahrenheit))
    }

    #Preview("Empty") {
        previewSurface(
            DrivingTemperatureUpdate(status: .loaded, stats: DrivingTemperatureStatsInput())
        )
    }

    #Preview("Loading") {
        previewSurface(DrivingTemperatureUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(DrivingTemperatureUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
