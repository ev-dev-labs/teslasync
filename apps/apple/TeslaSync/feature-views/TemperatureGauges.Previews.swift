//
//  TemperatureGauges.Previews.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  Xcode previews for each surface state (content °C / content °F / content with a missing
//  reading / empty / loading / error / stale / offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TemperatureGaugesUpdate) -> TemperatureGaugesModel {
        let source = InMemoryTemperatureGaugesSource(initial: update)
        let model = TemperatureGaugesModel(source: source)
        model.start()
        return model
    }

    /// The four canonical drivetrain sensors (web `DrivetrainHealthPage`): front/rear motor
    /// (ceiling 150 °C), inverter (120 °C), battery (60 °C), tuned to show normal / warning /
    /// critical / normal tones respectively.
    private func previewSensors(includeMissing: Bool = false) -> [TempSensorInput] {
        [
            TempSensorInput(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 95,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "rearMotor",
                labelKey: "drivetrain.rearMotor",
                labelFallback: "Rear Motor",
                valueCelsius: 110,
                maxTempCelsius: 150
            ),
            TempSensorInput(
                id: "inverter",
                labelKey: "drivetrain.inverter",
                labelFallback: "Inverter",
                valueCelsius: includeMissing ? nil : 105,
                maxTempCelsius: 120
            ),
            TempSensorInput(
                id: "battery",
                labelKey: "drivetrain.battery",
                labelFallback: "Battery",
                valueCelsius: 34,
                maxTempCelsius: 60
            )
        ]
    }

    private func loadedUpdate(
        connection: TemperatureGaugesConnection = .live,
        temperature: TemperatureUnit = .celsius,
        includeMissing: Bool = false
    ) -> TemperatureGaugesUpdate {
        TemperatureGaugesUpdate(
            status: .loaded,
            connection: connection,
            sensors: previewSensors(includeMissing: includeMissing),
            units: TemperatureGaugesUnitPrefs(temperature: temperature),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: TemperatureGaugesUpdate) -> some View {
        ScrollView {
            TemperatureGauges(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (°C)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (°F)") {
        previewSurface(loadedUpdate(temperature: .fahrenheit))
    }

    #Preview("Content (missing reading)") {
        previewSurface(loadedUpdate(includeMissing: true))
    }

    #Preview("Empty") {
        previewSurface(TemperatureGaugesUpdate(status: .empty, sensors: []))
    }

    #Preview("Loading") {
        previewSurface(TemperatureGaugesUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(TemperatureGaugesUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline, temperature: .fahrenheit))
    }
#endif
