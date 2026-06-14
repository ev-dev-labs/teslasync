//
//  WatchSummaryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  Unit coverage for the WatchSummaryWidget surface (adapter + helpers):
//    • Adapter (cached → projection) — `WatchSummaryProjector` value parity with the web widget's
//      pipeline (battery value/text/tone, range/temp conversion + 0-dp formatting, lock, state
//      label/tones, charging, the nil-summary empty projection).
//    • Conversions — distance (km/mi/ft) + temperature (°C/°F) factors ported from unitConversion.ts.
//    • Format helpers — fmtNumber rounding/grouping, cssCapitalize, relative last-seen + em-dash.
//    • Tones — battery bands + the vehicle-state compact/badge tone maps.
//    • Layout — `isCompact` parity with the web `size.cols <= 1`.
//
//  Model / registry / accessibility coverage lives in WatchSummaryWidget.ModelTests.swift (split to
//  stay within the 400-line lint envelope). These run in the TeslaSync(/-macOS) XCTest targets with
//  no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

func watchUTCDate(year: Int, month: Int, day: Int, hour: Int = 12) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = hour
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
}

enum WatchSummaryFixtures {
    static let prefsKmC = WatchSummaryUnitPrefs(distance: .kilometers, temperature: .celsius, localeIdentifier: "en_US")
    static let prefsMiF = WatchSummaryUnitPrefs(distance: .miles, temperature: .fahrenheit, localeIdentifier: "en_US")

    static let online = WatchSummaryDTO(
        state: "online",
        batteryLevel: 82,
        rangeKm: 312,
        isLocked: true,
        insideTempC: 21.5,
        lastUpdated: watchUTCDate(year: 2026, month: 6, day: 7),
        charging: false
    )

    static let charging = WatchSummaryDTO(
        state: "charging",
        batteryLevel: 47,
        rangeKm: 180,
        isLocked: false,
        insideTempC: 19,
        lastUpdated: watchUTCDate(year: 2026, month: 6, day: 7),
        charging: true
    )
}

// MARK: - Adapter: cached summary → projection (port parity with the web widget)

@MainActor final class WatchSummaryAdapterTests: XCTestCase {
    func testProjectionMetricUnits() {
        let projection = WatchSummaryProjector.project(
            summary: WatchSummaryFixtures.online,
            units: WatchSummaryFixtures.prefsKmC,
            now: watchUTCDate(year: 2026, month: 6, day: 7, hour: 13)
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.batteryLevel, 82)
        XCTAssertEqual(projection.batteryValue, 82, accuracy: 1e-9)
        XCTAssertEqual(projection.batteryText, "82")
        XCTAssertEqual(projection.batteryBigText, "82")
        XCTAssertEqual(projection.batteryTone, .good)
        XCTAssertEqual(projection.state?.raw, "online")
        XCTAssertEqual(projection.state?.compactLabel, "Online")
        XCTAssertEqual(projection.state?.compactTone, .success)
        XCTAssertEqual(projection.state?.badgeTone, .success)
        XCTAssertEqual(projection.rangeText, "312")
        XCTAssertEqual(projection.rangeUnit, "km")
        XCTAssertEqual(projection.lock, .locked)
        XCTAssertEqual(projection.cabinText, "22")
        XCTAssertEqual(projection.cabinUnit, "°C")
        XCTAssertFalse(projection.charging)
        XCTAssertNotEqual(projection.lastSeenText, "—")
    }

    func testProjectionImperialUnits() {
        let projection = WatchSummaryProjector.project(
            summary: WatchSummaryFixtures.online,
            units: WatchSummaryFixtures.prefsMiF
        )
        // 312 km → 312000 m / 1609.344 = 193.866… → 0-dp half-up → 194 mi.
        XCTAssertEqual(projection.rangeText, "194")
        XCTAssertEqual(projection.rangeUnit, "mi")
        // 21.5 °C → 70.7 °F → 0-dp half-up → 71.
        XCTAssertEqual(projection.cabinText, "71")
        XCTAssertEqual(projection.cabinUnit, "°F")
    }

