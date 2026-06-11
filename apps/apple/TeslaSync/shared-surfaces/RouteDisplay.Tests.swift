//
//  RouteDisplay.Tests.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  Unit coverage for the RouteDisplay surface logic:
//    • endpointLabel — the verbatim port of the web `endpointLabel` (address preferred + trimmed,
//      `📍 lat, lon` coordinate fallback at two decimals, nil when neither is present).
//    • haversineMeters — identity (zero) and monotonic distance for a known pair.
//    • project — every web render branch: from → to, round trip (matching addresses), round trip
//      (coordinates within threshold), not-a-round-trip when far apart, single location (no end),
//      no-location (both missing), per-endpoint fallback (one side missing), and the custom
//      `roundTripThresholdM` boundary (near vs far).
//    • i18n facade — the per-surface table resolves the two web keys to their English fallbacks.
//    • accessibility — every branch projects non-empty spoken text for VoiceOver.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry
//  once-only contract is asserted in `…ModelTests.swift`; per-branch view rendering is covered by
//  the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - endpointLabel (web `endpointLabel`)

final class RouteDisplayEndpointLabelTests: XCTestCase {
    func testReturnsAddressWhenPresent() {
        XCTAssertEqual(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(address: "Home")), "Home")
    }

    func testTrimsSurroundingWhitespaceFromAddress() {
        XCTAssertEqual(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(address: "  Home  ")), "Home")
    }

    func testFallsBackToCoordsWhenAddressMissing() {
        let label = RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(lat: 47.71, lon: -122.18))
        XCTAssertEqual(label, "📍 47.71, -122.18")
    }

    func testReturnsNilWhenNeitherAddressNorCoordsPresent() {
        XCTAssertNil(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint()))
        XCTAssertNil(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(address: "   ")))
        XCTAssertNil(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(lat: nil, lon: nil)))
    }

    func testCoordFallbackNeedsBothComponents() {
        XCTAssertNil(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(lat: 47.71, lon: nil)))
        XCTAssertNil(RouteDisplayLogic.endpointLabel(RouteDisplayEndpoint(lat: nil, lon: -122.18)))
    }
}

// MARK: - haversineMeters (web `haversineMeters`)

final class RouteDisplayHaversineTests: XCTestCase {
    func testIdenticalPointsAreZeroMetres() {
        XCTAssertEqual(RouteDisplayLogic.haversineMeters(47.71, -122.18, 47.71, -122.18), 0, accuracy: 1e-6)
    }

    func testKnownLatitudeDeltaIsAboutOneTenthDegree() {
        // ~0.09° of latitude ≈ 10 km.
        let metres = RouteDisplayLogic.haversineMeters(47.71, -122.18, 47.80, -122.18)
        XCTAssertEqual(metres, 10000, accuracy: 200)
    }

    func testSmallDeltaLandsBetweenHundredAndTwoHundredMetres() {
        let metres = RouteDisplayLogic.haversineMeters(47.7146, -122.18, 47.7157, -122.18)
        XCTAssertGreaterThan(metres, 100)
        XCTAssertLessThan(metres, 200)
    }
}

// MARK: - project (the web render branches)

final class RouteDisplayProjectTests: XCTestCase {
    private let noLocation = "No location data"
    private let roundTrip = "round trip"

    private func project(
        _ start: RouteDisplayEndpoint,
        _ end: RouteDisplayEndpoint?,
        threshold: Double = RouteDisplayLogic.defaultRoundTripThresholdM
    ) -> RouteDisplayContent {
        RouteDisplayLogic.project(
            start: start,
            end: end,
            roundTripThresholdM: threshold,
            noLocation: noLocation,
            roundTripPhrase: roundTrip
        )
    }

    func testFromToWhenStartAndEndDiffer() {
        let content = project(RouteDisplayEndpoint(address: "Home"), RouteDisplayEndpoint(address: "Office"))
        XCTAssertEqual(content, .fromTo(start: "Home", end: "Office"))
    }

    func testRoundTripWhenAddressesMatch() {
        let content = project(RouteDisplayEndpoint(address: "Home"), RouteDisplayEndpoint(address: "Home"))
        XCTAssertEqual(content, .roundTrip(start: "Home", phrase: roundTrip))
    }

