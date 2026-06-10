//
//  QuietHoursPanel.ScheduleTests.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  Pure coverage for the schedule label (web exported `nextWindowChangeLabel`), the
//  severity-token mapping (web row badges + `SEVERITY_CHOICES`), the window summary (web
//  `summarizeWindow`), and the VoiceOver builders. The clock is pinned with a fixed UTC
//  calendar + explicit `now` so the wrap / non-wrap branches are deterministic. Pure +
//  bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A UTC Gregorian calendar so weekday + minute extraction is deterministic.
private let utcCalendar: Calendar = {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
    return cal
}()

/// Builds a UTC instant. 2024-01-03 is a Wednesday (weekday bit 1<<3 = 8).
private func wednesday(hour: Int, minute: Int) -> Date {
    var components = DateComponents()
    components.year = 2024
    components.month = 1
    components.day = 3
    components.hour = hour
    components.minute = minute
    return utcCalendar.date(from: components) ?? Date(timeIntervalSinceReferenceDate: 0)
}

private func window(
    enabled: Bool = true,
    start: String,
    end: String,
    weekdays: Int = QuietHoursWeekdays.all,
    bypass: [String] = ["critical"]
) -> QuietHoursWindowItem {
    QuietHoursWindowItem(
        id: 1,
        enabled: enabled,
        startLocal: start,
        endLocal: end,
        timezone: "UTC",
        weekdays: weekdays,
        bypassSeverities: bypass
    )
}

private func label(for item: QuietHoursWindowItem, at now: Date) -> String? {
    QuietHoursSchedule.nextChangeLabel(for: item, now: now, calendar: utcCalendar, localize: passthroughLocalize)
}

// MARK: - Schedule (web `nextWindowChangeLabel`)

final class QuietHoursScheduleTests: XCTestCase {
    func testDisabledWindowHasNoLabel() {
        let item = window(enabled: false, start: "09:00", end: "17:00")
        XCTAssertNil(label(for: item, at: wednesday(hour: 12, minute: 0)))
    }

    func testWindowNotActiveTodayHasNoLabel() {
        // Sunday-only window (bit 1) on a Wednesday → not on today.
        let item = window(start: "09:00", end: "17:00", weekdays: 1 << 0)
        XCTAssertNil(label(for: item, at: wednesday(hour: 12, minute: 0)))
    }

    func testNonWrapBeforeStartStartsToday() {
        let item = window(start: "09:00", end: "17:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 8, minute: 0)), "starts at 09:00")
    }

    func testNonWrapDuringWindowEndsToday() {
        let item = window(start: "09:00", end: "17:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 12, minute: 0)), "ends at 17:00")
    }

    func testNonWrapAfterEndStartsTomorrow() {
        let item = window(start: "09:00", end: "17:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 18, minute: 0)), "starts tomorrow at 09:00")
    }

    func testWrapBeforeEndEndsToday() {
        let item = window(start: "23:00", end: "07:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 6, minute: 0)), "ends at 07:00")
    }

    func testWrapAfterStartEndsTomorrow() {
        let item = window(start: "23:00", end: "07:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 23, minute: 30)), "ends tomorrow at 07:00")
    }

    func testWrapBetweenEndAndStartStartsToday() {
        let item = window(start: "23:00", end: "07:00")
        XCTAssertEqual(label(for: item, at: wednesday(hour: 12, minute: 0)), "starts at 23:00")
    }

    func testInvalidTimesHaveNoLabel() {
        let item = window(start: "nope", end: "07:00")
        XCTAssertNil(label(for: item, at: wednesday(hour: 12, minute: 0)))
    }
}

// MARK: - Severity mapping (web row badges + `SEVERITY_CHOICES`)

final class QuietHoursSeverityTests: XCTestCase {
    func testKnownTokensResolveToLabels() {
        XCTAssertEqual(QuietHoursSeverity.label(forToken: "critical", localize: passthroughLocalize), "Critical")
        XCTAssertEqual(QuietHoursSeverity.label(forToken: "warn", localize: passthroughLocalize), "Warning")
        XCTAssertEqual(QuietHoursSeverity.label(forToken: "info", localize: passthroughLocalize), "Info")
    }

    func testUnknownTokenFallsBackToRawValue() {
        XCTAssertEqual(QuietHoursSeverity.label(forToken: "weird", localize: passthroughLocalize), "weird")
    }

    func testChoiceOrderMatchesWeb() {
        XCTAssertEqual(QuietHoursSeverity.allCases, [.critical, .warn, .info])
    }
}

// MARK: - Window summary (web `summarizeWindow`)

final class QuietHoursWindowItemTests: XCTestCase {
    func testSummaryFormat() {
        let item = window(start: "23:00", end: "07:00")
        XCTAssertEqual(item.summary, "23:00 → 07:00 (UTC)")
    }
}

// MARK: - Accessibility

final class QuietHoursAccessibilityTests: XCTestCase {
    func testPanelSummary() {
        let summary = QuietHoursAccessibility.panelSummary(count: 2, localize: passthroughLocalize)
        XCTAssertEqual(summary, "Quiet hours / Do-Not-Disturb: 2")
    }

    func testRowLabelIncludesStateSummaryWeekdaysAndBypass() {
        let item = window(start: "23:00", end: "07:00", weekdays: 1 << 0, bypass: ["critical"])
        let result = QuietHoursAccessibility.rowLabel(item, localize: passthroughLocalize)
        XCTAssertTrue(result.contains("Enabled"))
        XCTAssertTrue(result.contains("23:00 → 07:00 (UTC)"))
        XCTAssertTrue(result.contains("Sun"))
        XCTAssertTrue(result.contains("Always allow:"))
        XCTAssertTrue(result.contains("Critical"))
    }

    func testRowLabelDisabledOmitsBypassWhenEmpty() {
        let item = window(enabled: false, start: "09:00", end: "17:00", bypass: [])
        let result = QuietHoursAccessibility.rowLabel(item, localize: passthroughLocalize)
        XCTAssertTrue(result.contains("Disabled"))
        XCTAssertFalse(result.contains("Always allow:"))
    }
}
