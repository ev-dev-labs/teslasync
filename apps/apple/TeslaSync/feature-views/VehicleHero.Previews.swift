//
//  VehicleHero.Previews.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  Xcode previews for each surface state (data / driving / charging / asleep /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VehicleHeroPanelPreviewData {
        static let vehicle = VehicleHeroPanelVehicle(
            id: 1,
            displayName: "Lightning",
            vin: "5YJ3E1EA7KF000000",
            model: "Model 3",
            trimBadging: "Performance",
            updatedAt: Date().addingTimeInterval(-90)
        )

        static func state(
            status: VehicleHeroPanelStatus,
            speedMps: Double = 0,
            powerKw: Double = 0,
            charging: Bool = false
        ) -> VehicleHeroPanelState {
            VehicleHeroPanelState(
                status: status,
                batteryLevel: 72,
                ratedRangeMeters: 354_000,
                idealRangeMeters: 402_000,
                odometerMeters: 41_842_000,
                speedMps: speedMps,
                powerKw: powerKw,
                insideTempC: 21.5,
                outsideTempC: 12,
                isCharging: charging,
                chargerPowerKw: charging ? 11 : nil,
                chargeRateMeters: charging ? 48280 : nil,
                timeToFullHours: charging ? 2.5 : 0,
                isLocked: true,
                sentryMode: true
            )
        }

        static func input(
            state: VehicleHeroPanelState?,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: VehicleHeroPanelConnection = .live
        ) -> VehicleHeroPanelInput {
            VehicleHeroPanelInput(
                vehicle: vehicle,
                state: state,
                firmwareVersion: "2025.20.7",
                unitSystem: .imperial,
                locale: Locale(identifier: "en_US"),
                lastUpdated: Date().addingTimeInterval(-90),
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }
    }

    @MainActor
    private func previewHero(_ input: VehicleHeroPanelInput) -> VehicleHero {
        let source = InMemoryVehicleHeroPanelSource(initial: input)
        let model = VehicleHeroPanelModel(source: source)
        model.start()
        return VehicleHero(model: model)
    }

    #Preview("Parked") {
        previewHero(VehicleHeroPanelPreviewData.input(state: VehicleHeroPanelPreviewData.state(status: .parked)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Driving") {
        previewHero(VehicleHeroPanelPreviewData.input(
            state: VehicleHeroPanelPreviewData.state(status: .driving, speedMps: 28.5, powerKw: 96)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging") {
        previewHero(VehicleHeroPanelPreviewData.input(
            state: VehicleHeroPanelPreviewData.state(status: .charging, powerKw: -11, charging: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Asleep") {
        previewHero(VehicleHeroPanelPreviewData.input(state: nil))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        previewHero(VehicleHeroPanelPreviewData.input(state: nil, isLoading: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        previewHero(VehicleHeroPanelPreviewData.input(state: nil, errorMessage: "Network request timed out"))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        previewHero(VehicleHeroPanelPreviewData.input(
            state: VehicleHeroPanelPreviewData.state(status: .online), connection: .stale
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        previewHero(VehicleHeroPanelPreviewData.input(
            state: VehicleHeroPanelPreviewData.state(status: .online), connection: .offline
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
