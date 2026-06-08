//
//  SystemHealthWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0099 · SystemHealthWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / content, in both compact and standard layouts). DEBUG-only; skipped by
//  the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SystemHealthUpdate) -> SystemHealthModel {
        let source = InMemorySystemHealthSource(initial: update)
        let model = SystemHealthModel(source: source)
        model.start()
        return model
    }

    private let healthyData = SystemHealthData(
        status: "healthy",
        components: [
            "database": SystemHealthComponentData(status: "ok"),
            "mqtt": SystemHealthComponentData(status: "healthy"),
            "tesla_api": SystemHealthComponentData(status: "healthy"),
            "fleet_telemetry": SystemHealthComponentData(status: "healthy")
        ],
        databaseSize: "2.4 GB"
    )

    private let degradedData = SystemHealthData(
        status: "degraded",
        components: [
            "database": SystemHealthComponentData(status: "ok"),
            "mqtt": SystemHealthComponentData(status: "healthy"),
            "tesla_api": SystemHealthComponentData(status: "degraded"),
            "fleet_telemetry": SystemHealthComponentData(status: "unhealthy")
        ],
        databaseSize: "2.4 GB"
    )

    private let previewSnapshot = SystemHealthSnapshot(
        health: healthyData,
        dbStats: SystemHealthDBStats(databaseSize: "2.4 GB"),
        runtime: SystemHealthRuntimeInfo(inUse: 8, maxOpen: 25, goroutines: 142, memoryMB: 312)
    )

    private let degradedSnapshot = SystemHealthSnapshot(
        health: degradedData,
        dbStats: SystemHealthDBStats(databaseSize: "2.4 GB"),
        runtime: SystemHealthRuntimeInfo(inUse: 19, maxOpen: 25, goroutines: 301, memoryMB: 588)
    )

    #Preview("Content (standard)") {
        SystemHealthWidget(
            model: previewModel(
                SystemHealthUpdate(status: .loaded, connection: .live, snapshot: previewSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 260, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (degraded)") {
        SystemHealthWidget(
            model: previewModel(
                SystemHealthUpdate(status: .loaded, connection: .live, snapshot: degradedSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 260, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        SystemHealthWidget(
            model: previewModel(
                SystemHealthUpdate(status: .loaded, connection: .live, snapshot: previewSnapshot, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SystemHealthWidget(model: previewModel(SystemHealthUpdate(status: .loading, snapshot: nil)))
            .frame(width: 260, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SystemHealthWidget(model: previewModel(SystemHealthUpdate(status: .loaded, snapshot: nil)))
            .frame(width: 260, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SystemHealthWidget(
            model: previewModel(SystemHealthUpdate(status: .failed("Network unavailable"), snapshot: nil))
        )
        .frame(width: 260, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SystemHealthWidget(
            model: previewModel(
                SystemHealthUpdate(
                    status: .loaded,
                    connection: .stale,
                    snapshot: previewSnapshot,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            )
        )
        .frame(width: 260, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SystemHealthWidget(
            model: previewModel(
                SystemHealthUpdate(
                    status: .loaded,
                    connection: .offline,
                    snapshot: degradedSnapshot,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 260, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
