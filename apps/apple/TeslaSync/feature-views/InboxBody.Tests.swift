//
//  InboxBody.Tests.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  Pure-projection coverage for the inbox surface (no store, no rendered view):
//  the severity / read / view enums, the filter state, the `groupByDay` buckets,
//  the unread + selection helpers, the drill-through targets (port of
//  `lib/alertDrillthrough`), the per-row context menu + bulk-action lists, the
//  i18n key parity, and the VoiceOver summaries. Driven entirely by value types.
//

import XCTest
@testable import TeslaSync

final class InboxBodyProjectionTests: XCTestCase {
    // MARK: Enums + filters

    func testSeverityParseFallsBackToInfo() {
        XCTAssertEqual(InboxSeverity.parse(nil), .info)
        XCTAssertEqual(InboxSeverity.parse("WARN"), .warn)
        XCTAssertEqual(InboxSeverity.parse("critical"), .critical)
        XCTAssertEqual(InboxSeverity.parse("bogus"), .info)
    }

    func testReadFilterFlag() {
        XCTAssertNil(InboxReadFilter.all.readFlag)
        XCTAssertEqual(InboxReadFilter.read.readFlag, true)
        XCTAssertEqual(InboxReadFilter.unread.readFlag, false)
    }

    func testNotificationReadAndArchivedFlags() {
        let unread = InboxNotification(id: 1, title: "a", createdAt: "t")
        XCTAssertFalse(unread.isRead)
        XCTAssertFalse(unread.isArchived)
        let read = InboxNotification(id: 2, title: "b", createdAt: "t", readAt: "t2", archivedAt: "t3")
        XCTAssertTrue(read.isRead)
        XCTAssertTrue(read.isArchived)
        let blank = InboxNotification(id: 3, title: "c", createdAt: "t", readAt: "")
        XCTAssertFalse(blank.isRead)
    }

    func testFiltersIsGroupedAndActiveCount() {
        XCTAssertTrue(InboxFilters().isGrouped)
        XCTAssertFalse(InboxFilters(archived: true).isGrouped)
        XCTAssertFalse(InboxFilters(view: .flat).isGrouped)
        var filters = InboxFilters(severity: [.warn], vehicleIds: [1], search: "x", read: .unread)
        XCTAssertEqual(filters.activeFilterCount, 4)
        XCTAssertTrue(filters.hasActiveFilters)
        filters = InboxFilters()
        XCTAssertEqual(filters.activeFilterCount, 0)
    }

    // MARK: Day grouping

    private func row(_ id: Int, _ iso: String, read: Bool = false) -> InboxNotification {
        InboxNotification(id: id, title: "n\(id)", createdAt: iso, readAt: read ? "t" : nil)
    }

