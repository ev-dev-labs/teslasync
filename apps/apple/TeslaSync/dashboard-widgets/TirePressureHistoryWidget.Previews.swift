//
//  TirePressureHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  content), in both metric (kPa) and imperial (psi) units. DEBUG-only; skipped by
//  the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TirePressureHistoryUpdate) -> TirePressureHistoryModel {
        let source = InMemoryTirePressureHistorySource(initial: update)
        let model = TirePressureHistoryModel(source: source)
        model.start()
        return model
    }

    /// Synthesizes a plausible four-corner pressure trace (SI kilopascals: a gentle
    /// drift around the 240–290 kPa / 2.4–2.9 bar band).
    private func previewSnapshots(count: Int = 36) -> [TirePressureSnapshotInput] {
        let start = Date().addingTimeInterval(-Double(count) * 300)
        let formatter = ISO8601DateFormatter()
        return (0 ..< count).map { index in
            let time = start.addingTimeInterval(Double(index) * 300)
            let phase = Double(index) / Double(count) * .pi * 2
            return TirePressureSnapshotInput(
                timestamp: formatter.string(from: time),
                frontLeft: 262 + 10 * sin(phase),
                frontRight: 258 + 9 * sin(phase + 0.4),
                rearLeft: 250 + 8 * sin(phase + 0.8),
                rearRight: 246 + 8 * sin(phase + 1.2)
            )
        }
    }

    private func loadedUpdate(
        connection: TirePressureConnection = .live,
        unit: TirePressureUnit = .bar,
        updatedAt: Date = Date()
    ) -> TirePressureHistoryUpdate {
        TirePressureHistoryUpdate(
            status: .loaded,
            connection: connection,
            snapshots: previewSnapshots(),
            unit: unit,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (wide, bar)") {
        TirePressureHistoryWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 3, rows: 6),
            onOpen: {}
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (psi)") {
        TirePressureHistoryWidget(
            model: previewModel(loadedUpdate(unit: .psi)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TirePressureHistoryWidget(model: previewModel(TirePressureHistoryUpdate(status: .loading)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TirePressureHistoryWidget(model: previewModel(TirePressureHistoryUpdate(status: .loaded)))
            .frame(width: 300, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TirePressureHistoryWidget(
            model: previewModel(TirePressureHistoryUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 300, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        TirePressureHistoryWidget(
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
