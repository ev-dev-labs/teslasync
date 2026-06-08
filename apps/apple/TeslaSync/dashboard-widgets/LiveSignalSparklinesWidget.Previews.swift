//
//  LiveSignalSparklinesWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  Xcode previews for each surface state (content / wide two-column / loading /
//  empty / error / stale / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveSignalSparklinesUpdate) -> LiveSignalSparklinesModel {
        let source = InMemoryLiveSignalSparklinesSource(initial: update)
        let model = LiveSignalSparklinesModel(source: source)
        model.start()
        return model
    }

    private func previewHistory(base: Double, drift: Double) -> [SignalHistorySample] {
        (0 ..< 24).map { step in
            let fraction = Double(step) / 23
            let value = base + drift * fraction + sin(fraction * 6) * (abs(drift) * 0.15 + 1)
            return SignalHistorySample(valueNum: value)
        }
    }

    private let previewSignals = [
        "BatteryLevel", "VehicleSpeed", "OutsideTemp", "InsideTemp", "Odometer", "PackCurrent"
    ]

    private func previewUpdate(
        status: SignalLoadStatus = .loaded,
        connection: SignalConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = Date()
    ) -> LiveSignalSparklinesUpdate {
        LiveSignalSparklinesUpdate(
            status: status,
            connection: connection,
            isFetching: isFetching,
            isError: isError,
            vehicleID: 1,
            availableSignals: previewSignals,
            configuredSignals: nil,
            liveValues: [
                "BatteryLevel": .number(76.4),
                "VehicleSpeed": .number(0),
                "OutsideTemp": .number(18.5),
                "InsideTemp": .text("21.0"),
                "Odometer": .number(48211.2),
                "PackCurrent": .number(-3.4)
            ],
            histories: [
                "BatteryLevel": previewHistory(base: 70, drift: 6),
                "VehicleSpeed": previewHistory(base: 40, drift: -38),
                "OutsideTemp": previewHistory(base: 18, drift: 1),
                "InsideTemp": previewHistory(base: 20, drift: 1.5),
                "Odometer": previewHistory(base: 48200, drift: 11),
                "PackCurrent": previewHistory(base: -2, drift: -4)
            ],
            updatedAt: updatedAt
        )
    }

    private let previewEmpty = LiveSignalSparklinesUpdate(
        status: .loaded,
        availableSignals: [],
        configuredSignals: []
    )

    #Preview("Content") {
        LiveSignalSparklinesWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide · two columns") {
        LiveSignalSparklinesWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 8)
        )
        .frame(width: 520, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LiveSignalSparklinesWidget(model: previewModel(previewUpdate(status: .loading, updatedAt: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveSignalSparklinesWidget(model: previewModel(previewEmpty))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveSignalSparklinesWidget(
            model: previewModel(
                LiveSignalSparklinesUpdate(
                    status: .failed("Network unavailable"),
                    isError: true,
                    availableSignals: [],
                    configuredSignals: []
                )
            )
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LiveSignalSparklinesWidget(
            model: previewModel(previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-240)))
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LiveSignalSparklinesWidget(
            model: previewModel(previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
