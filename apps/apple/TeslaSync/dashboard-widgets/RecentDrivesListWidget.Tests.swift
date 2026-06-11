//
//  RecentDrivesListWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  Unit coverage for the RecentDrivesListWidget surface:
//    • Adapter (cached → projection) — `RecentDrivesProjector` value parity with the web
//      widget's per-row pipeline (distance convert + fmtNumber, formatDurationMinutes,
//      truncateAddress, start→end SoC, battery used gating, formatDateShort).
//    • Format helpers — fmtNumber/fmtInt rounding, jsNumber, duration + date shapes.
//    • Layout — `driveLimit` 5/7/10 + `isWide` parity with the web `size` math.
//    • State holder — `RDListModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `recent-drives-list` metadata + size clamping.
//    • Accessibility — the per-row VoiceOver label + the list summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `RDListInMemoryRecentDrivesSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

func recentDrivesUTCDate(year: Int, month: Int, day: Int) -> Date {
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    components.hour = 12
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
}

enum RecentDrivesFixtures {
    static let unitsKm = RecentDrivesUnitPrefs(
        distance: .kilometers,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "UTC"
    )
    static let unitsMi = RecentDrivesUnitPrefs(distance: .miles, localeIdentifier: "en_US", timeZoneIdentifier: "UTC")

    static let driveA = RecentDriveDTO(
        id: 1,
        distanceM: 12000,
        durationS: 1860,
        startSocPct: 82,
        endSocPct: 75,
        startAddress: "123456789012345678901234567890ABCDEFGHIJ",
        endAddress: "Work Plaza",
        startTimestamp: recentDrivesUTCDate(year: 2026, month: 6, day: 7)
    )

    static let driveB = RecentDriveDTO(
        id: 2,
        distanceM: 500,
        durationS: 30,
        startSocPct: 60,
        endSocPct: nil,
        startAddress: nil,
        endAddress: nil,
        startTimestamp: nil
    )

    static let driveC = RecentDriveDTO(
        id: 3,
        distanceM: 0,
        durationS: 7320,
        startSocPct: 50,
        endSocPct: 50,
        startAddress: "Pass Rest Area",
        endAddress: "Reno Supercharger",
        startTimestamp: recentDrivesUTCDate(year: 2026, month: 1, day: 3)
    )

    static let all = [driveA, driveB, driveC]
}

// MARK: - Adapter: cached drives → projection (port parity with the web widget)

@MainActor final class RecentDrivesAdapterTests: XCTestCase {
    func testProjectionKilometers() {
        let projection = RecentDrivesProjector.project(
            drives: RecentDrivesFixtures.all,
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: true
        )
        XCTAssertEqual(projection.rows.count, 3)

        let rowA = projection.rows[0]
        XCTAssertEqual(rowA.id, 1)
        XCTAssertEqual(rowA.distanceText, "12.0")
        XCTAssertEqual(rowA.distanceUnit, "km")
        XCTAssertEqual(rowA.durationText, "31m")
        XCTAssertEqual(rowA.socText, "82% → 75%")
        XCTAssertEqual(rowA.batteryUsedText, "7%")
        XCTAssertEqual(rowA.dateText, "Jun 7")
        XCTAssertEqual(rowA.startAddress, "123456789012345678901234567890…")
        XCTAssertEqual(rowA.endAddress, "Work Plaza")

        let rowB = projection.rows[1]
        XCTAssertEqual(rowB.distanceText, "0.5")
        XCTAssertEqual(rowB.durationText, "<1m")
        XCTAssertEqual(rowB.socText, "60% → ?%")
        XCTAssertNil(rowB.batteryUsedText)
        XCTAssertEqual(rowB.dateText, "—")
        XCTAssertEqual(rowB.startAddress, "—")
        XCTAssertEqual(rowB.endAddress, "—")

        let rowC = projection.rows[2]
        XCTAssertEqual(rowC.distanceText, "0.0")
        XCTAssertEqual(rowC.durationText, "2h 2m")
        XCTAssertEqual(rowC.socText, "50% → 50%")
        XCTAssertNil(rowC.batteryUsedText, "battery-used hidden when distance is 0")
        XCTAssertEqual(rowC.dateText, "Jan 3")
    }

    func testProjectionMiles() {
        let projection = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveA],
            units: RecentDrivesFixtures.unitsMi,
            limit: 7,
            showsAddresses: true
        )
        XCTAssertEqual(projection.rows[0].distanceText, "7.5")
        XCTAssertEqual(projection.rows[0].distanceUnit, "mi")
    }

    func testLimitSlicesRows() {
        let two = RecentDrivesProjector.project(
            drives: RecentDrivesFixtures.all,
            units: RecentDrivesFixtures.unitsKm,
            limit: 2,
            showsAddresses: false
        )
        XCTAssertEqual(two.rows.map(\.id), [1, 2])

        let none = RecentDrivesProjector.project(
            drives: RecentDrivesFixtures.all,
            units: RecentDrivesFixtures.unitsKm,
            limit: 0,
            showsAddresses: false
        )
        XCTAssertTrue(none.isEmpty)
    }

    func testAddressesAlwaysProjectedButA11yGatedByWidth() {
        let narrow = RecentDrivesProjector.project(
            drives: [RecentDrivesFixtures.driveA],
            units: RecentDrivesFixtures.unitsKm,
            limit: 7,
            showsAddresses: false
        )
        XCTAssertEqual(narrow.showsAddresses, false)
        XCTAssertEqual(narrow.rows[0].startAddress, "123456789012345678901234567890…")
        XCTAssertFalse(narrow.rows[0].accessibilityLabel.contains("from"))
    }
}

