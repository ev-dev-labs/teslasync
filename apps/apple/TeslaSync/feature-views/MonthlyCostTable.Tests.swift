//
//  MonthlyCostTable.Tests.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  Unit coverage for the MonthlyCostTable surface:
//    • Adapter — the number / int / unit / currency / signed-currency formatters (ports of
//      numberFormat.ts + Currency.tsx), the per-column comparators, and the default
//      month-descending sort.
//    • State holder — `MonthlyCostTableProjection` across loading / empty / error / data,
//      plus the `MonthlyCostTableModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryMonthlyCostTableSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func sampleBucket(
    month: String,
    cost: Double = 0,
    energy: Double = 0,
    sessions: Int = 0,
    avgCostPerKwh: Double = 0,
    gasEquiv: Double = 0,
    savings: Double = 0
) -> MonthlyCostBucket {
    MonthlyCostBucket(
        month: month,
        cost: cost,
        energy: energy,
        sessions: sessions,
        avgCostPerKwh: avgCostPerKwh,
        gasEquiv: gasEquiv,
        savings: savings
    )
}

private func sampleBuckets() -> [MonthlyCostBucket] {
    [
        sampleBucket(
            month: "2024-01",
            cost: 142.30,
            energy: 1180.4,
            sessions: 18,
            avgCostPerKwh: 0.121,
            gasEquiv: 318.75,
            savings: 176.45
        ),
        sampleBucket(
            month: "2024-02",
            cost: 98.60,
            energy: 820.0,
            sessions: 12,
            avgCostPerKwh: 0.120,
            gasEquiv: 70.10,
            savings: -28.50
        ),
        sampleBucket(
            month: "2024-03",
            cost: 205.15,
            energy: 1640.9,
            sessions: 24,
            avgCostPerKwh: 0.125,
            gasEquiv: 442.20,
            savings: 237.05
        )
    ]
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtInt / fmtWithUnit)

@MainActor final class MonthlyCostFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesDecimals() {
        XCTAssertEqual(MonthlyCostFormat.number(1000, decimals: 2, locale: enUS), "1,000.00")
        XCTAssertEqual(MonthlyCostFormat.number(1234.5, decimals: 2, locale: enUS), "1,234.50")
        XCTAssertEqual(MonthlyCostFormat.number(1180.4, decimals: 1, locale: enUS), "1,180.4")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(MonthlyCostFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(MonthlyCostFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(MonthlyCostFormat.number(-.infinity, decimals: 2, locale: enUS), "0.00")
    }

    func testIntDropsFractionAndGroups() {
        XCTAssertEqual(MonthlyCostFormat.int(18, locale: enUS), "18")
        XCTAssertEqual(MonthlyCostFormat.int(1234, locale: enUS), "1,234")
    }

    func testWithUnitSpacesValueAndUnit() {
        XCTAssertEqual(MonthlyCostFormat.withUnit(1180.4, "kWh", decimals: 1, locale: enUS), "1,180.4 kWh")
        XCTAssertEqual(MonthlyCostFormat.withUnit(0, "kWh", decimals: 1, locale: enUS), "0.0 kWh")
    }
}

// MARK: - Currency formatting (port of Currency.tsx)

@MainActor final class MonthlyCostFormatCurrencyTests: XCTestCase {
    func testCurrencyPrependsSymbolAtPrecisionTwo() {
        XCTAssertEqual(MonthlyCostFormat.currency(142.3, locale: enUS), "$142.30")
        XCTAssertEqual(MonthlyCostFormat.currency(1234.5, locale: enUS), "$1,234.50")
    }

    func testCurrencyHonoursPrecisionThree() {
        XCTAssertEqual(MonthlyCostFormat.currency(0.121, precision: 3, locale: enUS), "$0.121")
        XCTAssertEqual(MonthlyCostFormat.currency(0.1, precision: 3, locale: enUS), "$0.100")
    }

    func testCurrencyFallsBackToDashForNonFinite() {
        XCTAssertEqual(MonthlyCostFormat.currency(.nan, locale: enUS), "—")
        XCTAssertEqual(MonthlyCostFormat.currency(.infinity, precision: 3, locale: enUS), "—")
    }

    func testSignedCurrencyMarksNonNegativeWithPlus() {
        XCTAssertEqual(MonthlyCostFormat.signedCurrency(176.45, locale: enUS), "+$176.45")
        XCTAssertEqual(MonthlyCostFormat.signedCurrency(0, locale: enUS), "+$0.00")
    }

