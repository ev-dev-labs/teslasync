//
//  MonthlyCostTable.Previews.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum MonthlyCostPreviewData {
        static let buckets: [MonthlyCostBucket] = [
            MonthlyCostBucket(
                month: "2024-01",
                cost: 142.30,
                energy: 1180.4,
                sessions: 18,
                avgCostPerKwh: 0.121,
                gasEquiv: 318.75,
                savings: 176.45
            ),
            MonthlyCostBucket(
                month: "2024-02",
                cost: 98.60,
                energy: 820.0,
                sessions: 12,
                avgCostPerKwh: 0.120,
                gasEquiv: 70.10,
                savings: -28.50
            ),
            MonthlyCostBucket(
                month: "2024-03",
                cost: 205.15,
                energy: 1640.9,
                sessions: 24,
                avgCostPerKwh: 0.125,
                gasEquiv: 442.20,
                savings: 237.05
            )
        ]
    }

    @MainActor
    private func previewModel(_ input: MonthlyCostTableInput) -> MonthlyCostTableModel {
        let source = InMemoryMonthlyCostTableSource(initial: input)
        let model = MonthlyCostTableModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(buckets: MonthlyCostPreviewData.buckets)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(buckets: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(
            buckets: MonthlyCostPreviewData.buckets,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        MonthlyCostTable(model: previewModel(MonthlyCostTableInput(
            buckets: MonthlyCostPreviewData.buckets,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
