//
//  RouteMapSection.Adapter.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  The testable projection core: a `RouteMapDrive` + `RouteMapFormatPrefs` → the view-ready
//  `RouteMapProjection` (trail, speed-colored segments, start/end/anchor markers, camera coordinates,
//  the stationary-GPS fallback, the speed legend, and the start/end-time footer), reproducing the web
//  source's render logic VERBATIM so the native map shows the exact same geometry + text as
//  features/driving/components/drive-detail/RouteMapSection.tsx (fed by `useDriveDetailData`).
//
//  Deliberately free of SwiftUI / MapKit (Foundation only, value-typed `RouteCoordinate`) so the
//  geometry + composition compile and run on a plain host and are pinned by unit tests. The geo / unit /
//  date helpers it relies on live in RouteMapSection.Format.swift (ported from web `lib/geo.ts`,
//  `lib/unitConversion.ts`, `lib/numberFormat.ts`, and `lib/dateFormat.ts`).
//

import Foundation

// MARK: - Value-typed coordinate (SwiftUI/MapKit-free, so the adapter is host-testable)

/// A latitude/longitude pair (web `LatLngExpression` / `[lat, lng]`). The view maps it to a
/// `CLLocationCoordinate2D` at the MapKit boundary.
public struct RouteCoordinate: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

// MARK: - Speed bands (web segment-color thresholds)

/// The four speed bands the route trail is colored by (web `speedSegments` color ladder). Compared
/// against raw SI m/s thresholds; the view maps each band to its segment + legend color.
public enum RouteSpeedBand: String, Sendable, Equatable, CaseIterable {
    /// Below `SPEED_SEGMENT_LOW_MPS` — web `#10b981` (emerald).
    case low
    /// `SPEED_SEGMENT_LOW_MPS ..< SPEED_SEGMENT_MED_MPS` — web `#00f0ff` segment / cyan-400 legend.
    case lowMid
    /// `SPEED_SEGMENT_MED_MPS ..< SPEED_SEGMENT_HIGH_MPS` — web `#f59e0b` (amber).
    case midHigh
    /// At or above `SPEED_SEGMENT_HIGH_MPS` — web `#ef4444` (red).
    case high
}

/// One colored leg of the trail (web `SpeedSegment`): the two endpoints + the band that colors it.
public struct RouteSpeedSegment: Identifiable, Sendable, Equatable {
    public let id: Int
    public let start: RouteCoordinate
    public let end: RouteCoordinate
    public let band: RouteSpeedBand

    public init(id: Int, start: RouteCoordinate, end: RouteCoordinate, band: RouteSpeedBand) {
        self.id = id
        self.start = start
        self.end = end
        self.band = band
    }
}

/// One legend row (web footer swatch): the band + its pre-formatted threshold label (e.g. "30–60").
public struct RouteSpeedLegendEntry: Identifiable, Sendable, Equatable {
    public let band: RouteSpeedBand
    public let label: String

    public var id: String {
        band.rawValue
    }

    public init(band: RouteSpeedBand, label: String) {
        self.band = band
        self.label = label
    }
}

// MARK: - Markers (web `CircleMarker` + `Popup`)

/// A map marker with its resolved title + detail (web `CircleMarker` with a `Popup`). The detail is the
/// localized timestamp the web popup shows; the kind drives the color/glyph in the view.
public struct RouteMapMarker: Identifiable, Sendable, Equatable {
    public enum Kind: String, Sendable, Equatable {
        case start
        case end
        case anchor
    }

    public let kind: Kind
    public let coordinate: RouteCoordinate
    public let title: String
    public let detail: String?

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, coordinate: RouteCoordinate, title: String, detail: String?) {
        self.kind = kind
        self.coordinate = coordinate
        self.title = title
        self.detail = detail
    }
}

// MARK: - Projected route map (web `RouteMapSection` render)

