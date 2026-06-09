//
//  ClimateHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  content), in both Celsius and Fahrenheit. DEBUG-only; skipped by the swiftc host
//  gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ClimateHistoryUpdate) -> ClimateHistoryModel {
        let source = InMemoryClimateHistorySource(initial: update)
        let model = ClimateHistoryModel(source: source)
        model.start()
        return model
    }

    /// Synthesizes a plausible cabin/outside trace (SI Celsius): a warm, stable cabin
    /// (~22 °C) above a cooler, more variable outside (~8–16 °C).
    private func previewSnapshots(count: Int = 36) -> [ClimateSnapshotInput] {
        let start = Date().addingTimeInterval(-Double(count) * 300)
        let formatter = ISO8601DateFormatter()
        return (0 ..< count).map { index in
            let time = start.addingTimeInterval(Double(index) * 300)
            let phase = Double(index) / Double(count) * .pi * 2
            return ClimateSnapshotInput(
                createdAt: formatter.string(from: time),
                insideTemp: 22 + 1.5 * sin(phase + 0.3),
                outsideTemp: 12 + 4 * sin(phase)
            )
        }
    }

    private func loadedUpdate(
        connection: ClimateConnection = .live,
        unit: ClimateTemperatureUnit = .celsius,
        updatedAt: Date = Date()
    ) -> ClimateHistoryUpdate {
        ClimateHistoryUpdate(
            status: .loaded,
            connection: connection,
            snapshots: previewSnapshots(),
            unit: unit,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (wide, °C)") {
        ClimateHistoryWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 3, rows: 6),
            onOpen: {}
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (°F)") {
        ClimateHistoryWidget(
            model: previewModel(loadedUpdate(unit: .fahrenheit)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ClimateHistoryWidget(model: previewModel(ClimateHistoryUpdate(status: .loading)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ClimateHistoryWidget(model: previewModel(ClimateHistoryUpdate(status: .loaded)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ClimateHistoryWidget(
            model: previewModel(ClimateHistoryUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ClimateHistoryWidget(
            model: previewModel(
                loadedUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600))
            ),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
