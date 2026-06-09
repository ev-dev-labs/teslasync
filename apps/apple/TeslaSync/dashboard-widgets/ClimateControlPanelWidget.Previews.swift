//
//  ClimateControlPanelWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  Xcode previews for each surface state (content full °C/°F, compact, loading,
//  empty, error, stale, offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ClimatePanelUpdate) -> ClimatePanelModel {
        let source = InMemoryClimatePanelSource(initial: update)
        let model = ClimatePanelModel(source: source)
        model.start()
        return model
    }

    /// A rich, plausible cabin snapshot (SI Celsius): a warm cabin above a cool
    /// outside, HVAC running, fan on, three seat heaters, wheel heat, defrost, and
    /// the battery heater — so every branch of the full panel renders.
    private func previewInput() -> ClimatePanelInput {
        ClimatePanelInput(
            insideTemp: 22,
            outsideTemp: 8,
            hvacPower: 2.3,
            hvacACEnabled: true,
            hvacFanSpeed: 4,
            seatHeaterLeft: 3,
            seatHeaterRight: 2,
            seatHeaterRearCenter: 1,
            steeringWheelHeatLevel: 2,
            defrostMode: "Front",
            batteryHeaterOn: true
        )
    }

    private func loadedUpdate(
        connection: ClimatePanelConnection = .live,
        unit: ClimatePanelTemperatureUnit = .celsius,
        input: ClimatePanelInput? = nil,
        updatedAt: Date = Date()
    ) -> ClimatePanelUpdate {
        ClimatePanelUpdate(
            status: .loaded,
            connection: connection,
            input: input ?? previewInput(),
            unit: unit,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (full, °C)") {
        ClimateControlPanelWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (full, °F)") {
        ClimateControlPanelWidget(
            model: previewModel(loadedUpdate(unit: .fahrenheit)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (no seat heaters)") {
        ClimateControlPanelWidget(
            model: previewModel(
                loadedUpdate(
                    input: ClimatePanelInput(
                        insideTemp: 19,
                        outsideTemp: 14,
                        hvacACEnabled: false,
                        hvacFanSpeed: 0,
                        steeringWheelHeatLevel: 0
                    )
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×1)") {
        ClimateControlPanelWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ClimateControlPanelWidget(model: previewModel(ClimatePanelUpdate(status: .loading)))
            .frame(width: 300, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ClimateControlPanelWidget(model: previewModel(ClimatePanelUpdate(status: .loaded)))
            .frame(width: 300, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ClimateControlPanelWidget(
            model: previewModel(ClimatePanelUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ClimateControlPanelWidget(
            model: previewModel(loadedUpdate(connection: .stale)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ClimateControlPanelWidget(
            model: previewModel(
                loadedUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600))
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
