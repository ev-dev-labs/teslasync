//
//  TripLegList.Previews.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline) plus the imperial-unit and coordinate-fallback variants. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TripLegListPreviewData {
        static let metricConfig = TripLegFormatConfig(
            distanceUnit: .km,
            currencySymbol: "$",
            currencyPrecision: 2,
            localeIdentifier: "en-US"
        )

        static let imperialConfig = TripLegFormatConfig(
            distanceUnit: .mi,
            currencySymbol: "$",
            currencyPrecision: 2,
            localeIdentifier: "en-US"
        )

        /// The second leg's "from" name is intentionally blank to exercise the
        /// coordinate fallback (web `name || \`${lat.toFixed(2)}, …\``).
        static let legs: [TripLegData] = [
            TripLegData(
                from: TripLocationData(lat: 37.7749, lng: -122.4194, name: "San Francisco"),
                to: TripLocationData(lat: 36.25, lng: -120.23, name: "Harris Ranch"),
                distanceM: 330_000, durationS: 11400, energyWh: 58000,
                startSoc: 90, arrivalSoc: 18
            ),
            TripLegData(
                from: TripLocationData(lat: 36.25, lng: -120.23, name: ""),
                to: TripLocationData(lat: 34.0522, lng: -118.2437, name: "Los Angeles"),
                distanceM: 270_000, durationS: 9300, energyWh: 47500,
                startSoc: 80, arrivalSoc: 42
            )
        ]

        static let stops: [TripChargeStopData] = [
            TripChargeStopData(
                name: "Harris Ranch Supercharger",
                location: TripLocationData(lat: 36.25, lng: -120.23, name: "Harris Ranch Supercharger"),
                chargeFromSoc: 18,
                chargeToSoc: 80,
                chargeDurationS: 1500,
                energyWh: 38000,
                cost: 14.25,
                isRecommended: true
            )
        ]
    }

    @MainActor
    private func previewModel(_ input: TripLegListInput) -> TripLegListModel {
        let source = InMemoryTripLegListSource(initial: input)
        let model = TripLegListModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        ScrollView {
            TripLegList(model: previewModel(TripLegListInput(
                legs: TripLegListPreviewData.legs,
                chargeStops: TripLegListPreviewData.stops,
                config: TripLegListPreviewData.metricConfig
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Data (imperial)") {
        ScrollView {
            TripLegList(model: previewModel(TripLegListInput(
                legs: TripLegListPreviewData.legs,
                chargeStops: TripLegListPreviewData.stops,
                config: TripLegListPreviewData.imperialConfig
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TripLegList(model: previewModel(TripLegListInput(config: TripLegListPreviewData.metricConfig)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TripLegList(model: previewModel(TripLegListInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TripLegList(model: previewModel(TripLegListInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            TripLegList(model: previewModel(TripLegListInput(
                legs: TripLegListPreviewData.legs,
                chargeStops: TripLegListPreviewData.stops,
                config: TripLegListPreviewData.metricConfig,
                connection: .stale
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            TripLegList(model: previewModel(TripLegListInput(
                legs: TripLegListPreviewData.legs,
                chargeStops: TripLegListPreviewData.stops,
                config: TripLegListPreviewData.metricConfig,
                connection: .offline
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
