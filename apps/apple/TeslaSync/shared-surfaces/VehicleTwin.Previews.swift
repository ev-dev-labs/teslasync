//
//  VehicleTwin.Previews.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  Xcode previews for each surface state (content rich / calm / driving / unknown, loading, error,
//  empty, stale, offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: VehicleTwinInput) -> VehicleTwinSurfaceModel {
        let source = InMemoryVehicleTwinSource(initial: input)
        let model = VehicleTwinSurfaceModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let richState = VehicleTwinState(
        doors: DigitalTwinWidgetTwinDoorStates(
            driverFront: true,
            passengerFront: false,
            driverRear: false,
            passengerRear: false,
            trunkFront: true,
            trunkRear: false
        ),
        windowFD: .open,
        windowFP: .closed,
        windowRD: .partial,
        windowRP: .closed,
        frunkOpen: true,
        trunkOpen: false,
        chargePortOpen: true,
        isCharging: true,
        isDriving: false,
        locked: false,
        sentryMode: true,
        headlights: true,
        hazards: false,
        turnSignal: .left,
        driverSeatOccupied: true,
        vehicleColor: "DeepBlue",
        lastUpdated: Date(timeIntervalSinceNow: -90)
    )

    private let calmState = VehicleTwinState(
        doors: DigitalTwinWidgetTwinDoorStates(
            driverFront: false,
            passengerFront: false,
            driverRear: false,
            passengerRear: false,
            trunkFront: false,
            trunkRear: false
        ),
        windowFD: .closed,
        windowFP: .closed,
        windowRD: .closed,
        windowRP: .closed,
        frunkOpen: false,
        trunkOpen: false,
        chargePortOpen: false,
        isCharging: false,
        isDriving: false,
        locked: true,
        sentryMode: false,
        headlights: false,
        hazards: false,
        turnSignal: .off,
        driverSeatOccupied: false,
        vehicleColor: "PearlWhite",
        lastUpdated: Date(timeIntervalSinceNow: -20)
    )

    private let drivingState = VehicleTwinState(
        windowFD: .closed,
        windowFP: .closed,
        windowRD: .closed,
        windowRP: .closed,
        frunkOpen: false,
        trunkOpen: false,
        isCharging: false,
        isDriving: true,
        locked: true,
        sentryMode: false,
        headlights: true,
        hazards: true,
        turnSignal: .both,
        driverSeatOccupied: true,
        vehicleColor: "RedMulticoat",
        lastUpdated: Date()
    )

    private func contentInput(
        _ state: VehicleTwinState,
        connection: VehicleTwinConnection = .live,
        driveIn: Bool = false,
        exterior: String? = nil
    ) -> VehicleTwinInput {
        VehicleTwinInput(
            loadStatus: .loaded,
            connection: connection,
            state: state,
            vehicleID: 7,
            exteriorColor: exterior ?? state.vehicleColor,
            size: .medium,
            driveIn: driveIn,
            interactive: true,
            updatedAt: state.lastUpdated
        )
    }

    #Preview("Content · rich") {
        VehicleTwin(model: previewModel(contentInput(richState)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · calm") {
        VehicleTwin(model: previewModel(contentInput(calmState)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · driving + drive-in") {
        VehicleTwin(model: previewModel(contentInput(drivingState, driveIn: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · unknown state") {
        VehicleTwin(model: previewModel(
            VehicleTwinInput(loadStatus: .loaded, state: .empty, vehicleID: 7, updatedAt: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleTwin(model: previewModel(VehicleTwinInput(loadStatus: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleTwin(model: previewModel(VehicleTwinInput(loadStatus: .failed("Network request timed out"))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleTwin(model: previewModel(VehicleTwinInput(loadStatus: .empty)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        VehicleTwin(model: previewModel(contentInput(richState, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        VehicleTwin(model: previewModel(contentInput(calmState, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }
#endif
