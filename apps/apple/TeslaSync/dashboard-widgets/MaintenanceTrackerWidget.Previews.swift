//
//  MaintenanceTrackerWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / offline / stale). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MaintenanceUpdate) -> MaintenanceModel {
        let source = InMemoryMaintenanceSource(initial: update)
        let model = MaintenanceModel(source: source)
        model.start()
        return model
    }

    private let previewItems: [MaintenanceItemInput] = [
        MaintenanceItemInput(
            id: "tires",
            name: "Tire Rotation",
            intervalKm: 10000,
            intervalMonths: 2,
            estimatedCostUsd: 80
        ),
        MaintenanceItemInput(
            id: "cabin",
            name: "Cabin Air Filter",
            intervalKm: 30000,
            intervalMonths: 12,
            estimatedCostUsd: 45
        ),
        MaintenanceItemInput(
            id: "brake",
            name: "Brake Fluid",
            intervalKm: 40000,
            intervalMonths: 24,
            estimatedCostUsd: 120
        )
    ]

    private let previewRecords: [ServiceRecordInput] = [
        ServiceRecordInput(
            itemId: "tires",
            date: "2024-04-04T10:00:00Z",
            odometerKm: 22000,
            notes: "Rotated + balanced"
        ),
        ServiceRecordInput(itemId: "cabin", date: "2024-01-15T10:00:00Z", odometerKm: 18000, notes: ""),
        ServiceRecordInput(itemId: "brake", date: "2023-09-01T10:00:00Z", odometerKm: 12000, notes: "Flushed")
    ]

    private let previewFormat = MaintenanceFormatting(
        distanceUnit: "mi",
        currencySymbol: "$",
        currencyPrecision: 0,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    #Preview("Content (standard)") {
        MaintenanceTrackerWidget(
            model: previewModel(
                MaintenanceUpdate(
                    status: .loaded,
                    connection: .live,
                    maintenance: previewItems,
                    records: previewRecords,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        MaintenanceTrackerWidget(
            model: previewModel(
                MaintenanceUpdate(
                    status: .loaded,
                    maintenance: previewItems,
                    records: previewRecords,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MaintenanceTrackerWidget(model: previewModel(MaintenanceUpdate(status: .loading)))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MaintenanceTrackerWidget(model: previewModel(MaintenanceUpdate(status: .loaded)))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MaintenanceTrackerWidget(model: previewModel(MaintenanceUpdate(status: .failed("Network unavailable"))))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        MaintenanceTrackerWidget(
            model: previewModel(
                MaintenanceUpdate(
                    status: .loaded,
                    connection: .stale,
                    maintenance: previewItems,
                    records: previewRecords,
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MaintenanceTrackerWidget(
            model: previewModel(
                MaintenanceUpdate(
                    status: .loaded,
                    connection: .offline,
                    maintenance: previewItems,
                    records: [],
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
