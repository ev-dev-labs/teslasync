//
//  ClimateStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  Xcode previews for each surface state (content °C/°F, partial data, loading,
//  empty, error, stale, offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ClimateStatusUpdate) -> ClimateStatusModel {
        let source = InMemoryClimateStatusSource(initial: update)
        let model = ClimateStatusModel(source: source)
        model.start()
        return model
    }

    /// A rich, plausible cabin snapshot (SI Celsius): a warm cabin above a cool
    /// outside, HVAC drawing power, defrost on, and the battery heater on — so every
    /// row and both chips render.
    private func previewInput() -> ClimateStatusInput {
        ClimateStatusInput(
            insideTemp: 22,
            outsideTemp: 8,
            hvacPower: 2.3,
            defrostMode: "Front",
            batteryHeaterOn: true
        )
    }

    private func loadedUpdate(
        connection: ClimateStatusConnection = .live,
        unit: ClimateStatusTemperatureUnit = .celsius,
        input: ClimateStatusInput? = nil,
        updatedAt: Date = Date()
    ) -> ClimateStatusUpdate {
        ClimateStatusUpdate(
            status: .loaded,
            connection: connection,
            input: input ?? previewInput(),
            unit: unit,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (°C)") {
        ClimateStatusWidget(model: previewModel(loadedUpdate()))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content (°F)") {
        ClimateStatusWidget(model: previewModel(loadedUpdate(unit: .fahrenheit)))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content (no chips, partial)") {
        ClimateStatusWidget(
            model: previewModel(
                loadedUpdate(
                    input: ClimateStatusInput(insideTemp: 19, outsideTemp: nil, hvacPower: nil)
                )
            )
        )
        .frame(width: 200, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ClimateStatusWidget(model: previewModel(ClimateStatusUpdate(status: .loading)))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ClimateStatusWidget(model: previewModel(ClimateStatusUpdate(status: .loaded)))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ClimateStatusWidget(model: previewModel(ClimateStatusUpdate(status: .failed("Network unavailable"))))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ClimateStatusWidget(model: previewModel(loadedUpdate(connection: .stale)))
            .frame(width: 200, height: 220)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ClimateStatusWidget(
            model: previewModel(loadedUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
        )
        .frame(width: 200, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