    func testGroupByDayBucketsTodayYesterdayDated() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "UTC"))
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-06-07T12:00:00Z"))
        let rows = [
            row(1, "2026-06-07T08:00:00Z"),
            row(2, "2026-06-07T01:00:00Z"),
            row(3, "2026-06-06T20:00:00Z"),
            row(4, "2026-05-28T10:00:00Z")
        ]
        let groups = InboxProjection.groupByDay(
            rows,
            relativeTo: now,
            calendar: calendar,
            locale: Locale(identifier: "en_US")
        )
        XCTAssertEqual(groups.count, 3)
        XCTAssertEqual(groups[0].bucket, .today)
        XCTAssertEqual(groups[0].rows.map(\.id), [1, 2])
        XCTAssertEqual(groups[1].bucket, .yesterday)
        if case let .dated(label) = groups[2].bucket {
            XCTAssertFalse(label.isEmpty)
        } else {
            XCTFail("expected a dated bucket")
        }
    }

    func testGroupByDaySkipsUnparseableAndEmpty() {
        XCTAssertTrue(InboxProjection.groupByDay([]).isEmpty)
        let groups = InboxProjection.groupByDay([row(1, "not-a-date")])
        XCTAssertTrue(groups.isEmpty)
    }

    func testUnreadAndSelectionHelpers() {
        let rows = [row(1, "t"), row(2, "t", read: true), row(3, "t")]
        XCTAssertEqual(InboxProjection.unreadCount(rows), 2)
        XCTAssertEqual(InboxProjection.unreadIds(rows), [1, 3])
        XCTAssertEqual(InboxProjection.visibleIds(rows), [1, 2, 3])
        XCTAssertFalse(InboxProjection.allVisibleSelected([], selected: []))
        XCTAssertFalse(InboxProjection.allVisibleSelected([1, 2, 3], selected: [1, 2]))
        XCTAssertTrue(InboxProjection.allVisibleSelected([1, 2, 3], selected: [1, 2, 3]))
    }

    // MARK: Drill-through

    func testDrillTargetMappedSignal() {
        let target = InboxDrillthrough.target(signal: "BatteryLevel", vehicleId: 1, createdAt: "2026-06-07T08:00:00Z")
        XCTAssertEqual(target.path, "/battery")
        XCTAssertEqual(target.query.map(\.0), ["vehicle_id", "t", "signal"])
        XCTAssertTrue(target.href.hasPrefix("/battery?"))
        XCTAssertTrue(target.href.contains("signal=BatteryLevel"))
    }

    func testDrillTargetUnmappedFallbackAndZeroVehicle() {
        // Web keeps the (unmapped) signal in the query even on the fallback path;
        // the zero vehicle id and the empty timestamp are omitted.
        let target = InboxDrillthrough.target(signal: "Bogus", vehicleId: 0, createdAt: "")
        XCTAssertEqual(target.path, "/signal-explorer")
        XCTAssertEqual(target.query.map(\.0), ["signal"])
        XCTAssertEqual(target.href, "/signal-explorer?signal=Bogus")
        let bare = InboxDrillthrough.target(signal: nil, vehicleId: 0, createdAt: "")
        XCTAssertTrue(bare.query.isEmpty)
        XCTAssertEqual(bare.href, "/signal-explorer")
    }

    func testRowTargetNilWithoutRule() {
        let note = InboxNotification(id: 1, title: "a", createdAt: "t")
        XCTAssertNil(InboxDrillthrough.rowTarget(notification: note, rule: nil, vehicle: nil))
        let rule = InboxRule(id: 10, vehicleId: 2, signalName: "SentryMode")
        let target = InboxDrillthrough.rowTarget(notification: note, rule: rule, vehicle: nil)
        XCTAssertEqual(target?.path, "/security-access")
    }

    // MARK: Row menu + bulk actions

    func testRowMenuUnreadNotArchivedWithRule() {
        let note = InboxNotification(id: 1, title: "a", createdAt: "t")
        let rule = InboxRule(id: 10, signalName: "BatteryLevel")
        let target = InboxDrillthrough.rowTarget(notification: note, rule: rule, vehicle: nil)
        let items = InboxProjection.rowMenuItems(notification: note, rule: rule, target: target)
        XCTAssertEqual(items.map(\.id), ["mark-read", "archive", "view-context", "delete"])
        XCTAssertTrue(items.last?.destructive ?? false)
    }

    func testRowMenuReadArchivedNoRule() {
        let note = InboxNotification(id: 1, title: "a", createdAt: "t", readAt: "t2", archivedAt: "t3")
        let items = InboxProjection.rowMenuItems(notification: note, rule: nil, target: nil)
        XCTAssertEqual(items.map(\.id), ["mark-unread", "restore", "delete"])
    }

    func testBulkActionsInboxAndArchived() {
        let inbox = InboxProjection.bulkActions(archived: false)
        XCTAssertEqual(inbox.map(\.labelKey), [
            "notifications.inbox.bulk.markRead", "notifications.inbox.bulk.archive", "bulk.actions.delete"
        ])
        XCTAssertNotNil(inbox.last?.confirm)
        let archived = InboxProjection.bulkActions(archived: true)
        XCTAssertEqual(archived.map(\.kind), [.restore, .delete])
    }

    // MARK: i18n key parity + accessibility

    func testSeverityLabelKeysMatchWeb() {
        XCTAssertEqual(InboxSeverity.info.labelKey, "notifications.severity.info")
        XCTAssertEqual(InboxSeverity.warn.labelKey, "notifications.severity.warn")
        XCTAssertEqual(InboxSeverity.critical.labelKey, "notifications.severity.critical")
    }

    func testStringsInterpolatesCount() {
        let resolved = InboxStrings.count("notifications.inbox.countLabel", "{{count}} notifications", count: 7)
        XCTAssertEqual(resolved, "7 notifications")
    }

    func testRowAndGroupAccessibilitySummaries() {
        let note = InboxNotification(id: 1, title: "Battery at 18%", message: "Below threshold", createdAt: "t")
        let rule = InboxRule(id: 10, name: "Low battery", severity: "warn")
        let summary = InboxAccessibility.rowSummary(
            notification: note, rule: rule, vehicle: InboxVehicle(id: 1, displayName: "Model Y"),
            relativeTime: "5m ago", { _, fallback in fallback }
        )
        XCTAssertTrue(summary.contains("Unread"))
        XCTAssertTrue(summary.contains("warn"))
        XCTAssertTrue(summary.contains("Model Y"))
        XCTAssertTrue(summary.contains("Low battery"))
        XCTAssertTrue(summary.contains("Battery at 18%"))
        let group = InboxGroup(groupKey: "g", latest: note, count: 4, unreadCount: 2)
        let groupSummary = InboxAccessibility
            .groupSummary(group: group, headSummary: "head") { _, fallback in fallback }
        XCTAssertEqual(groupSummary, "head, +3 similar")
    }
}
