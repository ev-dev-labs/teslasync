//
//  VehicleStatePanel.Previews.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  Xcode previews for each surface state (data / data-imperial / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VehicleStatePreviewData {
        /// An active reading: high beams on, left turn signal, hazards off, driver seat
        /// occupied, 3 paired keys, valet off, service off, speed-limit mode on at
        /// 22.352 m/s (50 mph / 80 km/h), center display on, 2 HomeLink devices.
        static let active = VehicleStateReading(
            lightsHighBeams: true,
            lightsTurnSignal: "Left",
            lightsHazards: false,
            driverSeatOccupied: true,
            pairedKeyCount: 3,
            valetMode: false,
            serviceMode: false,
            speedLimitMode: true,
            currentSpeedLimitMps: 22.352,
            centerDisplay: "On",
            homelinkDeviceCount: 2
        )

        /// A restricted reading: hazards + valet + service engaged, no driver, no keys,
        /// speed-limit mode off, exercising the danger / feature / warning tones.
        static let restricted = VehicleStateReading(
            lightsHighBeams: false,
            lightsTurnSignal: nil,
            lightsHazards: true,
            driverSeatOccupied: false,
            pairedKeyCount: nil,
            valetMode: true,
            serviceMode: true,
            speedLimitMode: false,
            currentSpeedLimitMps: nil,
            centerDisplay: nil,
            homelinkDeviceCount: 0
        )
    }

    @MainActor
    private func vehicleStatePreviewModel(_ input: VehicleStatePanelInput) -> VehicleStateModel {
        let source = InMemoryVehicleStateSource(initial: input)
        let model = VehicleStateModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — active") {
        VehicleStatePanel(model: vehicleStatePreviewModel(
            VehicleStatePanelInput(reading: VehicleStatePreviewData.active)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — restricted (imperial)") {
        VehicleStatePanel(model: vehicleStatePreviewModel(
            VehicleStatePanelInput(reading: VehicleStatePreviewData.restricted, units: .imperial)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleStatePanel(model: vehicleStatePreviewModel(VehicleStatePanelInput(reading: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleStatePanel(model: vehicleStatePreviewModel(VehicleStatePanelInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleStatePanel(model: vehicleStatePreviewModel(
            VehicleStatePanelInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        VehicleStatePanel(model: vehicleStatePreviewModel(
            VehicleStatePanelInput(reading: VehicleStatePreviewData.active, connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        VehicleStatePanel(model: vehicleStatePreviewModel(
            VehicleStatePanelInput(reading: VehicleStatePreviewData.active, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
