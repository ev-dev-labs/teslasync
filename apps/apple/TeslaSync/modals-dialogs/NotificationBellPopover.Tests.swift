//
//  NotificationBellPopover.Tests.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  Adapter + accessibility coverage for the NotificationBellPopover surface:
//    • `NotificationBellSeverity` — the raw-token mapping (warn / critical pass through, everything
//      else collapses to info, web `severityOf`) + the label keys / fallbacks.
//    • `NotificationBellProjection.entries` — the log × rule × vehicle join: severity from the rule,
//      the vehicle-name fallback (`#id`), the title / message empty → nil arms, the `alert_id == nil`
//      no-rule arm, and the preview cap.
//    • `NotificationBellProjection` — badge text (`99+` clamp + hidden-when-zero), body phase, the
//      inline-failure envelope, and the mark-all-read predicate.
//    • `NotificationBellRelative` — the `formatRelative` bucketing against a fixed clock + the
//      default date facade's localized rendering.
//    • `NotificationBellEntry.displayTitle` — title → rule-name → "Notification" fallback.
//    • `NotificationBellAccessibility` — the trigger + row VoiceOver content.
//
//  The state-holder coverage lives in NotificationBellPopover.ModelTests.swift. Pure, bundle-free:
//  copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum BellSample {
    static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    static func log(
        id: Int, alertID: Int?, title: String = "Title", message: String = "Message", offset: Double = -90
    ) -> NotificationBellLog {
        NotificationBellLog(
            id: id, alertID: alertID, title: title, message: message,
            createdAt: anchor.addingTimeInterval(offset)
        )
    }

    static func rule(
        id: Int, name: String = "Rule", severity: NotificationBellSeverity, vehicleID: Int?
    ) -> NotificationBellRule {
        NotificationBellRule(id: id, name: name, severity: severity, vehicleID: vehicleID)
    }
}

final class NotificationBellAdapterTests: XCTestCase {
    // MARK: Severity

    func testSeverityMapsRawTokens() {
        XCTAssertEqual(NotificationBellSeverity(raw: "warn"), .warn)
        XCTAssertEqual(NotificationBellSeverity(raw: "critical"), .critical)
        XCTAssertEqual(NotificationBellSeverity(raw: "info"), .info)
        // Unknown / nil collapse to info (web severityOf default arm).
        XCTAssertEqual(NotificationBellSeverity(raw: "mystery"), .info)
        XCTAssertEqual(NotificationBellSeverity(raw: nil), .info)
    }

    func testSeverityLabelKeysAndFallbacks() {
        XCTAssertEqual(NotificationBellSeverity.warn.labelKey, "notifications.bellPopover.severity.warn")
        XCTAssertEqual(NotificationBellSeverity.info.labelFallback, "Info")
        XCTAssertEqual(NotificationBellSeverity.warn.labelFallback, "Warning")
        XCTAssertEqual(NotificationBellSeverity.critical.labelFallback, "Critical")
    }

    // MARK: Join

    func testEntriesJoinSeverityVehicleAndOrder() {
        let logs = [
            BellSample.log(id: 1, alertID: 10),
            BellSample.log(id: 2, alertID: 20, offset: -30)
        ]
        let rules = [
            BellSample.rule(id: 10, name: "Low battery", severity: .critical, vehicleID: 100),
            BellSample.rule(id: 20, name: "Tire", severity: .warn, vehicleID: nil)
        ]
        let vehicles = [NotificationBellVehicle(id: 100, displayName: "Model 3")]
        let entries = NotificationBellProjection.entries(logs: logs, rules: rules, vehicles: vehicles)
        XCTAssertEqual(entries.map(\.id), [1, 2])
        XCTAssertEqual(entries[0].severity, .critical)
        XCTAssertEqual(entries[0].vehicleName, "Model 3")
        XCTAssertEqual(entries[1].severity, .warn)
        XCTAssertNil(entries[1].vehicleName) // rule has no vehicle
    }

