//
//  AcDcStatsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AcDcPreviewData {
        static let breakdown = AcDcBreakdown(
            ac: AcDcBucket(
                energy: 4500,
                energyUsed: 4500,
                cost: 12.30,
                count: 30,
                totalDuration: 1500,
                freeCount: 2,
                freeEnergy: 300
            ),
            dc: AcDcBucket(
                energy: 8200,
                energyUsed: 8200,
                cost: 45.60,
                count: 12,
                totalDuration: 480,
                freeCount: 1,
                freeEnergy: 150
            ),
            total: AcDcBreakdownTotal(energy: 12700, cost: 57.90, freeEnergy: 450, freeCount: 3)
        )
    }

    @MainActor
    private func previewModel(_ input: AcDcStatsInput) -> AcDcStatsModel {
        let source = InMemoryAcDcStatsSource(initial: input)
        let model = AcDcStatsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(breakdown: AcDcPreviewData.breakdown)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(
            breakdown: AcDcBreakdown(ac: AcDcBucket(), dc: AcDcBucket(), total: AcDcBreakdownTotal())
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(
            breakdown: AcDcPreviewData.breakdown,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AcDcStatsPanel(model: previewModel(AcDcStatsInput(
            breakdown: AcDcPreviewData.breakdown,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
