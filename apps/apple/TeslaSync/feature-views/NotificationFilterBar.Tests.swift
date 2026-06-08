//
//  NotificationFilterBar.Tests.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  Unit coverage for the NotificationFilterBar adapter core:
//    • Patch math (`NotificationFilters`) — severity toggle (append/remove, order),
//      single-select vehicle/rule, query trim-to-nil, from/to set/clear, clear-all
//      keeping the parent pass-through fields (web `{ ...filters, … }`).
//    • Projection (`NotificationFilterProjection`) — phase resolution across loading /
//      loaded / failed × cached-or-not, and the active-filter chip order + values.
//    • Option label fallback, the ISO date boundary, and the VoiceOver summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and resolves copy through an echo localizer.
//

import XCTest
@testable import TeslaSync

// MARK: - Filter patch math (web setters)

final class NotificationFiltersPatchTests: XCTestCase {
    func testTogglingSeverityAppendsThenRemoves() {
        let base = NotificationFilters()
        let warned = base.togglingSeverity(.warn)
        XCTAssertEqual(warned.severity, [.warn])
        let cleared = warned.togglingSeverity(.warn)
        XCTAssertEqual(cleared.severity, [])
    }

    func testTogglingSeverityPreservesInsertionOrder() {
        let filters = NotificationFilters()
            .togglingSeverity(.info)
            .togglingSeverity(.critical)
            .togglingSeverity(.warn)
        XCTAssertEqual(filters.severity, [.info, .critical, .warn])
        XCTAssertEqual(filters.togglingSeverity(.critical).severity, [.info, .warn])
    }

    func testSettingVehicleAndRuleStoreSingleIDOrClear() {
        let withVehicle = NotificationFilters().settingVehicle(7)
        XCTAssertEqual(withVehicle.vehicleIDs, [7])
        XCTAssertEqual(withVehicle.selectedVehicleID, 7)
        XCTAssertEqual(withVehicle.settingVehicle(nil).vehicleIDs, [])

        let withRule = NotificationFilters().settingRule(3)
        XCTAssertEqual(withRule.ruleIDs, [3])
        XCTAssertEqual(withRule.selectedRuleID, 3)
        XCTAssertEqual(withRule.settingRule(nil).ruleIDs, [])
    }

    func testSettingQueryTrimsToNilButKeepsRawContent() {
        XCTAssertNil(NotificationFilters().settingQuery("   ").query)
        XCTAssertEqual(NotificationFilters().settingQuery("battery").query, "battery")
        XCTAssertEqual(NotificationFilters().settingQuery("  hi ").query, "  hi ")
    }

    func testSettingFromAndToClearOnEmptyString() {
        XCTAssertEqual(NotificationFilters().settingFrom("2026-01-01").from, "2026-01-01")
        XCTAssertNil(NotificationFilters().settingFrom("2026-01-01").settingFrom("").from)
        XCTAssertEqual(NotificationFilters().settingTo("2026-06-01").to, "2026-06-01")
        XCTAssertNil(NotificationFilters().settingTo("2026-06-01").settingTo("").to)
    }

    func testClearingBarFiltersKeepsParentPassThrough() {
        let filters = NotificationFilters(
            severity: [.warn],
            vehicleIDs: [1],
            ruleIDs: [2],
            query: "x",
            from: "2026-01-01",
            to: "2026-06-01",
            read: false,
            archived: true,
            groupKey: "abc",
            limit: 50,
            offset: 100
        )
        let cleared = filters.clearingBarFilters()
        XCTAssertEqual(cleared.severity, [])
        XCTAssertEqual(cleared.vehicleIDs, [])
        XCTAssertEqual(cleared.ruleIDs, [])
        XCTAssertNil(cleared.query)
        XCTAssertNil(cleared.from)
        XCTAssertNil(cleared.to)
        XCTAssertEqual(cleared.read, false)
        XCTAssertEqual(cleared.archived, true)
        XCTAssertEqual(cleared.groupKey, "abc")
        XCTAssertEqual(cleared.limit, 50)
        XCTAssertEqual(cleared.offset, 100)
    }

    func testHasActiveBarFilters() {
        XCTAssertFalse(NotificationFilters().hasActiveBarFilters)
        XCTAssertTrue(NotificationFilters(severity: [.info]).hasActiveBarFilters)
        XCTAssertTrue(NotificationFilters(vehicleIDs: [1]).hasActiveBarFilters)
        XCTAssertTrue(NotificationFilters(query: "x").hasActiveBarFilters)
        XCTAssertFalse(NotificationFilters(query: "").hasActiveBarFilters)
    }
}

