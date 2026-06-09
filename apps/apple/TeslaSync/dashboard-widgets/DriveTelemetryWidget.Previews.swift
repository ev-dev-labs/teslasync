//
//  DriveTelemetryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  content / no-telemetry). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveTelemetryUpdate) -> DriveTelemetryModel {
        let source = InMemoryDriveTelemetrySource(initial: update)
        let model = DriveTelemetryModel(source: source)
        model.start()
        return model
    }

    /// Synthesizes a plausible speed / power / battery / elevation trace.
    private func previewTelemetry(count: Int = 48) -> [DriveTelemetryPointInput] {
        let start = Date().addingTimeInterval(-Double(count) * 30)
        let formatter = ISO8601DateFormatter()
        return (0 ..< count).map { index in
            let time = start.addingTimeInterval(Double(index) * 30)
            let phase = Double(index) / Double(count) * .pi * 2
            return DriveTelemetryPointInput(
                timestamp: formatter.string(from: time),
                speed: max(0, 18 + 14 * sin(phase)),
                power: 60 * sin(phase * 1.3) - 8,
                batteryLevel: 82 - Double(index) / Double(count) * 24,
                elevation: 120 + 60 * sin(phase * 0.6)
            )
        }
    }

    private func previewDrives() -> [DriveTelemetrySummaryInput] {
        [
            DriveTelemetrySummaryInput(
                id: 1,
                startTs: "2026-06-07T08:10:00Z",
                distanceM: 18400,
                durationS: 1620,
                energyUsedWh: 3120,
                startAddress: "1 Tesla Road, Austin, TX"
            ),
            DriveTelemetrySummaryInput(
                id: 2,
                startTs: "2026-06-07T17:42:00Z",
                distanceM: 24900,
                durationS: 2040,
                energyUsedWh: 4180,
                startAddress: "500 Congress Ave, Austin, TX"
            )
        ]
    }

    private func loadedUpdate(
        connection: DriveTelemetryConnection = .live,
        measurement: MeasurementSystem = .metric,
        telemetry: [DriveTelemetryPointInput]? = nil,
        updatedAt: Date = Date()
    ) -> DriveTelemetryUpdate {
        DriveTelemetryUpdate(
            status: .loaded,
            connection: connection,
            drives: previewDrives(),
            telemetry: telemetry ?? previewTelemetry(),
            measurement: measurement,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (wide)") {
        DriveTelemetryWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 3, rows: 6),
            onOpen: {}
        )
        .frame(width: 400, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (imperial)") {
        DriveTelemetryWidget(
            model: previewModel(loadedUpdate(measurement: .imperial)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No telemetry") {
        DriveTelemetryWidget(
            model: previewModel(loadedUpdate(telemetry: [])),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DriveTelemetryWidget(model: previewModel(DriveTelemetryUpdate(status: .loading)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DriveTelemetryWidget(model: previewModel(DriveTelemetryUpdate(status: .loaded)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveTelemetryWidget(model: previewModel(DriveTelemetryUpdate(status: .failed("Network unavailable"))))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DriveTelemetryWidget(
            model: previewModel(
                loadedUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600))
            ),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 400, height: 340)
        .padding()
        .background(Color.TS.bg)
    }
#endif
