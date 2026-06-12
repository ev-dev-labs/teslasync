//
//  UnitInput.Previews.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  Xcode previews for each surface state (ready across distance / speed / temperature / energy /
//  percent / currency, ready-empty, loading, error, stale, offline). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum UnitInputFieldPreviewData {
        /// The documented canonical label from the web source example (`t('chargePlanner.
        /// batteryCapacity', 'Battery Capacity')`).
        static let batteryLabel = "Battery Capacity"

        static func input(
            value: Double?,
            kind: UnitInputFieldKind,
            label: String,
            settings: UnitInputFieldSettings = UnitInputFieldSettings(),
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: UnitInputFieldConnection = .live,
            isRequired: Bool = false
        ) -> UnitInputFieldInput {
            UnitInputFieldInput(
                value: value,
                kind: kind,
                settings: settings,
                label: label,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection,
                isRequired: isRequired
            )
        }
    }

    @MainActor
    private func unitInputFieldPreviewModel(_ input: UnitInputFieldInput) -> UnitInputFieldModel {
        let source = InMemoryUnitInputFieldSource(initial: input)
        let model = UnitInputFieldModel(source: source)
        model.start()
        return model
    }

    private let unitPreviewMetric = UnitInputFieldSettings(
        lengthUnit: .kilometers, tempUnit: .celsius, decimalPrecision: 2,
        currencySymbol: "$", locale: Locale(identifier: "en_US")
    )

    private let unitPreviewImperial = UnitInputFieldSettings(
        lengthUnit: .miles, tempUnit: .fahrenheit, decimalPrecision: 1,
        currencySymbol: "$", locale: Locale(identifier: "en_US")
    )

    #Preview("Ready · Energy (Battery Capacity)") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: 75, kind: .energy, label: UnitInputFieldPreviewData.batteryLabel)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Distance (km)") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(
                value: 100,
                kind: .distance,
                label: "Trip Distance",
                settings: unitPreviewMetric
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Speed (mph)") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(
                value: 60,
                kind: .speed,
                label: "Cruise Speed",
                settings: unitPreviewImperial
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Temperature (°F)") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(
                value: 20,
                kind: .temperature,
                label: "Cabin Target",
                settings: unitPreviewImperial
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Percent") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: 80, kind: .percent, label: "Charge Limit")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Currency") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: 0.12, kind: .currency, label: "Cost per kWh")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Empty (required)") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(
                value: nil, kind: .energy, label: UnitInputFieldPreviewData.batteryLabel, isRequired: true
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: nil, kind: .energy, label: "Battery Capacity", isLoading: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(
                value: nil, kind: .energy, label: "Battery Capacity",
                errorMessage: "The settings request timed out"
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: 75, kind: .energy, label: "Battery Capacity", connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        UnitInputField(model: unitInputFieldPreviewModel(
            UnitInputFieldPreviewData.input(value: 75, kind: .energy, label: "Battery Capacity", connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
