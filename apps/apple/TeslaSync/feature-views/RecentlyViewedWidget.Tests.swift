//
//  RecentlyViewedWidget.Tests.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  Unit coverage for the RecentlyViewedWidget surface:
//    • Adapter — the web ports: RecentPageKind.parse (+ unknown → page), classifyPath
//      (pattern table + ref capture + empty-segment guard), formatRelative bucketing +
//      formatting, the display-limit cap + row projection, and the VoiceOver summary.
//    • State holder — `RecentlyViewedProjection` phase resolution across loading / error /
//      data / empty (+ the independently-projected freshness + limit), plus the
//      `RecentlyViewedModel` wiring, the P1/S11 `view.opened`, and the stale auto-refresh.
//    • Accessibility — the combined VoiceOver row summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no store: the model is
//  driven by `InMemoryRecentlyViewedSource`.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: kind resolution

@MainActor
final class RecentlyViewedKindTests: XCTestCase {
    func testParseKnownAndUnknown() {
        XCTAssertEqual(RecentPageKind.parse("vehicle"), .vehicle)
        XCTAssertEqual(RecentPageKind.parse("drive"), .drive)
        XCTAssertEqual(RecentPageKind.parse("trip"), .trip)
        XCTAssertEqual(RecentPageKind.parse("charging"), .charging)
        XCTAssertEqual(RecentPageKind.parse("geofence"), .geofence)
        XCTAssertEqual(RecentPageKind.parse("year-review"), .yearReview)
        XCTAssertEqual(RecentPageKind.parse("page"), .page)
        // Case-insensitive + unknown → page (web forward-compat default).
        XCTAssertEqual(RecentPageKind.parse("VEHICLE"), .vehicle)
        XCTAssertEqual(RecentPageKind.parse("yearReview"), .yearReview)
        XCTAssertEqual(RecentPageKind.parse("nonsense"), .page)
        XCTAssertEqual(RecentPageKind.parse(""), .page)
    }

    func testStorageTokenAndLabels() {
        XCTAssertEqual(RecentPageKind.yearReview.storageToken, "year-review")
        XCTAssertEqual(RecentPageKind.vehicle.storageToken, "vehicle")
        XCTAssertEqual(RecentPageKind.charging.labelKey, "recentPages.kind.charging")
        XCTAssertEqual(RecentPageKind.charging.labelFallback, "Charging session")
        XCTAssertEqual(RecentPageKind.yearReview.labelKey, "recentPages.kind.yearReview")
        // Every case round-trips through parse(storageToken).
        for kind in RecentPageKind.allCases {
            XCTAssertEqual(RecentPageKind.parse(kind.storageToken), kind)
        }
    }
}

// MARK: - Adapter: path classification (web classifyPath)

@MainActor
final class RecentlyViewedClassifyTests: XCTestCase {
    func testEveryPatternCapturesRef() {
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/vehicles/42"),
            RecentPathClassification(kind: .vehicle, refID: "42")
        )
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/drives/7"),
            RecentPathClassification(kind: .drive, refID: "7")
        )
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/charging/9"),
            RecentPathClassification(kind: .charging, refID: "9")
        )
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/trips/3"),
            RecentPathClassification(kind: .trip, refID: "3")
        )
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/geofences/home"),
            RecentPathClassification(kind: .geofence, refID: "home")
        )
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/year-review/2025"),
            RecentPathClassification(kind: .yearReview, refID: "2025")
        )
    }

    func testFirstSegmentOnlyAndGuards() {
        // Only the first non-slash segment is captured (web `([^/]+)`).
        XCTAssertEqual(RecentlyViewedAdapter.classify(path: "/vehicles/42/telemetry").refID, "42")
        // Empty trailing segment → no match → plain page.
        XCTAssertEqual(RecentlyViewedAdapter.classify(path: "/vehicles/").kind, .page)
        XCTAssertNil(RecentlyViewedAdapter.classify(path: "/vehicles/").refID)
        // Unmatched routes are plain pages with no ref.
        XCTAssertEqual(
            RecentlyViewedAdapter.classify(path: "/analytics"),
            RecentPathClassification(kind: .page, refID: nil)
        )
        XCTAssertEqual(RecentlyViewedAdapter.classify(path: "/").kind, .page)
    }
}

