//
//  SummaryStats.Previews.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  Xcode previews for each surface state (loading / populated °C / populated °F / zeros
//  + em-dash / large values). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: DynamicsSummaryStatsInput) -> DynamicsSummaryStatsModel {
        let source = InMemoryDynamicsSummaryStatsSource(initial: input)
        let model = DynamicsSummaryStatsModel(source: source)
        model.start()
        return model
    }

    private let celsius = DynamicsSummaryStatsFormatting(
        locale: Locale(identifier: "en_US"),
        temperatureUnit: .celsius
    )

    private let fahrenheit = DynamicsSummaryStatsFormatting(
        locale: Locale(identifier: "en_US"),
        temperatureUnit: .fahrenheit
    )

    private let sampleValues = DynamicsSummaryStatsValues(
        totalReadings: 1284,
        avgTorque: 142.6,
        peakPower: 248.3,
        peakRegen: 64.1,
        avgPower: 38.9,
        avgMotorTempCelsius: 47.5
    )

    #Preview("Loading") {
        SummaryStats(model: previewModel(DynamicsSummaryStatsInput(formatting: celsius, isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Populated (°C)") {
        SummaryStats(model: previewModel(DynamicsSummaryStatsInput(values: sampleValues, formatting: celsius)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Populated (°F)") {
        SummaryStats(model: previewModel(DynamicsSummaryStatsInput(values: sampleValues, formatting: fahrenheit)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Zeros + em-dash (null stats)") {
        SummaryStats(model: previewModel(DynamicsSummaryStatsInput(values: nil, formatting: celsius)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Large values") {
        SummaryStats(model: previewModel(DynamicsSummaryStatsInput(
            values: DynamicsSummaryStatsValues(
                totalReadings: 1_284_932,
                avgTorque: 1342.8,
                peakPower: 982.4,
                peakRegen: 271.6,
                avgPower: 412.7,
                avgMotorTempCelsius: 88.2
            ),
            formatting: fahrenheit
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
