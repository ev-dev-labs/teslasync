//
//  ChargingScheduleWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  Xcode previews for each surface state (content / no-times / compact / loading
//  / empty / error / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargingScheduleUpdate) -> ChargingScheduleModel {
        let source = InMemoryChargingScheduleSource(initial: update)
        let model = ChargingScheduleModel(source: source)
        model.start()
        return model
    }

    private let previewOptions = ChargingScheduleFormatOptions(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    private let scheduledSignals = ChargingScheduleSignals(
        mode: "StartAt",
        pending: true,
        startTime: "2026-06-08T23:30:00Z",
        departureTime: "2026-06-09T15:00:00Z",
        chargeLimitSoc: 80
    )

    private let sampleState = ChargingScheduleStateDTO(batteryLevel: 64, isCharging: true)

    #Preview("Content") {
        ChargingScheduleWidget(
            model: previewModel(
                ChargingScheduleUpdate(
                    status: .loaded,
                    connection: .live,
                    signals: scheduledSignals,
                    state: sampleState,
                    options: previewOptions,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No scheduled times") {
        ChargingScheduleWidget(
            model: previewModel(
                ChargingScheduleUpdate(
                    status: .loaded,
                    connection: .live,
                    signals: ChargingScheduleSignals(mode: "Off", chargeLimitSoc: 90),
                    state: sampleState,
                    options: previewOptions,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        ChargingScheduleWidget(
            model: previewModel(
                ChargingScheduleUpdate(
                    status: .loaded,
                    connection: .live,
                    signals: scheduledSignals,
                    state: sampleState,
                    options: previewOptions
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 160, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargingScheduleWidget(model: previewModel(ChargingScheduleUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargingScheduleWidget(
            model: previewModel(
                ChargingScheduleUpdate(status: .loaded, signals: ChargingScheduleSignals(), state: sampleState)
            )
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargingScheduleWidget(
            model: previewModel(ChargingScheduleUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargingScheduleWidget(
            model: previewModel(
                ChargingScheduleUpdate(
                    status: .loaded,
                    connection: .offline,
                    signals: scheduledSignals,
                    state: sampleState,
                    options: previewOptions,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
