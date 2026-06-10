//
//  EnergyChargingPanel.Previews.swift
//  TeslaSync — P4 feature view · 0279 · EnergyChargingPanel (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EnergyChargingPreviewData {
        /// A live charging reading (SI inputs): ~402 V, 24 A, 11 kW, 8.4 kWh added,
        /// 64% battery, ~48 km of range added per hour (13.33 m/s → ~48 km/h).
        static let charging = EnergyChargingReading(
            chargerVoltage: 402,
            chargerActualCurrent: 24,
            chargerPowerW: 11000,
            chargeEnergyAddedWh: 8400,
            chargingState: EnergyChargingStateBadge.chargingValue,
            batteryLevel: 64,
            rangeAddedMetersPerHour: 48000
        )

        static let complete = EnergyChargingReading(
            chargerVoltage: 0,
            chargerActualCurrent: 0,
            chargerPowerW: 0,
            chargeEnergyAddedWh: 52000,
            chargingState: EnergyChargingStateBadge.completeValue,
            batteryLevel: 90,
            rangeAddedMetersPerHour: 0
        )
    }

    @MainActor
    private func energyChargingPreviewModel(_ input: EnergyChargingInput) -> EnergyChargingModel {
        let source = InMemoryEnergyChargingSource(initial: input)
        let model = EnergyChargingModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — charging") {
        EnergyChargingPanel(model: energyChargingPreviewModel(
            EnergyChargingInput(reading: EnergyChargingPreviewData.charging)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — complete (imperial)") {
        EnergyChargingPanel(model: energyChargingPreviewModel(
            EnergyChargingInput(reading: EnergyChargingPreviewData.complete, units: .imperial)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EnergyChargingPanel(model: energyChargingPreviewModel(EnergyChargingInput(reading: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergyChargingPanel(model: energyChargingPreviewModel(EnergyChargingInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergyChargingPanel(model: energyChargingPreviewModel(
            EnergyChargingInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EnergyChargingPanel(model: energyChargingPreviewModel(
            EnergyChargingInput(reading: EnergyChargingPreviewData.charging, connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EnergyChargingPanel(model: energyChargingPreviewModel(
            EnergyChargingInput(reading: EnergyChargingPreviewData.charging, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
