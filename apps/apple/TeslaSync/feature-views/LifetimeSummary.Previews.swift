//
//  LifetimeSummary.Previews.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  Xcode previews for each surface state (loading / data / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: LifetimeSummaryInput) -> LifetimeSummaryModel {
        let source = InMemoryLifetimeSummarySource(initial: input)
        let model = LifetimeSummaryModel(source: source)
        model.start()
        return model
    }

    private let previewCore = LifetimeCoreStats(
        totalCost: 1284.57,
        totalEnergy: 4210.6,
        count: 142
    )

    private let previewMetrics = LifetimeMetrics(
        avgSessionCost: 9.05,
        avgSessionEnergy: 29.6,
        avgDuration: 47,
        freeCount: 18,
        freeEnergy: 612.4
    )

    #Preview("Loading") {
        LifetimeSummary(model: previewModel(LifetimeSummaryInput(isLoading: true, isFetching: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        LifetimeSummary(model: previewModel(
            LifetimeSummaryInput(coreStats: previewCore, metrics: previewMetrics)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Data · EUR locale") {
        LifetimeSummary(model: previewModel(LifetimeSummaryInput(
            coreStats: previewCore,
            metrics: previewMetrics,
            formatting: LifetimeFormatting(currencySymbol: "€", localeIdentifier: "de-DE")
        )))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LifetimeSummary(model: previewModel(LifetimeSummaryInput()))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LifetimeSummary(model: previewModel(
            LifetimeSummaryInput(errorMessage: "Charging request returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LifetimeSummary(model: previewModel(LifetimeSummaryInput(
            isFetching: true, coreStats: previewCore, metrics: previewMetrics, isStale: true
        )))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        LifetimeSummary(model: previewModel(LifetimeSummaryInput(
            coreStats: previewCore, metrics: previewMetrics, isOffline: true
        )))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
