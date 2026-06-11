//
//  DateTime.Tests.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  Adapter + projection coverage for the DateTime surface:
//    • Parsing — the lossless `Date | ISO-8601 | absent` value mirror + the invalid-input guard.
//    • Locale — the empty → en-US fallback (web `resolveLocale`).
//    • Timezone — the mode/vehicle/override resolution (web `resolveTimezone`).
//    • Formatting — the five variants (full / date / time / short / relative) + the relative clock.
//    • ISO title — the canonical instant (+ optional "(tz)" suffix; the web hover `title`).
//    • Abbreviation — the DST-aware short zone (web `tzAbbreviation`).
//    • Accessibility — the composed spoken value label.
//    • Projection — the web render branches + the P4 leaf contract (loading / empty / error /
//      content), the `showTz` abbreviation, and the hook-free `pure` path.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

/// Identity resolver — returns each key's English fallback so the assertions read the web copy.
private let resolve: DateTimeResolve = { _, fallback in fallback }

/// Normalizes the narrow / non-breaking spaces `Date.FormatStyle` emits (e.g. U+202F before AM/PM in
/// en-US) to a regular space, so the assertions read with ordinary literals regardless of the ICU
/// spacing convention.
private func norm(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\u{202f}", with: " ")
        .replacingOccurrences(of: "\u{00a0}", with: " ")
}

/// A fixed backend timestamp (2026-04-04T09:30:00Z) used across the absolute-format assertions.
private func fixedDate() -> Date {
    guard let date = DateTimeFormatting.parse(.iso("2026-04-04T09:30:00Z")) else {
        fatalError("fixture parse failed")
    }
    return date
}

// MARK: - Parsing (web `string | Date | null`)

final class DateTimeValueParseTests: XCTestCase {
    func testAbsentParsesToNil() {
        XCTAssertNil(DateTimeFormatting.parse(.absent))
    }

    func testBlankIsoParsesToNil() {
        XCTAssertNil(DateTimeFormatting.parse(.iso("")))
        XCTAssertNil(DateTimeFormatting.parse(.iso("   ")))
    }

    func testGarbageIsoParsesToNil() {
        XCTAssertNil(DateTimeFormatting.parse(.iso("not-a-date")))
    }

    func testInternetDateTimeParses() {
        XCTAssertNotNil(DateTimeFormatting.parse(.iso("2026-04-04T09:30:00Z")))
    }

    func testFractionalSecondsParses() {
        XCTAssertNotNil(DateTimeFormatting.parse(.iso("2026-04-04T09:30:00.123Z")))
    }

    func testDateCaseRoundTrips() {
        let date = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(DateTimeFormatting.parse(.date(date)), date)
    }
}

// MARK: - Locale (web `resolveLocale`)

final class DateTimeLocaleTests: XCTestCase {
    func testNilAndBlankFallBackToEnUS() {
        XCTAssertEqual(DateTimeFormatting.resolveLocale(nil), "en-US")
        XCTAssertEqual(DateTimeFormatting.resolveLocale(""), "en-US")
        XCTAssertEqual(DateTimeFormatting.resolveLocale("   "), "en-US")
    }

    func testPresentLocalePassesThrough() {
        XCTAssertEqual(DateTimeFormatting.resolveLocale("fr-FR"), "fr-FR")
    }
}

// MARK: - Timezone resolution (web `resolveTimezone`)

final class DateTimeTimeZoneResolutionTests: XCTestCase {
    func testUtcModeAlwaysUTC() {
        let zone = DateTimeFormatting.resolveTimeZone(
            mode: .utc, vehicleTimeZone: "America/Los_Angeles", userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(zone, "UTC")
    }

    func testUserModeUsesOverrideThenDevice() {
        let withOverride = DateTimeFormatting.resolveTimeZone(
            mode: .user, vehicleTimeZone: nil, userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(withOverride, "Europe/Paris")
        let withoutOverride = DateTimeFormatting.resolveTimeZone(
            mode: .user, vehicleTimeZone: nil, userOverride: nil, device: "America/New_York"
        )
        XCTAssertEqual(withoutOverride, "America/New_York")
    }

    func testVehicleModeUsesVehicleZone() {
        let zone = DateTimeFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: "America/Los_Angeles", userOverride: "Europe/Paris",
            device: "America/New_York"
        )
        XCTAssertEqual(zone, "America/Los_Angeles")
    }

    func testVehicleModeFallsBackWhenZoneMissingOrUTC() {
        let missing = DateTimeFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: nil, userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(missing, "Europe/Paris")
        let utc = DateTimeFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: "UTC", userOverride: nil, device: "America/New_York"
        )
        XCTAssertEqual(utc, "America/New_York")
    }
}

