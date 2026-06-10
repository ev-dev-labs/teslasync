//
//  QuietHoursPanel.Tests.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  Pure adapter coverage for the QuietHoursPanel surface — the validator (web
//  `validateDraft` + the `HHMM` regex), the HH:MM ↔ Date clock, the weekday-mask
//  helpers, the phase projection, and the timezone catalog. The schedule + accessibility
//  coverage lives in QuietHoursPanel.ScheduleTests.swift; the state-holder coverage in
//  QuietHoursPanel.ModelTests.swift. Pure + bundle-free: copy resolves through an
//  identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real
/// copy (and the `%@` format strings) without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Validator (web `validateDraft` + `HHMM`)

final class QuietHoursValidatorTests: XCTestCase {
    func testIsValidTimeAcceptsWellFormed() {
        XCTAssertTrue(QuietHoursValidator.isValidTime("00:00"))
        XCTAssertTrue(QuietHoursValidator.isValidTime("23:59"))
        XCTAssertTrue(QuietHoursValidator.isValidTime("07:05"))
    }

    func testIsValidTimeRejectsMalformed() {
        XCTAssertFalse(QuietHoursValidator.isValidTime("7:00"))
        XCTAssertFalse(QuietHoursValidator.isValidTime("24:00"))
        XCTAssertFalse(QuietHoursValidator.isValidTime("23:60"))
        XCTAssertFalse(QuietHoursValidator.isValidTime("12:5"))
        XCTAssertFalse(QuietHoursValidator.isValidTime("abc"))
        XCTAssertFalse(QuietHoursValidator.isValidTime(""))
    }

    func testParseMinutes() {
        XCTAssertEqual(QuietHoursValidator.parseMinutes("00:00"), 0)
        XCTAssertEqual(QuietHoursValidator.parseMinutes("01:30"), 90)
        XCTAssertEqual(QuietHoursValidator.parseMinutes("23:00"), 1380)
        XCTAssertNil(QuietHoursValidator.parseMinutes("nope"))
    }

    func testValidateStartInvalid() {
        let draft = QuietHoursDraft(startLocal: "9:00")
        let result = QuietHoursValidator.validate(draft)
        XCTAssertFalse(result.ok)
        XCTAssertEqual(result.field, .startLocal)
    }

    func testValidateEndInvalid() {
        let draft = QuietHoursDraft(startLocal: "09:00", endLocal: "25:00")
        XCTAssertEqual(QuietHoursValidator.validate(draft).field, .endLocal)
        XCTAssertEqual(QuietHoursValidator.validate(draft).reason, .invalid)
    }

    func testValidateStartEqualsEnd() {
        let draft = QuietHoursDraft(startLocal: "08:00", endLocal: "08:00")
        let result = QuietHoursValidator.validate(draft)
        XCTAssertEqual(result.field, .endLocal)
        XCTAssertEqual(result.reason, .equal)
    }

    func testValidateTimezoneRequired() {
        let draft = QuietHoursDraft(startLocal: "23:00", endLocal: "07:00", timezone: "")
        XCTAssertEqual(QuietHoursValidator.validate(draft).field, .timezone)
    }

    func testValidateWeekdaysRequired() {
        let zero = QuietHoursDraft(startLocal: "23:00", endLocal: "07:00", timezone: "UTC", weekdays: 0)
        XCTAssertEqual(QuietHoursValidator.validate(zero).field, .weekdays)
        let over = QuietHoursDraft(startLocal: "23:00", endLocal: "07:00", timezone: "UTC", weekdays: 128)
        XCTAssertEqual(QuietHoursValidator.validate(over).field, .weekdays)
    }

    func testValidateAcceptsEmptyBypass() {
        let draft = QuietHoursDraft(
            startLocal: "23:00",
            endLocal: "07:00",
            timezone: "UTC",
            weekdays: QuietHoursWeekdays.all,
            bypassSeverities: []
        )
        XCTAssertTrue(QuietHoursValidator.validate(draft).ok)
    }

