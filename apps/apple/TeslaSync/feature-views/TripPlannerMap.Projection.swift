//
//  TripPlannerMap.Projection.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The pure projection of the trip-plan props into everything the map renders: the
//  route polyline (web `polylinePoints` memo), the origin / destination / charge-stop
//  markers (web `CircleMarker`s), the content-vs-empty flag (web `hasData`), and the
//  camera inputs — the fit-to-route bounding region the native map prefers, plus the
//  web `center` + `zoom` heuristics ported verbatim for parity and used as the
//  single-point fallback. Pure + `Equatable`, so the suite covers every branch
//  without a rendered map.
//

import CoreLocation
import Foundation

// MARK: - Marker (port of the web origin / destination / charge-stop CircleMarkers)

/// Which trip role a marker represents — drives its pin tint (web green origin /
/// red destination / accent charge stop) and the callout content.
public enum TripPlannerMarkerKind: Sendable, Equatable {
    case origin
    case destination
    case chargeStop
}

/// A single plotted marker derived from a plottable trip location. Holds the
/// resolved coordinate plus the raw fields the callout/label layer formats.
/// Coordinates are stored as `Double`s (so the value type stays `Sendable`/
/// `Equatable`); the `CLLocationCoordinate2D` is computed for MapKit.
public struct TripPlannerMarker: Identifiable, Equatable, Sendable {
    /// Stable identity for `ForEach` + the selected-callout lookup
    /// ("origin" / "destination" / "stop-{i}").
    public var id: String
    public var kind: TripPlannerMarkerKind
    public var latitude: Double
    public var longitude: Double
    /// The raw location name (web `name`) — resolved against a role fallback by the
    /// label layer.
    public var name: String
    /// Charge-stop entry SOC (web `charge_from_soc`); `nil` for endpoints.
    public var chargeFromSoc: Double?
    /// Charge-stop exit SOC (web `charge_to_soc`); `nil` for endpoints.
    public var chargeToSoc: Double?
    /// Charge-stop duration in seconds (web `charge_duration_s`); `nil` for endpoints.
    public var chargeDurationS: Double?

    public init(
        id: String,
        kind: TripPlannerMarkerKind,
        latitude: Double,
        longitude: Double,
        name: String,
        chargeFromSoc: Double? = nil,
        chargeToSoc: Double? = nil,
        chargeDurationS: Double? = nil
    ) {
        self.id = id
        self.kind = kind
        self.latitude = latitude
        self.longitude = longitude
        self.name = name
        self.chargeFromSoc = chargeFromSoc
        self.chargeToSoc = chargeToSoc
        self.chargeDurationS = chargeDurationS
    }

    /// The MapKit coordinate for this marker.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Projection

/// The structural projection the map view renders. Built once from the trip-plan
/// props; the view reads it and never recomputes.
public struct TripPlannerMapProjection: Equatable, Sendable {
    /// The origin / destination / charge-stop markers (web `CircleMarker`s), in
    /// render order (origin, destination, then each plottable charge stop).
    public var markers: [TripPlannerMarker]
    /// The route polyline vertices (web `polylinePoints`), as `(lat, lng)` pairs.
    public var polyline: [TripPlannerCoordinate]
    /// Whether there is anything to map — the web `hasData` (`origin != null ||
    /// destination != null`). Drives the content-vs-empty branch.
    public var hasData: Bool
    /// The web `center` memo latitude (origin/destination midpoint, origin, or the
    /// continental-US fallback) — the single-point camera center.
    public var centerLatitude: Double
    public var centerLongitude: Double
    /// The web `zoom` memo (4…9) — the single-point camera span source.
    public var zoom: Int

    public init(
        markers: [TripPlannerMarker],
        polyline: [TripPlannerCoordinate],
        hasData: Bool,
        centerLatitude: Double,
        centerLongitude: Double,
        zoom: Int
    ) {
        self.markers = markers
        self.polyline = polyline
        self.hasData = hasData
        self.centerLatitude = centerLatitude
        self.centerLongitude = centerLongitude
        self.zoom = zoom
    }

    // MARK: Web constants

    /// The web no-endpoints fallback center (`[39.8283, -98.5795]`, continental US).
    public static let fallbackCenterLatitude = 39.8283
    public static let fallbackCenterLongitude = -98.5795
    /// The web default zoom when either endpoint is missing (`return 5`).
    public static let defaultZoom = 5

    // MARK: Derivations

