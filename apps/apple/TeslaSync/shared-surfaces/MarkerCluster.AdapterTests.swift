//
//  MarkerCluster.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  Pure-core coverage for the MarkerCluster surface — the density palette (verbatim port of the web
//  `defaultIconCreate` count ladder), the CSS-colour parser (`#rgb` / `#rrggbb` / `#rrggbbaa` /
//  `rgb()` / `rgba()`), the point sanitation (the web `points.slice(0, 5000)` cap + the `Number.isNaN`
//  guard), the dominant-child colour reduction (web `getClusterColor` default), the slippy-zoom helper
//  (web `disableClusteringAtZoom`), the popup-text projection, the snake_case point decode, and the
//  load-status / resolve projection. Everything here is Foundation-only and reads the pure types
//  directly (no store, no rendered view), so each web branch is asserted in isolation. Runs in the
//  TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Density palette (web `defaultIconCreate` ladder)

final class MarkerClusterDensityTests: XCTestCase {
    func testForCountMatchesWebThresholds() {
        XCTAssertEqual(MarkerClusterDensity.forCount(0), .low)
        XCTAssertEqual(MarkerClusterDensity.forCount(9), .low)
        XCTAssertEqual(MarkerClusterDensity.forCount(10), .medium)
        XCTAssertEqual(MarkerClusterDensity.forCount(24), .medium)
        XCTAssertEqual(MarkerClusterDensity.forCount(25), .high)
        XCTAssertEqual(MarkerClusterDensity.forCount(99), .high)
        XCTAssertEqual(MarkerClusterDensity.forCount(100), .extreme)
        XCTAssertEqual(MarkerClusterDensity.forCount(5000), .extreme)
    }

    func testColorHexMatchesWebGlowPalette() {
        XCTAssertEqual(MarkerClusterDensity.low.colorHex, "#22d3ee")
        XCTAssertEqual(MarkerClusterDensity.medium.colorHex, "#a855f7")
        XCTAssertEqual(MarkerClusterDensity.high.colorHex, "#fbbf24")
        XCTAssertEqual(MarkerClusterDensity.extreme.colorHex, "#f43f5e")
    }

    func testBucketsAreOrderedAndLabelled() {
        XCTAssertEqual(MarkerClusterDensity.allCases.map(\.lowerBound), [0, 10, 25, 100])
        for density in MarkerClusterDensity.allCases {
            XCTAssertFalse(density.labelFallback.isEmpty)
            XCTAssertTrue(density.labelKey.hasPrefix("markerCluster.density."))
        }
    }
}

// MARK: - CSS colour parser (web `point.color` / `defaultColor`)

final class MarkerClusterColorTests: XCTestCase {
    func testParsesSixDigitHex() {
        let rgba = MarkerClusterColor.parse("#22d3ee")
        XCTAssertNotNil(rgba)
        XCTAssertEqual(rgba?.red ?? 0, 0x22 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgba?.green ?? 0, Double(0xD3) / 255, accuracy: 0.0001)
        XCTAssertEqual(rgba?.blue ?? 0, Double(0xEE) / 255, accuracy: 0.0001)
        XCTAssertEqual(rgba?.alpha ?? 0, 1, accuracy: 0.0001)
    }

    func testParsesShorthandAndAlphaHex() {
        // `#0af` expands to `#00aaff`.
        let short = MarkerClusterColor.parse("#0af")
        XCTAssertEqual(short?.red ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(short?.green ?? -1, Double(0xAA) / 255, accuracy: 0.0001)
        XCTAssertEqual(short?.blue ?? -1, 1, accuracy: 0.0001)
        // 8-digit carries alpha.
        let alpha = MarkerClusterColor.parse("#ff000080")
        XCTAssertEqual(alpha?.red ?? -1, 1, accuracy: 0.0001)
        XCTAssertEqual(alpha?.alpha ?? -1, Double(0x80) / 255, accuracy: 0.0001)
    }

    func testParsesFunctionalNotation() {
        let rgb = MarkerClusterColor.parse("rgb(255, 0, 0)")
        XCTAssertEqual(rgb?.red ?? -1, 1, accuracy: 0.0001)
        XCTAssertEqual(rgb?.alpha ?? -1, 1, accuracy: 0.0001)
        // The web cluster background uses `rgba(244, 63, 94, 0.85)`.
        let rgba = MarkerClusterColor.parse("rgba(244, 63, 94, 0.85)")
        XCTAssertEqual(rgba?.red ?? -1, 244.0 / 255, accuracy: 0.0001)
        XCTAssertEqual(rgba?.alpha ?? -1, 0.85, accuracy: 0.0001)
    }

    func testRejectsUnknownAndNil() {
        XCTAssertNil(MarkerClusterColor.parse("turquoise"))
        XCTAssertNil(MarkerClusterColor.parse("#xyz"))
        XCTAssertNil(MarkerClusterColor.parse("#12"))
        XCTAssertNil(MarkerClusterColor.parse(nil))
    }
}

// MARK: - Point sanitation (web cap + NaN guard)

final class MarkerClusterSanitizeTests: XCTestCase {
    private func point(_ id: String, _ lat: Double, _ lng: Double) -> MarkerClusterPoint {
        MarkerClusterPoint(id: id, latitude: lat, longitude: lng)
    }