// MARK: - Adapter: relative-time bucketing + formatting (web formatRelative)

@MainActor
final class RecentlyViewedRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func bucket(secondsAgo: TimeInterval) -> RecentRelativeTime {
        RecentRelativeTime.bucket(visitedAt: now.addingTimeInterval(-secondsAgo), now: now)
    }

    func testBucketThresholds() {
        XCTAssertEqual(bucket(secondsAgo: 0), .justNow)
        XCTAssertEqual(bucket(secondsAgo: 59), .justNow)
        XCTAssertEqual(bucket(secondsAgo: 60), .minutes(1))
        XCTAssertEqual(bucket(secondsAgo: 59 * 60), .minutes(59))
        XCTAssertEqual(bucket(secondsAgo: 60 * 60), .hours(1))
        XCTAssertEqual(bucket(secondsAgo: 23 * 3600), .hours(23))
        XCTAssertEqual(bucket(secondsAgo: 24 * 3600), .days(1))
        XCTAssertEqual(bucket(secondsAgo: 72 * 3600), .days(3))
    }

    func testFutureVisitClampsToJustNow() {
        // Web `Math.max(0, now - visitedAt)` — a future timestamp never goes negative.
        let future = now.addingTimeInterval(120)
        XCTAssertEqual(RecentRelativeTime.bucket(visitedAt: future, now: now), .justNow)
    }

    func testFormattingUsesLocalizedSuffix() {
        let localize: RecentlyViewedAdapter.Localize = { _, fallback in fallback }
        XCTAssertEqual(RecentlyViewedAdapter.relativeText(.justNow, localize: localize), "Just now")
        XCTAssertEqual(RecentlyViewedAdapter.relativeText(.minutes(5), localize: localize), "5m")
        XCTAssertEqual(RecentlyViewedAdapter.relativeText(.hours(2), localize: localize), "2h")
        XCTAssertEqual(RecentlyViewedAdapter.relativeText(.days(3), localize: localize), "3d")
    }
}

// MARK: - Adapter: row projection + accessibility summary

@MainActor
final class RecentlyViewedAdapterTests: XCTestCase {
    private func entry(
        _ path: String,
        _ title: String,
        _ kind: RecentPageKind,
        ago: TimeInterval
    ) -> RecentlyViewedEntry {
        RecentlyViewedEntry(path: path, title: title, kind: kind, visitedAt: Date().addingTimeInterval(-ago))
    }

    func testRowsCapAtLimitPreservingOrder() {
        let entries = (0 ..< 8).map { entry("/p/\($0)", "Page \($0)", .page, ago: Double($0) * 60) }
        let rows = RecentlyViewedAdapter.rows(from: entries, limit: 5)
        // Web `RECENT_PAGES_DISPLAY_LIMIT = 5` — never more than five rows, most-recent-first.
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(rows.map(\.path), ["/p/0", "/p/1", "/p/2", "/p/3", "/p/4"])
        XCTAssertEqual(rows.first?.id, "/p/0")
    }

    func testRowsDefaultLimitAndZeroLimit() {
        let entries = (0 ..< 8).map { entry("/p/\($0)", "Page \($0)", .page, ago: 0) }
        XCTAssertEqual(RecentlyViewedAdapter.rows(from: entries).count, RecentlyViewedAdapter.defaultLimit)
        XCTAssertTrue(RecentlyViewedAdapter.rows(from: entries, limit: 0).isEmpty)
    }

    func testRowProjectionCarriesEveryField() {
        let visited = Date(timeIntervalSince1970: 1_799_990_000)
        let row = RecentlyViewedAdapter.rows(from: [
            RecentlyViewedEntry(path: "/vehicles/1", title: "Model 3", kind: .vehicle, refID: "1", visitedAt: visited)
        ]).first
        XCTAssertEqual(row?.id, "/vehicles/1")
        XCTAssertEqual(row?.path, "/vehicles/1")
        XCTAssertEqual(row?.title, "Model 3")
        XCTAssertEqual(row?.kind, .vehicle)
        XCTAssertEqual(row?.refID, "1")
        XCTAssertEqual(row?.visitedAt, visited)
    }

