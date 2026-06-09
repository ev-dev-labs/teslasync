//
//  TeslaChargingSessionsMap.Projection.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The pure projection of the session slice into everything the map renders: the
//  plotted markers (web `clusterPoints`) and the fallback center (web `center`
//  memo — the mean of every session's coordinate, San Francisco when the slice is
//  empty). Pure + `Equatable`, so the suite covers every branch without a map.
//

import CoreLocation
import Foundation

/// The structural projection the map view renders. Built once from the session
/// slice; the view reads it and never recomputes.
public struct TeslaChargingSessionsMapProjection: Equatable, Sendable {
    /// The plotted markers (web `clusterPoints`), in source order.
    public var markers: [TeslaChargingSessionMarker]
    /// The fallback map center used when no marker has a usable coordinate — the
    /// web `center` memo (mean of `lat ?? 0` / `lng ?? 0`, SF default when empty).
    public var centerLatitude: Double
    public var centerLongitude: Double

    public init(markers: [TeslaChargingSessionMarker], centerLatitude: Double, centerLongitude: Double) {
        self.markers = markers
        self.centerLatitude = centerLatitude
        self.centerLongitude = centerLongitude
    }

    /// The web default center when there are no sessions (`{ lat: 37.77, lng: -122.42 }`).
    public static let defaultCenterLatitude = 37.77
    public static let defaultCenterLongitude = -122.42

    /// The fallback center as a MapKit coordinate.
    public var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: centerLatitude, longitude: centerLongitude)
    }

    /// The plotted-marker coordinates (used to frame the camera to fit them all).
    public var markerCoordinates: [CLLocationCoordinate2D] {
        markers.map(\.coordinate)
    }

    /// How many sessions are plotted (web `clusterPoints.length`).
    public var plottedCount: Int {
        markers.count
    }

    /// Whether any session is plottable — drives the loaded-vs-empty branch.
    public var hasPlottableMarkers: Bool {
        !markers.isEmpty
    }

    /// Builds the projection from the session slice — a faithful reproduction of
    /// the web component body (`center` + `clusterPoints`).
    public static func make(sessions: [TeslaChargingSessionRecord]) -> TeslaChargingSessionsMapProjection {
        let markers = sessions.compactMap(TeslaChargingSessionMarker.from)
        let center = centerCoordinate(for: sessions)
        return TeslaChargingSessionsMapProjection(
            markers: markers,
            centerLatitude: center.latitude,
            centerLongitude: center.longitude
        )
    }

    /// The web `center` memo: the mean of every session's coordinate, treating a
    /// missing component as `0` (web `s.latitude ?? 0`), and falling back to San
    /// Francisco when the slice is empty.
    public static func centerCoordinate(
        for sessions: [TeslaChargingSessionRecord]
    ) -> (latitude: Double, longitude: Double) {
        guard !sessions.isEmpty else {
            return (defaultCenterLatitude, defaultCenterLongitude)
        }
        let count = Double(sessions.count)
        let sumLat = sessions.reduce(0) { $0 + ($1.latitude ?? 0) }
        let sumLng = sessions.reduce(0) { $0 + ($1.longitude ?? 0) }
        return (sumLat / count, sumLng / count)
    }
}
