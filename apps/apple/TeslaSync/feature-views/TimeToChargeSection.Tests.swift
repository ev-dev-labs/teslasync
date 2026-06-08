//
//  TimeToChargeSection.Tests.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  Adapter (sessions → metrics) coverage: the duration / average / energy / number
//  formatting ports, the DC classification, the 10→80 / 20→80 band averages, the
//  fastest/slowest charge-rate reduction (with the web's later-wins tie-break),
//  the per-year trend grouping/rounding, and the four-card wiring. The lifecycle
//  resolver, layout, accessibility, telemetry, and model wiring are covered in
//  `TimeToChargeSection.StateTests.swift`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store;
//  the locale is injected for deterministic number formatting.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used by both test files)

let timeToChargeEnUS = Locale(identifier: "en_US")

enum TimeToChargeFixture {
    /// DC, crosses 10→80 and 20→80; 30 min; 30 kWh → 60 kWh/h; year 2026.
    static let sessionA = TimeToChargeSectionChargingSessionSummary(
        id: 301, startedAt: "2026-01-10T08:00:00Z", endedAt: "2026-01-10T08:30:00Z",
        startSocPct: 8, endSocPct: 82, totalEnergyAddedWh: 30000,
        peakPowerW: 120_000, chargerType: "Tesla"
    )

    /// DC, crosses 20→80 only (start 18 > 10); 60 min; 60 kWh → 60 kWh/h; 2026.
    static let sessionB = TimeToChargeSectionChargingSessionSummary(
        id: 302, startedAt: "2026-01-20T09:00:00Z", endedAt: "2026-01-20T10:00:00Z",
        startSocPct: 18, endSocPct: 88, totalEnergyAddedWh: 60000,
        peakPowerW: 100_000, chargerType: "CCS"
    )

    /// DC, crosses both bands; 20 min; 40 kWh → 120 kWh/h (fastest); year 2025.
    static let sessionC = TimeToChargeSectionChargingSessionSummary(
        id: 303, startedAt: "2025-12-05T22:00:00Z", endedAt: "2025-12-05T22:20:00Z",
        startSocPct: 5, endSocPct: 90, totalEnergyAddedWh: 40000,
        peakPowerW: 150_000, chargerType: "Tesla"
    )

    /// AC / home — excluded from DC analysis (no charger type, 7 kW peak).
    static let sessionD = TimeToChargeSectionChargingSessionSummary(
        id: 304, startedAt: "2026-03-01T19:00:00Z", endedAt: "2026-03-01T23:00:00Z",
        startSocPct: 40, endSocPct: 80, totalEnergyAddedWh: 11000,
        peakPowerW: 7000, chargerType: nil
    )

    static let all = [sessionA, sessionB, sessionC, sessionD]
}

// MARK: - Formatting (ports of helpers.ts / numberFormat.ts / unitConversion.ts)

@MainActor final class TimeToChargeFormatTests: XCTestCase {
    func testDurationMinutesValid() {
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(
                startedAt: "2026-01-10T08:00:00Z", endedAt: "2026-01-10T08:35:00Z"
            ),
            35
        )
    }

    func testDurationMinutesNilEndIsZero() {
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(startedAt: "2026-01-10T08:00:00Z", endedAt: nil),
            0
        )
    }

    func testDurationMinutesEndNotAfterStartIsZero() {
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(
                startedAt: "2026-01-10T08:00:00Z", endedAt: "2026-01-10T08:00:00Z"
            ),
            0
        )
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(
                startedAt: "2026-01-10T09:00:00Z", endedAt: "2026-01-10T08:00:00Z"
            ),
            0
        )
    }

    func testDurationMinutesUnparseableIsZero() {
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(startedAt: "nope", endedAt: "also-nope"),
            0
        )
    }

    func testDurationMinutesFractionalSecondsParse() {
        XCTAssertEqual(
            TimeToChargeFormat.durationMinutes(
                startedAt: "2026-01-10T08:00:00.250Z", endedAt: "2026-01-10T08:30:00.250Z"
            ),
            30
        )
    }

    func testAverage() {
        XCTAssertEqual(TimeToChargeFormat.average([]), 0)
        XCTAssertEqual(TimeToChargeFormat.average([30, 20]), 25)
        XCTAssertEqual(TimeToChargeFormat.average([30, 60, 20]), 110.0 / 3.0, accuracy: 1e-9)
    }

    func testKilowattHoursFromWh() {
        XCTAssertEqual(TimeToChargeFormat.kilowattHours(fromWh: 42000), 42)
        XCTAssertEqual(TimeToChargeFormat.kilowattHours(fromWh: 0), 0)
    }

    func testNumberFormatting() {
        XCTAssertEqual(TimeToChargeFormat.number(25, locale: timeToChargeEnUS), "25.00")
        XCTAssertEqual(TimeToChargeFormat.number(36.6667, locale: timeToChargeEnUS), "36.67")
        XCTAssertEqual(TimeToChargeFormat.number(1234.5, locale: timeToChargeEnUS), "1,234.50")
    }

    func testNumberNonFiniteCoercesToZero() {
        XCTAssertEqual(TimeToChargeFormat.number(.nan, locale: timeToChargeEnUS), "0.00")
        XCTAssertEqual(TimeToChargeFormat.number(.infinity, locale: timeToChargeEnUS), "0.00")
    }

    func testRoundToTenth() {
        XCTAssertEqual(TimeToChargeFormat.roundToTenth(45), 45)
        XCTAssertEqual(TimeToChargeFormat.roundToTenth(36.666), 36.7, accuracy: 1e-9)
        XCTAssertEqual(TimeToChargeFormat.roundToTenth(20.04), 20.0, accuracy: 1e-9)
    }
}