    func testCapsAtFiveThousand() {
        let points = (0 ..< 6000).map { point("\($0)", 1, 1) }
        XCTAssertEqual(MarkerClusterLogic.sanitize(points).count, MarkerClusterMeta.maxRenderedMarkers)
    }

    func testDropsNonFiniteCoordinates() {
        let points = [
            point("ok", 37.7, -122.4),
            point("nan-lat", .nan, 1),
            point("inf-lng", 1, .infinity)
        ]
        let kept = MarkerClusterLogic.sanitize(points)
        XCTAssertEqual(kept.map(\.id), ["ok"])
    }

    func testCapIsAppliedBeforeFilter() {
        // An invalid point inside the first 5000 is dropped (so the result is one short), and points
        // beyond the cap are never considered — the web slices first, then guards per point.
        var points = (0 ..< 6000).map { point("\($0)", 1, 1) }
        points[0] = point("bad", .nan, 1)
        let kept = MarkerClusterLogic.sanitize(points)
        XCTAssertEqual(kept.count, MarkerClusterMeta.maxRenderedMarkers - 1)
        XCTAssertFalse(kept.contains { $0.id == "bad" })
    }

    func testPreservesOrder() {
        let points = [point("a", 1, 1), point("b", 2, 2), point("c", 3, 3)]
        XCTAssertEqual(MarkerClusterLogic.sanitize(points).map(\.id), ["a", "b", "c"])
    }
}

// MARK: - Dominant colour (web `getClusterColor` default)

final class MarkerClusterDominantColorTests: XCTestCase {
    private func coloured(_ id: String, _ hex: String?) -> MarkerClusterPoint {
        MarkerClusterPoint(id: id, latitude: 0, longitude: 0, colorHex: hex)
    }

    func testReturnsMostCommonColor() {
        let children = [
            coloured("1", "#f43f5e"),
            coloured("2", "#22d3ee"),
            coloured("3", "#22d3ee")
        ]
        XCTAssertEqual(
            MarkerClusterLogic.dominantColorHex(children: children, defaultColorHex: "#000000"),
            "#22d3ee"
        )
    }

    func testTieBreaksByFirstSeen() {
        let children = [coloured("1", "#aaaaaa"), coloured("2", "#bbbbbb")]
        XCTAssertEqual(
            MarkerClusterLogic.dominantColorHex(children: children, defaultColorHex: "#000000"),
            "#aaaaaa"
        )
    }

    func testUsesDefaultForUncolouredChildren() {
        let children = [coloured("1", nil), coloured("2", nil)]
        XCTAssertEqual(
            MarkerClusterLogic.dominantColorHex(children: children, defaultColorHex: "#22d3ee"),
            "#22d3ee"
        )
    }

    func testEmptyClusterFallsBackToDefault() {
        XCTAssertEqual(
            MarkerClusterLogic.dominantColorHex(children: [], defaultColorHex: "#123456"),
            "#123456"
        )
    }
}

// MARK: - Zoom helper (web `disableClusteringAtZoom`)

final class MarkerClusterZoomTests: XCTestCase {
    func testZoomLevelInvertsTilePyramid() {
        XCTAssertEqual(MarkerClusterLogic.zoomLevel(forLongitudeDelta: 360), 0, accuracy: 0.0001)
        XCTAssertEqual(MarkerClusterLogic.zoomLevel(forLongitudeDelta: 180), 1, accuracy: 0.0001)
        XCTAssertEqual(MarkerClusterLogic.zoomLevel(forLongitudeDelta: 360.0 / 256.0), 8, accuracy: 0.0001)
    }

    func testZoomLevelClampsNonPositiveSpan() {
        XCTAssertEqual(MarkerClusterLogic.zoomLevel(forLongitudeDelta: 0), 28, accuracy: 0.0001)
        XCTAssertEqual(MarkerClusterLogic.zoomLevel(forLongitudeDelta: -1), 28, accuracy: 0.0001)
    }

    func testShouldClusterBelowDisableZoom() {
        XCTAssertTrue(MarkerClusterLogic.shouldCluster(zoom: 5, disableAtZoom: 18))
        XCTAssertTrue(MarkerClusterLogic.shouldCluster(zoom: 17.9, disableAtZoom: 18))
        XCTAssertFalse(MarkerClusterLogic.shouldCluster(zoom: 18, disableAtZoom: 18))
        XCTAssertFalse(MarkerClusterLogic.shouldCluster(zoom: 19, disableAtZoom: 18))
    }
}

// MARK: - Popup text projection (web `popupHtml`)

final class MarkerClusterPlainTextTests: XCTestCase {
    func testStripsMarkupAndDecodesEntities() {
        XCTAssertEqual(MarkerClusterLogic.plainText("<b>Ferry Building</b>"), "Ferry Building")
        XCTAssertEqual(MarkerClusterLogic.plainText("<a href=\"x\">Stop</a> &amp; go"), "Stop & go")
        XCTAssertEqual(MarkerClusterLogic.plainText("&copy; map"), "© map")
        XCTAssertEqual(MarkerClusterLogic.plainText("Line<br/>two"), "Line two")
    }

