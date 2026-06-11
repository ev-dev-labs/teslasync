//
//  FreshnessIndicator.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  Pure-core coverage for the FreshnessIndicator adapter — the verbatim ports of the web helpers,
//  asserted in isolation (Foundation only, no store, no view):
//    • FreshnessAge — `computeAge` (nil / empty / malformed → nil; future clamp to 0; fractional +
//      plain ISO parse; whole-second floor).
//    • FreshnessStatusResolver — `getStatus` truth table + boundaries + custom thresholds.
//    • FreshnessAgeFormatter — `formatAge` every branch + boundaries, routed through an identity
//      resolver so the web fallback literals are asserted.
//    • FreshnessStaleEvaluator — the `useIsStale` verdict (isStale / isOffline / ageLabel).
//    • FreshnessSize — the `DOT_SIZE` point map.
//    • FreshnessAccessibility — the freshness-aware VoiceOver label.
//    • FreshnessIndicatorMeta / FreshnessThresholds — the static identity + web prop defaults.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let passthroughStrings: FreshnessResolve = { _, fallback in fallback }

private enum FreshnessFixture {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func iso(secondsAgo seconds: TimeInterval, fractional: Bool = false) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter.string(from: now.addingTimeInterval(-seconds))
    }
}

// MARK: - Age arithmetic (web `computeAge`)

final class FreshnessAgeTests: XCTestCase {
    func testNilTimestampIsNil() {
        XCTAssertNil(FreshnessAge.seconds(of: nil, now: FreshnessFixture.now))
    }

    func testEmptyTimestampIsNil() {
        XCTAssertNil(FreshnessAge.seconds(of: "", now: FreshnessFixture.now))
    }

    func testMalformedTimestampIsNil() {
        XCTAssertNil(FreshnessAge.seconds(of: "not-a-date", now: FreshnessFixture.now))
    }

    func testWholeSecondAge() {
        let stamp = FreshnessFixture.iso(secondsAgo: 30)
        XCTAssertEqual(FreshnessAge.seconds(of: stamp, now: FreshnessFixture.now), 30)
    }

    func testFractionalSecondsParseAndFloor() {
        let stamp = FreshnessFixture.iso(secondsAgo: 30.7, fractional: true)
        XCTAssertEqual(FreshnessAge.seconds(of: stamp, now: FreshnessFixture.now), 30)
    }

    func testFutureTimestampClampsToZero() {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let future = formatter.string(from: FreshnessFixture.now.addingTimeInterval(50))
        XCTAssertEqual(FreshnessAge.seconds(of: future, now: FreshnessFixture.now), 0)
    }

    func testParseReturnsDateForValidAndNilForGarbage() {
        XCTAssertNotNil(FreshnessAge.parse(FreshnessFixture.iso(secondsAgo: 0)))
        XCTAssertNil(FreshnessAge.parse("garbage"))
        XCTAssertNil(FreshnessAge.parse(nil))
    }
}

// MARK: - Status resolver (web `getStatus`)

final class FreshnessStatusResolverTests: XCTestCase {
    private let thresholds = FreshnessThresholds.default

    func testNilAgeIsUnknown() {
        XCTAssertEqual(FreshnessStatusResolver.status(age: nil, thresholds: thresholds), .unknown)
    }

    func testFreshBelowStaleThreshold() {
        XCTAssertEqual(FreshnessStatusResolver.status(age: 0, thresholds: thresholds), .fresh)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 119, thresholds: thresholds), .fresh)
    }

    func testStaleAtAndAboveStaleThresholdBelowOffline() {
        XCTAssertEqual(FreshnessStatusResolver.status(age: 120, thresholds: thresholds), .stale)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 599, thresholds: thresholds), .stale)
    }

    func testOfflineAtAndAboveOfflineThreshold() {
        XCTAssertEqual(FreshnessStatusResolver.status(age: 600, thresholds: thresholds), .offline)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 100_000, thresholds: thresholds), .offline)
    }

    func testCustomThresholds() {
        let custom = FreshnessThresholds(staleSeconds: 10, offlineSeconds: 20)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 9, thresholds: custom), .fresh)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 10, thresholds: custom), .stale)
        XCTAssertEqual(FreshnessStatusResolver.status(age: 20, thresholds: custom), .offline)
    }
}

