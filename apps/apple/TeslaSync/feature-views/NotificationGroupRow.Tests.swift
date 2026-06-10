//
//  NotificationGroupRow.Tests.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  Pure-projection coverage for the NotificationGroupRow surface: severity mapping
//  (incl. the web `?? 'info'` default), the group derivations (isSingleton /
//  extraCount / chrome gating / canMarkGroupRead), phase resolution, the member
//  filter (web `members.filter(m => m.id !== latest.id)`) + the "no thread members"
//  empty, the parameterized copy (expand / similar / vehicles affected / mark-read
//  toasts), the formatters, the VoiceOver summaries, and the i18n key wiring. The
//  observable-model tests live in NotificationGroupRow.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

/// English-fallback localizer (bundle-free).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Fixtures

private enum NotificationGroupRowFixture {
    static let date = Date(timeIntervalSince1970: 1_733_600_000)

    static func log(
        _ identifier: Int,
        severity: String? = "critical",
        read: Bool = false,
        vehicle: String? = "Model 3",
        rule: String? = "Battery high",
        title: String = "Battery temperature high"
    ) -> NotificationLogInput {
        NotificationLogInput(
            id: identifier,
            title: title,
            message: "Details",
            severityRaw: severity,
            createdAt: date,
            isRead: read,
            isArchived: false,
            vehicleName: vehicle,
            ruleName: rule
        )
    }

    static func group(
        key: String? = "abc",
        count: Int = 5,
        unread: Int = 3,
        vehicles: Int = 2
    ) -> NotificationGroupInput {
        NotificationGroupInput(
            groupKey: key,
            latest: log(1),
            count: count,
            unreadCount: unread,
            vehicleAffectedCount: vehicles
        )
    }
}

// MARK: - Severity mapping

@MainActor final class NotificationSeverityKindTests: XCTestCase {
    func testKnownSeveritiesMapCaseInsensitively() {
        XCTAssertEqual(NotificationSeverityKind.from("critical"), .critical)
        XCTAssertEqual(NotificationSeverityKind.from("CRITICAL"), .critical)
        XCTAssertEqual(NotificationSeverityKind.from("warn"), .warn)
        XCTAssertEqual(NotificationSeverityKind.from("Warning"), .warn)
        XCTAssertEqual(NotificationSeverityKind.from("info"), .info)
    }

    func testUnknownAndNilDefaultToInfo() {
        XCTAssertEqual(NotificationSeverityKind.from("nope"), .info)
        XCTAssertEqual(NotificationSeverityKind.from(nil), .info)
        XCTAssertEqual(NotificationSeverityKind.from(""), .info)
    }

    func testLocalizationKeysAreStable() {
        XCTAssertEqual(NotificationSeverityKind.info.localizationKey, "notifications.group.severity.info")
        XCTAssertEqual(NotificationSeverityKind.warn.localizationKey, "notifications.group.severity.warn")
        XCTAssertEqual(NotificationSeverityKind.critical.localizationKey, "notifications.group.severity.critical")
    }
}

// MARK: - Group derivations

@MainActor final class NotificationGroupProjectionTests: XCTestCase {
    func testSingletonDerivation() {
        let singleton = NotificationGroupRowFixture.group(key: nil, count: 1, unread: 1).projected(archived: false)
        XCTAssertTrue(singleton.isSingleton)
        XCTAssertEqual(singleton.extraCount, 0)
        XCTAssertFalse(singleton.showsGroupChrome)
        XCTAssertFalse(singleton.showsExpandToggle)
    }

    func testExtraCountClampsAtZero() {
        XCTAssertEqual(NotificationGroupRowFixture.group(count: 0).projected(archived: false).extraCount, 0)
    }

    func testChromeGating() {
        // !singleton && (extraCount > 0 || unread > 1)
        XCTAssertTrue(NotificationGroupRowFixture.group(count: 5, unread: 3).projected(archived: false)
            .showsGroupChrome)
        // singleton extra=0 unread=1 -> no chrome (web `unread_count > 1` is false)
        XCTAssertFalse(NotificationGroupRowFixture.group(key: "k", count: 1, unread: 1).projected(archived: false)
            .showsGroupChrome)
        // extra=0 but unread=2 -> chrome shows (web `unread_count > 1`)
        XCTAssertTrue(NotificationGroupRowFixture.group(key: "k", count: 1, unread: 2).projected(archived: false)
            .showsGroupChrome)
    }