/// The fully-projected route map: every value the view needs to render the map, markers, banner,
/// legend, and footer without re-deriving anything. `hasTrail == false` → the view shows the web "No
/// route data available" body; `hasTrail && !hasRoute` → the stationary-GPS fallback (anchor + banner).
public struct RouteMapProjection: Sendable, Equatable {
    /// Web `trail.length > 0` — there is at least one plottable coordinate.
    public let hasTrail: Bool
    /// Web `hasMeaningfulRoute(drive.positions)` — two valid coords ≥ 10 m apart.
    public let hasRoute: Bool
    /// The ordered trail (web `trail`). Empty when `hasTrail == false`.
    public let trail: [RouteCoordinate]
    /// Coordinates the camera fits on first appear (web `FitBounds`): the trail when there is a route,
    /// else the single anchor/center so a stationary drive still lands on recognizable streets.
    public let cameraCoordinates: [RouteCoordinate]
    /// Web `centerPos` (start, else the drive's start lat/lng, else Seattle).
    public let center: RouteCoordinate
    /// The speed-colored legs (web `speedSegments`), present only when there is a route.
    public let segments: [RouteSpeedSegment]
    public let startMarker: RouteMapMarker?
    public let endMarker: RouteMapMarker?
    public let anchorMarker: RouteMapMarker?
    /// Web `!hasRoute` banner inside the `trail.length > 0` branch.
    public let showStationaryBanner: Bool
    /// Web `hasRoute && trail.length > 1` legend gate.
    public let showLegend: Bool
    public let legend: [RouteSpeedLegendEntry]
    public let speedUnitLabel: String
    /// Footer "Start: …" time (web `formatTime(drive.startTs)`).
    public let startTimeText: String
    /// Footer "End: …" time — present only for a finished drive (web `drive.endTs && …`).
    public let endTimeText: String?

    public init(
        hasTrail: Bool,
        hasRoute: Bool,
        trail: [RouteCoordinate],
        cameraCoordinates: [RouteCoordinate],
        center: RouteCoordinate,
        segments: [RouteSpeedSegment],
        startMarker: RouteMapMarker?,
        endMarker: RouteMapMarker?,
        anchorMarker: RouteMapMarker?,
        showStationaryBanner: Bool,
        showLegend: Bool,
        legend: [RouteSpeedLegendEntry],
        speedUnitLabel: String,
        startTimeText: String,
        endTimeText: String?
    ) {
        self.hasTrail = hasTrail
        self.hasRoute = hasRoute
        self.trail = trail
        self.cameraCoordinates = cameraCoordinates
        self.center = center
        self.segments = segments
        self.startMarker = startMarker
        self.endMarker = endMarker
        self.anchorMarker = anchorMarker
        self.showStationaryBanner = showStationaryBanner
        self.showLegend = showLegend
        self.legend = legend
        self.speedUnitLabel = speedUnitLabel
        self.startTimeText = startTimeText
        self.endTimeText = endTimeText
    }
}

// MARK: - Projector (web `useDriveDetailData` + `RouteMapSection` render)

/// One internal route sample (web `RoutePoint`): a coordinate + its raw SI m/s speed.
private struct RouteMapPoint {
    let coordinate: RouteCoordinate
    let speedMps: Double
}

/// Pure projector: `RouteMapDrive` + `RouteMapFormatPrefs` → `RouteMapProjection`. The geometry is
/// derived with the same `routeSource` / trail / segment logic as the web `useDriveDetailData`, and the
/// render gates (`hasRoute`, anchor, banner, legend) match the web `RouteMapSection` exactly.
public enum RouteMapProjector {
    /// Web fallback `centerPos` when there is no start fix (`[47.6, -122.3]`, Seattle).
    public static let fallbackCenter = RouteCoordinate(latitude: 47.6, longitude: -122.3)