// MARK: - Relative-time label (web `formatAge`)

final class FreshnessAgeFormatterTests: XCTestCase {
    private func label(_ age: Int?) -> String {
        FreshnessAgeFormatter.label(age: age, strings: passthroughStrings)
    }

    func testNilIsDash() {
        XCTAssertEqual(label(nil), "—")
    }

    func testJustNowBelowTen() {
        XCTAssertEqual(label(0), "just now")
        XCTAssertEqual(label(9), "just now")
    }

    func testSecondsBranch() {
        XCTAssertEqual(label(10), "10s ago")
        XCTAssertEqual(label(59), "59s ago")
    }

    func testMinutesBranch() {
        XCTAssertEqual(label(60), "1m ago")
        XCTAssertEqual(label(3599), "59m ago")
    }

    func testHoursBranch() {
        XCTAssertEqual(label(3600), "1h ago")
        XCTAssertEqual(label(7200), "2h ago")
    }
}

// MARK: - useIsStale evaluator (web hook)

final class FreshnessStaleEvaluatorTests: XCTestCase {
    private let thresholds = FreshnessThresholds.default

    private func evaluate(_ age: Int?) -> FreshnessStaleReadout {
        FreshnessStaleEvaluator.evaluate(age: age, thresholds: thresholds, strings: passthroughStrings)
    }

    func testNilAgeIsNeitherStaleNorOffline() {
        let readout = evaluate(nil)
        XCTAssertFalse(readout.isStale)
        XCTAssertFalse(readout.isOffline)
        XCTAssertEqual(readout.ageLabel, "—")
    }

    func testFreshIsNotStale() {
        let readout = evaluate(60)
        XCTAssertFalse(readout.isStale)
        XCTAssertFalse(readout.isOffline)
        XCTAssertEqual(readout.ageLabel, "1m ago")
    }

    func testStaleNotYetOffline() {
        let readout = evaluate(120)
        XCTAssertTrue(readout.isStale)
        XCTAssertFalse(readout.isOffline)
    }

    func testOfflineIsAlsoStale() {
        let readout = evaluate(600)
        XCTAssertTrue(readout.isStale)
        XCTAssertTrue(readout.isOffline)
    }
}

// MARK: - Size map (web `DOT_SIZE`)

final class FreshnessSizeTests: XCTestCase {
    func testDotDiameterPoints() {
        XCTAssertEqual(FreshnessSize.small.dotDiameterPoints, 6)
        XCTAssertEqual(FreshnessSize.medium.dotDiameterPoints, 8)
    }
}

// MARK: - Accessibility (freshness-aware VoiceOver label)

final class FreshnessAccessibilityTests: XCTestCase {
    func testKnownStatusAppendsAge() {
        XCTAssertEqual(
            FreshnessAccessibility.label(status: .fresh, ageLabel: "12s ago", statusWord: "Fresh"),
            "Fresh, 12s ago"
        )
        XCTAssertEqual(
            FreshnessAccessibility.label(status: .offline, ageLabel: "2h ago", statusWord: "Offline"),
            "Offline, 2h ago"
        )
    }

    func testUnknownStatusReadsWordAlone() {
        XCTAssertEqual(
            FreshnessAccessibility.label(status: .unknown, ageLabel: "—", statusWord: "No data"),
            "No data"
        )
    }
}

// MARK: - Metadata + thresholds (static identity + web defaults)

final class FreshnessIndicatorMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(FreshnessIndicatorMeta.surfaceSlug, "FreshnessIndicator")
        XCTAssertEqual(FreshnessIndicator.surfaceSlug, "FreshnessIndicator")
    }

    func testTickCadenceMatchesWebInterval() {
        XCTAssertEqual(FreshnessIndicatorMeta.tickIntervalSeconds, 10)
    }

    func testThresholdDefaultsMatchWebProps() {
        XCTAssertEqual(FreshnessThresholds.default.staleSeconds, 120)
        XCTAssertEqual(FreshnessThresholds.default.offlineSeconds, 600)
    }
}
