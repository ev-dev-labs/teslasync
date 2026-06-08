//
//  AcDcStatsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  Unit coverage for the AcDcStatsPanel surface:
//    • Adapter — the number / percent / energy-scaling / duration formatters
//      (ports of numberFormat.ts + dateFormat.ts), the energy-split fractions,
//      the per-type row filter, and the row-derived averages.
//    • State holder — `AcDcStatsProjection` across loading / empty / error / data
//      and the segment / footer flags, plus the `AcDcStatsModel` wiring, the
//      P1/S11 `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver row + split label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryAcDcStatsSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleBucket(
    energy: Double = 0,
    cost: Double = 0,
    count: Int = 0,
    totalDuration: Double = 0,
    freeCount: Int = 0,
    freeEnergy: Double = 0
) -> AcDcBucket {
    AcDcBucket(
        energy: energy,
        energyUsed: energy,
        cost: cost,
        count: count,
        totalDuration: totalDuration,
        freeCount: freeCount,
        freeEnergy: freeEnergy
    )
}

private func sampleBreakdown(
    ac: AcDcBucket,
    dc: AcDcBucket,
    freeCount: Int = 0,
    freeEnergy: Double = 0
) -> AcDcBreakdown {
    AcDcBreakdown(
        ac: ac,
        dc: dc,
        total: AcDcBreakdownTotal(
            energy: ac.energy + dc.energy,
            cost: ac.cost + dc.cost,
            freeEnergy: freeEnergy,
            freeCount: freeCount
        )
    )
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtPercent / fmtWithUnit)