    func testEmptyAndNilCollapseToNil() {
        XCTAssertNil(MarkerClusterLogic.plainText(nil))
        XCTAssertNil(MarkerClusterLogic.plainText(""))
        XCTAssertNil(MarkerClusterLogic.plainText("   "))
        XCTAssertNil(MarkerClusterLogic.plainText("<span></span>"))
    }
}

// MARK: - Point decode (web `ClusterPoint`, snake_case)

final class MarkerClusterPointDecodeTests: XCTestCase {
    func testDecodesSnakeCaseFields() throws {
        let json = Data(#"""
        {"id":"abc","lat":37.7,"lng":-122.4,"popup_html":"<b>Hi</b>","color":"#22d3ee","aria_label":"Stop A"}
        """#.utf8)
        let point = try JSONDecoder().decode(MarkerClusterPoint.self, from: json)
        XCTAssertEqual(point.id, "abc")
        XCTAssertEqual(point.latitude, 37.7, accuracy: 0.0001)
        XCTAssertEqual(point.longitude, -122.4, accuracy: 0.0001)
        XCTAssertEqual(point.popupHTML, "<b>Hi</b>")
        XCTAssertEqual(point.colorHex, "#22d3ee")
        XCTAssertEqual(point.accessibilityLabel, "Stop A")
        XCTAssertTrue(point.hasValidCoordinate)
    }

    func testDecodesNumericIdAndOmittedOptionals() throws {
        let json = Data(#"{"id":42,"lat":1.0,"lng":2.0}"#.utf8)
        let point = try JSONDecoder().decode(MarkerClusterPoint.self, from: json)
        XCTAssertEqual(point.id, "42")
        XCTAssertNil(point.popupHTML)
        XCTAssertNil(point.colorHex)
        XCTAssertNil(point.accessibilityLabel)
    }
}

// MARK: - Projection (load status + resolve)

final class MarkerClusterProjectionTests: XCTestCase {
    private func point(_ id: String) -> MarkerClusterPoint {
        MarkerClusterPoint(id: id, latitude: 1, longitude: 1)
    }

    func testLoadStatusPrecedence() {
        XCTAssertEqual(MarkerClusterProjection.loadStatus(phase: .failed, renderedCount: 5), .error)
        XCTAssertEqual(MarkerClusterProjection.loadStatus(phase: .loading, renderedCount: 0), .loading)
        // Loading but cached markers are present → render them (web keeps the handed-in points).
        XCTAssertEqual(MarkerClusterProjection.loadStatus(phase: .loading, renderedCount: 3), .ready)
        XCTAssertEqual(MarkerClusterProjection.loadStatus(phase: .loaded, renderedCount: 0), .empty)
        XCTAssertEqual(MarkerClusterProjection.loadStatus(phase: .loaded, renderedCount: 3), .ready)
    }

    func testResolveSanitisesAndCountsTruncation() {
        var points = (0 ..< 5002).map { point("\($0)") }
        points[1] = MarkerClusterPoint(id: "nan", latitude: .nan, longitude: 1)
        let resolved = MarkerClusterProjection.resolve(
            points: points,
            content: MarkerClusterContent(),
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(resolved.totalCount, 5002)
        // Cap (5000) then drop the one NaN inside the cap → 4999 rendered.
        XCTAssertEqual(resolved.renderedCount, MarkerClusterMeta.maxRenderedMarkers - 1)
        XCTAssertTrue(resolved.isTruncated)
        XCTAssertEqual(resolved.omittedCount, 5002 - (MarkerClusterMeta.maxRenderedMarkers - 1))
        XCTAssertEqual(resolved.status, .ready)
        XCTAssertTrue(resolved.canRender)
        XCTAssertTrue(resolved.isLive)
    }

    func testResolveCarriesContentAndConnection() {
        let resolved = MarkerClusterProjection.resolve(
            points: [point("a"), point("b")],
            content: MarkerClusterContent(
                maxClusterRadius: 80,
                disableClusteringAtZoom: 16,
                defaultColorHex: "#abcdef",
                colorMode: .dominantChild
            ),
            phase: .loaded,
            connection: .stale
        )
        XCTAssertEqual(resolved.renderedCount, 2)
        XCTAssertFalse(resolved.isTruncated)
        XCTAssertEqual(resolved.maxClusterRadius, 80)
        XCTAssertEqual(resolved.disableClusteringAtZoom, 16)
        XCTAssertEqual(resolved.defaultColorHex, "#abcdef")
        XCTAssertEqual(resolved.colorMode, .dominantChild)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertFalse(resolved.isLive)
    }

    func testResolveEmptyFeedIsEmptyStatus() {
        let resolved = MarkerClusterProjection.resolve(
            points: [],
            content: MarkerClusterContent(),
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(resolved.status, .empty)
        XCTAssertFalse(resolved.canRender)
        XCTAssertEqual(resolved.renderedCount, 0)
    }
}