    public static func project(drive: RouteMapDrive, prefs: RouteMapFormatPrefs) -> RouteMapProjection {
        let routeSource = makeRouteSource(drive)
        let trail = routeSource.map(\.coordinate)

        // hasRoute / anchor are computed from drive.positions (web `RouteMapSection` local memo).
        let hasRoute = RouteMapGeo.hasMeaningfulRoute(drive.positions)
        let anchorPoint = anchor(in: drive.positions)

        let startPos = trail.first
        let endPos = trail.count > 1 ? trail.last : nil
        let center = startPos ?? driveStart(drive) ?? fallbackCenter

        return RouteMapProjection(
            hasTrail: !trail.isEmpty,
            hasRoute: hasRoute,
            trail: trail,
            cameraCoordinates: cameraCoordinates(hasRoute: hasRoute, trail: trail, anchor: anchorPoint, center: center),
            center: center,
            segments: hasRoute ? makeSegments(routeSource) : [],
            startMarker: makeStartMarker(hasRoute: hasRoute, startPos: startPos, drive: drive, prefs: prefs),
            endMarker: makeEndMarker(hasRoute: hasRoute, endPos: endPos, drive: drive, prefs: prefs),
            anchorMarker: makeAnchorMarker(hasRoute: hasRoute, anchorPoint: anchorPoint),
            showStationaryBanner: !trail.isEmpty && !hasRoute,
            showLegend: hasRoute && trail.count > 1,
            legend: makeLegend(prefs: prefs),
            speedUnitLabel: prefs.speedUnit,
            startTimeText: RouteMapFormat.time(drive.startTs, prefs: prefs),
            endTimeText: drive.endTs.map { RouteMapFormat.time($0, prefs: prefs) }
        )
    }

    /// Web `routeSource`: telemetry coords (filtered non-null + non-`(0,0)`) when any telemetry rows
    /// exist, else the drive positions (filtered non-`(0,0)`). Speed defaults to `0` like the web `?? 0`.
    private static func makeRouteSource(_ drive: RouteMapDrive) -> [RouteMapPoint] {
        if !drive.telemetry.isEmpty {
            return drive.telemetry.compactMap { sample in
                guard let lat = sample.latitude, let lon = sample.longitude else { return nil }
                guard lat != 0 || lon != 0 else { return nil }
                return RouteMapPoint(
                    coordinate: RouteCoordinate(latitude: lat, longitude: lon),
                    speedMps: sample.speedMps ?? 0
                )
            }
        }
        return drive.positions.compactMap { position in
            guard position.latitude != 0 || position.longitude != 0 else { return nil }
            return RouteMapPoint(
                coordinate: RouteCoordinate(latitude: position.latitude, longitude: position.longitude),
                speedMps: position.speedMps ?? 0
            )
        }
    }

    /// Web `speedSegments`: a colored leg between each consecutive pair, banded by the later point's
    /// raw SI speed.
    private static func makeSegments(_ routeSource: [RouteMapPoint]) -> [RouteSpeedSegment] {
        guard routeSource.count > 1 else { return [] }
        return (1 ..< routeSource.count).map { index in
            RouteSpeedSegment(
                id: index - 1,
                start: routeSource[index - 1].coordinate,
                end: routeSource[index].coordinate,
                band: RouteMapUnitMath.band(forSpeedMps: routeSource[index].speedMps)
            )
        }
    }

    /// Web `anchorPoint`: the first valid position, used as the stationary-GPS single marker.
    private static func anchor(in positions: [RouteMapPosition]) -> RouteCoordinate? {
        let index = RouteMapGeo.firstValidIndex(positions)
        guard index >= 0 else { return nil }
        let point = positions[index]
        return RouteCoordinate(latitude: point.latitude, longitude: point.longitude)
    }

    private static func driveStart(_ drive: RouteMapDrive) -> RouteCoordinate? {
        guard let lat = drive.startLatitude, let lon = drive.startLongitude else { return nil }
        // Web `drive.startLat && drive.startLon` — `0` is falsy in JS, so a zero coordinate is skipped.
        guard lat != 0, lon != 0 else { return nil }
        return RouteCoordinate(latitude: lat, longitude: lon)
    }

    private static func makeStartMarker(
        hasRoute: Bool,
        startPos: RouteCoordinate?,
        drive: RouteMapDrive,
        prefs: RouteMapFormatPrefs
    ) -> RouteMapMarker? {
        guard hasRoute, let startPos else { return nil }
        return RouteMapMarker(
            kind: .start,
            coordinate: startPos,
            title: RouteMapSectionStrings.string("driveDetail.start", "Start"),
            detail: RouteMapFormat.dateTime(drive.startTs, prefs: prefs)
        )
    }

