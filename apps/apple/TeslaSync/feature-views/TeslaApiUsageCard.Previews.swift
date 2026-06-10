//
//  TeslaApiUsageCard.Previews.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  Xcode previews for each surface state (data / near-budget warn / over-budget danger / high error
//  rate / empty / loading / error / stale / offline / euro currency). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TeslaApiUsagePreviewData {
        static let usage = TeslaApiUsage(
            totalRequests: 84210,
            skippedPolls: 12040,
            estimatedCost: 3.20,
            costPerRequest: 0.00005,
            monthlyCredit: 5.00,
            estimatedRemaining: 1.80
        )

        static let warnUsage = TeslaApiUsage(
            totalRequests: 120_500,
            skippedPolls: 14000,
            estimatedCost: 4.55,
            costPerRequest: 0.00005,
            monthlyCredit: 5.00,
            estimatedRemaining: 0.45
        )

        static let overBudgetUsage = TeslaApiUsage(
            totalRequests: 168_900,
            skippedPolls: 15000,
            estimatedCost: 6.40,
            costPerRequest: 0.00005,
            monthlyCredit: 5.00,
            estimatedRemaining: -1.40
        )

        static let stats = TeslaApiLogStats(
            last24h: 4820,
            avgDurationMs: 142,
            errorRate: 0.8,
            errorCount: 39,
            byService: [
                TeslaApiUsageCountEntry(name: "tesla_fleet", count: 52000),
                TeslaApiUsageCountEntry(name: "geocoding", count: 18000),
                TeslaApiUsageCountEntry(name: "weather", count: 9000),
                TeslaApiUsageCountEntry(name: "elevation", count: 3200)
            ],
            byMethod: [
                TeslaApiUsageCountEntry(name: "GET", count: 70010),
                TeslaApiUsageCountEntry(name: "POST", count: 12000),
                TeslaApiUsageCountEntry(name: "DELETE", count: 2200)
            ]
        )

        static let highErrorStats = TeslaApiLogStats(
            last24h: 5100,
            avgDurationMs: 980,
            errorRate: 6.5,
            errorCount: 332,
            byService: [TeslaApiUsageCountEntry(name: "tesla_fleet", count: 48000)],
            byMethod: [TeslaApiUsageCountEntry(name: "GET", count: 40000)]
        )
    }

    @MainActor
    private func previewModel(_ input: TeslaApiUsageInput) -> TeslaApiUsageModel {
        let source = InMemoryTeslaApiUsageSource(initial: input)
        let model = TeslaApiUsageModel(source: source)
        model.start()
        return model
    }

    private func dataInput(
        usage: TeslaApiUsage = TeslaApiUsagePreviewData.usage,
        stats: TeslaApiLogStats = TeslaApiUsagePreviewData.stats,
        currencySymbol: String = "$",
        connection: TeslaApiUsageConnection = .live
    ) -> TeslaApiUsageInput {
        TeslaApiUsageInput(
            usage: usage,
            logStats: stats,
            currencySymbol: currencySymbol,
            connection: connection
        )
    }

    #Preview("Data") {
        TeslaApiUsageCard(model: previewModel(dataInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Near budget · warn") {
        TeslaApiUsageCard(model: previewModel(dataInput(usage: TeslaApiUsagePreviewData.warnUsage)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Over budget · danger") {
        TeslaApiUsageCard(model: previewModel(dataInput(usage: TeslaApiUsagePreviewData.overBudgetUsage)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("High error rate") {
        TeslaApiUsageCard(model: previewModel(dataInput(stats: TeslaApiUsagePreviewData.highErrorStats)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · no usage") {
        TeslaApiUsageCard(model: previewModel(TeslaApiUsageInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TeslaApiUsageCard(model: previewModel(TeslaApiUsageInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TeslaApiUsageCard(model: previewModel(TeslaApiUsageInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TeslaApiUsageCard(model: previewModel(dataInput(connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TeslaApiUsageCard(model: previewModel(dataInput(connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Euro · precision 2") {
        TeslaApiUsageCard(model: previewModel(dataInput(currencySymbol: "€")))
            .padding()
            .background(Color.TS.bg)
    }
#endif
