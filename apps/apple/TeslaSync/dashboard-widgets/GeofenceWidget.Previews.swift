//
//  GeofenceWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline / compact). DEBUG-only.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: GeofenceWidgetUpdate) -> GeofenceWidgetModel {
        let source = InMemoryGeofenceWidgetSource(initial: update)
        let model = GeofenceWidgetModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = GeofenceWidgetVehicleFix(latitude: 37.7749, longitude: -122.4194)

    private let previewFences: [GeofenceWidgetFenceInput] = [
        GeofenceWidgetFenceInput(
            id: "home",
            name: "Home",
            radiusMeters: 200,
            latitude: 37.7749,
            longitude: -122.4194,
            enabled: true
        ),
        GeofenceWidgetFenceInput(
            id: "work",
            name: "Office",
            radiusMeters: 150,
            latitude: 37.7920,
            longitude: -122.4030,
            enabled: true
        ),
        GeofenceWidgetFenceInput(
            id: "garage",
            name: "Storage Garage",
            radiusMeters: 300,
            latitude: 37.7600,
            longitude: -122.4350,
            enabled: false
        )
    ]

    private func previewUpdate(
        status: GeofenceWidgetLoadStatus = .loaded,
        connection: GeofenceWidgetConnection = .live,
        fences: [GeofenceWidgetFenceInput] = previewFences,
        vehicle: GeofenceWidgetVehicleFix? = previewVehicle,
        updatedAt: Date? = Date()
    ) -> GeofenceWidgetUpdate {
        GeofenceWidgetUpdate(
            status: status,
            connection: connection,
            fences: fences,
            vehicle: vehicle,
            distanceUnit: .kilometers,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (live, with map)") {
        GeofenceWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (no vehicle — list only)") {
        GeofenceWidget(
            model: previewModel(previewUpdate(vehicle: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GeofenceWidget(
            model: previewModel(previewUpdate(status: .loading, fences: [], vehicle: nil, updatedAt: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        GeofenceWidget(
            model: previewModel(previewUpdate(status: .loaded, fences: [], vehicle: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        GeofenceWidget(
            model: previewModel(
                previewUpdate(status: .failed("Network unavailable"), fences: [], vehicle: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        GeofenceWidget(
            model: previewModel(
                previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-180))
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        GeofenceWidget(
            model: previewModel(
                previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-900))
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        GeofenceWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }
#endif
