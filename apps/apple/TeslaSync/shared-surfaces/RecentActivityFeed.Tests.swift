//
//  RecentActivityFeed.Tests.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  Registry + accessibility + projection coverage for the RecentActivityFeed surface:
//    • Visual registry — the web `getActivityVisual` prefix-walk lookup (exact match, the most-specific
//      prefix down to the generic fallback, the trim + empty guard) and the web key/fallback parity.
//    • Accessibility — the composed VoiceOver row label.
//    • Projection — the render branches plus the P4 leaf contract across error / loading / content /
//      empty, including that the connectivity axis never hides the feed.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Visual registry (web `getActivityVisual`)

final class RecentActivityFeedVisualRegistryTests: XCTestCase {
    func testExactActionMatches() {
        let visual = RecentActivityFeedAdapter.visual(for: "vehicle.command.wake")
        XCTAssertEqual(visual.i18nKey, "activity.action.vehicleCommandWake")
        XCTAssertEqual(visual.fallback, "Wake vehicle")
        XCTAssertEqual(visual.tone, .warning)
        XCTAssertFalse(visual.symbol.isEmpty)
    }

    func testFallsBackToMostSpecificPrefix() {
        // `vehicle.command.unknownverb` is absent → walk to `vehicle.command`.
        let visual = RecentActivityFeedAdapter.visual(for: "vehicle.command.unknownverb")
        XCTAssertEqual(visual.i18nKey, "activity.action.vehicleCommand")
        XCTAssertEqual(visual.fallback, "Vehicle command")
    }

    func testWalksMultipleLevels() {
        // `alert.rule.snooze` is absent, `alert.rule` is absent → walk to `alert`.
        let visual = RecentActivityFeedAdapter.visual(for: "alert.rule.snooze")
        XCTAssertEqual(visual.i18nKey, "activity.action.alert")
    }

    func testUnknownTopLevelReturnsFallback() {
        // `vehicle` has no top-level entry, so an unmatched `vehicle.*` falls through to the fallback.
        let visual = RecentActivityFeedAdapter.visual(for: "vehicle.honkx")
        XCTAssertEqual(visual, RecentActivityFeedAdapter.fallbackVisual)
        XCTAssertEqual(visual.i18nKey, "activity.action.unknown")
        XCTAssertEqual(visual.fallback, "Activity")
    }

    func testNoDotUnknownReturnsFallback() {
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "frobnicate"), RecentActivityFeedAdapter.fallbackVisual)
    }

    func testEmptyAndWhitespaceReturnFallback() {
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: ""), RecentActivityFeedAdapter.fallbackVisual)
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "   "), RecentActivityFeedAdapter.fallbackVisual)
    }

    func testTrimsBeforeLookup() {
        let visual = RecentActivityFeedAdapter.visual(for: "  auth.login  ")
        XCTAssertEqual(visual.i18nKey, "activity.action.authLogin")
        XCTAssertEqual(visual.fallback, "Signed in")
    }

    func testEveryRegistryEntryHasSymbolAndKey() {
        for (action, visual) in RecentActivityFeedAdapter.registry {
            XCTAssertFalse(visual.symbol.isEmpty, "missing symbol for \(action)")
            XCTAssertTrue(visual.i18nKey.hasPrefix("activity.action."), "bad key for \(action)")
            XCTAssertFalse(visual.fallback.isEmpty, "missing fallback for \(action)")
        }
    }

    func testKnownCategoriesResolveDistinctTones() {
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "alert.rule.create").tone, .danger)
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "automation.create").tone, .accent)
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "auth.logout").tone, .muted)
        XCTAssertEqual(RecentActivityFeedAdapter.visual(for: "dashboard").tone, .power)
    }
}

// MARK: - Accessibility

final class RecentActivityFeedAccessibilityTests: XCTestCase {
    func testRowLabelReadsTitleSubtitleThenTime() {
        let label = RecentActivityFeedAccessibility.rowLabel(
            title: "Wake vehicle",
            subtitle: "vehicle · 12 — Model 3 woke",
            time: "5m ago"
        )
        XCTAssertEqual(label, "Wake vehicle, vehicle · 12 — Model 3 woke, 5m ago")
    }

    func testRowLabelSkipsEmptySubtitle() {
        let label = RecentActivityFeedAccessibility.rowLabel(title: "Signed in", subtitle: "", time: "2d ago")
        XCTAssertEqual(label, "Signed in, 2d ago")
    }

    func testRowLabelEmptyWhenAllEmpty() {
        XCTAssertEqual(RecentActivityFeedAccessibility.rowLabel(title: "", subtitle: "", time: ""), "")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class RecentActivityFeedProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func entry(id: Int64 = 1) -> RecentActivityFeedEntry {
        RecentActivityFeedEntry(
            id: id,
            timestamp: now.addingTimeInterval(-30),
            action: "auth.login"
        )
    }

    func testErrorTakesPrecedenceOverEverything() {
        let resolved = RecentActivityFeedProjection.resolve(
            input: RecentActivityFeedInput(entries: [entry()], isLoading: true, errorMessage: "boom"),
            now: now
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = RecentActivityFeedProjection.resolve(
            input: RecentActivityFeedInput(entries: [entry()], errorMessage: ""),
            now: now
        )
        XCTAssertEqual(resolved.phase, .content)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let resolved = RecentActivityFeedProjection.resolve(
            input: RecentActivityFeedInput(entries: [entry()], isLoading: true),
            now: now
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testEmptyWhenNoEntries() {
        let resolved = RecentActivityFeedProjection.resolve(input: RecentActivityFeedInput(), now: now)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testContentWhenEntriesPresent() {
        let resolved = RecentActivityFeedProjection.resolve(
            input: RecentActivityFeedInput(entries: [entry(id: 1), entry(id: 2)]),
            now: now
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertEqual(resolved.rows.map(\.id), [1, 2])
    }

    func testConnectivityNeverHidesTheFeed() {
        for connection in [RecentActivityFeedConnection.stale, .offline] {
            let resolved = RecentActivityFeedProjection.resolve(
                input: RecentActivityFeedInput(entries: [entry()], connection: connection),
                now: now
            )
            XCTAssertEqual(resolved.phase, .content, "\(connection) must keep the feed")
            XCTAssertFalse(resolved.rows.isEmpty)
        }
    }
}