    private static func makeEndMarker(
        hasRoute: Bool,
        endPos: RouteCoordinate?,
        drive: RouteMapDrive,
        prefs: RouteMapFormatPrefs
    ) -> RouteMapMarker? {
        guard hasRoute, let endPos else { return nil }
        let detail = drive.endTs != nil
            ? RouteMapFormat.dateTime(drive.endTs, prefs: prefs)
            : RouteMapSectionStrings.string("driveDetail.inProgress", "In progress")
        return RouteMapMarker(
            kind: .end,
            coordinate: endPos,
            title: RouteMapSectionStrings.string("driveDetail.end", "End"),
            detail: detail
        )
    }

    private static func makeAnchorMarker(hasRoute: Bool, anchorPoint: RouteCoordinate?) -> RouteMapMarker? {
        guard !hasRoute, let anchorPoint else { return nil }
        return RouteMapMarker(
            kind: .anchor,
            coordinate: anchorPoint,
            title: RouteMapSectionStrings.string("driveDetail.lastKnown", "Last known location"),
            detail: nil
        )
    }

    /// Web `FitBounds(trail = hasRoute ? trail : [], fallbackCenter = anchorPoint)`: fit the real route,
    /// else drop on the anchor (or center) so a stationary drive still lands on recognizable streets.
    private static func cameraCoordinates(
        hasRoute: Bool,
        trail: [RouteCoordinate],
        anchor: RouteCoordinate?,
        center: RouteCoordinate
    ) -> [RouteCoordinate] {
        if hasRoute, !trail.isEmpty { return trail }
        if let anchor { return [anchor] }
        return [center]
    }

    /// Web legend: the four band thresholds converted to the display unit + formatted, in band order.
    private static func makeLegend(prefs: RouteMapFormatPrefs) -> [RouteSpeedLegendEntry] {
        let low = threshold(RouteMapUnitMath.lowThresholdMps, prefs: prefs)
        let med = threshold(RouteMapUnitMath.medThresholdMps, prefs: prefs)
        let high = threshold(RouteMapUnitMath.highThresholdMps, prefs: prefs)
        return [
            RouteSpeedLegendEntry(band: .low, label: "<\(low)"),
            RouteSpeedLegendEntry(band: .lowMid, label: "\(low)–\(med)"),
            RouteSpeedLegendEntry(band: .midHigh, label: "\(med)–\(high)"),
            RouteSpeedLegendEntry(band: .high, label: ">\(high)")
        ]
    }

    private static func threshold(_ mps: Double, prefs: RouteMapFormatPrefs) -> String {
        let display = RouteMapUnitMath.speedFromSI(mps, prefs.speedUnit)
        let locale = Locale(identifier: prefs.localeIdentifier.replacingOccurrences(of: "_", with: "-"))
        return RouteMapUnitMath.fmtNumber(display, decimals: prefs.precision, locale: locale)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summaries spoken for the map canvas + its markers. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum RouteMapAccessibility {
    /// The canvas read as one phrase: a route/stationary lede plus the start/end times when present.
    public static func canvasSummary(for projection: RouteMapProjection) -> String {
        var parts: [String] = []
        if !projection.hasTrail {
            parts.append(RouteMapSectionStrings.string(
                "driveDetail.noRouteData",
                "No route data available for this drive"
            ))
        } else if projection.hasRoute {
            parts.append(RouteMapSectionStrings.string("routeMap.mapLabel", "Drive route map"))
        } else {
            parts.append(RouteMapSectionStrings.string("driveDetail.stationaryRouteTitle", "Route can't be plotted"))
        }
        parts.append("\(RouteMapSectionStrings.string("driveDetail.start", "Start")): \(projection.startTimeText)")
        if let endTimeText = projection.endTimeText {
            parts.append("\(RouteMapSectionStrings.string("driveDetail.end", "End")): \(endTimeText)")
        }
        return parts.joined(separator: ". ")
    }

    /// A single marker read as "title, detail" (web popup content).
    public static func markerSummary(for marker: RouteMapMarker) -> String {
        guard let detail = marker.detail, !detail.isEmpty else { return marker.title }
        return "\(marker.title), \(detail)"
    }
}