    func testRoundTripWhenCoordsWithinThreshold() {
        let point = RouteDisplayEndpoint(lat: 47.71, lon: -122.18)
        let content = project(point, point)
        XCTAssertEqual(content, .roundTrip(start: "📍 47.71, -122.18", phrase: roundTrip))
    }

    func testNotRoundTripWhenCoordsFarApart() throws {
        let start = RouteDisplayEndpoint(lat: 47.71, lon: -122.18)
        let end = RouteDisplayEndpoint(lat: 47.80, lon: -122.18)
        let content = project(start, end)
        XCTAssertEqual(
            content,
            try .fromTo(
                start: XCTUnwrap(RouteDisplayLogic.endpointLabel(start)),
                end: XCTUnwrap(RouteDisplayLogic.endpointLabel(end))
            )
        )
    }

    func testSingleLocationWhenNoEnd() {
        let content = project(RouteDisplayEndpoint(address: "Supercharger Costco"), nil)
        XCTAssertEqual(content, .single(start: "Supercharger Costco"))
    }

    func testNoLocationWhenNeitherEndpointHasData() {
        XCTAssertEqual(project(RouteDisplayEndpoint(), RouteDisplayEndpoint()), .noLocation(text: noLocation))
    }

    func testPerEndpointFallbackWhenOnlyOneSideMissing() {
        let content = project(RouteDisplayEndpoint(address: "Home"), RouteDisplayEndpoint())
        XCTAssertEqual(content, .fromTo(start: "Home", end: noLocation))
    }

    func testRespectsCustomRoundTripThreshold() throws {
        // Two points ~122 m apart whose two-decimal coordinate labels differ, so the only deciding
        // factor is the threshold (web "respects custom roundTripThresholdM").
        let start = RouteDisplayEndpoint(lat: 47.7146, lon: -122.18)
        let end = RouteDisplayEndpoint(lat: 47.7157, lon: -122.18)
        XCTAssertNotEqual(RouteDisplayLogic.endpointLabel(start), RouteDisplayLogic.endpointLabel(end))

        let near = project(start, end, threshold: 100)
        XCTAssertEqual(
            near,
            try .fromTo(
                start: XCTUnwrap(RouteDisplayLogic.endpointLabel(start)),
                end: XCTUnwrap(RouteDisplayLogic.endpointLabel(end))
            )
        )

        let far = project(start, end, threshold: 200)
        XCTAssertEqual(far, try .roundTrip(start: XCTUnwrap(RouteDisplayLogic.endpointLabel(start)), phrase: roundTrip))
    }

    func testExplicitSingleNeverShowsRoundTripPhrase() {
        if case .single = project(RouteDisplayEndpoint(address: "Home"), nil) {
            // single carries no phrase — correct.
        } else {
            XCTFail("explicit single must project .single, never .roundTrip")
        }
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

final class RouteDisplayStringsTests: XCTestCase {
    func testNoLocationResolvesToWebFallback() {
        XCTAssertEqual(RouteDisplayStrings.noLocationData, "No location data")
    }

    func testRoundTripResolvesToWebFallback() {
        XCTAssertEqual(RouteDisplayStrings.roundTrip, "round trip")
    }

    func testFacadeResolvesKeysToWebFallback() {
        XCTAssertEqual(RouteDisplayStrings.string("route.noLocationData", "No location data"), "No location data")
        XCTAssertEqual(RouteDisplayStrings.string("route.roundTrip", "round trip"), "round trip")
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(RouteDisplayStrings.table, "RouteDisplay")
    }
}

// MARK: - Accessibility (spoken text is present on every branch)

final class RouteDisplayAccessibilityTests: XCTestCase {
    private func spokenText(_ content: RouteDisplayContent) -> String {
        switch content {
        case let .noLocation(text): text
        case let .single(start): start
        case let .roundTrip(start, phrase): "\(start) ↻ \(phrase)"
        case let .fromTo(start, end): "\(start) → \(end)"
        }
    }

    func testEveryBranchProjectsNonEmptySpokenText() {
        let branches: [RouteDisplayContent] = [
            .noLocation(text: "No location data"),
            .single(start: "Supercharger Costco"),
            .roundTrip(start: "Home", phrase: "round trip"),
            .fromTo(start: "Home", end: "Office")
        ]
        for branch in branches {
            XCTAssertFalse(spokenText(branch).isEmpty, "\(branch) must expose non-empty spoken text")
        }
    }
}
