//
//  SignalCompareControls.Tests.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  Unit coverage for the SignalCompareControls adapter core:
//    • Datetime helpers (`SignalCompareDateFormat`) — the web `toLocalDatetimeInput` /
//      `isoOrEmpty` round-trips, with an injected zone so the result is deterministic.
//    • Category prefixes (`SignalDiffCategory`) — the web `/…/i` predicates + lookup.
//    • Presets (`SignalDiffPreset`) — the web `compute()` offsets relative to a fixed now.
//    • Projection (`SignalCompareProjection`) — phase resolution, preset application,
//      category toggle, the search + category filter, and the ISO server-query.
//    • The VoiceOver summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and resolves copy through an echo localizer.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private enum SignalCompareTestClock {
    static let utc = TimeZone.gmt

    static func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }
}

// MARK: - Datetime helpers (web `toLocalDatetimeInput` / `isoOrEmpty`)

final class SignalCompareDateFormatTests: XCTestCase {
    private let utc = SignalCompareTestClock.utc

    func testToLocalDatetimeInputFormatsLocalComponents() {
        let instant = SignalCompareTestClock.date(2026, 6, 9, 8, 30)
        XCTAssertEqual(SignalCompareDateFormat.toLocalDatetimeInput(instant, timeZone: utc), "2026-06-09T08:30")
    }

    func testLocalDatetimeInputRoundTrips() {
        let instant = SignalCompareTestClock.date(2026, 1, 2, 23, 5)
        let field = SignalCompareDateFormat.toLocalDatetimeInput(instant, timeZone: utc)
        let parsed = SignalCompareDateFormat.parseLocalDatetimeInput(field, timeZone: utc)
        XCTAssertEqual(parsed, instant)
    }

    func testIsoOrEmptyConvertsLocalFieldToUTC() {
        // 08:30 at UTC+2 is 06:30 UTC; web `isoOrEmpty` emits millisecond precision + Z.
        let plusTwo = TimeZone(secondsFromGMT: 2 * 3600) ?? .gmt
        XCTAssertEqual(
            SignalCompareDateFormat.isoOrEmpty("2026-06-09T08:30", timeZone: plusTwo),
            "2026-06-09T06:30:00.000Z"
        )
        XCTAssertEqual(
            SignalCompareDateFormat.isoOrEmpty("2026-06-09T08:30", timeZone: utc),
            "2026-06-09T08:30:00.000Z"
        )
    }

    func testIsoOrEmptyReturnsEmptyForEmptyOrInvalid() {
        XCTAssertEqual(SignalCompareDateFormat.isoOrEmpty("", timeZone: utc), "")
        XCTAssertEqual(SignalCompareDateFormat.isoOrEmpty("not-a-date", timeZone: utc), "")
    }
}

// MARK: - Category prefixes (web `CATEGORY_PREFIXES`)

final class SignalDiffCategoryTests: XCTestCase {
    func testAllEightPrefixesInWebOrder() {
        XCTAssertEqual(
            SignalDiffCategory.all.map(\.id),
            ["battery", "drive", "climate", "security", "motor", "tire", "media", "safety"]
        )
    }

    func testMatchesPredicatePerWebRegex() {
        func category(_ id: String) -> SignalDiffCategory {
            SignalDiffCategory.category(id: id) ?? SignalDiffCategory.all[0]
        }
        XCTAssertTrue(category("battery").matches("battery_level"))
        XCTAssertTrue(category("battery").matches("est_range_km"))
        XCTAssertFalse(category("battery").matches("vehicle_speed"))
        XCTAssertTrue(category("drive").matches("vehicle_speed"))
        XCTAssertTrue(category("drive").matches("odometer"))
        XCTAssertTrue(category("tire").matches("tpms_front_left"))
        XCTAssertTrue(category("tire").matches("tire_pressure"))
        XCTAssertTrue(category("security").matches("sentry_mode"))
        XCTAssertTrue(category("motor").matches("motor_rpm"))
    }

    func testMatchesIsCaseInsensitive() {
        let battery = SignalDiffCategory.category(id: "battery") ?? SignalDiffCategory.all[0]
        XCTAssertTrue(battery.matches("BATTERY_LEVEL"))
        XCTAssertTrue(battery.matches("ChargeState"))
    }

    func testCategoryLookupReturnsNilForUnknownOrNil() {
        XCTAssertNil(SignalDiffCategory.category(id: nil))
        XCTAssertNil(SignalDiffCategory.category(id: "does-not-exist"))
    }
}

// MARK: - Presets (web `DIFF_PRESETS` / `compute()`)

final class SignalDiffPresetTests: XCTestCase {
    func testAllFivePresetsInWebOrder() {
        XCTAssertEqual(
            SignalDiffPreset.all.map(\.id),
            [.nowVs1h, .nowVs1d, .beforeAfterCharge, .lastDrive, .todayVsYesterday]
        )
    }

