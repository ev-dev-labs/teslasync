//
//  DrivingTips.Previews.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline) plus the high-power and thermal recommendation variants. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DrivingTipsPreviewData {
        /// Moderate average power (20…80 kW) → the "smooth throttle" recommendations.
        static let moderate = DrivingTipsMetrics(averagePowerKW: 48, maxMotorTempC: 64)
        /// Conservative average power (< 20 kW) → the "great driving" recommendations.
        static let conservative = DrivingTipsMetrics(averagePowerKW: 12, maxMotorTempC: 52)
        /// High average power (> 80 kW) and a hot motor (> 120 °C) → the "ease
        /// accelerator" pair plus the appended thermal recommendation.
        static let aggressiveHot = DrivingTipsMetrics(averagePowerKW: 132, maxMotorTempC: 148)
    }

    @MainActor
    private func previewModel(_ input: DrivingTipsInput) -> DrivingTipsModel {
        let source = InMemoryDrivingTipsSource(initial: input)
        let model = DrivingTipsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data · Moderate") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            metrics: DrivingTipsPreviewData.moderate,
            throttleStyle: .moderate
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · Conservative") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            metrics: DrivingTipsPreviewData.conservative,
            throttleStyle: .conservative
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · Aggressive + Thermal") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            metrics: DrivingTipsPreviewData.aggressiveHot,
            throttleStyle: .aggressive
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DrivingTips(model: previewModel(DrivingTipsInput(metrics: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DrivingTips(model: previewModel(DrivingTipsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            metrics: DrivingTipsPreviewData.moderate,
            throttleStyle: .moderate,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        DrivingTips(model: previewModel(DrivingTipsInput(
            metrics: DrivingTipsPreviewData.conservative,
            throttleStyle: .conservative,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
