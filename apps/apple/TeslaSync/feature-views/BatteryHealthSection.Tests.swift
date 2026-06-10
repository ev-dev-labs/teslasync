//
//  BatteryHealthSection.Tests.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  Unit coverage for the BatteryHealthSection surface:
//    • Adapter — fmtNumber / fmtInt ports, Math.round, the battery colour-band
//      ladder, the pill projection (rounded level + clamped bar fraction), and the
//      three mini-stat expressions (charge gain / sessions / est. range added).
//    • State holder — `BatteryHealthProjection` phase resolution across loading /
//      error / empty / data plus the stale / offline overlays, the `BatteryHealthModel`
//      wiring, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile-summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryBatteryHealthSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Number formatting (port of web fmtNumber / fmtInt)

@MainActor final class BatteryHealthNumberFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")

    func testDefaultPrecisionIsTwoDecimals() {
        XCTAssertEqual(BatteryHealthNumberFormat.format(1, locale: enUS), "1.00")
        XCTAssertEqual(BatteryHealthNumberFormat.format(350, locale: enUS), "350.00")
    }

    func testGroupingSeparatorApplied() {
        XCTAssertEqual(BatteryHealthNumberFormat.format(1234.5, locale: enUS), "1,234.50")
    }

    func testDecimalsOverride() {
        XCTAssertEqual(BatteryHealthNumberFormat.format(36.5, decimals: 1, locale: enUS), "36.5")
        XCTAssertEqual(BatteryHealthNumberFormat.format(783.75, decimals: 0, locale: enUS), "784")
    }

    func testIntDropsFraction() {
        XCTAssertEqual(BatteryHealthNumberFormat.int(5, locale: enUS), "5")
        XCTAssertEqual(BatteryHealthNumberFormat.int(1234, locale: enUS), "1,234")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(BatteryHealthNumberFormat.format(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(BatteryHealthNumberFormat.format(.nan, locale: enUS), "0.00")
    }

    func testRoundedLevelMatchesMathRound() {
        XCTAssertEqual(BatteryHealthNumberFormat.roundedLevel(42.4), 42)
        XCTAssertEqual(BatteryHealthNumberFormat.roundedLevel(78.9), 79)
        XCTAssertEqual(BatteryHealthNumberFormat.roundedLevel(42.5), 43)
        XCTAssertEqual(BatteryHealthNumberFormat.roundedLevel(0), 0)
        XCTAssertEqual(BatteryHealthNumberFormat.roundedLevel(.nan), 0)
    }
}

// MARK: - Battery colour band (web STATUS_COLORS ladder)

@MainActor final class BatteryBandTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(BatteryBand.forLevel(100), .good)
        XCTAssertEqual(BatteryBand.forLevel(60), .good)
        XCTAssertEqual(BatteryBand.forLevel(59), .warning)
        XCTAssertEqual(BatteryBand.forLevel(30), .warning)
        XCTAssertEqual(BatteryBand.forLevel(29), .critical)
        XCTAssertEqual(BatteryBand.forLevel(0), .critical)
    }
}

// MARK: - Battery pill projection (web BatteryPill inline maths)

@MainActor final class BatteryPillProjectionTests: XCTestCase {
    func testRoundsLevelAndDerivesBandAndFraction() {
        let start = BatteryPillProjection.make(kind: .chargeStart, value: 42.4)
        XCTAssertEqual(start.level, 42)
        XCTAssertEqual(start.levelText, "42")
        XCTAssertEqual(start.band, .warning)
        XCTAssertEqual(start.fraction, 0.42, accuracy: 0.0001)

        let end = BatteryPillProjection.make(kind: .chargeEnd, value: 78.9)
        XCTAssertEqual(end.level, 79)
        XCTAssertEqual(end.band, .good)
        XCTAssertEqual(end.fraction, 0.79, accuracy: 0.0001)
    }

    func testFractionClampsToOneAboveHundred() {
        let pill = BatteryPillProjection.make(kind: .chargeEnd, value: 120)
        XCTAssertEqual(pill.level, 120)
        XCTAssertEqual(pill.band, .good)
        XCTAssertEqual(pill.fraction, 1, accuracy: 0.0001)
    }

    func testFractionClampsToZeroBelowZero() {
        let pill = BatteryPillProjection.make(kind: .chargeStart, value: -8)
        XCTAssertEqual(pill.fraction, 0, accuracy: 0.0001)
        XCTAssertEqual(pill.band, .critical)
    }
}

// MARK: - Tile builders (web BatteryHealthSection composition)

@MainActor final class BatteryHealthTilesTests: XCTestCase {
    private let metrics = BatteryHealthMetrics(
        batteryStart: 42.4,
        batteryEnd: 78.9,
        chargingSessionCount: 5,
        chargeEnergyAdded: 142.5
    )