    func testNowVs1hWindow() {
        let now = SignalCompareTestClock.date(2026, 6, 9, 12, 0)
        let preset = SignalDiffPreset.preset(id: .nowVs1h) ?? SignalDiffPreset.all[0]
        let window = preset.window(now: now)
        XCTAssertEqual(window.atA, now.addingTimeInterval(-3600))
        XCTAssertEqual(window.atB, now)
    }

    func testLastDriveWindowUsesBothOffsets() {
        let now = SignalCompareTestClock.date(2026, 6, 9, 12, 0)
        let preset = SignalDiffPreset.preset(id: .lastDrive) ?? SignalDiffPreset.all[0]
        let window = preset.window(now: now)
        XCTAssertEqual(window.atA, now.addingTimeInterval(-90 * 60))
        XCTAssertEqual(window.atB, now.addingTimeInterval(-5 * 60))
    }
}

// MARK: - Projection

final class SignalCompareProjectionTests: XCTestCase {
    private let utc = SignalCompareTestClock.utc
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testResolvePhaseWithoutComparableSignals() {
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.loading, comparableCount: 0), .loading)
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.loaded, comparableCount: 0), .empty)
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.failed("boom"), comparableCount: 0), .error("boom"))
    }

    func testResolvePhaseWithComparableSignalsAlwaysContent() {
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.loading, comparableCount: 4), .content)
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.loaded, comparableCount: 4), .content)
        XCTAssertEqual(SignalCompareProjection.resolvePhase(.failed("x"), comparableCount: 4), .content)
    }

    func testApplyPresetWritesBothWindowsKeepingSearchAndCategory() {
        let now = SignalCompareTestClock.date(2026, 6, 9, 12, 0)
        let current = SignalCompareSelection(atA: "", atB: "", search: "soc", category: "battery")
        let next = SignalCompareProjection.selection(
            applyingPreset: .nowVs1h, to: current, now: now, timeZone: utc
        )
        XCTAssertEqual(next.atA, "2026-06-09T11:00")
        XCTAssertEqual(next.atB, "2026-06-09T12:00")
        XCTAssertEqual(next.search, "soc")
        XCTAssertEqual(next.category, "battery")
    }

    func testToggledCategory() {
        XCTAssertEqual(SignalCompareProjection.toggledCategory(current: nil, tapped: "battery"), "battery")
        XCTAssertNil(SignalCompareProjection.toggledCategory(current: "battery", tapped: "battery"))
        XCTAssertEqual(SignalCompareProjection.toggledCategory(current: "battery", tapped: "drive"), "drive")
    }

    func testMatchingSignalsBySearchAndCategory() {
        let names = ["battery_level", "charge_state", "vehicle_speed", "cabin_temp"]
        let bySearch = SignalCompareProjection.matchingSignals(
            names, selection: SignalCompareSelection(search: "char")
        )
        XCTAssertEqual(bySearch, ["charge_state"])

        let byCategory = SignalCompareProjection.matchingSignals(
            names, selection: SignalCompareSelection(category: "battery")
        )
        XCTAssertEqual(byCategory, ["battery_level", "charge_state"])

        let both = SignalCompareProjection.matchingSignals(
            names, selection: SignalCompareSelection(search: "level", category: "battery")
        )
        XCTAssertEqual(both, ["battery_level"])

        let unfiltered = SignalCompareProjection.matchingSignals(names, selection: SignalCompareSelection())
        XCTAssertEqual(unfiltered, names)
    }

    func testServerQueryProjectsIsoBoundsAndTrimsSearch() {
        let selection = SignalCompareSelection(
            atA: "2026-06-09T08:30", atB: "2026-06-09T09:45", search: "  soc  ", category: "battery"
        )
        let query = SignalCompareProjection.serverQuery(for: selection, timeZone: utc)
        XCTAssertEqual(query.atAISO, "2026-06-09T08:30:00.000Z")
        XCTAssertEqual(query.atBISO, "2026-06-09T09:45:00.000Z")
        XCTAssertEqual(query.search, "soc")
        XCTAssertEqual(query.category, "battery")
    }

    func testServerQueryEmptyWindowsProjectEmptyIso() {
        let query = SignalCompareProjection.serverQuery(for: SignalCompareSelection(), timeZone: utc)
        XCTAssertEqual(query.atAISO, "")
        XCTAssertEqual(query.atBISO, "")
    }
}

// MARK: - Accessibility

final class SignalCompareAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryWithoutCategory() {
        let summary = SignalCompareAccessibility.summary(availableCount: 8, category: nil, localize: echo)
        XCTAssertEqual(summary, "Compare signals: 8 signals available")
    }

    func testSummaryWithCategory() {
        let battery = SignalDiffCategory.category(id: "battery")
        let summary = SignalCompareAccessibility.summary(availableCount: 3, category: battery, localize: echo)
        XCTAssertEqual(summary, "Compare signals: 3 signals available, filtered by Battery")
    }
}
