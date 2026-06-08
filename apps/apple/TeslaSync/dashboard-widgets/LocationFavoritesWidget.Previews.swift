//
//  LocationFavoritesWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LocationFavoritesUpdate) -> LocationFavoritesModel {
        let source = InMemoryLocationFavoritesSource(initial: update)
        let model = LocationFavoritesModel(source: source)
        model.start()
        return model
    }

    private let sampleLocations: [LocationFavoritesLocation] = [
        LocationFavoritesLocation(id: "1", addressName: "Home", visitCount: 142, lastVisited: minutesAgo(35)),
        LocationFavoritesLocation(
            id: "2",
            addressName: "Office — Downtown",
            visitCount: 88,
            lastVisited: minutesAgo(140)
        ),
        LocationFavoritesLocation(
            id: "3",
            addressName: "Supercharger — 5th & Main",
            visitCount: 37,
            lastVisited: daysAgo(1)
        ),
        LocationFavoritesLocation(id: "4", addressName: "Trailhead Parking", visitCount: 12, lastVisited: daysAgo(3)),
        LocationFavoritesLocation(id: "5", addressName: "Grandma's House", visitCount: 6, lastVisited: daysAgo(11))
    ]

    private let homeSnapshot = LocationFavoritesSnapshot(locatedAtHome: true, destinationName: "Office — Downtown")
    private let workSnapshot = LocationFavoritesSnapshot(locatedAtWork: true)

    private func minutesAgo(_ minutes: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-minutes * 60))
    }

    private func daysAgo(_ days: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-days * 86400))
    }

    #Preview("Content") {
        LocationFavoritesWidget(
            model: previewModel(
                LocationFavoritesUpdate(
                    status: .loaded,
                    connection: .live,
                    locations: sampleLocations,
                    snapshot: homeSnapshot,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        LocationFavoritesWidget(
            model: previewModel(
                LocationFavoritesUpdate(status: .loaded, connection: .live, locations: [], snapshot: workSnapshot)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LocationFavoritesWidget(model: previewModel(LocationFavoritesUpdate(status: .loading)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LocationFavoritesWidget(model: previewModel(LocationFavoritesUpdate(
            status: .loaded,
            locations: [],
            snapshot: nil
        )))
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LocationFavoritesWidget(model: previewModel(LocationFavoritesUpdate(status: .failed("Network unavailable"))))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LocationFavoritesWidget(
            model: previewModel(
                LocationFavoritesUpdate(
                    status: .loaded,
                    connection: .offline,
                    locations: sampleLocations,
                    snapshot: homeSnapshot,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
