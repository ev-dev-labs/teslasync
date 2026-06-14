//
//  RoutePlayback.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  Pure-core coverage for the RoutePlayback surface — the geometry guards (plottable coordinate, the
//  great-circle heading), the playback timing (offsets, the nearest-sample binary search, the tick
//  advance, the duration format), the trail-colour parse (`#RGB` / `#RRGGBB` / `#RRGGBBAA`), the
//  wire-row decode + route adapter (web `buildOffsets` + the finite `trail` filter), and the
//  load-status / resolve / frame projection. Everything here is Foundation-only and reads the pure types
//  directly (no store, no rendered view), so each web branch is asserted in isolation. Runs in the
//  TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Geometry (plottable coordinate / heading)

final class RoutePlaybackGeoTests: XCTestCase {
    func testIsPlottableKeepsNullIslandButRejectsOutOfRange() {
        XCTAssertTrue(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: 37.77, longitude: -122.41)))
        // Web trail filter is finite-only — it keeps (0, 0), unlike the live marker guard.
        XCTAssertTrue(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: 0, longitude: 0)))
        XCTAssertFalse(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: 91, longitude: 0)))
        XCTAssertFalse(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: 0, longitude: 181)))
        XCTAssertFalse(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: .nan, longitude: 1)))
        XCTAssertFalse(RoutePlaybackGeo.isPlottable(RoutePlaybackCoordinate(latitude: 1, longitude: .infinity)))
    }

    func testHeadingMatchesCardinalDirections() {
        let origin = RoutePlaybackCoordinate(latitude: 0, longitude: 0)
        let north = RoutePlaybackCoordinate(latitude: 1, longitude: 0)
        let east = RoutePlaybackCoordinate(latitude: 0, longitude: 1)
        XCTAssertEqual(RoutePlaybackGeo.heading(from: origin, to: north), 0, accuracy: 0.001)
        XCTAssertEqual(RoutePlaybackGeo.heading(from: origin, to: east), 90, accuracy: 0.001)
        // A degenerate pair (same point) yields a finite, in-range bearing.
        let bearing = RoutePlaybackGeo.heading(from: origin, to: origin)
        XCTAssertTrue(bearing >= 0 && bearing < 360)
    }
}

// MARK: - Timing (offsets / index / advance / format)

final class RoutePlaybackTimingTests: XCTestCase {
    func testOffsetsAreRelativeToFirstSample() {
        let timestamps: [Date?] = [
            Date(timeIntervalSince1970: 1000),
            Date(timeIntervalSince1970: 1030),
            Date(timeIntervalSince1970: 1090)
        ]
        XCTAssertEqual(RoutePlaybackTiming.offsets(from: timestamps), [0, 30000, 90000])
        XCTAssertEqual(RoutePlaybackTiming.offsets(from: []), [])
    }

    func testOffsetsTreatNilTimestampAsZero() {
        let timestamps: [Date?] = [Date(timeIntervalSince1970: 1000), nil, Date(timeIntervalSince1970: 1002)]
        XCTAssertEqual(RoutePlaybackTiming.offsets(from: timestamps), [0, 0, 2000])
    }

    func testIndexFindsNearestOffset() {
        let offsets: [Double] = [0, 1000, 2000, 3000]
        XCTAssertEqual(RoutePlaybackTiming.index(at: 0, in: offsets), 0)
        XCTAssertEqual(RoutePlaybackTiming.index(at: 1400, in: offsets), 1)
        XCTAssertEqual(RoutePlaybackTiming.index(at: 1600, in: offsets), 2)
        XCTAssertEqual(RoutePlaybackTiming.index(at: 5000, in: offsets), 3)
        XCTAssertEqual(RoutePlaybackTiming.index(at: 100, in: []), 0)
    }

    func testAdvanceClampsAndFlagsEnd() {
        let mid = RoutePlaybackTiming.advance(elapsed: 0, total: 1000, speedMultiplier: 10)
        XCTAssertEqual(mid.elapsed, 500)
        XCTAssertFalse(mid.reachedEnd)

        let end = RoutePlaybackTiming.advance(elapsed: 900, total: 1000, speedMultiplier: 10)
        XCTAssertEqual(end.elapsed, 1000)
        XCTAssertTrue(end.reachedEnd)

        let zero = RoutePlaybackTiming.advance(elapsed: 0, total: 0, speedMultiplier: 1)
        XCTAssertEqual(zero.elapsed, 0)
        XCTAssertTrue(zero.reachedEnd)
    }

