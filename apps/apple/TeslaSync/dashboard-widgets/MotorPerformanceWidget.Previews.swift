//
//  MotorPerformanceWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty / error / stale / offline).
//  DEBUG-only; skipped by the release build.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MotorUpdate) -> MotorPerformanceModel {
        let source = InMemoryMotorPerformanceSource(initial: update)
        let model = MotorPerformanceModel(source: source)
        model.start()
        return model
    }

    private let previewSnapshot = MotorPerformanceWidgetSnapshotInput(
        diTorque: 312,
        diStatorTemp: 78,
        motorTempCFront: 64,
        gear: "D",
        shiftState: "D",
        lateralAccel: 0.12,
        longitudinalAccel: -0.34
    )

    #Preview("Content") {
        MotorPerformanceWidget(
            model: previewModel(
                MotorUpdate(
                    status: .loaded,
                    connection: .live,
                    snapshot: previewSnapshot,
                    temperatureUnit: .celsius,
                    updatedAt: Date(),
                    isFetching: false
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        MotorPerformanceWidget(
            model: previewModel(
                MotorUpdate(status: .loaded, connection: .live, snapshot: previewSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MotorPerformanceWidget(model: previewModel(MotorUpdate(status: .loading, snapshot: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MotorPerformanceWidget(model: previewModel(MotorUpdate(status: .loaded, snapshot: nil)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MotorPerformanceWidget(
            model: previewModel(MotorUpdate(status: .failed("Network unavailable"), snapshot: nil))
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (Fahrenheit)") {
        MotorPerformanceWidget(
            model: previewModel(
                MotorUpdate(
                    status: .loaded,
                    connection: .stale,
                    snapshot: previewSnapshot,
                    temperatureUnit: .fahrenheit,
                    updatedAt: Date().addingTimeInterval(-180),
                    isFetching: true
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MotorPerformanceWidget(
            model: previewModel(
                MotorUpdate(
                    status: .loaded,
                    connection: .offline,
                    snapshot: previewSnapshot,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
