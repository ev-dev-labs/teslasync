//
//  RegionSettings.Previews.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum RegionPreviewData {
        static let record = RegionRecord(
            region: "na",
            fleetAPIBaseURL: "https://fleet-api.prd.na.vn.cloud.tesla.com",
            fetchedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
    }

    @MainActor
    private func previewModel(_ input: RegionSettingsInput) -> RegionSettingsModel {
        let source = InMemoryRegionSettingsSource(initial: input)
        let model = RegionSettingsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        RegionSettings(model: previewModel(RegionSettingsInput(config: RegionPreviewData.record)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RegionSettings(model: previewModel(RegionSettingsInput(
            config: RegionRecord(region: nil, fleetAPIBaseURL: nil, fetchedAt: nil)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RegionSettings(model: previewModel(RegionSettingsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RegionSettings(model: previewModel(RegionSettingsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Refreshing") {
        RegionSettings(model: previewModel(RegionSettingsInput(
            config: RegionPreviewData.record,
            isRefreshing: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RegionSettings(model: previewModel(RegionSettingsInput(
            config: RegionPreviewData.record,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RegionSettings(model: previewModel(RegionSettingsInput(
            config: RegionPreviewData.record,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
