//
//  VehicleCharts.Projection.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The pure projection of the resolved slice into everything the view renders:
//  the live map coordinate (web `state.latitude && state.longitude`), the trail
//  polyline (web `positions.filter(p => p.latitude && p.longitude)`), and the
//  speed-history samples (web `positions.map(p => ({ time, speed })).reverse()` —
//  oldest-first, keeping `speed == 0`, dropping only `null`). Pure + `Equatable`
//  so the suite covers every section flag + ordering branch without a view.
//

import CoreLocation
import Foundation

// MARK: - Value-typed coordinate (keeps the projection Equatable/Sendable)

/// A plottable coordinate stored as `Double`s (so the projection stays a value
/// type), exposing the `CLLocationCoordinate2D` MapKit needs.
public struct VehicleChartsCoordinate: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    public init(_ coordinate: CLLocationCoordinate2D) {
        latitude = coordinate.latitude
        longitude = coordinate.longitude
    }

    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Speed sample (web `batteryData[i]`)

/// One point on the speed-history chart — the native parity of a web
/// `batteryData` row. `speedMps` is SI (the display layer converts to the user's
/// unit at render); `timestamp` drives the temporal x-axis (web `time` label).
public struct VehicleChartsSpeedSample: Identifiable, Equatable, Sendable {
    public var id: Int
    public var timestamp: Date
    public var speedMps: Double

    public init(id: Int, timestamp: Date, speedMps: Double) {
        self.id = id
        self.timestamp = timestamp
        self.speedMps = speedMps
    }
}

// MARK: - Projection

/// The structural projection the surface renders. Built once from the resolved
/// slice; the view reads it and never recomputes.
public struct VehicleChartsProjection: Equatable, Sendable {
    /// The live map coordinate, or `nil` when the state location is falsy.
    public var current: VehicleChartsCoordinate?
    /// The plotted trail (web filtered + mapped positions), in source order.
    public var trail: [VehicleChartsCoordinate]
    /// The speed-history samples, oldest-first (web `.reverse()`).
    public var speedSeries: [VehicleChartsSpeedSample]
    /// The vehicle configuration slice (rendered by the config grid), if present.
    public var config: VehicleChartsConfig?
    /// The user-preference slice (rendered by the preferences grid), if present.
    public var preferences: VehicleChartsPreferences?

    public init(
        current: VehicleChartsCoordinate? = nil,
        trail: [VehicleChartsCoordinate] = [],
        speedSeries: [VehicleChartsSpeedSample] = [],
        config: VehicleChartsConfig? = nil,
        preferences: VehicleChartsPreferences? = nil
    ) {
        self.current = current
        self.trail = trail
        self.speedSeries = speedSeries
        self.config = config
        self.preferences = preferences
    }

    // MARK: Section flags (drive the composite's conditional sections)

    /// Whether the live-map section renders (web `state.latitude && state.longitude`).
    public var hasMap: Bool {
        current != nil
    }

    /// Whether the trail polyline draws (web `trail.length > 1`).
    public var hasTrail: Bool {
        trail.count > 1
    }

    /// Whether the configuration grid renders (web `vehicleConfigData &&`).
    public var hasConfig: Bool {
        config != nil
    }

    /// Whether the preferences grid renders (web `userPrefData &&`).
    public var hasPreferences: Bool {
        preferences != nil
    }

    /// Whether the speed chart has data (web `batteryData.length > 0`).
    public var hasSpeedData: Bool {
        !speedSeries.isEmpty
    }

    /// Whether ANY section has content — drives the loaded-vs-empty phase so the
    /// surface shows a friendly empty state instead of a blank composite.
    public var hasAnyContent: Bool {
        hasMap || hasConfig || hasPreferences || hasSpeedData
    }

    // MARK: Map helpers

    /// The current coordinate as a MapKit value (for the marker + camera).
    public var currentCoordinate: CLLocationCoordinate2D? {
        current?.coordinate
    }

    /// The trail as MapKit coordinates (for the polyline + camera fit).
    public var trailCoordinates: [CLLocationCoordinate2D] {
        trail.map(\.coordinate)
    }

    /// Every coordinate the camera should frame (current + trail), de-duplicated
    /// of `nil`s — used with the shared `TSGeo.boundingRegion`.
    public var cameraCoordinates: [CLLocationCoordinate2D] {
        var coordinates = trailCoordinates
        if let currentCoordinate { coordinates.append(currentCoordinate) }
        return coordinates
    }

    // MARK: Build

    /// Builds the projection from the resolved slice — a faithful reproduction of
    /// the web component body (`trail`, `batteryData`, and the section guards).
    public static func make(from data: VehicleChartsData) -> VehicleChartsProjection {
        VehicleChartsProjection(
            current: data.state?.currentCoordinate.map(VehicleChartsCoordinate.init),
            trail: trail(from: data.positions),
            speedSeries: speedSeries(from: data.positions),
            config: data.config,
            preferences: data.preferences
        )
    }

    /// The trail polyline points — the web `positions.filter(p => p.latitude &&
    /// p.longitude).map(p => [lat, lng])` (source order preserved).
    public static func trail(from positions: [VehicleChartsPositionRecord]) -> [VehicleChartsCoordinate] {
        positions.compactMap { position in
            position.coordinate.map(VehicleChartsCoordinate.init)
        }
    }

    /// The speed-history samples — the web `positions.map(p => ({ time:
    /// formatTime(p.ts), speed: p.speed_mph != null ? convert(p.speed_mph) : null
    /// })).reverse()`. Samples without a finite speed are dropped (the web plots a
    /// gap), a real `0` is kept, and the order is reversed to oldest-first.
    public static func speedSeries(
        from positions: [VehicleChartsPositionRecord]
    ) -> [VehicleChartsSpeedSample] {
        positions
            .reversed()
            .enumerated()
            .compactMap { index, position in
                guard let timestamp = position.timestamp,
                      VehicleChartsNumeric.isFiniteNumber(position.speedMps),
                      let speedMps = position.speedMps
                else { return nil }
                return VehicleChartsSpeedSample(id: index, timestamp: timestamp, speedMps: speedMps)
            }
    }
}