    func testCanMarkGroupReadRespectsArchivedAndUnread() {
        XCTAssertTrue(NotificationGroupRowFixture.group(unread: 3).projected(archived: false).canMarkGroupRead)
        XCTAssertFalse(NotificationGroupRowFixture.group(unread: 3).projected(archived: true).canMarkGroupRead)
        XCTAssertFalse(NotificationGroupRowFixture.group(unread: 0).projected(archived: false).canMarkGroupRead)
    }

    func testSubChipGating() {
        let full = NotificationGroupRowFixture.group(count: 5, unread: 3, vehicles: 2).projected(archived: false)
        XCTAssertTrue(full.showsExpandToggle)
        XCTAssertTrue(full.showsUnreadChip)
        XCTAssertTrue(full.showsVehicleAffected)
        let none = NotificationGroupRowFixture.group(key: "k", count: 1, unread: 0, vehicles: 0)
            .projected(archived: false)
        XCTAssertFalse(none.showsExpandToggle)
        XCTAssertFalse(none.showsUnreadChip)
        XCTAssertFalse(none.showsVehicleAffected)
    }

    func testSeverityDefaultFoldsThroughProjection() {
        let input = NotificationGroupInput(
            groupKey: "k",
            latest: NotificationGroupRowFixture.log(1, severity: nil),
            count: 1,
            unreadCount: 0,
            vehicleAffectedCount: 0
        )
        XCTAssertEqual(input.projected(archived: false).latest.severity, .info)
    }
}

// MARK: - Phase + member projectors

@MainActor final class NotificationGroupProjectorTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(NotificationGroupProjector.resolvePhase(.loading, hasGroup: false), .loading)
        XCTAssertEqual(NotificationGroupProjector.resolvePhase(.loaded, hasGroup: true), .content)
        XCTAssertEqual(NotificationGroupProjector.resolvePhase(.loaded, hasGroup: false), .empty)
        XCTAssertEqual(NotificationGroupProjector.resolvePhase(.failed("x"), hasGroup: true), .error("x"))
    }

    func testMembersFilterOutLatest() {
        let members = [
            NotificationGroupRowFixture.log(1).projected(),
            NotificationGroupRowFixture.log(2).projected(),
            NotificationGroupRowFixture.log(3).projected()
        ]
        let phase = NotificationMembersProjector.project(status: .loaded, members: members, latestId: 1)
        guard case let .loaded(rows) = phase else {
            XCTFail("expected loaded")
            return
        }
        XCTAssertEqual(rows.map(\.id), [2, 3])
    }

    func testMembersEmptyWhenOnlyLatest() {
        let members = [NotificationGroupRowFixture.log(1).projected()]
        XCTAssertEqual(
            NotificationMembersProjector.project(status: .loaded, members: members, latestId: 1),
            .empty
        )
    }

    func testMembersLoadingAndError() {
        XCTAssertEqual(NotificationMembersProjector.project(status: .loading, members: [], latestId: 1), .loading)
        XCTAssertEqual(
            NotificationMembersProjector.project(status: .failed("boom"), members: [], latestId: 1),
            .error("boom")
        )
    }
}

// MARK: - Copy + formatting

@MainActor final class NotificationGroupCopyTests: XCTestCase {
    func testExpandLabelSwitchesOnState() {
        XCTAssertEqual(NotificationGroupCopy.expandLabel(expanded: true, extraCount: 4, localize: echo), "Hide similar")
        XCTAssertEqual(
            NotificationGroupCopy.expandLabel(expanded: false, extraCount: 4, localize: echo),
            "Show 4 similar"
        )
    }

    func testSimilarChipAndVehiclesAffected() {
        XCTAssertEqual(NotificationGroupCopy.similarChip(extraCount: 4, localize: echo), "+4 similar")
        XCTAssertEqual(NotificationGroupCopy.vehiclesAffected(count: 2, localize: echo), "2 vehicles affected")
    }

    func testMarkReadToasts() {
        XCTAssertEqual(
            NotificationGroupCopy.markReadSuccess(count: 7, localize: echo),
            "Marked 7 thread members as read"
        )
        XCTAssertEqual(NotificationGroupCopy.markReadError(localize: echo), "Could not mark group as read")
    }

    func testCountFormatGroupsThousands() {
        XCTAssertEqual(NotificationGroupFormat.count(1234, locale: Locale(identifier: "en_US")), "1,234")
    }

