//
//  LiveVehicleState.Previews.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  Xcode previews for each surface state (loading / content-active / content-idle /
//  empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveVehicleStateUpdate) -> LiveVehicleStateModel {
        let source = InMemoryLiveVehicleStateSource(initial: update)
        let model = LiveVehicleStateModel(source: source)
        model.start()
        return model
    }

    private let activeEvent = LiveVehicleStateLatest(
        lightsHazardsActive: true,
        lightsHighBeams: false,
        lightsTurnSignal: .text("Left"),
        driverSeatOccupied: true,
        pairedPhoneKeyCount: 2,
        valetModeEnabled: false,
        serviceMode: false,
        speedLimitMode: .boolean(true),
        homelinkDeviceCount: 3,
        centerDisplay: .text("Drive"),
        createdAt: Date()
    )

    private let idleEvent = LiveVehicleStateLatest(
        lightsHazardsActive: false,
        lightsHighBeams: false,
        lightsTurnSignal: .text("Off"),
        driverSeatOccupied: false,
        pairedPhoneKeyCount: 0,
        valetModeEnabled: false,
        serviceMode: false,
        speedLimitMode: .boolean(false),
        homelinkDeviceCount: 0,
        centerDisplay: .text("Off"),
        createdAt: Date()
    )

    #Preview("Loading") {
        LiveVehicleState(model: previewModel(LiveVehicleStateUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content — active") {
        LiveVehicleState(model: previewModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .live, latest: activeEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — idle") {
        LiveVehicleState(model: previewModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .live, latest: idleEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveVehicleState(model: previewModel(LiveVehicleStateUpdate(status: .empty, latest: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveVehicleState(model: previewModel(
            LiveVehicleStateUpdate(status: .failed("Tesla API returned 503 Service Unavailable"), latest: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LiveVehicleState(model: previewModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .stale, latest: activeEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        LiveVehicleState(model: previewModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .offline, latest: activeEvent)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
