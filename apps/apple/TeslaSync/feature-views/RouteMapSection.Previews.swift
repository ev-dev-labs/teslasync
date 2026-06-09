//
//  RouteMapSection.Previews.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  Xcode previews for each surface state (route / stationary / in-progress / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum RouteMapPreviewData {
        static let start = Date(timeIntervalSince1970: 1_733_500_200) // 2024-12-06 ~14:30 PST

        static let prefs = RouteMapFormatPrefs(
            localeIdentifier: "en_US",
            timeZoneIdentifier: "America/Los_Angeles",
            speedUnit: "mph",
            precision: 0
        )

        /// A real San Francisco route with speeds spanning every band (m/s).
        static let routePositions: [RouteMapPosition] = [
            RouteMapPosition(latitude: 37.7749, longitude: -122.4194, speedMps: 8),
            RouteMapPosition(latitude: 37.7765, longitude: -122.4170, speedMps: 16),
            RouteMapPosition(latitude: 37.7790, longitude: -122.4135, speedMps: 24),
            RouteMapPosition(latitude: 37.7820, longitude: -122.4090, speedMps: 34),
            RouteMapPosition(latitude: 37.7860, longitude: -122.4035, speedMps: 46),
            RouteMapPosition(latitude: 37.7905, longitude: -122.3975, speedMps: 30)
        ]

        static func routedDrive(ended: Bool = true) -> RouteMapDrive {
            RouteMapDrive(
                driveID: "8421",
                startTs: start,
                endTs: ended ? start.addingTimeInterval(1800) : nil,
                startLatitude: 37.7749,
                startLongitude: -122.4194,
                positions: routePositions,
                telemetry: routePositions.map {
                    RouteMapTelemetrySample(latitude: $0.latitude, longitude: $0.longitude, speedMps: $0.speedMps)
                }
            )
        }

        /// A stationary drive: every recorded fix is within a few meters of the first.
        static func stationaryDrive() -> RouteMapDrive {
            let positions = (0 ..< 4).map { index in
                RouteMapPosition(latitude: 37.7749 + Double(index) * 0.000_01, longitude: -122.4194, speedMps: 0)
            }
            return RouteMapDrive(
                driveID: "8422",
                startTs: start,
                endTs: start.addingTimeInterval(600),
                startLatitude: 37.7749,
                startLongitude: -122.4194,
                positions: positions,
                telemetry: positions.map {
                    RouteMapTelemetrySample(latitude: $0.latitude, longitude: $0.longitude, speedMps: 0)
                }
            )
        }

        static func emptyDrive() -> RouteMapDrive {
            RouteMapDrive(driveID: "8423", startTs: start, endTs: start.addingTimeInterval(300))
        }
    }

    @MainActor
    private func routeMapPreviewModel(_ update: RouteMapUpdate) -> RouteMapSectionModel {
        let source = InMemoryRouteMapSource(initial: update)
        let model = RouteMapSectionModel(source: source)
        model.start()
        return model
    }

    private func loadedUpdate(
        drive: RouteMapDrive,
        connection: RouteMapConnection = .live
    ) -> RouteMapUpdate {
        RouteMapUpdate(
            status: .loaded,
            connection: connection,
            drive: drive,
            prefs: RouteMapPreviewData.prefs,
            updatedAt: Date()
        )
    }

    @MainActor
    private func routeMapPreviewSurface(_ update: RouteMapUpdate) -> some View {
        ScrollView {
            RouteMapSection(model: routeMapPreviewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Route") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.routedDrive()))
    }

    #Preview("Route (in progress)") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.routedDrive(ended: false)))
    }

    #Preview("Stationary") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.stationaryDrive()))
    }

    #Preview("Empty (no route)") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.emptyDrive()))
    }

    #Preview("Empty (no drive)") {
        routeMapPreviewSurface(RouteMapUpdate(status: .empty, drive: nil))
    }

    #Preview("Loading") {
        routeMapPreviewSurface(RouteMapUpdate(status: .loading))
    }

    #Preview("Error") {
        routeMapPreviewSurface(RouteMapUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.routedDrive(), connection: .stale))
    }

    #Preview("Offline (cached)") {
        routeMapPreviewSurface(loadedUpdate(drive: RouteMapPreviewData.routedDrive(), connection: .offline))
    }
#endif
