//
//  DigitalTwinWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/offline/content). DEBUG-only; skipped by the swiftc host
//  gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private func previewModel(_ update: DigitalTwinUpdate) -> DigitalTwinModel {
        let source = InMemoryDigitalTwinSource(initial: update)
        let model = DigitalTwinModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = TwinVehicle(id: 1, displayName: "Model Y", vin: "5YJYG", exteriorColor: "blue")

    #Preview("Content") {
        DigitalTwinWidget(
            model: previewModel(
                DigitalTwinUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    security: TwinSecurityInput(
                        doorState: .text("OpenDriverFront"),
                        fdWindow: "Open",
                        fpWindow: "Closed",
                        rdWindow: "Closed",
                        rpWindow: "Closed",
                        locked: false,
                        sentryMode: true,
                        lightsHighBeams: true,
                        createdAt: Date()
                    ),
                    vehicleState: TwinVehicleStateInput(state: "driving", speed: 32),
                    charging: nil,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DigitalTwinWidget(model: previewModel(DigitalTwinUpdate(status: .loading, vehicle: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DigitalTwinWidget(model: previewModel(DigitalTwinUpdate(status: .loaded, vehicle: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DigitalTwinWidget(model: previewModel(DigitalTwinUpdate(status: .failed("Network unavailable"), vehicle: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DigitalTwinWidget(
            model: previewModel(
                DigitalTwinUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicle: previewVehicle,
                    security: TwinSecurityInput(locked: true, createdAt: Date()),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