// MARK: - Formatting (absolute variants + relative clock)

final class DateTimeFormatTests: XCTestCase {
    private func display(_ variant: DateTimeVariant, tz: String?, now: Date = Date()) -> String {
        norm(DateTimeFormatting.display(
            value: .date(fixedDate()),
            variant: variant,
            context: DateTimeFormatContext(locale: "en-US", timeZone: tz, now: now),
            strings: resolve
        ))
    }

    func testFullUTC() {
        XCTAssertEqual(display(.full, tz: "UTC"), "Apr 4, 2026 at 9:30 AM")
    }

    func testDateUTC() {
        XCTAssertEqual(display(.date, tz: "UTC"), "Apr 4, 2026")
    }

    func testShortUTC() {
        XCTAssertEqual(display(.short, tz: "UTC"), "Apr 4")
    }

    func testTimeUTC() {
        XCTAssertEqual(display(.time, tz: "UTC"), "9:30 AM")
    }

    func testFullLosAngelesShiftsWallClock() {
        XCTAssertEqual(display(.full, tz: "America/Los_Angeles"), "Apr 4, 2026 at 2:30 AM")
    }

    func testAbsentRendersFallback() {
        let out = DateTimeFormatting.display(
            value: .absent,
            variant: .full,
            context: DateTimeFormatContext(locale: "en-US", timeZone: "UTC"),
            strings: resolve
        )
        XCTAssertEqual(out, "—")
    }

    func testInvalidRendersFallback() {
        let out = DateTimeFormatting.display(
            value: .iso("nope"),
            variant: .full,
            context: DateTimeFormatContext(locale: "en-US", timeZone: "UTC"),
            strings: resolve
        )
        XCTAssertEqual(out, "—")
    }

    func testRelativeJustNow() {
        let base = fixedDate()
        XCTAssertEqual(display(.relative, tz: "UTC", now: base.addingTimeInterval(30)), "Just now")
    }

    func testRelativeMinutesAgo() {
        let base = fixedDate()
        XCTAssertEqual(display(.relative, tz: "UTC", now: base.addingTimeInterval(5 * 60)), "5m ago")
    }

    func testRelativeHoursAgo() {
        let base = fixedDate()
        XCTAssertEqual(display(.relative, tz: "UTC", now: base.addingTimeInterval(3 * 3600)), "3h ago")
    }

    func testRelativeFallsBackToAbsoluteBeyondADay() {
        let base = fixedDate()
        let out = display(.relative, tz: "UTC", now: base.addingTimeInterval(30 * 3600))
        XCTAssertNotEqual(out, "—")
        XCTAssertTrue(out.contains("Apr"))
        XCTAssertFalse(out.hasSuffix("ago"))
    }

    func testRelativeFutureIsJustNow() {
        let base = fixedDate()
        XCTAssertEqual(display(.relative, tz: "UTC", now: base.addingTimeInterval(-120)), "Just now")
    }
}

// MARK: - ISO title (web hover `title`)

final class DateTimeISOTitleTests: XCTestCase {
    func testAbsentHasNoTitle() {
        XCTAssertNil(DateTimeFormatting.isoTitle(.absent, timeZone: "UTC"))
    }

    func testTitleWithoutZone() {
        XCTAssertEqual(
            DateTimeFormatting.isoTitle(.date(fixedDate()), timeZone: nil),
            "2026-04-04T09:30:00Z"
        )
    }

    func testTitleAnnotatesZone() {
        XCTAssertEqual(
            DateTimeFormatting.isoTitle(.date(fixedDate()), timeZone: "America/Los_Angeles"),
            "2026-04-04T09:30:00Z (America/Los_Angeles)"
        )
    }
}

// MARK: - Abbreviation (web `tzAbbreviation`)

final class DateTimeAbbreviationTests: XCTestCase {
    private func value(_ iso: String) -> DateTimeValue {
        .iso(iso)
    }

    func testStandardTimeAbbreviation() {
        XCTAssertEqual(
            DateTimeFormatting.abbreviation(value("2026-01-15T12:00:00Z"), timeZone: "America/Los_Angeles"),
            "PST"
        )
    }

    func testDaylightTimeAbbreviation() {
        XCTAssertEqual(
            DateTimeFormatting.abbreviation(value("2026-07-15T12:00:00Z"), timeZone: "America/Los_Angeles"),
            "PDT"
        )
    }