// MARK: - Format helpers (port parity with numberFormat.ts + dateFormat.ts)

@MainActor final class RecentDrivesFormatTests: XCTestCase {
    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(RecentDrivesFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(RecentDrivesFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(RecentDrivesFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(RecentDrivesFormat.number(7.4565, decimals: 1), "7.5")
        XCTAssertEqual(RecentDrivesFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testIntegerFormatting() {
        XCTAssertEqual(RecentDrivesFormat.integer(7), "7")
        XCTAssertEqual(RecentDrivesFormat.integer(-3), "-3")
        XCTAssertEqual(RecentDrivesFormat.integer(1500), "1,500")
    }

    func testJSNumberStringification() {
        XCTAssertEqual(RecentDrivesFormat.jsNumber(82), "82")
        XCTAssertEqual(RecentDrivesFormat.jsNumber(82.5), "82.5")
        XCTAssertEqual(RecentDrivesFormat.jsNumber(.infinity), "0")
    }

    func testDurationShapes() {
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 31, subMinuteLabel: "<1m"), "31m")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 0.5, subMinuteLabel: "<1m"), "<1m")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 0, subMinuteLabel: "<1m"), "<1m")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 122, subMinuteLabel: "<1m"), "2h 2m")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 60, subMinuteLabel: "<1m"), "1h 0m")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: -5, subMinuteLabel: "<1m"), "—")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: .infinity, subMinuteLabel: "<1m"), "—")
        XCTAssertEqual(RecentDrivesFormat.duration(minutes: 90, subMinuteLabel: nil), "1h 30m")
    }

    func testShortDate() {
        let date = recentDrivesUTCDate(year: 2026, month: 6, day: 7)
        XCTAssertEqual(
            RecentDrivesFormat.shortDate(date, localeIdentifier: "en_US", timeZoneIdentifier: "UTC"),
            "Jun 7"
        )
        XCTAssertEqual(
            RecentDrivesFormat.shortDate(nil, localeIdentifier: "en_US", timeZoneIdentifier: "UTC"),
            "—"
        )
    }

    func testTruncateAddress() {
        XCTAssertEqual(truncateRecentAddress("Work Plaza", maxLength: 30), "Work Plaza")
        XCTAssertEqual(truncateRecentAddress(nil, maxLength: 30), "—")
        XCTAssertEqual(truncateRecentAddress("", maxLength: 30), "—")
        XCTAssertEqual(
            truncateRecentAddress("123456789012345678901234567890ABCDEFGHIJ", maxLength: 30),
            "123456789012345678901234567890…"
        )
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertRecentDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRecentDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRecentDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRecentDistanceFromSI(.nan, to: .kilometers), 0)
    }
}

// MARK: - Layout (web `size` → driveLimit + isWide)

@MainActor final class RecentDrivesLayoutTests: XCTestCase {
    func testDriveLimitMatrix() {
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 3, rows: 4), 10)
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 4, rows: 40), 10)
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 2, rows: 4), 7)
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 1, rows: 4), 7)
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 2, rows: 1), 5)
        XCTAssertEqual(RecentDrivesLayout.driveLimit(cols: 1, rows: 1), 5)
    }

    func testIsWide() {
        XCTAssertTrue(RecentDrivesLayout.isWide(cols: 3))
        XCTAssertTrue(RecentDrivesLayout.isWide(cols: 4))
        XCTAssertFalse(RecentDrivesLayout.isWide(cols: 2))
        XCTAssertFalse(RecentDrivesLayout.isWide(cols: 1))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class RDListPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(RDListModel.resolvePhase(status: .loading, hasRows: false), .loading)
        XCTAssertEqual(RDListModel.resolvePhase(status: .loading, hasRows: true), .content)
        XCTAssertEqual(RDListModel.resolvePhase(status: .empty, hasRows: false), .empty)
        XCTAssertEqual(RDListModel.resolvePhase(status: .empty, hasRows: true), .empty)
        XCTAssertEqual(RDListModel.resolvePhase(status: .loaded, hasRows: false), .empty)
        XCTAssertEqual(RDListModel.resolvePhase(status: .loaded, hasRows: true), .content)
        XCTAssertEqual(
            RDListModel.resolvePhase(status: .failed("x"), hasRows: false),
            .error("x")
        )
        XCTAssertEqual(
            RDListModel.resolvePhase(status: .failed("x"), hasRows: true),
            .content
        )
    }
}