    func testPillsAreStartThenEnd() {
        let pills = BatteryHealthTiles.pills(from: metrics)
        XCTAssertEqual(pills.map(\.kind), [.chargeStart, .chargeEnd])
        XCTAssertEqual(pills[0].level, 42)
        XCTAssertEqual(pills[1].level, 79)
    }

    func testStatsReproduceWebExpressions() {
        let stats = BatteryHealthTiles.stats(from: metrics)
        XCTAssertEqual(stats.map(\.kind), [.chargeGain, .sessions, .rangeAdded])
        // chargeGain = fmtNumber(end - start, 1) = fmtNumber(36.5, 1)
        XCTAssertEqual(stats[0].valueText, "36.5")
        // sessions = fmtInt(5)
        XCTAssertEqual(stats[1].valueText, "5")
        // rangeAdded = fmtNumber(142.5 * 5.5, 0) = fmtNumber(783.75, 0)
        XCTAssertEqual(stats[2].valueText, "784")
    }

    func testChargeGainUsesRawNotRoundedValues() {
        // 78.6 - 42.4 = 36.2 (not round(79) - round(42) = 37)
        let raw = BatteryHealthMetrics(
            batteryStart: 42.4, batteryEnd: 78.6, chargingSessionCount: 1, chargeEnergyAdded: 0
        )
        XCTAssertEqual(BatteryHealthTiles.stats(from: raw)[0].valueText, "36.2")
    }
}

// MARK: - Projection: phase resolution + overlays

@MainActor final class BatteryHealthProjectionTests: XCTestCase {
    private func metrics(count: Int) -> BatteryHealthMetrics {
        BatteryHealthMetrics(batteryStart: 40, batteryEnd: 80, chargingSessionCount: count, chargeEnergyAdded: 100)
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = BatteryHealthInput(isLoading: true, metrics: metrics(count: 3))
        XCTAssertEqual(BatteryHealthProjection.resolve(input).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = BatteryHealthInput(errorMessage: "boom", metrics: metrics(count: 3))
        XCTAssertEqual(BatteryHealthProjection.resolve(input).phase, .error("boom"))
    }

    func testEmptyWhenNoChargingSessions() {
        let resolved = BatteryHealthProjection.resolve(BatteryHealthInput(metrics: metrics(count: 0)))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testEmptyWhenMetricsMissing() {
        let resolved = BatteryHealthProjection.resolve(BatteryHealthInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.pills.isEmpty)
        XCTAssertTrue(resolved.stats.isEmpty)
    }

    func testDataWhenSessionsPresent() {
        let resolved = BatteryHealthProjection.resolve(BatteryHealthInput(metrics: metrics(count: 3)))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.pills.count, 2)
        XCTAssertEqual(resolved.stats.count, 3)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = BatteryHealthInput(metrics: metrics(count: 1), isStale: true, isOffline: true)
        let resolvedWith = BatteryHealthProjection.resolve(withData)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = BatteryHealthInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = BatteryHealthProjection.resolve(noData)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }

    func testFetchingFlagPassesThrough() {
        let input = BatteryHealthInput(isFetching: true, metrics: metrics(count: 1))
        XCTAssertTrue(BatteryHealthProjection.resolve(input).isFetching)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class BatteryHealthModelTests: XCTestCase {
    private func metrics(count: Int) -> BatteryHealthMetrics {
        BatteryHealthMetrics(batteryStart: 40, batteryEnd: 80, chargingSessionCount: count, chargeEnergyAdded: 100)
    }

    private func makeModel(
        _ input: BatteryHealthInput,
        telemetry: BatteryHealthTelemetry = OSLogBatteryHealthTelemetry()
    ) -> (BatteryHealthModel, InMemoryBatteryHealthSource) {
        let source = InMemoryBatteryHealthSource(initial: input)
        let model = BatteryHealthModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = BatteryHealthSectionSpyBatteryHealthTelemetry()
        let (model, source) = makeModel(BatteryHealthInput(metrics: metrics(count: 3)), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.pills.count, 2)
        XCTAssertEqual(model.stats.count, 3)
        XCTAssertEqual(spy.surfaces, [BatteryHealthSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryHealthInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(BatteryHealthInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(BatteryHealthInput(isFetching: true, metrics: metrics(count: 1), isStale: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.isFetching)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.pills.count, 2)
    }
}

// MARK: - Accessibility summary content

@MainActor final class BatteryHealthAccessibilityTests: XCTestCase {
    func testTileSummaryJoinsLabelAndValue() {
        let summary = BatteryHealthAccessibility.tileSummary(
            label: "Avg Battery at Charge End",
            value: "79%"
        )
        XCTAssertEqual(summary, "Avg Battery at Charge End, 79%")
    }

    func testTileSummaryDropsEmptyFragments() {
        let summary = BatteryHealthAccessibility.tileSummary(label: "Charge Sessions", value: "")
        XCTAssertEqual(summary, "Charge Sessions")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class BatteryHealthSectionSpyBatteryHealthTelemetry: BatteryHealthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
