//
//  SummaryStatsRow.Tests.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  Unit coverage for the SummaryStatsRow surface:
//    • Adapter — `timeSince` relative-time bucketing (helpers.ts) across every
//      branch, the `fmtInt` / percent / count number formatting (numberFormat.ts),
//      the responsive column math, and the i18n relative-time wording.
//    • State holder — `SummaryStatsProjection` across the loading / data branches and
//      each tile's label / value / accent / symbol, plus the `SummaryStatsModel`
//      wiring and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySummaryStatsSource`, and the clock /
//  locale are injected for determinism.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private func iso(_ string: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: string) ?? Date(timeIntervalSince1970: 0)
}

private let referenceNow = iso("2026-01-05T15:04:05Z")
private let enUS = Locale(identifier: "en_US")

// MARK: - Relative time (port of helpers.ts timeSince)

final class SummaryStatsRelativeTimeTests: XCTestCase {
    func testNilAndEmptyReturnNone() {
        XCTAssertEqual(SummaryStatsFormat.relativeTime(nil, now: referenceNow), .none)
        XCTAssertEqual(SummaryStatsFormat.relativeTime("", now: referenceNow), .none)
    }

    func testUnparseableReturnsNone() {
        XCTAssertEqual(SummaryStatsFormat.relativeTime("not-a-date", now: referenceNow), .none)
    }

    func testFutureTimestampReturnsNone() {
        XCTAssertEqual(SummaryStatsFormat.relativeTime("2026-01-05T15:10:00Z", now: referenceNow), .none)
    }

    func testUnderOneMinuteIsJustNow() {
        // 10 seconds before now.
        XCTAssertEqual(SummaryStatsFormat.relativeTime("2026-01-05T15:03:55Z", now: referenceNow), .justNow)
    }

    func testMinutesBucketFloors() {
        // 90 seconds before now → 1 minute.
        XCTAssertEqual(SummaryStatsFormat.relativeTime("2026-01-05T15:02:35Z", now: referenceNow), .minutes(1))
    }

    func testHoursBucketFloors() {
        // 2 hours before now.
        XCTAssertEqual(SummaryStatsFormat.relativeTime("2026-01-05T13:04:05Z", now: referenceNow), .hours(2))
    }

    func testDaysBucketFloors() {
        // 3 days before now.
        XCTAssertEqual(SummaryStatsFormat.relativeTime("2026-01-02T15:04:05Z", now: referenceNow), .days(3))
    }

    func testFractionalSecondsTimestampParses() {
        // 2h 4m before now, with fractional seconds → still the 2-hour bucket.
        XCTAssertEqual(
            SummaryStatsFormat.relativeTime("2026-01-05T13:00:00.500Z", now: referenceNow),
            .hours(2)
        )
    }
}

// MARK: - Number formatting (port of numberFormat.ts fmtInt)

final class SummaryStatsNumberTests: XCTestCase {
    func testIntegerRoundsAndGroups() {
        XCTAssertEqual(SummaryStatsFormat.integer(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(SummaryStatsFormat.integer(1000, locale: enUS), "1,000")
        XCTAssertEqual(SummaryStatsFormat.integer(99, locale: enUS), "99")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(SummaryStatsFormat.integer(.nan, locale: enUS), "0")
        XCTAssertEqual(SummaryStatsFormat.integer(.infinity, locale: enUS), "0")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(SummaryStatsFormat.percent(87, locale: enUS), "87%")
        XCTAssertEqual(SummaryStatsFormat.percent(99.4, locale: enUS), "99%")
    }

    func testCountIsRawIntegerWithoutGrouping() {
        // Web renders value={totalEvents} (no separators).
        XCTAssertEqual(SummaryStatsFormat.count(1284), "1284")
        XCTAssertEqual(SummaryStatsFormat.count(0), "0")
    }
}

// MARK: - Responsive column math (web grid-cols-1 / sm:2 / lg:4)

final class SummaryStatsLayoutTests: XCTestCase {
    func testColumnsAtBreakpoints() {
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 320), 1)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 639), 1)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 640), 2)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 900), 2)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 1023), 2)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 1024), 4)
        XCTAssertEqual(SummaryStatsLayout.columnCount(forWidth: 1440), 4)
    }
}

// MARK: - Projection: branches + tile wiring

