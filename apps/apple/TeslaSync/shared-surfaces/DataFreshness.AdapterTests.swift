//
//  DataFreshness.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  Pure-core coverage for the DataFreshness adapter — the verbatim ports of the web helpers, asserted
//  in isolation (Foundation only, no store, no view):
//    • DataFreshnessStatusResolver — the `status` ternary truth table + precedence.
//    • DataFreshnessStaleResolver — the `DataFreshnessAuto.forceStaleAfterMs` window.
//    • DataFreshnessRelativeFormatter — `formatRelativeTime` every branch + boundaries + future
//      clamp, routed through an identity resolver so the web fallback literals are asserted.
//    • DataFreshnessStatus — the `STATUS_CONFIG` icon map + spin flag + state-word fallback.
//    • DataFreshnessAccessibility — the `aria-label` + value builder.
//    • DataFreshnessMeta — the static identity + 30s web tick cadence.
//    • DataFreshnessTime — the default short-time formatter (smoke).
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let passthroughStrings: DataFreshnessResolve = { _, fallback in fallback }

private enum AdapterFixture {
    static let now = Date(timeIntervalSince1970: 1_700_000_000)

    static func ago(_ seconds: TimeInterval) -> Date {
        now.addingTimeInterval(-seconds)
    }
}

// MARK: - Status resolver (web `status` ternary)

final class DataFreshnessStatusResolverTests: XCTestCase {
    func testFreshWhenAllFlagsClear() {
        XCTAssertEqual(
            DataFreshnessStatusResolver.status(isError: false, isFetching: false, isStale: false),
            .fresh
        )
    }

    func testStaleWhenOnlyStale() {
        XCTAssertEqual(
            DataFreshnessStatusResolver.status(isError: false, isFetching: false, isStale: true),
            .stale
        )
    }

    func testFetchingBeatsStale() {
        XCTAssertEqual(
            DataFreshnessStatusResolver.status(isError: false, isFetching: true, isStale: true),
            .fetching
        )
    }

    func testErrorBeatsEverything() {
        XCTAssertEqual(
            DataFreshnessStatusResolver.status(isError: true, isFetching: true, isStale: true),
            .error
        )
    }
}

// MARK: - Force-stale window (web `DataFreshnessAuto.forceStaleAfterMs`)

final class DataFreshnessStaleResolverTests: XCTestCase {
    func testDeclaredStaleAlwaysStale() {
        XCTAssertTrue(DataFreshnessStaleResolver.isStale(
            declared: true,
            updatedAt: AdapterFixture.now,
            now: AdapterFixture.now,
            forceStaleAfterMs: nil
        ))
    }

    func testNoWindowIsNotStale() {
        XCTAssertFalse(DataFreshnessStaleResolver.isStale(
            declared: false,
            updatedAt: AdapterFixture.ago(10000),
            now: AdapterFixture.now,
            forceStaleAfterMs: nil
        ))
    }

    func testWindowForcesStaleWhenAged() {
        // 3h old, 1h window → forced stale.
        XCTAssertTrue(DataFreshnessStaleResolver.isStale(
            declared: false,
            updatedAt: AdapterFixture.ago(3 * 3600),
            now: AdapterFixture.now,
            forceStaleAfterMs: 3600 * 1000
        ))
    }

    func testWindowNotExceededIsFresh() {
        XCTAssertFalse(DataFreshnessStaleResolver.isStale(
            declared: false,
            updatedAt: AdapterFixture.ago(60),
            now: AdapterFixture.now,
            forceStaleAfterMs: 3600 * 1000
        ))
    }

    func testWindowWithoutTimestampIsFresh() {
        XCTAssertFalse(DataFreshnessStaleResolver.isStale(
            declared: false,
            updatedAt: nil,
            now: AdapterFixture.now,
            forceStaleAfterMs: 3600 * 1000
        ))
    }
}

// MARK: - Relative-time label (web `formatRelativeTime`)

final class DataFreshnessRelativeFormatterTests: XCTestCase {
    private func label(_ secondsAgo: TimeInterval) -> String {
        DataFreshnessRelativeFormatter.label(
            updatedAt: AdapterFixture.ago(secondsAgo),
            now: AdapterFixture.now,
            strings: passthroughStrings
        )
    }

