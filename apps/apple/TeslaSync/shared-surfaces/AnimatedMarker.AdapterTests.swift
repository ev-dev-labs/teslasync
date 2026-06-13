//
//  AnimatedMarker.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  Pure-core coverage for the AnimatedMarker surface — the geometry guards (usable-coordinate, heading
//  normalisation, region-contains pan trigger), the marker colour parse (`#RGB` / `#RRGGBB` /
//  `#RRGGBBAA`, web `color` default `#00b4d8`), the wire-row decode (snake_case position payload), the
//  fix adapter (web `hasCoords` guard + colour default), and the load-status / resolve projection.
//  Everything here is Foundation-only and reads the pure types directly (no store, no rendered view),
//  so each web branch is asserted in isolation. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Geometry (usable coordinate / heading / region-contains)

final class AnimatedMarkerGeoTests: XCTestCase {
    func testIsUsableRejectsNullIslandAndOutOfRange() {
        XCTAssertTrue(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: 37.77, longitude: -122.41)))
        // Web `hasCoords` guard: (0, 0) is not usable.
        XCTAssertFalse(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: 0, longitude: 0)))
        XCTAssertFalse(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: 91, longitude: 0)))
        XCTAssertFalse(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: 0, longitude: 181)))
        XCTAssertFalse(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: .nan, longitude: 1)))
        // A non-zero coordinate on a single axis is still usable.
        XCTAssertTrue(AnimatedMarkerGeo.isUsable(AnimatedMarkerCoordinate(latitude: 51.5, longitude: 0)))
    }

    func testNormalizedHeadingWrapsInto0To360() {
        XCTAssertEqual(AnimatedMarkerGeo.normalizedHeading(45), 45)
        XCTAssertEqual(AnimatedMarkerGeo.normalizedHeading(0), 0)
        XCTAssertEqual(AnimatedMarkerGeo.normalizedHeading(360), 0)
        XCTAssertEqual(AnimatedMarkerGeo.normalizedHeading(370), 10)
        XCTAssertEqual(AnimatedMarkerGeo.normalizedHeading(-45), 315)
        XCTAssertNil(AnimatedMarkerGeo.normalizedHeading(nil))
        XCTAssertNil(AnimatedMarkerGeo.normalizedHeading(.infinity))
    }

    func testRegionContainsMatchesWebBounds() {
        let center = AnimatedMarkerCoordinate(latitude: 0, longitude: 0)
        let span = AnimatedMarkerSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        // Inside the half-span box.
        XCTAssertTrue(AnimatedMarkerGeo.region(
            center: center,
            span: span,
            contains: AnimatedMarkerCoordinate(latitude: 0.005, longitude: 0.005)
        ))
        // On the edge (half-delta) is contained.
        XCTAssertTrue(AnimatedMarkerGeo.region(
            center: center,
            span: span,
            contains: AnimatedMarkerCoordinate(latitude: 0.01, longitude: 0)
        ))
        // Past the latitude bound → pans (web `!contains`).
        XCTAssertFalse(AnimatedMarkerGeo.region(
            center: center,
            span: span,
            contains: AnimatedMarkerCoordinate(latitude: 0.02, longitude: 0)
        ))
        // Past the longitude bound → pans.
        XCTAssertFalse(AnimatedMarkerGeo.region(
            center: center,
            span: span,
            contains: AnimatedMarkerCoordinate(latitude: 0, longitude: 0.5)
        ))
    }
}

// MARK: - Colour parse (web `color` prop)

final class AnimatedMarkerPaletteTests: XCTestCase {
    func testDefaultHexParsesToFallback() {
        XCTAssertEqual(AnimatedMarkerPalette.parse(AnimatedMarkerPalette.defaultHex), AnimatedMarkerPalette.fallback)
        // Tolerates the missing leading '#'.
        XCTAssertEqual(AnimatedMarkerPalette.parse("00b4d8"), AnimatedMarkerPalette.fallback)
    }

    func testParsesShorthandSixAndEightDigits() {
        let shorthand = AnimatedMarkerPalette.parse("#0bd")
        XCTAssertEqual(shorthand.green, Double(0xBB) / 255.0, accuracy: 0.0001)
        XCTAssertEqual(shorthand.blue, Double(0xDD) / 255.0, accuracy: 0.0001)
        XCTAssertEqual(shorthand.alpha, 1, accuracy: 0.0001)

        let emerald = AnimatedMarkerPalette.parse("#10b981")
        XCTAssertEqual(emerald.red, Double(0x10) / 255.0, accuracy: 0.0001)
        XCTAssertEqual(emerald.green, Double(0xB9) / 255.0, accuracy: 0.0001)
        XCTAssertEqual(emerald.blue, Double(0x81) / 255.0, accuracy: 0.0001)

        let withAlpha = AnimatedMarkerPalette.parse("#00b4d880")
        XCTAssertEqual(withAlpha.alpha, Double(0x80) / 255.0, accuracy: 0.0001)
    }