    /// The web `center` as a MapKit coordinate (single-point camera center).
    public var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: centerLatitude, longitude: centerLongitude)
    }

    /// Every plottable coordinate the camera should frame — the markers plus the
    /// route vertices, finite-guarded. Used to fit the route bounds.
    public var mapCoordinates: [CLLocationCoordinate2D] {
        var coordinates = markers.map(\.coordinate)
        coordinates.append(contentsOf: polyline.map(\.coordinate))
        return coordinates
            .filter { TripPlannerMapNumeric.isFinite($0.latitude) && TripPlannerMapNumeric.isFinite($0.longitude) }
    }

    /// Whether there are at least two distinct points to frame, so the map fits the
    /// route bounds; a single point falls back to the web `center` + `zoom` span.
    public var hasFittableSpan: Bool {
        let distinct = Set(mapCoordinates.map { "\($0.latitude),\($0.longitude)" })
        return distinct.count >= 2
    }

    /// How many markers are plotted (origin + destination + charge stops).
    public var markerCount: Int {
        markers.count
    }

    /// The plotted charge-stop markers (web `chargeStops` map).
    public var chargeStopMarkers: [TripPlannerMarker] {
        markers.filter { $0.kind == .chargeStop }
    }

    // MARK: Builder

    /// Builds the projection from the trip-plan props — a faithful reproduction of
    /// the web component body (`polylinePoints` + `center` + `zoom` + `hasData`),
    /// plus the origin / destination / charge-stop markers. Markers whose coordinate
    /// is non-finite are dropped (Leaflet silently skips an invalid lat-lng).
    public static func make(
        origin: TripPlannerLocation?,
        destination: TripPlannerLocation?,
        legs: [TripPlannerLeg],
        chargeStops: [TripPlannerChargeStop]
    ) -> TripPlannerMapProjection {
        var markers: [TripPlannerMarker] = []
        if let origin, origin.isPlottable {
            markers.append(
                TripPlannerMarker(
                    id: "origin",
                    kind: .origin,
                    latitude: origin.latitude,
                    longitude: origin.longitude,
                    name: origin.name
                )
            )
        }
        if let destination, destination.isPlottable {
            markers.append(
                TripPlannerMarker(
                    id: "destination",
                    kind: .destination,
                    latitude: destination.latitude,
                    longitude: destination.longitude,
                    name: destination.name
                )
            )
        }
        for (index, stop) in chargeStops.enumerated() where stop.location.isPlottable {
            markers.append(
                TripPlannerMarker(
                    id: "stop-\(index)",
                    kind: .chargeStop,
                    latitude: stop.location.latitude,
                    longitude: stop.location.longitude,
                    name: stop.name,
                    chargeFromSoc: stop.chargeFromSoc,
                    chargeToSoc: stop.chargeToSoc,
                    chargeDurationS: stop.chargeDurationS
                )
            )
        }

        let center = centerCoordinate(origin: origin, destination: destination)
        return TripPlannerMapProjection(
            markers: markers,
            polyline: polylineCoordinates(origin: origin, destination: destination, legs: legs),
            hasData: origin != nil || destination != nil,
            centerLatitude: center.latitude,
            centerLongitude: center.longitude,
            zoom: zoomLevel(origin: origin, destination: destination)
        )
    }

    // MARK: Web memo ports (verbatim)

    /// The web `polylinePoints` memo: when there are no legs but both endpoints
    /// exist, a direct origin→destination line; otherwise the chained leg
    /// `from`/`to` vertices (the first leg contributes both endpoints, each later
    /// leg its `to`).
    public static func polylineCoordinates(
        origin: TripPlannerLocation?,
        destination: TripPlannerLocation?,
        legs: [TripPlannerLeg]
    ) -> [TripPlannerCoordinate] {
        if legs.isEmpty, let origin, let destination {
            return [
                TripPlannerCoordinate(latitude: origin.latitude, longitude: origin.longitude),
                TripPlannerCoordinate(latitude: destination.latitude, longitude: destination.longitude)
            ]
        }
        var points: [TripPlannerCoordinate] = []
        for leg in legs {
            if points.isEmpty {
                points.append(TripPlannerCoordinate(latitude: leg.from.latitude, longitude: leg.from.longitude))
            }
            points.append(TripPlannerCoordinate(latitude: leg.to.latitude, longitude: leg.to.longitude))
        }
        return points
    }

    /// The web `center` memo: the origin/destination midpoint when both exist, else
    /// the origin, else the continental-US fallback.
    public static func centerCoordinate(
        origin: TripPlannerLocation?,
        destination: TripPlannerLocation?
    ) -> (latitude: Double, longitude: Double) {
        if let origin, let destination {
            return ((origin.latitude + destination.latitude) / 2, (origin.longitude + destination.longitude) / 2)
        }
        if let origin {
            return (origin.latitude, origin.longitude)
        }
        return (fallbackCenterLatitude, fallbackCenterLongitude)
    }

    /// The web `zoom` memo: `5` when either endpoint is missing, else a step over the
    /// larger of the lat/lng deltas (`>20→4`, `>10→5`, `>5→6`, `>2→7`, else `9`).
    public static func zoomLevel(
        origin: TripPlannerLocation?,
        destination: TripPlannerLocation?
    ) -> Int {
        guard let origin, let destination else { return defaultZoom }
        let latDiff = abs(origin.latitude - destination.latitude)
        let lngDiff = abs(origin.longitude - destination.longitude)
        let maxDiff = max(latDiff, lngDiff)
        if maxDiff > 20 { return 4 }
        if maxDiff > 10 { return 5 }
        if maxDiff > 5 { return 6 }
        if maxDiff > 2 { return 7 }
        return 9
    }
}

// MARK: - Coordinate value type

/// A lightweight `(lat, lng)` pair for the route polyline — kept as a value type so
/// the projection stays `Sendable`/`Equatable` and unit-tests without MapKit.
public struct TripPlannerCoordinate: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    /// The MapKit coordinate for this vertex.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
