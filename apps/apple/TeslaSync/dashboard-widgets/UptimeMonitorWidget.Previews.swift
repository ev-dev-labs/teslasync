//
//  UptimeMonitorWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  Xcode previews for each surface state (content healthy / content degraded /
//  compact / loading / empty / error / stale / offline). DEBUG-only; skipped by
//  the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: UptimeMonitorUpdate) -> UptimeMonitorModel {
        let source = InMemoryUptimeMonitorSource(initial: update)
        let model = UptimeMonitorModel(source: source)
        model.start()
        return model
    }

    private let healthyData = UptimeMonitorWidgetSystemHealthData(
        status: "healthy",
        components: [
            "database": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy"),
            "mqtt": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy"),
            "tesla_api": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy"),
            "fleet_telemetry": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy")
        ],
        databaseSize: "248 MB",
        tableCount: 87
    )

    private let degradedData = UptimeMonitorWidgetSystemHealthData(
        status: "degraded",
        components: [
            "database": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy"),
            "mqtt": UptimeMonitorWidgetSystemHealthComponentData(status: "healthy"),
            "tesla_api": UptimeMonitorWidgetSystemHealthComponentData(
                status: "degraded",
                consecutiveFailures: 2,
                lastError: "429 Too Many Requests"
            ),
            "fleet_telemetry": UptimeMonitorWidgetSystemHealthComponentData(
                status: "unhealthy",
                consecutiveFailures: 11,
                lastError: "connection refused"
            )
        ],
        databaseSize: "1.2 GB",
        tableCount: 142
    )

    #Preview("Content · healthy (standard)") {
        UptimeMonitorWidget(
            model: previewModel(
                UptimeMonitorUpdate(status: .loaded, connection: .live, data: healthyData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · degraded (standard)") {
        UptimeMonitorWidget(
            model: previewModel(
                UptimeMonitorUpdate(status: .loaded, connection: .live, data: degradedData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 260, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · compact (1×1)") {
        UptimeMonitorWidget(
            model: previewModel(
                UptimeMonitorUpdate(status: .loaded, connection: .live, data: degradedData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 130, height: 130)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        UptimeMonitorWidget(model: previewModel(UptimeMonitorUpdate(status: .loading, data: nil)))
            .frame(width: 260, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        UptimeMonitorWidget(model: previewModel(UptimeMonitorUpdate(status: .loaded, data: nil)))
            .frame(width: 260, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        UptimeMonitorWidget(
            model: previewModel(UptimeMonitorUpdate(status: .failed("Network unavailable"), data: nil))
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        UptimeMonitorWidget(
            model: previewModel(
                UptimeMonitorUpdate(
                    status: .loaded,
                    connection: .stale,
                    data: healthyData,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 260, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        UptimeMonitorWidget(
            model: previewModel(
                UptimeMonitorUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: degradedData,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 260, height: 300)
        .padding()
        .background(Color.TS.bg)
    }
#endif
