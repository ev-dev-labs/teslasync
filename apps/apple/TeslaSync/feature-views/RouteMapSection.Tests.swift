//
//  RouteMapSection.Tests.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  Shared fixtures + the pure-helper coverage for the route-map surface:
//    • Geo — `RouteMapGeo` validity / haversine / `hasMeaningfulRoute` / `firstValidIndex` parity with
//      web `lib/geo.ts`.
//    • Unit math — `RouteMapUnitMath` SI speed conversion, band classification, and `fmtNumber` parity
//      with web `lib/unitConversion.ts` + `lib/numberFormat.ts`.
//    • Format — `RouteMapFormat` time/date/dateTime parity with web `lib/dateFormat.ts`.
//    • Accessibility — the VoiceOver canvas + marker summaries.
//
//  The projector coverage lives in RouteMapSection.ProjectorTests.swift and the state-holder + view
//  coverage in RouteMapSection.ModelTests.swift; all three share `RouteMapFixture` below. The tests run
//  with no network and no real store. Timestamps are built in a fixed timezone so the formatted
//  assertions are stable on any host.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used across the three RouteMapSection test files)

enum RouteMapFixture {
    static let prefs = RouteMapFormatPrefs(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles",
        speedUnit: "mph",
        precision: 0
    )

    /// A wall-clock instant in a fixed zone so the formatted output is deterministic across hosts.
    static func instant(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        zone: String = "America/Los_Angeles"
    ) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }

    static var start: Date {
        instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
    }

    static var end: Date {
        instant(year: 2026, month: 4, day: 4, hour: 15, minute: 10)
    }

    /// A real San Francisco route with speeds spanning every band (m/s).
    static let routePositions: [RouteMapPosition] = [
        RouteMapPosition(latitude: 37.7749, longitude: -122.4194, speedMps: 8),
        RouteMapPosition(latitude: 37.7765, longitude: -122.4170, speedMps: 16),
        RouteMapPosition(latitude: 37.7790, longitude: -122.4135, speedMps: 24),
        RouteMapPosition(latitude: 37.7820, longitude: -122.4090, speedMps: 34),
        RouteMapPosition(latitude: 37.7860, longitude: -122.4035, speedMps: 46),
        RouteMapPosition(latitude: 37.7905, longitude: -122.3975, speedMps: 30)
    ]

    static func routedDrive(ended: Bool = true, withTelemetry: Bool = true) -> RouteMapDrive {
        RouteMapDrive(
            driveID: "8421",
            startTs: start,
            endTs: ended ? end : nil,
            startLatitude: 37.7749,
            startLongitude: -122.4194,
            positions: routePositions,
            telemetry: withTelemetry
                ? routePositions.map {
                    RouteMapTelemetrySample(latitude: $0.latitude, longitude: $0.longitude, speedMps: $0.speedMps)
                }
                : []
        )
    }

    /// A stationary drive: every fix is within ~3 m of the first (below the 10 m route floor).
    static func stationaryDrive() -> RouteMapDrive {
        let positions = (0 ..< 4).map { index in
            RouteMapPosition(latitude: 37.7749 + Double(index) * 0.000_01, longitude: -122.4194, speedMps: 0)
        }
        return RouteMapDrive(
            driveID: "8422",
            startTs: start,
            endTs: end,
            startLatitude: 37.7749,
            startLongitude: -122.4194,
            positions: positions,
            telemetry: positions.map {
                RouteMapTelemetrySample(latitude: $0.latitude, longitude: $0.longitude, speedMps: 0)
            }
        )
    }

    static func emptyDrive() -> RouteMapDrive {
        RouteMapDrive(driveID: "8423", startTs: start, endTs: end)
    }
}

// MARK: - Geo (web lib/geo.ts parity)

final class RouteMapGeoTests: XCTestCase {
    func testIsValidRejectsNullIslandAndOutOfBounds() {
        XCTAssertTrue(RouteMapGeo.isValid(latitude: 37.77, longitude: -122.41))
        XCTAssertFalse(RouteMapGeo.isValid(latitude: 0, longitude: 0))
        XCTAssertFalse(RouteMapGeo.isValid(latitude: 91, longitude: 0))
        XCTAssertFalse(RouteMapGeo.isValid(latitude: 0, longitude: 181))
        XCTAssertFalse(RouteMapGeo.isValid(latitude: .nan, longitude: 0))
    }

    func testHaversineDistanceMatchesKnownSeparation() {
        let distance = RouteMapGeo.haversineDistance(37.7749, -122.4194, 37.7765, -122.4170)
        XCTAssertEqual(distance, 270, accuracy: 40) // ~270 m between the first two SF fixes
    }

    func testHasMeaningfulRouteTrueForSpreadOutFixes() {
        XCTAssertTrue(RouteMapGeo.hasMeaningfulRoute(RouteMapFixture.routedDrive().positions))
    }

    func testHasMeaningfulRouteFalseForStationaryCluster() {
        XCTAssertFalse(RouteMapGeo.hasMeaningfulRoute(RouteMapFixture.stationaryDrive().positions))
    }

    func testHasMeaningfulRouteFalseForEmptyOrInvalid() {
        XCTAssertFalse(RouteMapGeo.hasMeaningfulRoute([]))
        XCTAssertFalse(RouteMapGeo.hasMeaningfulRoute([RouteMapPosition(latitude: 0, longitude: 0)]))
    }

