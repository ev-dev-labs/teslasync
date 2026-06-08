//
//  MQTTStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0068 · MQTTStatusWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / content, in both compact and standard layouts). DEBUG-only; skipped by
//  the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MQTTStatusUpdate) -> MQTTStatusModel {
        let source = InMemoryMQTTStatusSource(initial: update)
        let model = MQTTStatusModel(source: source)
        model.start()
        return model
    }

    private let previewData = MQTTStatusData(
        connected: true,
        broker: "mqtts://mosquitto:8883",
        vehicles: [
            MQTTVehicleTelemetry(
                vin: "5YJ3E1EA7KF000001",
                signalCount: 18234,
                signalsPerSecond: 12.4,
                lastReceived: Date().addingTimeInterval(-8)
            ),
            MQTTVehicleTelemetry(
                vin: "7SAYGDEE9PF000002",
                signalCount: 9210,
                signalsPerSecond: 7.1,
                lastReceived: Date().addingTimeInterval(-42)
            )
        ]
    )

    #Preview("Content (standard)") {
        MQTTStatusWidget(
            model: previewModel(
                MQTTStatusUpdate(status: .loaded, connection: .live, data: previewData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        MQTTStatusWidget(
            model: previewModel(
                MQTTStatusUpdate(status: .loaded, connection: .live, data: previewData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MQTTStatusWidget(model: previewModel(MQTTStatusUpdate(status: .loading, data: nil)))
            .frame(width: 260, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MQTTStatusWidget(model: previewModel(MQTTStatusUpdate(status: .loaded, data: nil)))
            .frame(width: 260, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MQTTStatusWidget(model: previewModel(MQTTStatusUpdate(status: .failed("Network unavailable"), data: nil)))
            .frame(width: 260, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        MQTTStatusWidget(
            model: previewModel(
                MQTTStatusUpdate(
                    status: .loaded,
                    connection: .stale,
                    data: previewData,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            )
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MQTTStatusWidget(
            model: previewModel(
                MQTTStatusUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: MQTTStatusData(
                        connected: false,
                        broker: "mqtts://mosquitto:8883",
                        vehicles: previewData.vehicles
                    ),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