    func testJustNowBelowOneMinute() {
        XCTAssertEqual(label(0), "just now")
        XCTAssertEqual(label(59), "just now")
    }

    func testMinutesBranch() {
        XCTAssertEqual(label(60), "1m ago")
        XCTAssertEqual(label(3599), "59m ago")
    }

    func testHoursBranch() {
        XCTAssertEqual(label(3600), "1h ago")
        XCTAssertEqual(label(86399), "23h ago")
    }

    func testDaysBranch() {
        XCTAssertEqual(label(86400), "1d ago")
        XCTAssertEqual(label(604_799), "6d ago")
    }

    func testWeeksBranch() {
        XCTAssertEqual(label(604_800), "1w ago")
        XCTAssertEqual(label(3 * 604_800), "3w ago")
    }

    func testFutureTimestampClampsToJustNow() {
        let future = AdapterFixture.now.addingTimeInterval(120)
        XCTAssertEqual(
            DataFreshnessRelativeFormatter.label(
                updatedAt: future,
                now: AdapterFixture.now,
                strings: passthroughStrings
            ),
            "just now"
        )
    }
}

// MARK: - Status icon map + spin + state word (web `STATUS_CONFIG`)

final class DataFreshnessStatusTests: XCTestCase {
    func testIconSystemNames() {
        XCTAssertEqual(DataFreshnessStatus.fresh.iconSystemName, "wifi")
        XCTAssertEqual(DataFreshnessStatus.stale.iconSystemName, "wifi")
        XCTAssertEqual(DataFreshnessStatus.fetching.iconSystemName, "arrow.triangle.2.circlepath")
        XCTAssertEqual(DataFreshnessStatus.error.iconSystemName, "wifi.slash")
    }

    func testOnlyFetchingSpins() {
        XCTAssertTrue(DataFreshnessStatus.fetching.iconSpins)
        XCTAssertFalse(DataFreshnessStatus.fresh.iconSpins)
        XCTAssertFalse(DataFreshnessStatus.stale.iconSpins)
        XCTAssertFalse(DataFreshnessStatus.error.iconSpins)
    }

    func testStateWordFallbackIsRawValue() {
        XCTAssertEqual(DataFreshnessStatus.fresh.stateWordKey, "freshness.state.fresh")
        XCTAssertEqual(DataFreshnessStatus.fetching.stateWordFallback, "fetching")
    }
}

// MARK: - Accessibility (web `aria-label` + value)

final class DataFreshnessAccessibilityTests: XCTestCase {
    func testRefreshableLabelReadsRefresh() {
        XCTAssertEqual(
            DataFreshnessAccessibility.label(refreshable: true, status: .stale, strings: passthroughStrings),
            "Refresh"
        )
    }

    func testReadOnlyLabelInterpolatesState() {
        XCTAssertEqual(
            DataFreshnessAccessibility.label(refreshable: false, status: .fresh, strings: passthroughStrings),
            "Data freshness: fresh"
        )
        XCTAssertEqual(
            DataFreshnessAccessibility.label(refreshable: false, status: .error, strings: passthroughStrings),
            "Data freshness: error"
        )
    }

    func testValuePrefersRelativeLabel() {
        XCTAssertEqual(
            DataFreshnessAccessibility.value(status: .fresh, relativeLabel: "5m ago", strings: passthroughStrings),
            "5m ago"
        )
    }

    func testValueFallsBackToStateWordWhenEmpty() {
        XCTAssertEqual(
            DataFreshnessAccessibility.value(status: .fresh, relativeLabel: "", strings: passthroughStrings),
            "fresh"
        )
    }
}

// MARK: - Metadata + default time formatter

final class DataFreshnessMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(DataFreshnessMeta.surfaceSlug, "DataFreshness")
        XCTAssertEqual(DataFreshness.surfaceSlug, "DataFreshness")
    }

    func testTickCadenceMatchesWebInterval() {
        XCTAssertEqual(DataFreshnessMeta.tickIntervalSeconds, 30)
    }

    func testShortTimeFormatterProducesNonEmptyString() {
        XCTAssertFalse(DataFreshnessTime.shortTime(AdapterFixture.now).isEmpty)
    }
}