    func testAccessibilitySummaryCombinesTitleKindRecency() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let row = RecentlyViewedRow(
            path: "/drives/9",
            title: "Morning commute",
            kind: .drive,
            refID: "9",
            visitedAt: now.addingTimeInterval(-5 * 60)
        )
        let localize: RecentlyViewedAdapter.Localize = { _, fallback in fallback }
        let summary = RecentlyViewedAdapter.accessibilitySummary(for: row, now: now, localize: localize)
        XCTAssertTrue(summary.contains("Morning commute"))
        XCTAssertTrue(summary.contains("Drive"))
        XCTAssertTrue(summary.contains("5m"))
    }
}

// MARK: - Projection: phase resolution across every branch

@MainActor
final class RecentlyViewedProjectionTests: XCTestCase {
    private var sample: [RecentlyViewedEntry] {
        [RecentlyViewedEntry(path: "/vehicles/1", title: "Model 3", kind: .vehicle, visitedAt: Date())]
    }

    func testLoadingTakesPrecedence() {
        let resolved = RecentlyViewedProjection.resolve(
            RecentlyViewedInput(entries: sample, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
        // Rows still project so cached recents can stay visible under the skeleton if desired.
        XCTAssertEqual(resolved.rows.count, 1)
    }

    func testErrorWhenNotLoading() {
        let resolved = RecentlyViewedProjection.resolve(
            RecentlyViewedInput(entries: sample, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testEmptyErrorMessageIsNotError() {
        let resolved = RecentlyViewedProjection.resolve(
            RecentlyViewedInput(entries: sample, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testDataWhenRowsPresent() {
        let resolved = RecentlyViewedProjection.resolve(RecentlyViewedInput(entries: sample))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 1)
    }

    func testEmptyWhenNoRows() {
        XCTAssertEqual(RecentlyViewedProjection.resolve(RecentlyViewedInput(entries: [])).phase, .empty)
    }

    func testFreshnessAndLimitProjectedIndependentlyOfPhase() {
        let entries = (0 ..< 6).map {
            RecentlyViewedEntry(path: "/p/\($0)", title: "P\($0)", kind: .page, visitedAt: Date())
        }
        let resolved = RecentlyViewedProjection.resolve(
            RecentlyViewedInput(entries: entries, freshness: .offline, limit: 3)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 3)
        XCTAssertEqual(resolved.freshness, .offline)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class RecentlyViewedModelTests: XCTestCase {
    private func makeModel(
        _ input: RecentlyViewedInput,
        telemetry: RecentlyViewedTelemetry = OSLogRecentlyViewedTelemetry()
    ) -> (RecentlyViewedModel, InMemoryRecentlyViewedSource) {
        let source = InMemoryRecentlyViewedSource(initial: input)
        let model = RecentlyViewedModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyRecentlyViewedTelemetry()
        let entry = RecentlyViewedEntry(path: "/vehicles/1", title: "Model 3", kind: .vehicle, visitedAt: Date())
        let (model, source) = makeModel(RecentlyViewedInput(entries: [entry]), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(spy.surfaces, [RecentlyViewedDiagnostics.surface])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RecentlyViewedInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(RecentlyViewedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(RecentlyViewedInput(entries: [
            RecentlyViewedEntry(path: "/drives/7", title: "Drive", kind: .drive, visitedAt: Date())
        ]))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.first?.id, "/drives/7")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilFresh() {
        let (model, source) = makeModel(RecentlyViewedInput(freshness: .fresh))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(RecentlyViewedInput(freshness: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.freshness, .stale)
        // A second stale snapshot does not re-trigger (guarded).
        source.push(RecentlyViewedInput(freshness: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Returning to fresh resets the guard; a later stale episode refreshes once more.
        source.push(RecentlyViewedInput(freshness: .fresh))
        source.push(RecentlyViewedInput(freshness: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineSurfacesWithoutAutoRefresh() {
        let entries = [RecentlyViewedEntry(path: "/p/1", title: "P", kind: .page, visitedAt: Date())]
        let (model, source) = makeModel(RecentlyViewedInput(entries: entries, freshness: .offline))
        model.start()
        // Offline keeps the cached rows visible and does NOT auto-refresh.
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRecentlyViewedTelemetry: RecentlyViewedTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