    func testProjectionChargingUnlockedWarningBattery() {
        let projection = WatchSummaryProjector.project(
            summary: WatchSummaryFixtures.charging,
            units: WatchSummaryFixtures.prefsKmC
        )
        XCTAssertEqual(projection.batteryText, "47")
        XCTAssertEqual(projection.batteryTone, .warning)
        XCTAssertEqual(projection.state?.compactLabel, "Charging")
        XCTAssertEqual(projection.state?.compactTone, .warning)
        XCTAssertEqual(projection.state?.badgeTone, .warning)
        XCTAssertEqual(projection.lock, .unlocked)
        XCTAssertTrue(projection.charging)
        XCTAssertEqual(projection.rangeText, "180")
        XCTAssertEqual(projection.cabinText, "19")
    }

    func testNilSummaryYieldsEmptyProjection() {
        let projection = WatchSummaryProjector.project(
            summary: nil,
            units: WatchSummaryFixtures.prefsKmC
        )
        XCTAssertFalse(projection.hasData)
        XCTAssertNil(projection.state)
        XCTAssertNil(projection.batteryLevel)
        XCTAssertEqual(projection.batteryValue, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.batteryText, "0")
        XCTAssertEqual(projection.batteryBigText, "—")
        XCTAssertEqual(projection.batteryTone, .unknown)
        XCTAssertNil(projection.rangeDisplay)
        XCTAssertEqual(projection.rangeText, "—")
        XCTAssertNil(projection.cabinDisplay)
        XCTAssertEqual(projection.cabinText, "—")
        XCTAssertEqual(projection.lock, .unknown)
        XCTAssertEqual(projection.lastSeenText, "—")
        XCTAssertFalse(projection.charging)
    }

    func testMissingScalarsFallBackToPlaceholders() { // parity:allow ui
        let summary = WatchSummaryDTO(state: "", batteryLevel: nil, rangeKm: nil, isLocked: nil, insideTempC: nil)
        let projection = WatchSummaryProjector.project(summary: summary, units: WatchSummaryFixtures.prefsKmC)
        XCTAssertTrue(projection.hasData, "an existing (if sparse) summary still renders content, not empty")
        XCTAssertNil(projection.state, "empty state string is treated as no state (web `state &&` guard)")
        XCTAssertEqual(projection.rangeText, "—")
        XCTAssertEqual(projection.cabinText, "—")
        XCTAssertEqual(projection.lock, .unknown)
        XCTAssertEqual(projection.lastSeenText, "—")
    }
}

// MARK: - Conversions (port parity with unitConversion.ts)

@MainActor final class WatchSummaryConversionTests: XCTestCase {
    func testDistanceFactors() {
        XCTAssertEqual(convertWatchDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWatchDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWatchDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWatchDistanceFromSI(.nan, to: .kilometers), 0)
    }

    func testTemperatureFactors() {
        XCTAssertEqual(convertWatchTempFromSI(0, to: .celsius), 0, accuracy: 1e-9)
        XCTAssertEqual(convertWatchTempFromSI(100, to: .celsius), 100, accuracy: 1e-9)
        XCTAssertEqual(convertWatchTempFromSI(0, to: .fahrenheit), 32, accuracy: 1e-9)
        XCTAssertEqual(convertWatchTempFromSI(100, to: .fahrenheit), 212, accuracy: 1e-9)
        XCTAssertEqual(convertWatchTempFromSI(37, to: .fahrenheit), 98.6, accuracy: 1e-9)
        XCTAssertEqual(convertWatchTempFromSI(.nan, to: .fahrenheit), 32, accuracy: 1e-9)
    }
}

// MARK: - Format helpers (port parity with numberFormat.ts + the web TimeStamp)

