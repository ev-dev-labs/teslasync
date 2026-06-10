//
//  TelemetryPipelineCard.Previews.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  Xcode previews for each surface state (content / streaming-only / broker-down / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TelemetryPipelineUpdate) -> TelemetryPipelineModel {
        let source = InMemoryTelemetryPipelineSource(initial: update)
        let model = TelemetryPipelineModel(source: source)
        model.start()
        return model
    }

    private func previewVehicles(now: Date = Date()) -> [TelemetryVehicleInput] {
        [
            TelemetryVehicleInput(
                id: 1, displayName: "Daily Driver", vin: "5YJSA1E60JF000ABC", state: "online",
                lastPoll: now.addingTimeInterval(-120), nextPoll: now.addingTimeInterval(30),
                lastStream: now.addingTimeInterval(-12), batteryLevel: 73
            ),
            TelemetryVehicleInput(
                id: 2, displayName: "Road Tripper", vin: "7SAYGDEE9PF000333", state: "charging",
                lastPoll: now.addingTimeInterval(-600), nextPoll: now.addingTimeInterval(120),
                lastStream: nil, batteryLevel: 41
            ),
            TelemetryVehicleInput(
                id: 3, displayName: "Garage Queen", vin: "5YJ3E1EA7KF000111", state: "asleep",
                lastPoll: now.addingTimeInterval(-3600), nextPoll: now.addingTimeInterval(900),
                lastStream: nil, batteryLevel: 18
            ),
            TelemetryVehicleInput(
                id: 4, displayName: "Loaner", vin: "LRW3E7EK0PC000444", state: "offline",
                lastPoll: nil, nextPoll: nil, lastStream: nil, batteryLevel: nil
            )
        ]
    }

    private func previewTotals() -> TelemetryFleetTotals {
        TelemetryFleetTotals(positions: 12366, drives: 48, chargingSessions: 7, signalLog: 97611)
    }

    private func loadedUpdate(
        connection: TelemetryPipelineConnection = .live,
        mqttConnected: Bool = true,
        pollingEnabled: Bool = true,
        vehicles: [TelemetryVehicleInput]? = nil
    ) -> TelemetryPipelineUpdate {
        TelemetryPipelineUpdate(
            status: .loaded,
            vehicles: vehicles ?? previewVehicles(),
            totals: previewTotals(),
            mqttConnected: mqttConnected,
            pollingEnabled: pollingEnabled,
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: TelemetryPipelineUpdate) -> some View {
        ScrollView {
            TelemetryPipelineCard(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Streaming-only") {
        previewSurface(loadedUpdate(
            pollingEnabled: false,
            vehicles: [previewVehicles()[0]]
        ))
    }

    #Preview("Broker down") {
        previewSurface(loadedUpdate(mqttConnected: false, pollingEnabled: false))
    }

    #Preview("Empty") {
        previewSurface(
            TelemetryPipelineUpdate(status: .loaded, vehicles: [], totals: previewTotals())
        )
    }

    #Preview("Loading") {
        previewSurface(TelemetryPipelineUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(TelemetryPipelineUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
