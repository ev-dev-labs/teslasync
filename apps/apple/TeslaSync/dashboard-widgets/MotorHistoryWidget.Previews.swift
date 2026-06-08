//
//  MotorHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0066 · MotorHistoryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  content). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private func previewModel(_ update: MotorHistoryUpdate) -> MotorHistoryModel {
        let source = InMemoryMotorHistorySource(initial: update)
        let model = MotorHistoryModel(source: source)
        model.start()
        return model
    }

    /// Synthesizes a plausible torque / stator-temp / g-force trace.
    private func previewSnapshots(count: Int = 40) -> [MotorSnapshotInput] {
        let start = Date().addingTimeInterval(-Double(count) * 30)
        let formatter = ISO8601DateFormatter()
        return (0 ..< count).map { index in
            let time = start.addingTimeInterval(Double(index) * 30)
            let phase = Double(index) / Double(count) * .pi * 2
            return MotorSnapshotInput(
                ts: formatter.string(from: time),
                diTorque: 180 + 140 * sin(phase),
                diStatorTemp: 70 + 45 * (0.5 + 0.5 * sin(phase * 0.7)),
                gear: "D",
                lateralAccel: 0.4 * sin(phase * 1.3),
                longitudinalAccel: 0.3 * cos(phase * 1.1)
            )
        }
    }

    private func loadedUpdate(
        connection: MotorConnection = .live,
        measurement: MeasurementSystem = .metric,
        updatedAt: Date = Date()
    ) -> MotorHistoryUpdate {
        MotorHistoryUpdate(
            status: .loaded,
            connection: connection,
            snapshots: previewSnapshots(),
            measurement: measurement,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (wide)") {
        MotorHistoryWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 3, rows: 6),
            onOpen: {}
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (imperial)") {
        MotorHistoryWidget(
            model: previewModel(loadedUpdate(measurement: .imperial)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MotorHistoryWidget(model: previewModel(MotorHistoryUpdate(status: .loading)))
            .frame(width: 280, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MotorHistoryWidget(model: previewModel(MotorHistoryUpdate(status: .loaded)))
            .frame(width: 280, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MotorHistoryWidget(model: previewModel(MotorHistoryUpdate(status: .failed("Network unavailable"))))
            .frame(width: 280, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MotorHistoryWidget(
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