    func testNoZoneIsEmpty() {
        XCTAssertEqual(DateTimeFormatting.abbreviation(value("2026-04-04T09:30:00Z"), timeZone: nil), "")
    }

    func testAbsentIsEmpty() {
        XCTAssertEqual(DateTimeFormatting.abbreviation(.absent, timeZone: "America/Los_Angeles"), "")
    }

    func testUnknownZoneIsEmpty() {
        XCTAssertEqual(DateTimeFormatting.abbreviation(value("2026-04-04T09:30:00Z"), timeZone: "Not/AZone"), "")
    }
}

// MARK: - Accessibility

final class DateTimeAccessibilityTests: XCTestCase {
    func testValueLabelAppendsAbbreviation() {
        XCTAssertEqual(DateTimeAccessibility.valueLabel(display: "9:30 AM", abbreviation: "PST"), "9:30 AM PST")
    }

    func testValueLabelWithoutAbbreviation() {
        XCTAssertEqual(DateTimeAccessibility.valueLabel(display: "9:30 AM", abbreviation: nil), "9:30 AM")
        XCTAssertEqual(DateTimeAccessibility.valueLabel(display: "9:30 AM", abbreviation: ""), "9:30 AM")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class DateTimeProjectionTests: XCTestCase {
    private func input(
        value: DateTimeValue = .iso("2026-04-04T09:30:00Z"),
        variant: DateTimeVariant = .full,
        mode: TimeZoneMode? = .utc,
        showTimeZone: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> DateTimeInput {
        DateTimeInput(
            value: value,
            variant: variant,
            mode: mode,
            showTimeZone: showTimeZone,
            locale: "en-US",
            vehicleTimeZone: "America/Los_Angeles",
            defaultMode: .vehicle,
            deviceTimeZone: "America/New_York",
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    func testErrorTakesPrecedence() {
        let resolved = DateTimeProjection.resolve(input(isLoading: true, errorMessage: "boom"), strings: resolve)
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(DateTimeProjection.resolve(input(isLoading: true), strings: resolve).phase, .loading)
    }

    func testEmptyWhenValueAbsent() {
        let resolved = DateTimeProjection.resolve(input(value: .absent), strings: resolve)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.display, "—")
        XCTAssertTrue(resolved.isFallback)
        XCTAssertEqual(resolved.accessibilityLabel, "No date")
        XCTAssertNil(resolved.isoTitle)
    }

    func testEmptyWhenValueInvalid() {
        XCTAssertEqual(DateTimeProjection.resolve(input(value: .iso("bad")), strings: resolve).phase, .empty)
    }

    func testContentRendersUTCValue() {
        let resolved = DateTimeProjection.resolve(input(), strings: resolve)
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertEqual(norm(resolved.display), "Apr 4, 2026 at 9:30 AM")
        XCTAssertFalse(resolved.isFallback)
        XCTAssertEqual(resolved.isoTitle, "2026-04-04T09:30:00Z (UTC)")
    }

    func testShowTimeZoneAddsAbbreviation() {
        let resolved = DateTimeProjection.resolve(input(mode: .vehicle, showTimeZone: true), strings: resolve)
        XCTAssertEqual(resolved.abbreviation, "PDT")
    }

    func testNoAbbreviationWhenShowTimeZoneOff() {
        XCTAssertNil(DateTimeProjection.resolve(input(mode: .vehicle, showTimeZone: false), strings: resolve)
            .abbreviation)
    }

    func testModeFallsBackToDefaultWhenUnset() {
        // mode nil → defaultMode (.vehicle) → vehicle zone (LA) → 2:30 AM wall clock.
        let resolved = DateTimeProjection.resolve(input(mode: nil), strings: resolve)
        XCTAssertEqual(norm(resolved.display), "Apr 4, 2026 at 2:30 AM")
    }

    func testPurePathUsesNoZoneSuffix() {
        let resolved = DateTimeProjection.pure(
            value: .iso("2026-04-04T09:30:00Z"), variant: .full, locale: "en-US", strings: resolve
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertEqual(resolved.isoTitle, "2026-04-04T09:30:00Z")
        XCTAssertNil(resolved.abbreviation)
    }

    func testPurePathEmptyForAbsent() {
        let resolved = DateTimeProjection.pure(value: .absent, variant: .full, locale: "en-US", strings: resolve)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.isFallback)
    }
}
