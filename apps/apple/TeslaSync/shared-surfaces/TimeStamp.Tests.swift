//
//  TimeStamp.Tests.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  Adapter + projection coverage for the TimeStamp surface:
//    • Parsing — the lossless `Date | ISO-8601 | epoch-millis | absent` value mirror + the
//      invalid-input guard (blank / garbage ISO, non-finite epoch).
//    • Locale — the empty → en-US fallback (web `resolveLocale`).
//    • Timezone — the mode/vehicle/override resolution (web `resolveTimezone`, via `useDateFormat`).
//    • Effective format — the web `format === 'auto' ? pref : format`.
//    • Formatting — the relative clock (`formatRelative`: just now / m / h / d / >7d date fallback)
//      and the absolute body (`formatDateTime`).
//    • Pair — the visible body + the tooltip alternate (always the OTHER format).
//    • Accessibility — the spoken value label + the alternate hint.
//    • Projection — the web render branches + the P4 leaf contract (loading / empty / error /
//      content) and the auto-preference + mode-default resolution.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure core directly.
//

import XCTest
@testable import TeslaSync

/// Identity resolver — returns each key's English fallback so the assertions read the web copy.
private let resolve: TimeStampResolve = { _, fallback in fallback }

/// Normalizes the narrow / non-breaking spaces `Date.FormatStyle` emits (e.g. U+202F before AM/PM in
/// en-US) to a regular space, so the assertions read with ordinary literals regardless of the ICU
/// spacing convention.
private func norm(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\u{202f}", with: " ")
        .replacingOccurrences(of: "\u{00a0}", with: " ")
}

/// A fixed backend timestamp (2026-04-04T09:30:00Z) used across the format assertions.
private func fixedDate() -> Date {
    guard let date = TimeStampFormatting.parse(.iso("2026-04-04T09:30:00Z")) else {
        fatalError("fixture parse failed")
    }
    return date
}

// MARK: - Parsing (web `string | number | Date | null`)

final class TimeStampValueParseTests: XCTestCase {
    func testAbsentParsesToNil() {
        XCTAssertNil(TimeStampFormatting.parse(.absent))
    }

    func testBlankIsoParsesToNil() {
        XCTAssertNil(TimeStampFormatting.parse(.iso("")))
        XCTAssertNil(TimeStampFormatting.parse(.iso("   ")))
    }

    func testGarbageIsoParsesToNil() {
        XCTAssertNil(TimeStampFormatting.parse(.iso("not-a-date")))
    }

    func testInternetDateTimeParses() {
        XCTAssertNotNil(TimeStampFormatting.parse(.iso("2026-04-04T09:30:00Z")))
    }

    func testFractionalSecondsParses() {
        XCTAssertNotNil(TimeStampFormatting.parse(.iso("2026-04-04T09:30:00.123Z")))
    }

    func testDateCaseRoundTrips() {
        let date = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(TimeStampFormatting.parse(.date(date)), date)
    }

    func testEpochMillisRoundTrips() {
        let millis = fixedDate().timeIntervalSince1970 * 1000
        XCTAssertEqual(TimeStampFormatting.parse(.epochMillis(millis)), fixedDate())
    }

    func testEpochIsReadAsMilliseconds() {
        // The web `new Date(number)` reads the number as MILLISECONDS. 1_000_000_000 ms is
        // 1_000_000 s after the epoch — proving the /1000 (ms, not s) reading.
        XCTAssertEqual(TimeStampFormatting.parse(.epochMillis(1_000_000_000)), Date(timeIntervalSince1970: 1_000_000))
    }

    func testNonFiniteEpochParsesToNil() {
        XCTAssertNil(TimeStampFormatting.parse(.epochMillis(.nan)))
        XCTAssertNil(TimeStampFormatting.parse(.epochMillis(.infinity)))
    }
}

// MARK: - Locale (web `resolveLocale`)

final class TimeStampLocaleTests: XCTestCase {
    func testNilAndBlankFallBackToEnUS() {
        XCTAssertEqual(TimeStampFormatting.resolveLocale(nil), "en-US")
        XCTAssertEqual(TimeStampFormatting.resolveLocale(""), "en-US")
        XCTAssertEqual(TimeStampFormatting.resolveLocale("   "), "en-US")
    }

    func testPresentLocalePassesThrough() {
        XCTAssertEqual(TimeStampFormatting.resolveLocale("fr-FR"), "fr-FR")
    }
}

// MARK: - Timezone resolution (web `resolveTimezone`)