    func testFormatDurationMatchesWeb() {
        XCTAssertEqual(RoutePlaybackTiming.formatDuration(0), "00:00")
        XCTAssertEqual(RoutePlaybackTiming.formatDuration(65000), "01:05")
        XCTAssertEqual(RoutePlaybackTiming.formatDuration(3_661_000), "1:01:01")
        XCTAssertEqual(RoutePlaybackTiming.formatDuration(-5000), "00:00")
    }
}

// MARK: - Trail colour parse (web `trailColor` / `markerColor`)

final class RoutePlaybackPaletteTests: XCTestCase {
    func testParsesSixDigitHex() throws {
        let trail = try XCTUnwrap(RoutePlaybackPalette.parse(RoutePlaybackPalette.defaultTrailHex))
        XCTAssertEqual(trail.red, Double(0x22) / 255, accuracy: 0.0001)
        XCTAssertEqual(trail.green, Double(0xD3) / 255, accuracy: 0.0001)
        XCTAssertEqual(trail.blue, Double(0xEE) / 255, accuracy: 0.0001)
        XCTAssertEqual(trail.alpha, 1, accuracy: 0.0001)
    }

    func testParsesShorthandAndAlpha() throws {
        let shorthand = try XCTUnwrap(RoutePlaybackPalette.parse("#0bd"))
        XCTAssertEqual(shorthand.green, Double(0xBB) / 255, accuracy: 0.0001)
        XCTAssertEqual(shorthand.blue, Double(0xDD) / 255, accuracy: 0.0001)

        let withAlpha = try XCTUnwrap(RoutePlaybackPalette.parse("#00b4d880"))
        XCTAssertEqual(withAlpha.alpha, Double(0x80) / 255, accuracy: 0.0001)
    }

    func testMalformedHexReturnsNil() {
        XCTAssertNil(RoutePlaybackPalette.parse(nil))
        XCTAssertNil(RoutePlaybackPalette.parse(""))
        XCTAssertNil(RoutePlaybackPalette.parse("#12"))
        XCTAssertNil(RoutePlaybackPalette.parse("zzzzzz"))
    }
}

// MARK: - Wire-row decode + route adapter (web `buildOffsets` + `trail` filter)

final class RoutePlaybackAdapterTests: XCTestCase {
    private func row(
        _ lat: Double,
        _ lng: Double,
        _ stamp: String,
        speed: Double? = nil,
        soc: Double? = nil
    ) -> RoutePlaybackPointRow {
        RoutePlaybackPointRow(lat: lat, lng: lng, timestamp: stamp, speed: speed, soc: soc)
    }