    func testMessageMapping() {
        let cases: [(QuietHoursValidation, String)] = [
            (QuietHoursValidation(field: .startLocal, reason: .invalid), "Start must be HH:MM (24-hour)."),
            (QuietHoursValidation(field: .endLocal, reason: .invalid), "End must be HH:MM (24-hour)."),
            (QuietHoursValidation(field: .endLocal, reason: .equal), "End must differ from start."),
            (QuietHoursValidation(field: .timezone, reason: .required), "Timezone is required."),
            (QuietHoursValidation(field: .weekdays, reason: .required), "Pick at least one weekday."),
            (QuietHoursValidation(field: .bypassSeverities, reason: .required), "Pick at least one severity."),
            (QuietHoursValidation(), "Start must be HH:MM (24-hour).")
        ]
        for (validation, expected) in cases {
            XCTAssertEqual(QuietHoursValidator.message(for: validation, localize: passthroughLocalize), expected)
        }
    }
}

// MARK: - Clock (HH:MM ↔ Date)

final class QuietHoursClockTests: XCTestCase {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return cal
    }

    func testHHMMFromMinutesPadsAndClamps() {
        XCTAssertEqual(QuietHoursClock.hhmm(fromMinutes: 0), "00:00")
        XCTAssertEqual(QuietHoursClock.hhmm(fromMinutes: 90), "01:30")
        XCTAssertEqual(QuietHoursClock.hhmm(fromMinutes: 1439), "23:59")
        XCTAssertEqual(QuietHoursClock.hhmm(fromMinutes: -10), "00:00")
        XCTAssertEqual(QuietHoursClock.hhmm(fromMinutes: 5000), "23:59")
    }

    func testDateRoundTrip() {
        for value in ["00:00", "07:05", "12:30", "23:00", "23:59"] {
            let date = QuietHoursClock.date(fromHHMM: value, calendar: calendar)
            XCTAssertEqual(QuietHoursClock.hhmm(fromDate: date, calendar: calendar), value)
        }
    }
}

// MARK: - Weekday mask helpers

final class QuietHoursWeekdaysTests: XCTestCase {
    func testAllWeekdaysIs127() {
        XCTAssertEqual(QuietHoursWeekdays.all, 127)
        XCTAssertEqual(QuietHoursWeekdays.ordered.count, 7)
    }

    func testIsOnAndToggle() {
        let sunday = 1 << 0
        XCTAssertTrue(QuietHoursWeekdays.isOn(QuietHoursWeekdays.all, bit: sunday))
        XCTAssertFalse(QuietHoursWeekdays.isOn(0, bit: sunday))
        let toggledOn = QuietHoursWeekdays.toggled(0, bit: sunday)
        XCTAssertEqual(toggledOn, sunday)
        XCTAssertEqual(QuietHoursWeekdays.toggled(toggledOn, bit: sunday), 0)
    }

    func testOrderedBitsAreSunThroughSat() {
        let bits = QuietHoursWeekdays.ordered.map(\.bit)
        XCTAssertEqual(bits, [1, 2, 4, 8, 16, 32, 64])
    }
}

// MARK: - Projection (phase resolution)

final class QuietHoursProjectionTests: XCTestCase {
    func testLoadingResolvesByBodyPresence() {
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .loading, windowCount: 0, hasDraft: false),
            .loading
        )
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .loading, windowCount: 2, hasDraft: false),
            .content
        )
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .loaded, windowCount: 0, hasDraft: false),
            .empty
        )
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .loaded, windowCount: 0, hasDraft: true),
            .content
        )
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .loaded, windowCount: 3, hasDraft: false),
            .content
        )
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .failed("boom"), windowCount: 0, hasDraft: false),
            .error("boom")
        )
        XCTAssertEqual(
            QuietHoursProjection.resolvePhase(status: .failed("boom"), windowCount: 1, hasDraft: false),
            .content
        )
    }
}

// MARK: - Timezone catalog (web `listTimezones`)

final class QuietHoursTimezonesTests: XCTestCase {
    func testKnownZonesAreSortedWhenCurrentPresent() {
        let zones = QuietHoursTimezones.options(current: "Europe/London")
        XCTAssertEqual(zones, zones.sorted())
        XCTAssertTrue(zones.contains("Europe/London"))
    }

    func testCurrentPinnedFirstWhenAbsent() {
        let zones = QuietHoursTimezones.options(current: "Mars/Olympus")
        XCTAssertEqual(zones.first, "Mars/Olympus")
    }
}