// MARK: - DC classification (web isDcSession)

@MainActor final class TimeToChargeDcClassificationTests: XCTestCase {
    func testChargerTypePresentIsDc() {
        XCTAssertTrue(TimeToChargeProjection.isDcSession(TimeToChargeFixture.sessionB))
    }

    func testHighPeakPowerIsDc() {
        let session = TimeToChargeSectionChargingSessionSummary(
            id: 1, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:30:00Z",
            startSocPct: 10, endSocPct: 80, totalEnergyAddedWh: 20000,
            peakPowerW: 50000, chargerType: nil
        )
        XCTAssertTrue(TimeToChargeProjection.isDcSession(session))
    }

    func testEmptyChargerTypeAndLowPowerIsNotDc() {
        XCTAssertFalse(TimeToChargeProjection.isDcSession(TimeToChargeFixture.sessionD))
        let emptyType = TimeToChargeSectionChargingSessionSummary(
            id: 2, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:30:00Z",
            startSocPct: 10, endSocPct: 80, totalEnergyAddedWh: 1000,
            peakPowerW: 20000, chargerType: ""
        )
        XCTAssertFalse(TimeToChargeProjection.isDcSession(emptyType))
    }
}

// MARK: - Metrics projection (web useMemo)

@MainActor final class TimeToChargeMetricsTests: XCTestCase {
    func testEmptyWhenNoSessions() {
        XCTAssertEqual(TimeToChargeProjection.metrics(from: []), .empty)
    }

    func testEmptyWhenNoDcSessions() {
        XCTAssertEqual(TimeToChargeProjection.metrics(from: [TimeToChargeFixture.sessionD]), .empty)
    }

    func testBandAverages() throws {
        let metrics = TimeToChargeProjection.metrics(from: TimeToChargeFixture.all)
        // cross10to80 = {A(30), C(20)} → 25; cross20to80 = {A(30), B(60), C(20)} → 36.67
        XCTAssertEqual(try XCTUnwrap(metrics.avg10to80), 25, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(metrics.avg20to80), 110.0 / 3.0, accuracy: 1e-9)
    }

    func testBandAverageNilWhenNoneCross() throws {
        // Only B crosses 20→80; none cross 10→80 → avg10to80 is nil.
        let metrics = TimeToChargeProjection.metrics(from: [TimeToChargeFixture.sessionB])
        XCTAssertNil(metrics.avg10to80)
        XCTAssertEqual(try XCTUnwrap(metrics.avg20to80), 60, accuracy: 1e-9)
    }

