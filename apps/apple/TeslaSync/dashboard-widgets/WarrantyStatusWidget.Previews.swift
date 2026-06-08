//
//  WarrantyStatusWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / offline / stale). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: WarrantyUpdate) -> WarrantyModel {
        let source = InMemoryWarrantySource(initial: update)
        let model = WarrantyModel(source: source)
        model.start()
        return model
    }

    private let previewData = WarrantyDataInput([
        "warranty_expiry_date": .string("2027-03-15T00:00:00Z"),
        "warranty_start_date": .string("2023-03-15T00:00:00Z"),
        "mileage_limit_mi": .number(80467),
        "current_mileage_mi": .number(48280),
        "basic": .bool(true),
        "basic_expiry_date": .string("2027-03-15"),
        "battery_drive_unit": .bool(true),
        "battery_drive_unit_expiry_date": .string("2031-03-15"),
        "corrosion": .string("12 yr"),
        "body": .bool(true)
    ])

    private let previewFormat = WarrantyFormatting(
        distanceUnit: "mi",
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    #Preview("Content (standard)") {
        WarrantyStatusWidget(
            model: previewModel(
                WarrantyUpdate(
                    status: .loaded,
                    connection: .live,
                    data: previewData,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        WarrantyStatusWidget(
            model: previewModel(
                WarrantyUpdate(
                    status: .loaded,
                    data: previewData,
                    format: previewFormat,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 170)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WarrantyStatusWidget(model: previewModel(WarrantyUpdate(status: .loading)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WarrantyStatusWidget(model: previewModel(WarrantyUpdate(status: .loaded)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        WarrantyStatusWidget(model: previewModel(WarrantyUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        WarrantyStatusWidget(
            model: previewModel(
                WarrantyUpdate(
                    status: .loaded,
                    connection: .stale,
                    data: previewData,
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WarrantyStatusWidget(
            model: previewModel(
                WarrantyUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: previewData,
                    format: previewFormat,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
