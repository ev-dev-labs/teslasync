//
//  ThermalLoadPanel.Previews.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  Xcode previews for each surface state (data / data °F / unknown readings / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ThermalPreviewData {
        /// A severity spread (good · warning · critical · good) over the real 150/150/
        /// 120/60 °C sensor ceilings the Drivetrain Health page builds.
        static let sensors: [ThermalSensorReading] = [
            ThermalSensorReading(
                id: "frontMotor",
                labelKey: "drivetrain.frontMotor",
                labelFallback: "Front Motor",
                valueCelsius: 64,
                maxTempCelsius: 150
            ),
            ThermalSensorReading(
                id: "rearMotor",
                labelKey: "drivetrain.rearMotor",
                labelFallback: "Rear Motor",
                valueCelsius: 110,
                maxTempCelsius: 150
            ),
            ThermalSensorReading(
                id: "inverter",
                labelKey: "drivetrain.inverter",
                labelFallback: "Inverter",
                valueCelsius: 108,
                maxTempCelsius: 120
            ),
            ThermalSensorReading(
                id: "battery",
                labelKey: "drivetrain.battery",
                labelFallback: "Battery",
                valueCelsius: 31,
                maxTempCelsius: 60
            )
        ]

        /// The same sensors with absent readings (web `value === null` grey branch).
        static let unknownSensors: [ThermalSensorReading] = sensors.map {
            ThermalSensorReading(
                id: $0.id,
                labelKey: $0.labelKey,
                labelFallback: $0.labelFallback,
                valueCelsius: nil,
                maxTempCelsius: $0.maxTempCelsius
            )
        }

        static let stats = ThermalLoadStats(totalDrives: 1280, regenRatio: 0.32)

        static func payload(_ sensors: [ThermalSensorReading]) -> ThermalLoadPayload {
            ThermalLoadPayload(sensors: sensors, peakPower: 245, avgPower: 38.4, stats: stats)
        }
    }

    @MainActor
    private func previewModel(_ input: ThermalLoadInput) -> ThermalLoadModel {
        let source = InMemoryThermalLoadSource(initial: input)
        let model = ThermalLoadModel(source: source)
        model.start()
        return model
    }

    #Preview("Data · °C") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalPreviewData.payload(ThermalPreviewData.sensors)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data · °F") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalPreviewData.payload(ThermalPreviewData.sensors),
            units: ThermalUnitContext(temperature: .fahrenheit, locale: "en_US")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Unknown readings") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalLoadPayload(
                sensors: ThermalPreviewData.unknownSensors,
                peakPower: 0,
                avgPower: 0,
                stats: nil
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalLoadPayload(sensors: [], peakPower: 0, avgPower: 0, stats: nil)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalPreviewData.payload(ThermalPreviewData.sensors),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ThermalLoadPanel(model: previewModel(ThermalLoadInput(
            payload: ThermalPreviewData.payload(ThermalPreviewData.sensors),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
