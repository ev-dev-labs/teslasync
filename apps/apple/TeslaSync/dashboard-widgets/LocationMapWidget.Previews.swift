//
//  LocationMapWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0060 · LocationMapWidget (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline / compact). DEBUG-only.
//

import CoreLocation
import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LocationMapUpdate) -> LocationMapModel {
        let source = InMemoryLocationMapSource(initial: update)
        let model = LocationMapModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = LocationVehicle(id: 1, displayName: "Model Y")
    private let previewPosition = LocationInput(latitude: 37.7749, longitude: -122.4194, heading: 295)

    #Preview("Content (live)") {
        LocationMapWidget(
            model: previewModel(
                LocationMapUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    position: previewPosition,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 4)
        )
        .frame(width: 360, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LocationMapWidget(
            model: previewModel(LocationMapUpdate(status: .loading, vehicle: previewVehicle)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LocationMapWidget(
            model: previewModel(LocationMapUpdate(status: .loaded, vehicle: previewVehicle, position: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LocationMapWidget(
            model: previewModel(LocationMapUpdate(status: .failed("Network unavailable"), vehicle: previewVehicle)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (last known)") {
        LocationMapWidget(
            model: previewModel(
                LocationMapUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    position: previewPosition,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 4)
        )
        .frame(width: 360, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LocationMapWidget(
            model: previewModel(
                LocationMapUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicle: previewVehicle,
                    position: previewPosition,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×4)") {
        LocationMapWidget(
            model: previewModel(
                LocationMapUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    position: previewPosition,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 150, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
