import XCTest
@testable import TeslaSync

/// Timeline-construction tests: entries flip fresh → stale → offline honestly as the
/// cache ages, are sorted, and the reload date is always in the future (sooner while
/// charging).
@MainActor final class WidgetTimelinePlannerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    private func snapshot(generatedAt: Date, charging: Bool = false) -> TeslaSyncWidgetSnapshot {
        let session = ChargingSummary(
            isActive: true,
            batteryFraction: 0.5,
            batteryDisplay: "50%",
            powerDisplay: nil,
            addedDisplay: nil,
            finishBy: nil,
            sampledAt: generatedAt
        )
        return TeslaSyncWidgetSnapshot(generatedAt: generatedAt, charging: charging ? session : nil)
    }

    func testEntriesIncludeFreshStaleOffline() {
        let entries = WidgetTimelinePlanner.entries(for: snapshot(generatedAt: now), now: now)
        XCTAssertEqual(entries.count, 3)
        XCTAssertEqual(entries.first?.freshness, .fresh)
        XCTAssertEqual(entries[1].freshness, .stale)
        XCTAssertEqual(entries.last?.freshness, .offline)
    }

    func testEntriesSortedAscending() {
        let entries = WidgetTimelinePlanner.entries(for: snapshot(generatedAt: now), now: now)
        XCTAssertEqual(entries.map(\.date), entries.map(\.date).sorted())
    }

    func testOldSnapshotProducesSingleOfflineEntry() {
        let entries = WidgetTimelinePlanner.entries(for: snapshot(generatedAt: now.addingTimeInterval(-9999)), now: now)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.freshness, .offline)
    }

    func testReloadDateInFuture() {
        let reload = WidgetTimelinePlanner.reloadDate(for: snapshot(generatedAt: now), now: now)
        XCTAssertGreaterThan(reload, now)
    }

    func testChargingReloadsNoLaterThanIdle() {
        let active = WidgetTimelinePlanner.reloadDate(for: snapshot(generatedAt: now, charging: true), now: now)
        let idle = WidgetTimelinePlanner.reloadDate(for: snapshot(generatedAt: now, charging: false), now: now)
        XCTAssertLessThanOrEqual(active, idle)
    }

    func testEntryPerDatumFreshness() {
        let entry = TeslaSyncWidgetEntry(date: now, snapshot: snapshot(generatedAt: now), freshness: .fresh)
        XCTAssertEqual(entry.freshness(forSampledAt: now.addingTimeInterval(-4000)), .offline)
        XCTAssertEqual(entry.freshness(forSampledAt: now.addingTimeInterval(-30)), .fresh)
    }
}