// MARK: - Projection: phase + active chips

final class NotificationFilterProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testResolvePhaseWithoutCache() {
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.loading, optionCount: 0), .loading)
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.loaded, optionCount: 0), .empty)
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.failed("boom"), optionCount: 0), .error("boom"))
    }

    func testResolvePhaseWithCachedOptionsAlwaysContent() {
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.loading, optionCount: 3), .content)
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.loaded, optionCount: 3), .content)
        XCTAssertEqual(NotificationFilterProjection.resolvePhase(.failed("x"), optionCount: 3), .content)
    }

    func testActiveChipsOrderAndValues() {
        let filters = NotificationFilters(
            severity: [.warn, .critical],
            vehicleIDs: [1],
            ruleIDs: [10],
            query: "battery",
            from: "2026-01-01T00:00:00Z",
            to: "2026-06-01T00:00:00Z"
        )
        let chips = NotificationFilterProjection.activeChips(
            for: filters,
            vehicles: [NotificationVehicleOption(id: 1, displayName: "Model 3")],
            rules: [NotificationRuleOption(id: 10, name: "Low battery")],
            localize: echo
        )
        XCTAssertEqual(chips.map(\.kind), [.severity, .vehicle, .rule, .query, .from, .to])
        XCTAssertEqual(chips[0].value, "Warn, Critical")
        XCTAssertEqual(chips[1].value, "Model 3")
        XCTAssertEqual(chips[2].value, "Low battery")
        XCTAssertEqual(chips[3].value, "battery")
        XCTAssertEqual(chips[4].value, "2026-01-01")
        XCTAssertEqual(chips[5].value, "2026-06-01")
    }

    func testActiveChipsEmptyWhenNoFilters() {
        let chips = NotificationFilterProjection.activeChips(
            for: NotificationFilters(),
            vehicles: [],
            rules: [],
            localize: echo
        )
        XCTAssertTrue(chips.isEmpty)
    }

    func testActiveChipsFallBackToIDWhenOptionMissing() {
        let filters = NotificationFilters(vehicleIDs: [99], ruleIDs: [42])
        let chips = NotificationFilterProjection.activeChips(
            for: filters,
            vehicles: [],
            rules: [],
            localize: echo
        )
        XCTAssertEqual(chips.first { $0.kind == .vehicle }?.value, "#99")
        XCTAssertEqual(chips.first { $0.kind == .rule }?.value, "#42")
    }
}

// MARK: - Option labels + ISO date boundary

final class NotificationFilterOptionTests: XCTestCase {
    func testVehicleOptionLabelFallback() {
        XCTAssertEqual(NotificationVehicleOption(id: 1, displayName: "Roadster").label, "Roadster")
        XCTAssertEqual(NotificationVehicleOption(id: 2, displayName: "").label, "#2")
        XCTAssertEqual(NotificationVehicleOption(id: 3, displayName: nil).label, "#3")
    }

    func testRuleOptionLabelFallback() {
        XCTAssertEqual(NotificationRuleOption(id: 5, name: "Sentry").label, "Sentry")
        XCTAssertEqual(NotificationRuleOption(id: 6, name: nil).label, "#6")
    }

    func testDateFormatRoundTrip() {
        let parsed = NotificationDateFormat.parse("2026-06-01")
        XCTAssertNotNil(parsed)
        XCTAssertEqual(NotificationDateFormat.string(parsed ?? Date()), "2026-06-01")
    }

    func testDateFormatTrimsTimeComponentAndRejectsEmpty() {
        XCTAssertNotNil(NotificationDateFormat.parse("2026-06-01T12:34:56Z"))
        XCTAssertNil(NotificationDateFormat.parse(""))
        XCTAssertNil(NotificationDateFormat.parse(nil))
    }
}

// MARK: - Accessibility

final class NotificationFilterAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryWithNoActiveFilters() {
        let summary = NotificationFilterAccessibility.summary(activeCount: 0, localize: echo)
        XCTAssertEqual(summary, "Notification filters: no filters active")
    }

    func testSummaryWithActiveFilters() {
        let summary = NotificationFilterAccessibility.summary(activeCount: 3, localize: echo)
        XCTAssertEqual(summary, "Notification filters: 3 active")
    }
}

// MARK: - Test doubles

final class SpyNotificationFilterTelemetry: NotificationFilterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

final class SpyNotificationFilterChangeSink: NotificationFilterChangeSink, @unchecked Sendable {
    private(set) var changes: [NotificationFilters] = []
    var last: NotificationFilters? {
        changes.last
    }

    func filtersChanged(_ filters: NotificationFilters) {
        changes.append(filters)
    }
}