final class TimeStampTimeZoneResolutionTests: XCTestCase {
    func testUtcModeAlwaysUTC() {
        let zone = TimeStampFormatting.resolveTimeZone(
            mode: .utc, vehicleTimeZone: "America/Los_Angeles", userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(zone, "UTC")
    }

    func testUserModeUsesOverrideThenDevice() {
        let withOverride = TimeStampFormatting.resolveTimeZone(
            mode: .user, vehicleTimeZone: nil, userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(withOverride, "Europe/Paris")
        let withoutOverride = TimeStampFormatting.resolveTimeZone(
            mode: .user, vehicleTimeZone: nil, userOverride: nil, device: "America/New_York"
        )
        XCTAssertEqual(withoutOverride, "America/New_York")
    }

    func testVehicleModeUsesVehicleZone() {
        let zone = TimeStampFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: "America/Los_Angeles", userOverride: "Europe/Paris",
            device: "America/New_York"
        )
        XCTAssertEqual(zone, "America/Los_Angeles")
    }

    func testVehicleModeFallsBackWhenZoneMissingOrUTC() {
        let missing = TimeStampFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: nil, userOverride: "Europe/Paris", device: "America/New_York"
        )
        XCTAssertEqual(missing, "Europe/Paris")
        let utc = TimeStampFormatting.resolveTimeZone(
            mode: .vehicle, vehicleTimeZone: "UTC", userOverride: nil, device: "America/New_York"
        )
        XCTAssertEqual(utc, "America/New_York")
    }
}

// MARK: - Effective format (web `format === 'auto' ? pref : format`)

final class TimeStampEffectiveFormatTests: XCTestCase {
    func testAutoUsesPreference() {
        XCTAssertEqual(TimeStampFormatting.effective(.auto, preference: .relative), .relative)
        XCTAssertEqual(TimeStampFormatting.effective(.auto, preference: .absolute), .absolute)
    }

    func testExplicitFormatWins() {
        XCTAssertEqual(TimeStampFormatting.effective(.relative, preference: .absolute), .relative)
        XCTAssertEqual(TimeStampFormatting.effective(.absolute, preference: .relative), .absolute)
    }
}

// MARK: - Formatting (relative clock + absolute body)

final class TimeStampFormatTests: XCTestCase {
    private func relative(now: Date) -> String {
        norm(TimeStampFormatting.relative(
            fixedDate(),
            context: TimeStampFormatContext(locale: "en-US", timeZone: "UTC", now: now),
            strings: resolve
        ))
    }

    func testAbsoluteFullUTC() {
        let out = norm(TimeStampFormatting.absolute(
            fixedDate(), context: TimeStampFormatContext(locale: "en-US", timeZone: "UTC")
        ))
        XCTAssertEqual(out, "Apr 4, 2026 at 9:30 AM")
    }

    func testAbsoluteShiftsWallClockForZone() {
        let out = norm(TimeStampFormatting.absolute(
            fixedDate(), context: TimeStampFormatContext(locale: "en-US", timeZone: "America/Los_Angeles")
        ))
        XCTAssertEqual(out, "Apr 4, 2026 at 2:30 AM")
    }

    func testDateOnlyUTC() {
        let out = norm(TimeStampFormatting.dateOnly(
            fixedDate(), context: TimeStampFormatContext(locale: "en-US", timeZone: "UTC")
        ))
        XCTAssertEqual(out, "Apr 4, 2026")
    }

    func testRelativeJustNow() {
        XCTAssertEqual(relative(now: fixedDate().addingTimeInterval(30)), "just now")
    }

    func testRelativeMinutesAgo() {
        XCTAssertEqual(relative(now: fixedDate().addingTimeInterval(5 * 60)), "5m ago")
    }

    func testRelativeHoursAgo() {
        XCTAssertEqual(relative(now: fixedDate().addingTimeInterval(3 * 3600)), "3h ago")
    }

    func testRelativeDaysAgo() {
        XCTAssertEqual(relative(now: fixedDate().addingTimeInterval(2 * 86400)), "2d ago")
    }

    func testRelativeFallsBackToDateBeyondAWeek() {
        let out = relative(now: fixedDate().addingTimeInterval(10 * 86400))
        XCTAssertEqual(out, "Apr 4, 2026")
        XCTAssertFalse(out.hasSuffix("ago"))
    }

    func testRelativeFutureIsJustNow() {
        XCTAssertEqual(relative(now: fixedDate().addingTimeInterval(-120)), "just now")
    }
}

// MARK: - Pair (visible body + tooltip alternate)

final class TimeStampPairTests: XCTestCase {
    private func pair(format: TimeStampFormat, preference: TimeStampPreference) -> TimeStampPair? {
        TimeStampFormatting.pair(
            value: .date(fixedDate()),
            format: format,
            preference: preference,
            context: TimeStampFormatContext(
                locale: "en-US", timeZone: "UTC", now: fixedDate().addingTimeInterval(5 * 60)
            ),
            strings: resolve
        )
    }

    func testRelativeEffectiveShowsRelativePrimaryAbsoluteSecondary() {
        let result = pair(format: .relative, preference: .absolute)
        XCTAssertEqual(result?.primary, "5m ago")
        XCTAssertEqual(result.map { norm($0.secondary) }, "Apr 4, 2026 at 9:30 AM")
    }