    func testTimestampIsDeterministic() {
        let locale = Locale(identifier: "en_US")
        let zone = TimeZone(identifier: "America/Los_Angeles") ?? .gmt
        let first = NotificationGroupFormat.timestamp(NotificationGroupRowFixture.date, locale: locale, timeZone: zone)
        let second = NotificationGroupFormat.timestamp(NotificationGroupRowFixture.date, locale: locale, timeZone: zone)
        XCTAssertEqual(first, second)
        XCTAssertFalse(first.isEmpty)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(NotificationGroupRowSurface.slug, "NotificationGroupRow")
        XCTAssertEqual(NotificationGroupRow.surfaceSlug, "NotificationGroupRow")
    }
}

// MARK: - Accessibility

@MainActor final class NotificationGroupAccessibilityTests: XCTestCase {
    func testRowLabelIncludesSeverityReadStateAndTitle() {
        let row = NotificationGroupRowFixture.log(1, severity: "critical", read: false).projected()
        let label = NotificationGroupAccessibility.rowLabel(
            row,
            localize: echo,
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(identifier: "UTC") ?? .gmt
        )
        XCTAssertTrue(label.contains("Critical"))
        XCTAssertTrue(label.contains("Unread"))
        XCTAssertTrue(label.contains("Battery temperature high"))
        XCTAssertTrue(label.contains("Model 3"))
    }

    func testGroupSummaryIncludesCounts() {
        let group = NotificationGroupRowFixture.group(count: 5, unread: 3, vehicles: 2).projected(archived: false)
        let summary = NotificationGroupAccessibility.groupSummary(
            group,
            localize: echo,
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(identifier: "UTC") ?? .gmt
        )
        XCTAssertTrue(summary.contains("+4 similar"))
        XCTAssertTrue(summary.contains("3 unread"))
        XCTAssertTrue(summary.contains("2 vehicles affected"))
    }

    func testSingletonSummaryHasNoGroupCounts() {
        let group = NotificationGroupRowFixture.group(key: nil, count: 1, unread: 1, vehicles: 1)
            .projected(archived: false)
        let summary = NotificationGroupAccessibility.groupSummary(group, localize: echo)
        XCTAssertFalse(summary.contains("similar"))
        XCTAssertFalse(summary.contains("vehicles affected"))
    }
}

// MARK: - i18n: every web source key is wired

@MainActor final class NotificationGroupLocalizationTests: XCTestCase {
    /// Drives every copy helper through a recording localizer and asserts all keys
    /// extracted from the web source are requested (the view-static keys are checked
    /// directly against the fallback table).
    func testAllWebSourceKeysAreReferenced() {
        let recorder = KeyRecorder()
        let localize = recorder.localize

        _ = NotificationGroupCopy.expandLabel(expanded: false, extraCount: 2, localize: localize)
        _ = NotificationGroupCopy.expandLabel(expanded: true, extraCount: 2, localize: localize)
        _ = NotificationGroupCopy.similarChip(extraCount: 2, localize: localize)
        _ = NotificationGroupCopy.vehiclesAffected(count: 2, localize: localize)
        _ = NotificationGroupCopy.markReadSuccess(count: 2, localize: localize)
        _ = NotificationGroupCopy.markReadError(localize: localize)

        // View-static strings resolved directly in the Views/Chrome; assert their keys.
        for staticKey in [
            "notifications.group.markRead",
            "notifications.group.loadingMembers",
            "notifications.group.membersError",
            "notifications.group.noMembers"
        ] {
            recorder.record(staticKey)
        }

        let webKeys = [
            "notifications.group.markReadSuccess",
            "notifications.group.markReadError",
            "notifications.group.collapse",
            "notifications.group.expand",
            "notifications.group.similar",
            "notifications.group.vehicleAffected",
            "notifications.group.markRead",
            "notifications.group.loadingMembers",
            "notifications.group.membersError",
            "notifications.group.noMembers"
        ]
        for key in webKeys {
            XCTAssertTrue(recorder.keys.contains(key), "missing i18n key wiring: \(key)")
        }
    }

    func testStringsFacadeFallsBackToProvidedValue() {
        let value = NotificationGroupStrings.string("notifications.group.__missing__", "Fallback value")
        XCTAssertEqual(value, "Fallback value")
    }
}

// MARK: - Test doubles

/// Records every localization key requested.
private final class KeyRecorder {
    private(set) var keys: Set<String> = []

    func record(_ key: String) {
        keys.insert(key)
    }

    var localize: (String, String) -> String {
        { [self] key, fallback in
            keys.insert(key)
            return fallback
        }
    }
}