final class AcDcFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(AcDcFormat.number(1000, locale: enUS), "1,000.00")
        XCTAssertEqual(AcDcFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(AcDcFormat.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(AcDcFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(AcDcFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(AcDcFormat.number(-.infinity, locale: enUS), "0.00")
    }

    func testPercentAppendsSign() {
        XCTAssertEqual(AcDcFormat.percent(35.5, locale: enUS), "35.50%")
        XCTAssertEqual(AcDcFormat.percent(100, locale: enUS), "100.00%")
    }

    func testWithUnitSpacesValueAndUnit() {
        XCTAssertEqual(AcDcFormat.withUnit(4500, "kWh", locale: enUS), "4,500.00 kWh")
        XCTAssertEqual(AcDcFormat.withUnit(0, "kWh", locale: enUS), "0.00 kWh")
    }
}

// MARK: - Energy scaling (web `value >= 1000 ? MWh : kWh`)

final class AcDcFormatEnergyTests: XCTestCase {
    func testBelowThresholdStaysKWh() {
        XCTAssertEqual(AcDcFormat.energyScaled(999.5, locale: enUS), "999.50 kWh")
        XCTAssertEqual(AcDcFormat.energyScaled(0, locale: enUS), "0.00 kWh")
    }

    func testAtAndAboveThresholdScalesToMWh() {
        XCTAssertEqual(AcDcFormat.energyScaled(1000, locale: enUS), "1.00 MWh")
        XCTAssertEqual(AcDcFormat.energyScaled(4500, locale: enUS), "4.50 MWh")
        XCTAssertEqual(AcDcFormat.energyScaled(12700, locale: enUS), "12.70 MWh")
    }
}

// MARK: - Duration (port of dateFormat.ts formatDurationMinutes)

final class AcDcFormatDurationTests: XCTestCase {
    func testSubHourRendersMinutesOnly() {
        XCTAssertEqual(AcDcFormat.duration(45, locale: enUS), "45m")
        XCTAssertEqual(AcDcFormat.duration(0, locale: enUS), "0m")
    }

    func testHourAndMinutes() {
        XCTAssertEqual(AcDcFormat.duration(90, locale: enUS), "1h 30m")
        XCTAssertEqual(AcDcFormat.duration(125.4, locale: enUS), "2h 5m")
    }

    func testMinuteRemainderRoundsHalfAway() {
        XCTAssertEqual(AcDcFormat.duration(59.6, locale: enUS), "60m")
    }

    func testNegativeAndNonFiniteFallBackToDash() {
        XCTAssertEqual(AcDcFormat.duration(-5, locale: enUS), "—")
        XCTAssertEqual(AcDcFormat.duration(.nan, locale: enUS), "—")
        XCTAssertEqual(AcDcFormat.duration(.infinity, locale: enUS), "—")
    }
}

// MARK: - Energy split fractions (web grid `templateColumns`)

final class AcDcSplitTests: XCTestCase {
    func testProportionalShares() {
        let split = AcDcSplit.fractions(ac: 4500, dc: 8200, total: 12700)
        XCTAssertEqual(split.ac, 4500.0 / 12700.0, accuracy: 1e-9)
        XCTAssertEqual(split.dc, 8200.0 / 12700.0, accuracy: 1e-9)
        XCTAssertEqual(split.ac + split.dc, 1, accuracy: 1e-9)
    }

    func testSingleTypeTakesFullWidth() {
        let split = AcDcSplit.fractions(ac: 5, dc: 0, total: 5)
        XCTAssertEqual(split.ac, 1, accuracy: 1e-9)
        XCTAssertEqual(split.dc, 0, accuracy: 1e-9)
    }

    func testNonPositiveOrNonFiniteTotalYieldsZeroShares() {
        XCTAssertEqual(AcDcSplit.fractions(ac: 1, dc: 1, total: 0).ac, 0, accuracy: 1e-9)
        XCTAssertEqual(AcDcSplit.fractions(ac: 1, dc: 1, total: -3).dc, 0, accuracy: 1e-9)
        XCTAssertEqual(AcDcSplit.fractions(ac: 1, dc: 1, total: .nan).ac, 0, accuracy: 1e-9)
    }

    func testSharesAreClampedToUnit() {
        let split = AcDcSplit.fractions(ac: 10, dc: 0, total: 5)
        XCTAssertEqual(split.ac, 1, accuracy: 1e-9)
    }
}

// MARK: - Per-type rows (web `[ac, dc].filter(count > 0)`)

final class AcDcRowsTests: XCTestCase {
    func testKeepsBothTypesWhenBothHaveSessions() {
        let breakdown = sampleBreakdown(ac: sampleBucket(count: 30), dc: sampleBucket(count: 12))
        let rows = AcDcRows.rows(for: breakdown)
        XCTAssertEqual(rows.map(\.id), ["ac", "dc"])
        XCTAssertEqual(rows[0].kind, .ac)
        XCTAssertEqual(rows[1].kind, .dc)
    }

    func testDropsTypesWithNoSessions() {
        let acOnly = sampleBreakdown(ac: sampleBucket(count: 4), dc: sampleBucket(count: 0))
        XCTAssertEqual(AcDcRows.rows(for: acOnly).map(\.id), ["ac"])

        let dcOnly = sampleBreakdown(ac: sampleBucket(count: 0), dc: sampleBucket(count: 7))
        XCTAssertEqual(AcDcRows.rows(for: dcOnly).map(\.id), ["dc"])
    }

    func testEmptyWhenNoSessions() {
        let none = sampleBreakdown(ac: sampleBucket(), dc: sampleBucket())
        XCTAssertTrue(AcDcRows.rows(for: none).isEmpty)
    }
}

// MARK: - Row-derived values (web averages + `$/kWh`)

final class AcDcTableRowTests: XCTestCase {
    private let row = AcDcTableRow(
        id: "ac",
        kind: .ac,
        labelKey: "charging.table.acCharging",
        labelFallback: "AC Charging",
        energy: 4500,
        cost: 12.30,
        sessionCount: 30,
        totalDuration: 1500,
        freeCount: 2,
        freeEnergy: 300
    )

    func testAverages() {
        XCTAssertEqual(row.averageEnergy, 150, accuracy: 1e-9)
        XCTAssertEqual(row.averageDuration, 50, accuracy: 1e-9)
    }

    func testCostPerEnergy() {
        XCTAssertEqual(row.costPerEnergy ?? -1, 12.30 / 4500, accuracy: 1e-9)
        let zeroEnergy = AcDcTableRow(
            id: "dc", kind: .dc, labelKey: "k", labelFallback: "f",
            energy: 0, cost: 5, sessionCount: 1, totalDuration: 10, freeCount: 0, freeEnergy: 0
        )
        XCTAssertNil(zeroEnergy.costPerEnergy)
    }

    func testHasFree() {
        XCTAssertTrue(row.hasFree)
        XCTAssertFalse(AcDcTableRow(
            id: "dc", kind: .dc, labelKey: "k", labelFallback: "f",
            energy: 1, cost: 1, sessionCount: 1, totalDuration: 1, freeCount: 0, freeEnergy: 0
        ).hasFree)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class AcDcStatsProjectionTests: XCTestCase {
    private var dataBreakdown: AcDcBreakdown {
        sampleBreakdown(
            ac: sampleBucket(energy: 4500, cost: 12.3, count: 30, totalDuration: 1500, freeCount: 2, freeEnergy: 300),
            dc: sampleBucket(energy: 8200, cost: 45.6, count: 12, totalDuration: 480, freeCount: 1, freeEnergy: 150),
            freeCount: 3,
            freeEnergy: 450
        )
    }

    func testErrorTakesPrecedence() {
        let resolved = AcDcStatsProjection.resolve(
            AcDcStatsInput(breakdown: dataBreakdown, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(AcDcStatsProjection.resolve(AcDcStatsInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(AcDcStatsProjection.resolve(AcDcStatsInput(breakdown: nil)).phase, .loading)
    }

    func testEmptyWhenNoTypeHasSessions() {
        let breakdown = sampleBreakdown(ac: sampleBucket(), dc: sampleBucket())
        XCTAssertEqual(AcDcStatsProjection.resolve(AcDcStatsInput(breakdown: breakdown)).phase, .empty)
    }

    func testDataResolvesRowsSegmentsAndFooter() {
        let resolved = AcDcStatsProjection.resolve(AcDcStatsInput(breakdown: dataBreakdown))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 2)
        XCTAssertTrue(resolved.showACSegment)
        XCTAssertTrue(resolved.showDCSegment)
        XCTAssertTrue(resolved.showFreeFooter)
        XCTAssertEqual(resolved.acFraction, 4500.0 / 12700.0, accuracy: 1e-9)
        XCTAssertEqual(resolved.dcFraction, 8200.0 / 12700.0, accuracy: 1e-9)
    }

    func testFooterHiddenWithoutFreeSessions() {
        let breakdown = sampleBreakdown(
            ac: sampleBucket(energy: 100, count: 2),
            dc: sampleBucket(energy: 0, count: 0),
            freeCount: 0
        )
        let resolved = AcDcStatsProjection.resolve(AcDcStatsInput(breakdown: breakdown))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertFalse(resolved.showFreeFooter)
        XCTAssertTrue(resolved.showACSegment)
        XCTAssertFalse(resolved.showDCSegment)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class AcDcStatsModelTests: XCTestCase {
    private func makeModel(
        _ input: AcDcStatsInput,
        telemetry: AcDcStatsTelemetry = OSLogAcDcStatsTelemetry()
    ) -> (AcDcStatsModel, InMemoryAcDcStatsSource) {
        let source = InMemoryAcDcStatsSource(initial: input)
        let model = AcDcStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: AcDcStatsInput {
        AcDcStatsInput(breakdown: sampleBreakdown(
            ac: sampleBucket(energy: 4500, count: 30),
            dc: sampleBucket(energy: 8200, count: 12)
        ))
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAcDcTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 2)
        XCTAssertEqual(spy.surfaces, [AcDcStatsPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AcDcStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.rows.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AcDcStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AcDcStatsInput(breakdown: dataInput.breakdown, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AcDcStatsInput(breakdown: dataInput.breakdown, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(AcDcStatsInput(breakdown: dataInput.breakdown, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AcDcStatsPanel.surfaceSlug, "AcDcStatsPanel")
    }
}

// MARK: - Accessibility summary content

final class AcDcAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(
            AcDcAccessibility.rowLabel(type: "AC Charging", sessions: "30", energy: "4.50 MWh", cost: "12.30"),
            "AC Charging, 30, 4.50 MWh, 12.30"
        )
    }

    func testSplitLabelJoinsParts() {
        XCTAssertEqual(
            AcDcAccessibility.splitLabel(ac: "AC 35.43%", dc: "DC 64.57%"),
            "AC 35.43%, DC 64.57%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAcDcTelemetry: AcDcStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