    func testMalformedHexFallsBack() {
        XCTAssertEqual(AnimatedMarkerPalette.parse(nil), AnimatedMarkerPalette.fallback)
        XCTAssertEqual(AnimatedMarkerPalette.parse(""), AnimatedMarkerPalette.fallback)
        XCTAssertEqual(AnimatedMarkerPalette.parse("#12"), AnimatedMarkerPalette.fallback)
        XCTAssertEqual(AnimatedMarkerPalette.parse("zzzzzz"), AnimatedMarkerPalette.fallback)
    }
}

// MARK: - Wire-row decode (web snake_case payload)

final class AnimatedMarkerFixRowDecodeTests: XCTestCase {
    func testDecodesFullPayload() throws {
        let json = Data(##"{"latitude":1.5,"longitude":2.5,"heading":90,"color":"#ffffff"}"##.utf8)
        let row = try JSONDecoder().decode(AnimatedMarkerFixRow.self, from: json)
        XCTAssertEqual(row.latitude, 1.5)
        XCTAssertEqual(row.longitude, 2.5)
        XCTAssertEqual(row.heading, 90)
        XCTAssertEqual(row.color, "#ffffff")
    }

    func testDecodesWithoutOptionalFields() throws {
        let json = Data(#"{"latitude":1.5,"longitude":2.5}"#.utf8)
        let row = try JSONDecoder().decode(AnimatedMarkerFixRow.self, from: json)
        XCTAssertNil(row.heading)
        XCTAssertNil(row.color)
    }
}

// MARK: - Fix adapter (web `hasCoords` + colour default)

final class AnimatedMarkerAdapterTests: XCTestCase {
    func testNilRowAndNullIslandResolveToNil() {
        XCTAssertNil(AnimatedMarkerAdapter.fix(from: nil))
        XCTAssertNil(AnimatedMarkerAdapter.fix(from: AnimatedMarkerFixRow(latitude: 0, longitude: 0)))
    }

    func testValidRowNormalisesHeadingAndDefaultsColour() throws {
        let row = AnimatedMarkerFixRow(latitude: 37.7749, longitude: -122.4194, heading: 370)
        let fix = try XCTUnwrap(AnimatedMarkerAdapter.fix(from: row))
        XCTAssertEqual(fix.coordinate.latitude, 37.7749)
        XCTAssertEqual(fix.coordinate.longitude, -122.4194)
        XCTAssertEqual(fix.heading, 10) // 370 → 10
        XCTAssertEqual(fix.color, AnimatedMarkerPalette.fallback) // default #00b4d8
        XCTAssertTrue(fix.hasHeading)
    }

    func testCustomColourAndAbsentHeading() {
        let row = AnimatedMarkerFixRow(latitude: 40.71, longitude: -74.0, color: "#10b981")
        let fix = AnimatedMarkerAdapter.fix(from: row)
        XCTAssertEqual(fix?.color, AnimatedMarkerPalette.parse("#10b981"))
        XCTAssertNil(fix?.heading)
        XCTAssertEqual(fix?.hasHeading, false)
    }
}

// MARK: - Projection (load status + resolve)

final class AnimatedMarkerProjectionTests: XCTestCase {
    private let fix = AnimatedMarkerFix(
        coordinate: AnimatedMarkerCoordinate(latitude: 1, longitude: 1),
        heading: 90,
        color: AnimatedMarkerPalette.fallback
    )

    func testLoadStatusPrecedence() {
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .failed, hasFix: false), .error)
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .failed, hasFix: true), .error)
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .loading, hasFix: false), .loading)
        // Loading with a cached fix → render the cached marker (web keeps the last marker).
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .loading, hasFix: true), .ready)
        // Settled with no usable coordinate → empty (web `hasCoords === false`).
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .loaded, hasFix: false), .empty)
        XCTAssertEqual(AnimatedMarkerProjection.loadStatus(phase: .loaded, hasFix: true), .ready)
    }

    func testResolveWiresStatusConnectionFixAndSpan() {
        let content = AnimatedMarkerContent(span: AnimatedMarkerSpan(latitudeDelta: 0.05, longitudeDelta: 0.05))
        let resolved = AnimatedMarkerProjection.resolve(
            content: content,
            fix: fix,
            phase: .loaded,
            connection: .stale
        )
        XCTAssertEqual(resolved.status, .ready)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertEqual(resolved.fix, fix)
        XCTAssertEqual(resolved.span, content.span)
        XCTAssertFalse(resolved.isLive)
        XCTAssertTrue(resolved.hasMarker)
    }

    func testResolveEmptyHasNoMarker() {
        let resolved = AnimatedMarkerProjection.resolve(
            content: AnimatedMarkerContent(),
            fix: nil,
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(resolved.status, .empty)
        XCTAssertTrue(resolved.isLive)
        XCTAssertFalse(resolved.hasMarker)
    }
}
