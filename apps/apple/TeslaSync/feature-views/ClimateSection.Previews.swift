//
//  ClimateSection.Previews.swift
//  TeslaSync — P4 feature view · 0291 · ClimateSection (Apple)
//
//  Xcode previews for each surface state (loading / data / data·imperial / partial /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: ClimateSectionInput) -> ClimateSectionModel {
        let source = InMemoryClimateSectionSource(initial: input)
        let model = ClimateSectionModel(source: source)
        model.start()
        return model
    }

    private let fullReading = ClimateSectionReading(
        insideTempC: 21.5,
        outsideTempC: 8.0,
        driverSetpointC: 22.0,
        fanStatus: 4,
        seatHeaterLeft: 3,
        seatHeaterRight: 0,
        defrostMode: "Front",
        isClimateOn: true
    )

    private let partialReading = ClimateSectionReading(
        insideTempC: 19.0,
        outsideTempC: nil,
        driverSetpointC: 21.0,
        fanStatus: nil,
        seatHeaterLeft: nil,
        seatHeaterRight: nil,
        defrostMode: "Off",
        isClimateOn: false
    )

    #Preview("Loading") {
        ClimateSection(model: previewModel(ClimateSectionInput(isLoading: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        ClimateSection(model: previewModel(ClimateSectionInput(reading: fullReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · imperial") {
        ClimateSection(model: previewModel(ClimateSectionInput(reading: fullReading, units: .imperial)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data · partial") {
        ClimateSection(model: previewModel(ClimateSectionInput(reading: partialReading)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ClimateSection(model: previewModel(ClimateSectionInput(reading: nil)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ClimateSection(model: previewModel(
            ClimateSectionInput(errorMessage: "Climate request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ClimateSection(model: previewModel(
            ClimateSectionInput(reading: fullReading, connection: .stale)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ClimateSection(model: previewModel(
            ClimateSectionInput(reading: fullReading, connection: .offline)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
