//
//  TelemetryErrorsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / fetching / content + no-errors, in both compact and standard
//  layouts). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TelemetryErrorsUpdate) -> TelemetryErrorsWidgetModel {
        let source = TelemetryErrorsWidgetInMemoryTelemetryErrorsSource(initial: update)
        let model = TelemetryErrorsWidgetModel(source: source)
        model.start()
        return model
    }

    private let previewVINs = [
        TelemetryErrorVIN(id: 1, vin: "5YJ3E1EA7KF000001", active: true),
        TelemetryErrorVIN(id: 2, vin: "7SAYGDEE9PF000002", active: true),
        TelemetryErrorVIN(id: 3, vin: "LRW3E7FA5MC000003", active: false)
    ]

    private let previewErrors = [
        TelemetryErrorEntry(
            id: 11,
            vin: "5YJ3E1EA7KF000001",
            errorCode: "FLEET_TELEMETRY_CONFIG_INVALID",
            reportedAt: Date().addingTimeInterval(-90)
        ),
        TelemetryErrorEntry(
            id: 12,
            vin: "5YJ3E1EA7KF000001",
            errorCode: "FLEET_TELEMETRY_CONFIG_INVALID",
            reportedAt: Date().addingTimeInterval(-300)
        ),
        TelemetryErrorEntry(
            id: 13,
            vin: "7SAYGDEE9PF000002",
            errorCode: "VEHICLE_OFFLINE",
            reportedAt: Date().addingTimeInterval(-7200)
        ),
        TelemetryErrorEntry(
            id: 14,
            vin: "7SAYGDEE9PF000002",
            errorCode: nil,
            fetchedAt: Date().addingTimeInterval(-172_800)
        )
    ]

    private let populatedUpdate = TelemetryErrorsUpdate(
        status: .loaded,
        freshness: .live,
        vins: previewVINs,
        errors: previewErrors,
        updatedAt: Date()
    )

    #Preview("Content (standard)") {
        TelemetryErrorsWidget(
            model: previewModel(populatedUpdate),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        TelemetryErrorsWidget(
            model: previewModel(populatedUpdate),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Healthy (no active VINs)") {
        TelemetryErrorsWidget(
            model: previewModel(
                TelemetryErrorsUpdate(
                    status: .loaded,
                    vins: [TelemetryErrorVIN(id: 3, vin: "LRW3E7FA5MC000003", active: false)],
                    errors: [],
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TelemetryErrorsWidget(model: previewModel(TelemetryErrorsUpdate(status: .loading)))
            .frame(width: 280, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TelemetryErrorsWidget(model: previewModel(TelemetryErrorsUpdate(status: .loaded)))
            .frame(width: 280, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TelemetryErrorsWidget(
            model: previewModel(TelemetryErrorsUpdate(status: .failed("Network unavailable"), freshness: .error))
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Fetching (cached)") {
        TelemetryErrorsWidget(
            model: previewModel(
                TelemetryErrorsUpdate(
                    status: .loaded,
                    freshness: .fetching,
                    vins: previewVINs,
                    errors: previewErrors,
                    updatedAt: Date().addingTimeInterval(-30)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        TelemetryErrorsWidget(
            model: previewModel(
                TelemetryErrorsUpdate(
                    status: .loaded,
                    freshness: .stale,
                    vins: previewVINs,
                    errors: previewErrors,
                    updatedAt: Date().addingTimeInterval(-3600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        TelemetryErrorsWidget(
            model: previewModel(
                TelemetryErrorsUpdate(
                    status: .loaded,
                    freshness: .offline,
                    vins: previewVINs,
                    errors: previewErrors,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 300)
        .padding()
        .background(Color.TS.bg)
    }
#endif