    func testFirstValidIndexSkipsNullIsland() {
        let positions = [
            RouteMapPosition(latitude: 0, longitude: 0),
            RouteMapPosition(latitude: 37.77, longitude: -122.41)
        ]
        XCTAssertEqual(RouteMapGeo.firstValidIndex(positions), 1)
        XCTAssertEqual(RouteMapGeo.firstValidIndex([]), -1)
    }
}

// MARK: - Unit math (web unitConversion.ts + numberFormat.ts parity)

final class RouteMapUnitMathTests: XCTestCase {
    func testSpeedFromSIMph() {
        XCTAssertEqual(RouteMapUnitMath.speedFromSI(RouteMapUnitMath.lowThresholdMps, "mph"), 30, accuracy: 0.0001)
        XCTAssertEqual(RouteMapUnitMath.speedFromSI(RouteMapUnitMath.highThresholdMps, "mph"), 100, accuracy: 0.0001)
    }

    func testSpeedFromSIKmh() {
        XCTAssertEqual(RouteMapUnitMath.speedFromSI(RouteMapUnitMath.lowThresholdMps, "km/h"), 48.28, accuracy: 0.01)
    }

    func testFmtNumberRoundsHalfUpAtPrecision() {
        XCTAssertEqual(RouteMapUnitMath.fmtNumber(30, decimals: 0), "30")
        XCTAssertEqual(RouteMapUnitMath.fmtNumber(96.56, decimals: 0), "97")
        XCTAssertEqual(RouteMapUnitMath.fmtNumber(48.2811, decimals: 1), "48.3")
    }

    func testFmtNumberGuardsNonFinite() {
        XCTAssertEqual(RouteMapUnitMath.fmtNumber(.nan, decimals: 0), "0")
        XCTAssertEqual(RouteMapUnitMath.fmtNumber(.infinity, decimals: 0), "0")
    }

    func testBandClassification() {
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: 8), .low)
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: 16), .lowMid)
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: 34), .midHigh)
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: 46), .high)
    }

    func testBandBoundariesAreInclusiveLower() {
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: RouteMapUnitMath.lowThresholdMps), .lowMid)
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: RouteMapUnitMath.medThresholdMps), .midHigh)
        XCTAssertEqual(RouteMapUnitMath.band(forSpeedMps: RouteMapUnitMath.highThresholdMps), .high)
    }
}

// MARK: - Format (web dateFormat.ts parity)

final class RouteMapFormatTests: XCTestCase {
    private let start = RouteMapFixture.start

    func testTimeRendersLocaleTwelveHour() {
        let text = RouteMapFormat.time(start, prefs: RouteMapFixture.prefs)
        XCTAssertTrue(text.contains("2:30"), text)
        XCTAssertTrue(text.contains("PM"), text)
    }

    func testTimeRendersLocaleTwentyFourHour() {
        let prefs = RouteMapFormatPrefs(localeIdentifier: "de_DE", timeZoneIdentifier: "America/Los_Angeles")
        XCTAssertEqual(RouteMapFormat.time(start, prefs: prefs), "14:30")
    }

    func testDateTimeComposesDateAndTime() {
        let text = RouteMapFormat.dateTime(start, prefs: RouteMapFixture.prefs)
        XCTAssertTrue(text.hasPrefix("Apr 4, 2026, "), text)
        XCTAssertTrue(text.contains("2:30"), text)
    }

    func testNilRendersEmptyMarker() {
        XCTAssertEqual(RouteMapFormat.time(nil, prefs: RouteMapFixture.prefs), "—")
        XCTAssertEqual(RouteMapFormat.dateTime(nil, prefs: RouteMapFixture.prefs), "—")
    }
}

// MARK: - Accessibility summaries

final class RouteMapAccessibilityTests: XCTestCase {
    func testCanvasSummaryForRouteIncludesStartAndEnd() {
        let projection = RouteMapProjector.project(drive: RouteMapFixture.routedDrive(), prefs: RouteMapFixture.prefs)
        let summary = RouteMapAccessibility.canvasSummary(for: projection)
        XCTAssertTrue(summary.contains("Drive route map"), summary)
        XCTAssertTrue(summary.contains("Start: "), summary)
        XCTAssertTrue(summary.contains("End: "), summary)
    }

    func testCanvasSummaryForStationaryMentionsCannotPlot() {
        let projection = RouteMapProjector.project(
            drive: RouteMapFixture.stationaryDrive(),
            prefs: RouteMapFixture.prefs
        )
        let summary = RouteMapAccessibility.canvasSummary(for: projection)
        XCTAssertTrue(summary.contains("Route can't be plotted"), summary)
    }

    func testCanvasSummaryForNoRouteData() {
        let projection = RouteMapProjector.project(drive: RouteMapFixture.emptyDrive(), prefs: RouteMapFixture.prefs)
        let summary = RouteMapAccessibility.canvasSummary(for: projection)
        XCTAssertTrue(summary.contains("No route data available"), summary)
    }

    func testMarkerSummaryJoinsTitleAndDetail() {
        let marker = RouteMapMarker(
            kind: .start,
            coordinate: RouteCoordinate(latitude: 1, longitude: 2),
            title: "Start",
            detail: "Apr 4, 2026, 2:30 PM"
        )
        XCTAssertEqual(RouteMapAccessibility.markerSummary(for: marker), "Start, Apr 4, 2026, 2:30 PM")
        let anchor = RouteMapMarker(
            kind: .anchor,
            coordinate: RouteCoordinate(latitude: 1, longitude: 2),
            title: "Last known location",
            detail: nil
        )
        XCTAssertEqual(RouteMapAccessibility.markerSummary(for: anchor), "Last known location")
    }
}
