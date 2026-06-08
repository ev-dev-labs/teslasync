//
//  SummaryStatsGrid.Previews.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  Xcode previews for each surface state (loading / populated / zeros / large values /
//  non-USD currency). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SummaryStatsGridInput) -> SummaryStatsGridModel {
        let source = InMemorySummaryStatsGridSource(initial: input)
        let model = SummaryStatsGridModel(source: source)
        model.start()
        return model
    }

    private let usd = SummaryStatsGridFormatting(
        currencySymbol: "$",
        decimalPrecision: 2,
        locale: Locale(identifier: "en_US")
    )

    private let eur = SummaryStatsGridFormatting(
        currencySymbol: "€",
        decimalPrecision: 2,
        locale: Locale(identifier: "de_DE")
    )

    #Preview("Loading") {
        SummaryStatsGrid(model: previewModel(SummaryStatsGridInput(formatting: usd, isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        SummaryStatsGrid(model: previewModel(SummaryStatsGridInput(
            values: SummaryStatsGridValues(
                totalSessions: 1284,
                totalEnergy: 18234.7,
                avgRate: 48.6,
                peakRate: 250,
                avgDuration: 42,
                totalCost: 2189.45
            ),
            formatting: usd
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Zeros (null stats)") {
        SummaryStatsGrid(model: previewModel(SummaryStatsGridInput(values: nil, formatting: usd)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Large values") {
        SummaryStatsGrid(model: previewModel(SummaryStatsGridInput(
            values: SummaryStatsGridValues(
                totalSessions: 1_284_932,
                totalEnergy: 9_872_341.2,
                avgRate: 71.4,
                peakRate: 312.8,
                avgDuration: 138,
                totalCost: 1_482_771.9
            ),
            formatting: usd
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("EUR currency") {
        SummaryStatsGrid(model: previewModel(SummaryStatsGridInput(
            values: SummaryStatsGridValues(
                totalSessions: 642,
                totalEnergy: 9123.4,
                avgRate: 22.5,
                peakRate: 120,
                avgDuration: 64,
                totalCost: 1342.8
            ),
            formatting: eur
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
