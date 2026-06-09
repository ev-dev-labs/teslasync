//
//  GasPriceSettings.Previews.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  Xcode previews for each surface state (data / disabled / empty / loading / error /
//  polling / stale / offline). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum GasPricePreviewData {
        static let record = GasPriceRecord(
            enabled: true,
            pollInterval: .weekly,
            currentPrice: 3.45,
            lastPollTime: Date(timeIntervalSince1970: 1_775_000_000)
        )

        static let stopped = GasPriceRecord(
            enabled: false,
            pollInterval: .daily,
            currentPrice: 0,
            lastPollTime: nil
        )
    }

    @MainActor
    private func previewModel(
        _ input: GasPriceSettingsInput,
        outcome: GasPriceActionOutcome? = nil
    ) -> GasPriceSettingsModel {
        let source = InMemoryGasPriceSettingsSource(initial: input, outcome: outcome)
        let model = GasPriceSettingsModel(
            source: source,
            formatting: GasPriceFormatting(currencySymbol: "$", gasUnit: "gallon", decimals: 2)
        )
        model.start()
        return model
    }

    #Preview("Data — Running") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(status: GasPricePreviewData.record)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data — Stopped / no price") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(status: GasPricePreviewData.stopped)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(status: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(
            status: GasPricePreviewData.record,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        GasPriceSettings(model: previewModel(GasPriceSettingsInput(
            status: GasPricePreviewData.record,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
