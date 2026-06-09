//
//  ChargingTelemetryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  Xcode previews for each surface state (charging content / wide / compact /
//  not-charging / loading / error / offline). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: ChargingTelemetryUpdate,
        warm: [ChargingTelemetryUpdate] = []
    ) -> ChargingTelemetryModel {
        let source = InMemoryChargingTelemetrySource(initial: update)
        let model = ChargingTelemetryModel(source: source)
        model.start()
        for extra in warm {
            source.push(extra)
        }
        return model
    }

    private func chargingSnapshot(timestamp: String, power: Double) -> ChargingTelemetrySnapshot {
        ChargingTelemetrySnapshot(
            timestamp: timestamp,
            chargingState: "Charging",
            chargerVoltage: 232,
            chargerActualCurrent: 31,
            chargerPowerW: power,
            chargerPhases: 3,
            chargerPilotCurrent: 32
        )
    }

    private let chargingUpdate = ChargingTelemetryUpdate(
        status: .loaded,
        connection: .live,
        snapshot: chargingSnapshot(timestamp: "2026-06-08T20:00:00Z", power: 7.2),
        updatedAt: Date()
    )

    /// A short history so the wide preview shows the sparkline.
    private let warmSamples: [ChargingTelemetryUpdate] = [
        ChargingTelemetryUpdate(
            status: .loaded,
            snapshot: chargingSnapshot(timestamp: "t1", power: 6.4),
            updatedAt: Date()
        ),
        ChargingTelemetryUpdate(
            status: .loaded,
            snapshot: chargingSnapshot(timestamp: "t2", power: 7.0),
            updatedAt: Date()
        ),
        ChargingTelemetryUpdate(
            status: .loaded,
            snapshot: chargingSnapshot(timestamp: "t3", power: 7.4),
            updatedAt: Date()
        )
    ]

    #Preview("Charging (standard)") {
        ChargingTelemetryWidget(
            model: previewModel(chargingUpdate),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 280, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging (wide)") {
        ChargingTelemetryWidget(
            model: previewModel(chargingUpdate, warm: warmSamples),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 520, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Charging (compact)") {
        ChargingTelemetryWidget(
            model: previewModel(chargingUpdate),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Not charging") {
        ChargingTelemetryWidget(
            model: previewModel(
                ChargingTelemetryUpdate(
                    status: .loaded,
                    snapshot: ChargingTelemetrySnapshot(timestamp: "t0", chargingState: "Disconnected"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 280, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargingTelemetryWidget(
            model: previewModel(ChargingTelemetryUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 280, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargingTelemetryWidget(
            model: previewModel(ChargingTelemetryUpdate(status: .failed("Network unavailable"))),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 280, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargingTelemetryWidget(
            model: previewModel(
                ChargingTelemetryUpdate(
                    status: .loaded,
                    connection: .offline,
                    snapshot: chargingSnapshot(timestamp: "t0", power: 7.2),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        )
        .frame(width: 520, height: 260)
        .padding()
        .background(Color.TS.bg)
    }
#endif