    func testAbsoluteEffectiveShowsAbsolutePrimaryRelativeSecondary() {
        let result = pair(format: .absolute, preference: .relative)
        XCTAssertEqual(result.map { norm($0.primary) }, "Apr 4, 2026 at 9:30 AM")
        XCTAssertEqual(result?.secondary, "5m ago")
    }

    func testAutoFollowsRelativePreference() {
        let result = pair(format: .auto, preference: .relative)
        XCTAssertEqual(result?.primary, "5m ago")
        XCTAssertEqual(result.map { norm($0.secondary) }, "Apr 4, 2026 at 9:30 AM")
    }

    func testAutoFollowsAbsolutePreference() {
        let result = pair(format: .auto, preference: .absolute)
        XCTAssertEqual(result.map { norm($0.primary) }, "Apr 4, 2026 at 9:30 AM")
        XCTAssertEqual(result?.secondary, "5m ago")
    }

    func testAbsentValueHasNoPair() {
        let result = TimeStampFormatting.pair(
            value: .absent,
            format: .auto,
            preference: .relative,
            context: TimeStampFormatContext(locale: "en-US", timeZone: "UTC"),
            strings: resolve
        )
        XCTAssertNil(result)
    }
}

// MARK: - Accessibility

final class TimeStampAccessibilityTests: XCTestCase {
    func testValueLabelIsPrimary() {
        XCTAssertEqual(TimeStampAccessibility.valueLabel(primary: "2h ago"), "2h ago")
    }

    func testAlternateHintInterpolatesSecondary() {
        let hint = TimeStampAccessibility.alternateHint(secondary: "Apr 4, 2026 at 9:30 AM", strings: resolve)
        XCTAssertEqual(hint, "Also Apr 4, 2026 at 9:30 AM")
    }

    func testAlternateHintNilWhenNoSecondary() {
        XCTAssertNil(TimeStampAccessibility.alternateHint(secondary: nil, strings: resolve))
        XCTAssertNil(TimeStampAccessibility.alternateHint(secondary: "", strings: resolve))
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class TimeStampProjectionTests: XCTestCase {
    private func input(
        value: TimeStampValue = .iso("2026-04-04T09:30:00Z"),
        format: TimeStampFormat = .absolute,
        mode: TimeStampTzMode? = .utc,
        preference: TimeStampPreference = .relative,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) -> TimeStampInput {
        TimeStampInput(
            value: value,
            format: format,
            mode: mode,
            preference: preference,
            locale: "en-US",
            vehicleTimeZone: "America/Los_Angeles",
            defaultMode: .vehicle,
            deviceTimeZone: "America/New_York",
            isLoading: isLoading,
            errorMessage: errorMessage
        )
    }

    private func resolveAt(_ input: TimeStampInput, now: Date) -> TimeStampResolved {
        TimeStampProjection.resolve(input, now: now, strings: resolve)
    }

    func testErrorTakesPrecedence() {
        let resolved = resolveAt(input(isLoading: true, errorMessage: "boom"), now: fixedDate())
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(resolveAt(input(isLoading: true), now: fixedDate()).phase, .loading)
    }

    func testEmptyWhenValueAbsent() {
        let resolved = resolveAt(input(value: .absent), now: fixedDate())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.primary, "—")
        XCTAssertNil(resolved.secondary)
        XCTAssertTrue(resolved.isFallback)
        XCTAssertEqual(resolved.accessibilityLabel, "No time")
        XCTAssertNil(resolved.accessibilityHint)
    }

    func testEmptyWhenValueInvalid() {
        XCTAssertEqual(resolveAt(input(value: .iso("bad")), now: fixedDate()).phase, .empty)
    }

    func testContentRendersAbsolutePrimaryWithRelativeSecondary() {
        let resolved = resolveAt(input(format: .absolute), now: fixedDate().addingTimeInterval(5 * 60))
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertEqual(norm(resolved.primary), "Apr 4, 2026 at 9:30 AM")
        XCTAssertEqual(resolved.secondary, "5m ago")
        XCTAssertFalse(resolved.isFallback)
        XCTAssertEqual(resolved.accessibilityHint, "Also 5m ago")
    }

    func testAutoPreferenceDrivesPrimary() {
        let now = fixedDate().addingTimeInterval(5 * 60)
        let resolved = resolveAt(input(format: .auto, preference: .relative), now: now)
        XCTAssertEqual(resolved.primary, "5m ago")
        XCTAssertEqual(norm(resolved.secondary ?? ""), "Apr 4, 2026 at 9:30 AM")
    }

    func testModeFallsBackToDefaultWhenUnset() {
        // mode nil → defaultMode (.vehicle) → vehicle zone (LA) → 2:30 AM wall clock.
        let resolved = resolveAt(input(format: .absolute, mode: nil), now: fixedDate())
        XCTAssertEqual(norm(resolved.primary), "Apr 4, 2026 at 2:30 AM")
    }
}