    func testSignedCurrencyKeepsNegativeSign() {
        XCTAssertEqual(MonthlyCostFormat.signedCurrency(-28.5, locale: enUS), "$-28.50")
    }

    func testSignedCurrencyFallsBackToDashForNonFinite() {
        XCTAssertEqual(MonthlyCostFormat.signedCurrency(.nan, locale: enUS), "—")
    }
}

// MARK: - Sorting (web `sortedData`, default month / desc)

@MainActor final class MonthlyCostSortTests: XCTestCase {
    func testDefaultSortIsMonthDescending() {
        let sorted = MonthlyCostSort.defaultSorted(sampleBuckets())
        XCTAssertEqual(sorted.map(\.month), ["2024-03", "2024-02", "2024-01"])
    }

    func testDefaultSortIsStableForEqualMonths() {
        let buckets = [
            sampleBucket(month: "2024-01", cost: 1),
            sampleBucket(month: "2024-01", cost: 2)
        ]
        // Equal keys preserve original order (the shared stable sort).
        XCTAssertEqual(MonthlyCostSort.defaultSorted(buckets).map(\.cost), [1, 2])
    }

    func testNumericComparatorOrdersAscending() {
        let low = sampleBucket(month: "a", sessions: 12)
        let high = sampleBucket(month: "b", sessions: 18)
        XCTAssertEqual(MonthlyCostSort.comparator(for: .sessions)(low, high), .orderedAscending)
        XCTAssertEqual(MonthlyCostSort.comparator(for: .sessions)(high, low), .orderedDescending)
        XCTAssertEqual(MonthlyCostSort.comparator(for: .savings)(low, low), .orderedSame)
    }

    func testMonthComparatorUsesStringOrder() {
        let jan = sampleBucket(month: "2024-01")
        let feb = sampleBucket(month: "2024-02")
        XCTAssertEqual(MonthlyCostSort.comparator(for: .month)(jan, feb), .orderedAscending)
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

@MainActor final class MonthlyCostTableProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = MonthlyCostTableProjection.resolve(
            MonthlyCostTableInput(buckets: sampleBuckets(), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(MonthlyCostTableProjection.resolve(MonthlyCostTableInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(MonthlyCostTableProjection.resolve(MonthlyCostTableInput(buckets: nil)).phase, .loading)
    }

    func testEmptyWhenNoBuckets() {
        XCTAssertEqual(MonthlyCostTableProjection.resolve(MonthlyCostTableInput(buckets: [])).phase, .empty)
    }

    func testDataResolvesSortedRows() {
        let resolved = MonthlyCostTableProjection.resolve(MonthlyCostTableInput(buckets: sampleBuckets()))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 3)
        XCTAssertEqual(resolved.rows.map(\.month), ["2024-03", "2024-02", "2024-01"])
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class MonthlyCostTableModelTests: XCTestCase {
    private func makeModel(
        _ input: MonthlyCostTableInput,
        telemetry: MonthlyCostTableTelemetry = OSLogMonthlyCostTableTelemetry()
    ) -> (MonthlyCostTableModel, InMemoryMonthlyCostTableSource) {
        let source = InMemoryMonthlyCostTableSource(initial: input)
        let model = MonthlyCostTableModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: MonthlyCostTableInput {
        MonthlyCostTableInput(buckets: sampleBuckets())
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = MonthlyCostTableSpyMonthlyCostTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 3)
        XCTAssertEqual(spy.surfaces, [MonthlyCostTable.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(MonthlyCostTableInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.rows.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(MonthlyCostTableInput(isLoading: true))
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

        source.push(MonthlyCostTableInput(buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(MonthlyCostTableInput(buckets: sampleBuckets(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(MonthlyCostTableInput(buckets: sampleBuckets(), connection: .offline))
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
        XCTAssertEqual(MonthlyCostTable.surfaceSlug, "MonthlyCostTable")
    }
}

// MARK: - Accessibility summary content

@MainActor final class MonthlyCostTableMonthlyCostAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(
            MonthlyCostTableAccessibility.rowLabel(
                month: "2024-03",
                sessions: "24",
                energy: "1,640.9 kWh",
                cost: "$205.15",
                savings: "+$237.05"
            ),
            "2024-03, 24, 1,640.9 kWh, $205.15, +$237.05"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class MonthlyCostTableSpyMonthlyCostTelemetry: MonthlyCostTableTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