@MainActor final class WatchSummaryFormatTests: XCTestCase {
    func testNumberRoundsHalfAwayFromZeroAndGroups() {
        XCTAssertEqual(WatchSummaryFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(WatchSummaryFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(WatchSummaryFormat.number(21.5, decimals: 0), "22")
        XCTAssertEqual(WatchSummaryFormat.number(193.866, decimals: 0), "194")
        XCTAssertEqual(WatchSummaryFormat.number(.infinity, decimals: 0), "0")
    }

    func testIntegerFormatting() {
        XCTAssertEqual(WatchSummaryFormat.integer(82), "82")
        XCTAssertEqual(WatchSummaryFormat.integer(0), "0")
    }

    func testCSSCapitalize() {
        XCTAssertEqual(WatchSummaryFormat.cssCapitalize("online"), "Online")
        XCTAssertEqual(WatchSummaryFormat.cssCapitalize("Online"), "Online")
        XCTAssertEqual(WatchSummaryFormat.cssCapitalize("asleep"), "Asleep")
        XCTAssertEqual(WatchSummaryFormat.cssCapitalize(""), "")
    }

    func testRelativeLastSeen() {
        XCTAssertEqual(WatchSummaryFormat.relativeLastSeen(nil), "—")
        let now = watchUTCDate(year: 2026, month: 6, day: 7, hour: 13)
        let past = now.addingTimeInterval(-120)
        let text = WatchSummaryFormat.relativeLastSeen(past, now: now)
        XCTAssertNotEqual(text, "—")
        XCTAssertFalse(text.isEmpty)
    }
}

// MARK: - Tones (battery bands + vehicle-state maps)

@MainActor final class WatchSummaryToneTests: XCTestCase {
    func testBatteryToneBands() {
        XCTAssertEqual(WatchBatteryTone.forLevel(nil), .unknown)
        XCTAssertEqual(WatchBatteryTone.forLevel(.nan), .unknown)
        XCTAssertEqual(WatchBatteryTone.forLevel(51), .good)
        XCTAssertEqual(WatchBatteryTone.forLevel(50), .warning)
        XCTAssertEqual(WatchBatteryTone.forLevel(21), .warning)
        XCTAssertEqual(WatchBatteryTone.forLevel(20), .critical)
        XCTAssertEqual(WatchBatteryTone.forLevel(0), .critical)
    }

    func testCompactStateToneMap() {
        XCTAssertEqual(WatchStateView.compactTone(for: "online"), .success)
        XCTAssertEqual(WatchStateView.compactTone(for: "driving"), .info)
        XCTAssertEqual(WatchStateView.compactTone(for: "charging"), .warning)
        XCTAssertEqual(WatchStateView.compactTone(for: "parked"), .info)
        XCTAssertEqual(WatchStateView.compactTone(for: "updating"), .info)
        XCTAssertEqual(WatchStateView.compactTone(for: "asleep"), .neutral)
        XCTAssertEqual(WatchStateView.compactTone(for: "offline"), .danger)
        XCTAssertEqual(WatchStateView.compactTone(for: "mystery"), .neutral)
    }

    func testBadgeStateToneMap() {
        XCTAssertEqual(WatchStateView.badgeTone(for: "online"), .success)
        XCTAssertEqual(WatchStateView.badgeTone(for: "asleep"), .neutral)
        for other in ["driving", "charging", "parked", "updating", "offline", "mystery"] {
            XCTAssertEqual(WatchStateView.badgeTone(for: other), .warning, "\(other) → warning")
        }
    }

    func testStateMakeGuards() {
        XCTAssertNil(WatchStateView.make(from: nil))
        XCTAssertNil(WatchStateView.make(from: ""))
        XCTAssertEqual(WatchStateView.make(from: "online")?.raw, "online")
    }

    func testLockStateFrom() {
        XCTAssertEqual(WatchLockState.from(true), .locked)
        XCTAssertEqual(WatchLockState.from(false), .unlocked)
        XCTAssertEqual(WatchLockState.from(nil), .unknown)
    }
}

// MARK: - Layout (web `size` → isCompact)

@MainActor final class WatchSummaryLayoutTests: XCTestCase {
    func testIsCompactMatrix() {
        XCTAssertTrue(WatchSummaryLayout.isCompact(cols: 0))
        XCTAssertTrue(WatchSummaryLayout.isCompact(cols: 1))
        XCTAssertFalse(WatchSummaryLayout.isCompact(cols: 2))
        XCTAssertFalse(WatchSummaryLayout.isCompact(cols: 4))
    }
}
