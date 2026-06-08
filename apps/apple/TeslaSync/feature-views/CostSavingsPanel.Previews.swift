//
//  CostSavingsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  Xcode previews for each surface state (data / data-no-savings / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum CostSavingsPreviewData {
        /// Imperial settings so the Cost/unit cell reads "Cost / mi" and the gas
        /// estimate (MPG) produces positive savings.
        static let config = CostSavingsConfig(
            costPerKwh: 0.12,
            currencySymbol: "$",
            decimalPrecision: 2,
            distanceUnit: .mi,
            gasEfficiencyMpg: 30,
            gasPricePerUnit: 3.5,
            gasUnit: .gallon,
            localeIdentifier: "en-US"
        )

        /// ~31 mi, 12 kWh — exercises every cell (Trip Cost, Cost/mi, gas trio).
        static let inputs = CostSavingsInputs(distanceM: 50000, energyWh: 12000)

        static let snapshot = CostSavingsSnapshot(config: config, inputs: inputs)

        /// Same drive but with no configured MPG, so the gas trio is hidden and only
        /// Trip Cost + Cost/mi render.
        static let noSavingsSnapshot = CostSavingsSnapshot(
            config: CostSavingsConfig(
                costPerKwh: 0.12,
                currencySymbol: "$",
                decimalPrecision: 2,
                distanceUnit: .mi,
                gasEfficiencyMpg: 0,
                gasPricePerUnit: 0,
                gasUnit: .gallon,
                localeIdentifier: "en-US"
            ),
            inputs: inputs
        )

        static let emptySnapshot = CostSavingsSnapshot(
            config: config,
            inputs: CostSavingsInputs(distanceM: 0, energyWh: 0)
        )
    }

    @MainActor
    private func previewModel(_ input: CostSavingsInput) -> CostSavingsModel {
        let source = InMemoryCostSavingsSource(initial: input)
        let model = CostSavingsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(snapshot: CostSavingsPreviewData.snapshot)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data — no gas savings") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(snapshot: CostSavingsPreviewData.noSavingsSnapshot)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(snapshot: CostSavingsPreviewData.emptySnapshot)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(
            snapshot: CostSavingsPreviewData.snapshot,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        CostSavingsPanel(model: previewModel(CostSavingsInput(
            snapshot: CostSavingsPreviewData.snapshot,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