final class SummaryStatsProjectionTests: XCTestCase {
    func testLoadingBranchHasNoTiles() {
        let resolved = SummaryStatsProjection.resolve(
            SummaryStatsInput(isLoading: true), now: referenceNow, locale: enUS
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.tiles.isEmpty)
    }

    func testDataBranchBuildsFourTiles() {
        let resolved = SummaryStatsProjection.resolve(
            SummaryStatsInput(
                isSecure: true,
                lastLockChange: "2026-01-05T13:04:05Z",
                sentryUptime: 99,
                totalEvents: 1284
            ),
            now: referenceNow,
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tiles.count, 4)

        XCTAssertEqual(resolved.tiles[0].id, "status")
        XCTAssertEqual(resolved.tiles[0].value, .secure(true))
        XCTAssertEqual(resolved.tiles[0].accent, .secure)
        XCTAssertEqual(resolved.tiles[0].symbol, "checkmark.shield.fill")

        XCTAssertEqual(resolved.tiles[1].id, "lastLock")
        XCTAssertEqual(resolved.tiles[1].value, .relative(.hours(2)))
        XCTAssertEqual(resolved.tiles[1].accent, .lastLock)

        XCTAssertEqual(resolved.tiles[2].id, "sentryUptime")
        XCTAssertEqual(resolved.tiles[2].value, .text("99%"))
        XCTAssertEqual(resolved.tiles[2].accent, .uptime)

        XCTAssertEqual(resolved.tiles[3].id, "totalEvents")
        XCTAssertEqual(resolved.tiles[3].value, .text("1284"))
        XCTAssertEqual(resolved.tiles[3].accent, .events)
    }

    func testUnsecureFlipsStatusTile() {
        let resolved = SummaryStatsProjection.resolve(
            SummaryStatsInput(isSecure: false), now: referenceNow, locale: enUS
        )
        XCTAssertEqual(resolved.tiles[0].value, .secure(false))
        XCTAssertEqual(resolved.tiles[0].accent, .unsecure)
    }

    func testMissingLastLockResolvesToNone() {
        let resolved = SummaryStatsProjection.resolve(
            SummaryStatsInput(isSecure: true, lastLockChange: nil), now: referenceNow, locale: enUS
        )
        XCTAssertEqual(resolved.tiles[1].value, .relative(.none))
    }
}

// MARK: - i18n wording (web timeSince literals routed through the facade)

final class SummaryStatsStringsTests: XCTestCase {
    func testRelativeTimeWording() {
        XCTAssertEqual(SSRStrings.relativeTime(.none), "—")
        XCTAssertEqual(SSRStrings.relativeTime(.justNow), "just now")
        XCTAssertEqual(SSRStrings.relativeTime(.minutes(5)), "5m ago")
        XCTAssertEqual(SSRStrings.relativeTime(.hours(3)), "3h ago")
        XCTAssertEqual(SSRStrings.relativeTime(.days(12)), "12d ago")
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor
final class SummaryStatsModelTests: XCTestCase {
    private func makeModel(
        _ input: SummaryStatsInput,
        telemetry: SummaryStatsTelemetry = OSLogSummaryStatsTelemetry()
    ) -> (SummaryStatsModel, InMemorySummaryStatsSource) {
        let source = InMemorySummaryStatsSource(initial: input)
        let model = SummaryStatsModel(
            source: source, telemetry: telemetry, locale: enUS, clock: { referenceNow }
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySummaryStatsTelemetry()
        let (model, source) = makeModel(
            SummaryStatsInput(isSecure: true, sentryUptime: 95, totalEvents: 7),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.tiles.count, 4)
        XCTAssertEqual(spy.surfaces, [SummaryStatsRow.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(SummaryStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.tiles.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SummaryStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SummaryStatsInput(isSecure: false, sentryUptime: 80, totalEvents: 3))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.tiles[0].value, .secure(false))
        XCTAssertEqual(model.tiles[2].value, .text("80%"))
    }

    func testStopDelegatesToSourceAndResetsStarted() {
        let (model, source) = makeModel(SummaryStatsInput(isSecure: true))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        // After stop, start re-arms (telemetry + source.start fire again).
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Accessibility summary content

final class SummaryStatsAccessibilityTests: XCTestCase {
    func testTileLabelCombinesLabelAndValue() {
        XCTAssertEqual(
            SummaryStatsAccessibility.tileLabel(label: "Sentry Uptime", value: "99%"),
            "Sentry Uptime, 99%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySummaryStatsTelemetry: SummaryStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
