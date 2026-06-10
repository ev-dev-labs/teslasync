//
//  VehicleGauges.Previews.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  Xcode previews for each surface state (data / charging / imperial / loading / empty / error
//  / stale / offline) and a sweep of the model silhouettes. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VehicleGaugesPreviewData {
        static let modelS = VehicleGaugesVehicle(model: "Model S")
        static let model3 = VehicleGaugesVehicle(model: "Model 3")

        /// A parked, locked Model S at 82% with ~480 km rated range (SI metres).
        static let parked = VehicleGaugesState(
            batteryLevel: 82,
            ratedRange: 480_000,
            speed: 0,
            chargerPower: 0,
            chargeRate: 0,
            isCharging: false,
            isLocked: true,
            isClimateOn: true,
            sentryMode: true,
            softwareVersion: "2026.6.1"
        )

        /// A charging Model 3 at 47% drawing 48 kW, adding ~64 km/h of range (SI metres/hour).
        static let charging = VehicleGaugesState(
            batteryLevel: 47,
            ratedRange: 280_000,
            speed: 0,
            chargerPower: 48,
            chargeRate: 64000,
            isCharging: true,
            isLocked: true,
            isClimateOn: false,
            sentryMode: false,
            softwareVersion: "2026.6.1"
        )

        /// A driving Model S at 64% doing ~30 m/s (≈108 km/h).
        static let driving = VehicleGaugesState(
            batteryLevel: 64,
            ratedRange: 360_000,
            speed: 30,
            chargerPower: 0,
            chargeRate: 0,
            isCharging: false,
            isLocked: true,
            isClimateOn: true,
            sentryMode: false,
            softwareVersion: nil
        )
    }

    @MainActor
    private func previewModel(_ input: VehicleGaugesInput) -> VehicleGaugesModel {
        let source = InMemoryVehicleGaugesSource(initial: input)
        let model = VehicleGaugesModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — parked") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            vehicle: VehicleGaugesPreviewData.modelS,
            state: VehicleGaugesPreviewData.parked
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            vehicle: VehicleGaugesPreviewData.model3,
            state: VehicleGaugesPreviewData.charging
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Driving — imperial") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            vehicle: VehicleGaugesPreviewData.modelS,
            state: VehicleGaugesPreviewData.driving,
            units: .imperial
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleGauges(model: previewModel(VehicleGaugesInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            vehicle: VehicleGaugesPreviewData.model3,
            state: VehicleGaugesPreviewData.charging,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        VehicleGauges(model: previewModel(VehicleGaugesInput(
            vehicle: VehicleGaugesPreviewData.modelS,
            state: VehicleGaugesPreviewData.parked,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