    func testFastestAndSlowestWithTieBreak() throws {
        let metrics = TimeToChargeProjection.metrics(from: TimeToChargeFixture.all)
        // rates: A=60, B=60, C=120. fastest = C(120).
        XCTAssertEqual(try XCTUnwrap(metrics.fastest).id, 303)
        XCTAssertEqual(try XCTUnwrap(metrics.fastest).rate, 120, accuracy: 1e-9)
        // slowest: left-fold keeps the later element on the 60-vs-60 tie → B(302).
        XCTAssertEqual(try XCTUnwrap(metrics.slowest).id, 302)
        XCTAssertEqual(try XCTUnwrap(metrics.slowest).rate, 60, accuracy: 1e-9)
    }

    func testZeroDurationOrZeroEnergyExcludedFromRates() {
        let noEnd = TimeToChargeSectionChargingSessionSummary(
            id: 9, startedAt: "2026-01-01T00:00:00Z", endedAt: nil,
            startSocPct: 5, endSocPct: 90, totalEnergyAddedWh: 50000,
            peakPowerW: 120_000, chargerType: "Tesla"
        )
        let zeroEnergy = TimeToChargeSectionChargingSessionSummary(
            id: 10, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:30:00Z",
            startSocPct: 5, endSocPct: 90, totalEnergyAddedWh: 0,
            peakPowerW: 120_000, chargerType: "Tesla"
        )
        let metrics = TimeToChargeProjection.metrics(from: [noEnd, zeroEnergy])
        XCTAssertNil(metrics.fastest)
        XCTAssertNil(metrics.slowest)
    }

    func testYearlyTrendGroupsSortsAndRounds() {
        let trend = TimeToChargeProjection.metrics(from: TimeToChargeFixture.all).yearlyTrend
        XCTAssertEqual(trend.map(\.year), ["2025", "2026"])

        let y2025 = trend[0]
        XCTAssertEqual(y2025.count, 1) // session C
        XCTAssertEqual(y2025.avg10to80, 20, accuracy: 1e-9)
        XCTAssertEqual(y2025.avg20to80, 20, accuracy: 1e-9)

        let y2026 = trend[1]
        XCTAssertEqual(y2026.count, 2) // sessions A, B
        XCTAssertEqual(y2026.avg10to80, 30, accuracy: 1e-9) // only A crosses 10→80
        XCTAssertEqual(y2026.avg20to80, 45, accuracy: 1e-9) // A(30), B(60) → 45
    }
}

// MARK: - Cards

@MainActor final class TimeToChargeCardsTests: XCTestCase {
    func testBuildsFourCardsWithWiring() {
        let metrics = TimeToChargeProjection.metrics(from: TimeToChargeFixture.all)
        let cards = TimeToChargeCards.make(from: metrics, locale: timeToChargeEnUS)
        XCTAssertEqual(cards.map(\.id), ["avg10to80", "avg20to80", "fastest", "slowest"])

        XCTAssertEqual(cards[0].value, "25.00")
        XCTAssertEqual(cards[0].unitFallback, "min")
        XCTAssertEqual(cards[0].labelFallback, "10% → 80%")
        XCTAssertEqual(cards[0].subtitleFallback, "Avg duration")
        XCTAssertNil(cards[0].subtitleSessionID)

        XCTAssertEqual(cards[1].value, "36.67")

        XCTAssertEqual(cards[2].value, "120.00")
        XCTAssertEqual(cards[2].unitFallback, "kWh/h")
        XCTAssertEqual(cards[2].subtitleSessionID, 303)

        XCTAssertEqual(cards[3].value, "60.00")
        XCTAssertEqual(cards[3].subtitleSessionID, 302)
    }

    func testNilFiguresProduceEmDashValueAndNoSubtitle() {
        let cards = TimeToChargeCards.make(from: .empty, locale: timeToChargeEnUS)
        XCTAssertTrue(cards.allSatisfy { $0.value == nil })
        // Duration cards keep their "Avg duration" subtitle; rate cards drop theirs.
        XCTAssertNotNil(cards[0].subtitleKey)
        XCTAssertNil(cards[2].subtitleKey)
        XCTAssertNil(cards[3].subtitleKey)
    }

    func testSubtitleInterpolatesSessionID() {
        let metrics = TimeToChargeProjection.metrics(from: TimeToChargeFixture.all)
        let cards = TimeToChargeCards.make(from: metrics, locale: timeToChargeEnUS)
        XCTAssertEqual(TimeToChargeStrings.cardSubtitle(cards[2]), "Session #303")
        XCTAssertEqual(TimeToChargeStrings.cardSubtitle(cards[0]), "Avg duration")
    }
}
