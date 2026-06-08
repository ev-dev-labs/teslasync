//
//  CostSummaryCards.Previews.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline) across imperial-USD and metric-EUR unit/currency contexts. DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: CostSummaryUpdate) -> CostSummaryModel {
        let source = InMemoryCostSummarySource(initial: update)
        let model = CostSummaryModel(source: source)
        model.start()
        return model
    }

    /// Representative aggregated stats — the shape the web reads from `useCostAnalysisData`'s
    /// `coreStats` projection.
    private func previewStats() -> CostSummaryStats {
        CostSummaryStats(
            totalCost: 1234.56,
            count: 128,
            avgCostPerKwh: 0.1423,
            costPerDist: 0.0584,
            totalEnergy: 1024.5,
            gallonsEquiv: 30.66,
            savings: 210.4,
            savingsPercent: 62.34
        )
    }

    private let imperialContext = CostSummaryUnitContext(
        gasPrice: 3.5,
        distanceUnit: "mi",
        isMiles: true,
        currencySymbol: "$",
        gasUnit: .gallon,
        locale: "en-US"
    )

    private let metricContext = CostSummaryUnitContext(
        gasPrice: 1.65,
        distanceUnit: "km",
        isMiles: false,
        currencySymbol: "€",
        gasUnit: .liter,
        locale: "de-DE"
    )

    private func loadedUpdate(
        context: CostSummaryUnitContext,
        connection: CostSummaryConnection = .live
    ) -> CostSummaryUpdate {
        CostSummaryUpdate(
            status: .loaded,
            stats: previewStats(),
            context: context,
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: CostSummaryUpdate) -> some View {
        ScrollView {
            CostSummaryCards(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · imperial USD") {
        previewSurface(loadedUpdate(context: imperialContext))
    }

    #Preview("Content · metric EUR") {
        previewSurface(loadedUpdate(context: metricContext))
    }

    #Preview("Empty") {
        previewSurface(CostSummaryUpdate(status: .empty, stats: nil, context: imperialContext))
    }

    #Preview("Loading") {
        previewSurface(CostSummaryUpdate(status: .loading, stats: nil, context: imperialContext))
    }

    #Preview("Error") {
        previewSurface(
            CostSummaryUpdate(status: .failed("Network unavailable"), stats: nil, context: imperialContext)
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(context: imperialContext, connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(context: imperialContext, connection: .offline))
    }
#endif
