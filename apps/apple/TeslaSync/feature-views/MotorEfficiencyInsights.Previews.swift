//
//  MotorEfficiencyInsights.Previews.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline) plus a Fahrenheit + aggressive-style variant. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum MotorEfficiencyPreviewData {
        static let metrics = MotorMetrics(
            averageTorqueNm: 142.5,
            maxTorqueNm: 421.0,
            highTorquePercent: 18.4,
            averagePowerKW: 64.0,
            averageMotorTempC: 49.0,
            maxMotorTempC: 64.0
        )

        static let hot = MotorMetrics(
            averageTorqueNm: 268.0,
            maxTorqueNm: 612.0,
            highTorquePercent: 47.2,
            averagePowerKW: 132.0,
            averageMotorTempC: 96.0,
            maxMotorTempC: 148.0
        )
    }

    @MainActor
    private func previewModel(_ input: MotorEfficiencyInput) -> MotorEfficiencyInsightsModel {
        let source = InMemoryMotorEfficiencySource(initial: input)
        let model = MotorEfficiencyInsightsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(
            metrics: MotorEfficiencyPreviewData.metrics,
            throttleStyle: .moderate
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · °F · Aggressive") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(
            metrics: MotorEfficiencyPreviewData.hot,
            throttleStyle: .aggressive,
            temperatureUnit: .fahrenheit
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(metrics: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(
            metrics: MotorEfficiencyPreviewData.metrics,
            throttleStyle: .moderate,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        MotorEfficiencyInsights(model: previewModel(MotorEfficiencyInput(
            metrics: MotorEfficiencyPreviewData.metrics,
            throttleStyle: .conservative,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