    func testEntriesNoRuleFallsBackToInfo() {
        let entries = NotificationBellProjection.entries(
            logs: [BellSample.log(id: 5, alertID: nil)], rules: [], vehicles: []
        )
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0].severity, .info)
        XCTAssertNil(entries[0].vehicleName)
    }

    func testEntriesEmptyTitleAndMessageBecomeNil() {
        let entries = NotificationBellProjection.entries(
            logs: [BellSample.log(id: 7, alertID: 70, title: "", message: "")],
            rules: [BellSample.rule(id: 70, name: "R", severity: .info, vehicleID: nil)],
            vehicles: []
        )
        XCTAssertNil(entries[0].title)
        XCTAssertNil(entries[0].message)
        XCTAssertEqual(entries[0].ruleName, "R")
    }

    func testVehicleNameFallsBackToHashId() {
        XCTAssertEqual(
            NotificationBellProjection.vehicleName(for: NotificationBellVehicle(id: 42, displayName: "")),
            "#42"
        )
        XCTAssertEqual(
            NotificationBellProjection.vehicleName(for: NotificationBellVehicle(id: 42, displayName: "Roadster")),
            "Roadster"
        )
    }

    func testEntriesCapAtLimit() {
        let logs = (0 ..< 15).map { BellSample.log(id: $0, alertID: nil) }
        let entries = NotificationBellProjection.entries(logs: logs, rules: [], vehicles: [], limit: 10)
        XCTAssertEqual(entries.count, 10)
        XCTAssertEqual(NotificationBellProjection.previewLimit, 10)
    }

    // MARK: Display title fallback

    func testDisplayTitleFallbackChain() {
        let withTitle = NotificationBellEntry(
            id: 1, severity: .info, title: "Explicit", ruleName: "Rule",
            message: nil, createdAt: BellSample.anchor, vehicleName: nil
        )
        XCTAssertEqual(withTitle.displayTitle(localize: passthroughLocalize), "Explicit")
        let ruleOnly = NotificationBellEntry(
            id: 2, severity: .info, title: nil, ruleName: "Rule name",
            message: nil, createdAt: BellSample.anchor, vehicleName: nil
        )
        XCTAssertEqual(ruleOnly.displayTitle(localize: passthroughLocalize), "Rule name")
        let neither = NotificationBellEntry(
            id: 3, severity: .info, title: nil, ruleName: nil,
            message: nil, createdAt: BellSample.anchor, vehicleName: nil
        )
        XCTAssertEqual(neither.displayTitle(localize: passthroughLocalize), "Notification")
    }

    // MARK: Badge / phase / predicates

    func testBadgeTextClampAndHidden() {
        XCTAssertNil(NotificationBellProjection.badgeText(count: 0))
        XCTAssertNil(NotificationBellProjection.badgeText(count: -2))
        XCTAssertEqual(NotificationBellProjection.badgeText(count: 5), "5")
        XCTAssertEqual(NotificationBellProjection.badgeText(count: 99), "99")
        XCTAssertEqual(NotificationBellProjection.badgeText(count: 100), "99+")
    }

    func testPhase() {
        XCTAssertEqual(NotificationBellProjection.phase(status: .loading, hasEntries: false), .loading)
        XCTAssertEqual(NotificationBellProjection.phase(status: .loading, hasEntries: true), .populated)
        XCTAssertEqual(NotificationBellProjection.phase(status: .loaded, hasEntries: false), .empty)
        XCTAssertEqual(NotificationBellProjection.phase(status: .loaded, hasEntries: true), .populated)
        XCTAssertEqual(NotificationBellProjection.phase(status: .failed("x"), hasEntries: false), .error("x"))
        XCTAssertEqual(NotificationBellProjection.phase(status: .failed("x"), hasEntries: true), .populated)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(NotificationBellProjection.inlineFailure(status: .failed("boom"), hasEntries: true), "boom")
        XCTAssertNil(NotificationBellProjection.inlineFailure(status: .failed("boom"), hasEntries: false))
        XCTAssertNil(NotificationBellProjection.inlineFailure(status: .loaded, hasEntries: true))
    }

    func testMarkAllEnabledPredicate() {
        XCTAssertTrue(NotificationBellProjection.markAllEnabled(hasEntries: true, pending: false))
        XCTAssertFalse(NotificationBellProjection.markAllEnabled(hasEntries: false, pending: false))
        XCTAssertFalse(NotificationBellProjection.markAllEnabled(hasEntries: true, pending: true))
    }

    // MARK: Relative

    func testRelativeBuckets() {
        let now = BellSample.anchor
        XCTAssertEqual(NotificationBellRelative.from(nil, now: now), .empty)
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-90), now: now), .minutes(1))
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-3600), now: now), .hours(1))
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-90000), now: now), .days(1))
        XCTAssertEqual(
            NotificationBellRelative.from(now.addingTimeInterval(-700_000), now: now),
            .absolute(now.addingTimeInterval(-700_000))
        )
    }

    func testRelativeBoundaryAtSixtySeconds() {
        let now = BellSample.anchor
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-59), now: now), .justNow)
        XCTAssertEqual(NotificationBellRelative.from(now.addingTimeInterval(-60), now: now), .minutes(1))
    }

    func testDefaultDateFacadeRendersBuckets() {
        let facade = DefaultNotificationBellDateFormatting()
        XCTAssertEqual(facade.relative(.empty), "—")
        XCTAssertEqual(facade.relative(.justNow), "just now")
        XCTAssertEqual(facade.relative(.minutes(5)), "5m ago")
        XCTAssertEqual(facade.relative(.hours(3)), "3h ago")
        XCTAssertEqual(facade.relative(.days(4)), "4d ago")
        XCTAssertFalse(facade.relative(.absolute(BellSample.anchor)).isEmpty)
    }

    // MARK: Accessibility

    func testTriggerLabelUnreadAndZero() {
        XCTAssertEqual(
            NotificationBellAccessibility.triggerLabel(count: 0, localize: passthroughLocalize),
            "Notifications"
        )
        XCTAssertEqual(
            NotificationBellAccessibility.triggerLabel(count: 4, localize: passthroughLocalize),
            "4 unread notifications"
        )
    }

    func testRowLabelComposition() {
        let withVehicle = NotificationBellAccessibility.rowLabel(
            severity: "Critical", title: "Battery low", relative: "1m ago", vehicle: "Model 3"
        )
        XCTAssertEqual(withVehicle, "Critical, Battery low, 1m ago, Model 3")
        let noVehicle = NotificationBellAccessibility.rowLabel(
            severity: "Info", title: "Charging complete", relative: "2h ago", vehicle: nil
        )
        XCTAssertEqual(noVehicle, "Info, Charging complete, 2h ago")
    }
}
