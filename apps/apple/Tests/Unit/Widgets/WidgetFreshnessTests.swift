import XCTest
@testable import TeslaSync

/// Pure-logic tests for the widget freshness policy (ADR-013): fresh / stale /
/// offline classification and the transition scheduling the timeline relies on.
@MainActor
final class WidgetFreshnessTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)
    private let policy = WidgetFreshnessPolicy.standard

    func testFreshWithinWindow() {
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: now.addingTimeInterval(-60)), .fresh)
    }

    func testStaleBeyondStaleWindow() {
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: now.addingTimeInterval(-600)), .stale)
    }

    func testOfflineBeyondOfflineWindow() {
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: now.addingTimeInterval(-4000)), .offline)
    }

    func testNilLastUpdatedIsOffline() {
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: nil), .offline)
    }

    func testFutureSampleIsFresh() {
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: now.addingTimeInterval(30)), .fresh)
    }

    func testStaleBoundaryIsInclusive() {
        let lastUpdated = now.addingTimeInterval(-policy.staleAfter)
        XCTAssertEqual(policy.evaluate(now: now, lastUpdated: lastUpdated), .stale)
    }

    func testNextTransitionFromFresh() {
        XCTAssertEqual(policy.nextTransition(after: now, from: .fresh), now.addingTimeInterval(policy.staleAfter))
    }

    func testNextTransitionFromStale() {
        XCTAssertEqual(policy.nextTransition(after: now, from: .stale), now.addingTimeInterval(policy.offlineAfter))
    }

    func testNextTransitionFromOfflineIsNil() {
        XCTAssertNil(policy.nextTransition(after: now, from: .offline))
    }

    func testNextTransitionWithNilLastUpdatedIsNil() {
        XCTAssertNil(policy.nextTransition(after: nil, from: .fresh))
    }
}