    func testDecodesWirePayload() throws {
        let json = Data(##"{"lat":1.5,"lng":2.5,"timestamp":"2026-01-01T00:00:00Z","speed":33,"soc":80}"##.utf8)
        let decoded = try JSONDecoder().decode(RoutePlaybackPointRow.self, from: json)
        XCTAssertEqual(decoded.lat, 1.5)
        XCTAssertEqual(decoded.lng, 2.5)
        XCTAssertEqual(decoded.speed, 33)
        XCTAssertEqual(decoded.soc, 80)
        XCTAssertNil(decoded.power)
    }

    func testEmptyRowsResolveToEmptyRoute() {
        let route = RoutePlaybackAdapter.route(from: [])
        XCTAssertTrue(route.isEmpty)
        XCTAssertEqual(route.count, 0)
        XCTAssertEqual(route.totalMs, 0)
        XCTAssertNil(route.start)
        XCTAssertNil(route.end)
    }

    func testRouteBuildsOffsetsTrailAndAnchors() {
        let route = RoutePlaybackAdapter.route(from: [
            row(37.7749, -122.4194, "2026-01-01T00:00:00Z", speed: 0, soc: 82),
            row(37.7769, -122.4185, "2026-01-01T00:00:30Z", speed: 32, soc: 81),
            row(37.7795, -122.4150, "2026-01-01T00:01:30Z", speed: 40, soc: 80)
        ])
        XCTAssertEqual(route.count, 3)
        XCTAssertEqual(route.trail.count, 3)
        XCTAssertEqual(route.offsets, [0, 30000, 90000])
        XCTAssertEqual(route.totalMs, 90000)
        XCTAssertEqual(route.start, RoutePlaybackCoordinate(latitude: 37.7749, longitude: -122.4194))
        XCTAssertEqual(route.end, RoutePlaybackCoordinate(latitude: 37.7795, longitude: -122.4150))
        XCTAssertFalse(route.isEmpty)
    }

    func testNonFiniteCoordinateLeavesTrailButKeepsSample() {
        let route = RoutePlaybackAdapter.route(from: [
            row(37.77, -122.41, "2026-01-01T00:00:00Z"),
            row(.nan, -122.41, "2026-01-01T00:00:30Z"),
            row(37.78, -122.40, "2026-01-01T00:01:00Z")
        ])
        // All three remain in cursor space (web `points`), but the non-finite sample drops from the
        // plottable trail (web finite filter).
        XCTAssertEqual(route.count, 3)
        XCTAssertEqual(route.trail.count, 2)
    }

    func testParseTimestampHandlesFractionalAndInvalid() {
        XCTAssertNotNil(RoutePlaybackAdapter.parseTimestamp("2026-01-01T00:00:00Z"))
        XCTAssertNotNil(RoutePlaybackAdapter.parseTimestamp("2026-01-01T00:00:00.250Z"))
        XCTAssertNil(RoutePlaybackAdapter.parseTimestamp("not-a-date"))
        XCTAssertNil(RoutePlaybackAdapter.parseTimestamp(""))
    }
}

// MARK: - Projection (load status / resolve / frame)

final class RoutePlaybackProjectionTests: XCTestCase {
    private func route() -> RoutePlaybackRoute {
        RoutePlaybackAdapter.route(from: [
            RoutePlaybackPointRow(lat: 0, lng: 0, timestamp: "2026-01-01T00:00:00Z", speed: 0, soc: 90),
            RoutePlaybackPointRow(lat: 0, lng: 1, timestamp: "2026-01-01T00:00:10Z", speed: 50, soc: 88)
        ])
    }

    func testLoadStatusPrecedence() {
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .failed, hasRoute: false), .error)
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .failed, hasRoute: true), .error)
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .loading, hasRoute: false), .loading)
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .loading, hasRoute: true), .ready)
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .loaded, hasRoute: false), .empty)
        XCTAssertEqual(RoutePlaybackProjection.loadStatus(phase: .loaded, hasRoute: true), .ready)
    }

    func testResolveWiresStatusConnectionRoute() {
        let resolved = RoutePlaybackProjection.resolve(
            content: RoutePlaybackContent(),
            route: route(),
            phase: .loaded,
            connection: .stale
        )
        XCTAssertEqual(resolved.status, .ready)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertTrue(resolved.hasRoute)
        XCTAssertFalse(resolved.isLive)
    }

    func testResolveEmptyHasNoRoute() {
        let resolved = RoutePlaybackProjection.resolve(
            content: RoutePlaybackContent(),
            route: .empty,
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(resolved.status, .empty)
        XCTAssertFalse(resolved.hasRoute)
        XCTAssertTrue(resolved.isLive)
    }

    func testFrameDerivesProgressHeadingAndPlayhead() {
        let built = route()
        let frame = RoutePlaybackProjection.frame(
            route: built,
            currentIndex: 1,
            isPlaying: true,
            speedMultiplier: 10,
            elapsedMs: built.totalMs
        )
        XCTAssertEqual(frame.progress, 1, accuracy: 0.0001)
        XCTAssertEqual(frame.displayIndex, 2)
        XCTAssertEqual(frame.count, 2)
        XCTAssertTrue(frame.hasPlayhead)
        // Two samples heading east → ~90°.
        XCTAssertEqual(frame.heading, 90, accuracy: 0.001)
        XCTAssertEqual(frame.totalLabel, "00:10")
    }

    func testFrameProgressIsZeroForEmptyRoute() {
        let frame = RoutePlaybackProjection.frame(
            route: .empty,
            currentIndex: 0,
            isPlaying: false,
            speedMultiplier: 1,
            elapsedMs: 0
        )
        XCTAssertEqual(frame.progress, 0)
        XCTAssertEqual(frame.displayIndex, 0)
        XCTAssertFalse(frame.hasPlayhead)
        XCTAssertEqual(frame.heading, 0)
    }
}
