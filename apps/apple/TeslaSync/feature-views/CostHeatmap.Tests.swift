//
//  CostHeatmap.Tests.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  Unit coverage for the CostHeatmap surface:
//    • Adapter (data → projection) — `CostHeatmapNumeric.safe`, the `maxCost`
//      resolution (web `peakCostPerKwh || 0.30`), the dense 7×24 grid build (web
//      `heatmap.find`), the cheap→expensive cell/legend colour ramp, and the
//      localized day labels.
//    • State holder — `CostHeatmapModel` phase resolution across loading / loaded /
//      empty / error, projection wiring, the P1/S11 `view.opened` telemetry + source
//      wiring, and connection tracking.
//    • Formatting — `DefaultCostHeatmapFormatting` currency (3-dp) + integer parity.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryCostHeatmapSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: numeric guard

@MainActor
final class CostHeatmapNumericTests: XCTestCase {
    func testSafeReturnsFiniteValues() {
        XCTAssertEqual(CostHeatmapNumeric.safe(0.42), 0.42)
        XCTAssertEqual(CostHeatmapNumeric.safe(0), 0)
        XCTAssertEqual(CostHeatmapNumeric.safe(-3), -3)
    }

    func testSafeZeroesNonFiniteAndNil() {
        XCTAssertEqual(CostHeatmapNumeric.safe(nil), 0)
        XCTAssertEqual(CostHeatmapNumeric.safe(.nan), 0)
        XCTAssertEqual(CostHeatmapNumeric.safe(.infinity), 0)
        XCTAssertEqual(CostHeatmapNumeric.safe(-.infinity), 0)
    }
}

// MARK: - Adapter: maxCost (web `peakCostPerKwh || 0.30`)

@MainActor
final class CostHeatmapMaxCostTests: XCTestCase {
    func testPositivePeakIsKept() {
        XCTAssertEqual(CostHeatmapProjection.maxCost(peakCostPerKwh: 0.48), 0.48, accuracy: 0.0001)
    }

    func testZeroPeakFallsBackToDefault() {
        XCTAssertEqual(CostHeatmapProjection.maxCost(peakCostPerKwh: 0), 0.30, accuracy: 0.0001)
    }

    func testNonFinitePeakFallsBackToDefault() {
        XCTAssertEqual(CostHeatmapProjection.maxCost(peakCostPerKwh: .nan), 0.30, accuracy: 0.0001)
        XCTAssertEqual(CostHeatmapProjection.maxCost(peakCostPerKwh: .infinity), 0.30, accuracy: 0.0001)
    }

    func testNegativePeakIsKeptLikeJSTruthiness() {
        XCTAssertEqual(CostHeatmapProjection.maxCost(peakCostPerKwh: -0.5), -0.5, accuracy: 0.0001)
    }
}

// MARK: - Adapter: cell / legend colour ramp (web `rgba(...)`)

@MainActor
final class CostHeatmapColorTests: XCTestCase {
    func testCheapEndIsGreen() {
        let color = CostHeatmapColor.cell(intensity: 0, sessions: 1)
        XCTAssertEqual(color.red, 0)
        XCTAssertEqual(color.green, 187)
        XCTAssertEqual(color.blue, 100)
    }

    func testExpensiveEndIsRed() {
        let color = CostHeatmapColor.cell(intensity: 1, sessions: 1)
        XCTAssertEqual(color.red, 239)
        XCTAssertEqual(color.green, 0)
        XCTAssertEqual(color.blue, 0)
    }

    func testMidpointChannelsRoundHalfUp() {
        let color = CostHeatmapColor.cell(intensity: 0.5, sessions: 1)
        XCTAssertEqual(color.red, 120)
        XCTAssertEqual(color.green, 94)
        XCTAssertEqual(color.blue, 50)
    }

    func testIntensityClampsToUnitRange() {
        let over = CostHeatmapColor.cell(intensity: 4, sessions: 1)
        XCTAssertEqual(over.red, 239)
        let under = CostHeatmapColor.cell(intensity: -2, sessions: 1)
        XCTAssertEqual(under.green, 187)
    }

    func testAlphaGrowsWithSessionsAndCapsAtNinePercent() {
        XCTAssertEqual(CostHeatmapColor.cell(intensity: 0, sessions: 1).alpha, 0.27, accuracy: 0.0001)
        XCTAssertEqual(CostHeatmapColor.cell(intensity: 0, sessions: 5).alpha, 0.75, accuracy: 0.0001)
        XCTAssertEqual(CostHeatmapColor.cell(intensity: 0, sessions: 20).alpha, 0.9, accuracy: 0.0001)
    }

    func testLegendUsesConstantAlpha() {
        let swatch = CostHeatmapColor.legend(intensity: 0.5)
        XCTAssertEqual(swatch.alpha, 0.6, accuracy: 0.0001)
    }

    func testLegendSwatchesSpanCheapToExpensive() {
        let swatches = CostHeatmapProjection.legendSwatches()
        XCTAssertEqual(swatches.count, 5)
        // 0.15 → mostly green, 0.9 → mostly red.
        XCTAssertLessThan(swatches.first?.red ?? 999, swatches.last?.red ?? 0)
        XCTAssertGreaterThan(swatches.first?.green ?? 0, swatches.last?.green ?? 999)
    }
}

// MARK: - Adapter: dense 7×24 grid (web `heatmap.find`)

@MainActor
final class CostHeatmapGridTests: XCTestCase {
    func testGridIsAlwaysSevenByTwentyFour() {
        let cells = CostHeatmapProjection.grid(CostHeatmapData())
        XCTAssertEqual(cells.count, 168)
        XCTAssertEqual(Set(cells.map(\.day)), Set(0 ..< 7))
        XCTAssertEqual(Set(cells.map(\.hour)), Set(0 ..< 24))
    }

    func testEmptySlotsHaveNoFill() {
        let cells = CostHeatmapProjection.grid(CostHeatmapData())
        XCTAssertTrue(cells.allSatisfy { $0.fill == nil })
        XCTAssertTrue(cells.allSatisfy { $0.sessions == 0 })
    }

    func testPopulatedSlotResolvesIntensityAndFill() {
        let data = CostHeatmapData(
            entries: [CostHeatmapEntry(day: 2, hour: 18, sessions: 6, avgCostPerKwh: 0.48)],
            peakCostPerKwh: 0.48
        )
        let cell = CostHeatmapProjection.grid(data).first { $0.day == 2 && $0.hour == 18 }
        XCTAssertNotNil(cell)
        XCTAssertEqual(cell?.intensity ?? 0, 1, accuracy: 0.0001)
        XCTAssertEqual(cell?.fill?.red, 239)
        XCTAssertEqual(cell?.fill?.green, 0)
        XCTAssertEqual(cell?.fill?.alpha ?? 0, 0.87, accuracy: 0.0001)
    }

    func testIntensityIsCappedAtOneWhenCostExceedsPeak() {
        let data = CostHeatmapData(
            entries: [CostHeatmapEntry(day: 0, hour: 0, sessions: 1, avgCostPerKwh: 1.0)],
            peakCostPerKwh: 0.5
        )
        let cell = CostHeatmapProjection.grid(data).first { $0.day == 0 && $0.hour == 0 }
        XCTAssertEqual(cell?.intensity ?? 0, 1, accuracy: 0.0001)
    }

    func testFirstMatchWinsForDuplicateSlots() {
        let data = CostHeatmapData(
            entries: [
                CostHeatmapEntry(day: 1, hour: 5, sessions: 9, avgCostPerKwh: 0.20),
                CostHeatmapEntry(day: 1, hour: 5, sessions: 1, avgCostPerKwh: 0.40)
            ],
            peakCostPerKwh: 0.40
        )
        let cell = CostHeatmapProjection.grid(data).first { $0.day == 1 && $0.hour == 5 }
        XCTAssertEqual(cell?.sessions, 9)
        XCTAssertEqual(cell?.cost ?? 0, 0.20, accuracy: 0.0001)
    }

    func testZeroSessionEntryStaysEmpty() {
        let data = CostHeatmapData(
            entries: [CostHeatmapEntry(day: 3, hour: 3, sessions: 0, avgCostPerKwh: 0.25)],
            peakCostPerKwh: 0.40
        )
        let cell = CostHeatmapProjection.grid(data).first { $0.day == 3 && $0.hour == 3 }
        XCTAssertNil(cell?.fill)
    }
}

// MARK: - Adapter: localized day labels

@MainActor
final class CostHeatmapDayLabelTests: XCTestCase {
    func testDayLabelsAreSundayFirstForEnglish() {
        let labels = CostHeatmapProjection.dayLabels(locale: Locale(identifier: "en_US"))
        XCTAssertEqual(labels, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
    }
}

// MARK: - Formatting: web `formatCurrency(_, 3)` / `fmtInt` parity

@MainActor
final class CostHeatmapFormattingTests: XCTestCase {
    private let formatting = DefaultCostHeatmapFormatting()

    func testCostPerKwhUsesSymbolGroupingAndThreeDecimals() {
        XCTAssertEqual(formatting.formatCurrency(0.235, decimals: 3), "$0.235")
        XCTAssertEqual(formatting.formatCurrency(1234.5, decimals: 3), "$1,234.500")
        XCTAssertEqual(formatting.formatCurrency(0, decimals: 3), "$0.000")
    }

    func testCostPerKwhConvenienceUsesThreeDecimals() {
        XCTAssertEqual(formatting.formatCostPerKwh(0.4), "$0.400")
    }

    func testCurrencyZeroesNonFinite() {
        XCTAssertEqual(formatting.formatCurrency(.nan, decimals: 3), "$0.000")
    }

    func testIntegerGroupsAndRounds() {
        XCTAssertEqual(formatting.formatInt(1204), "1,204")
        XCTAssertEqual(formatting.formatInt(12345.6), "12,346")
        XCTAssertEqual(formatting.formatInt(0), "0")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class CostHeatmapAccessibilityTests: XCTestCase {
    private let formatting = DefaultCostHeatmapFormatting()

    private var labels: CostHeatmapSummaryLabels {
        CostHeatmapSummaryLabels(
            title: "Charging Cost Heatmap",
            sessions: "sessions",
            cheapest: "Cheapest",
            priciest: "Most expensive",
            busiest: "Busiest",
            perKwh: "/kWh",
            empty: "No charging sessions recorded yet"
        )
    }

    private var data: CostHeatmapData {
        CostHeatmapData(
            entries: [
                CostHeatmapEntry(day: 1, hour: 2, sessions: 3, avgCostPerKwh: 0.09),
                CostHeatmapEntry(day: 2, hour: 18, sessions: 6, avgCostPerKwh: 0.48),
                CostHeatmapEntry(day: 4, hour: 21, sessions: 2, avgCostPerKwh: 0.20)
            ],
            peakCostPerKwh: 0.48
        )
    }

    func testSummaryListsTotalsRangeAndBusiestSlot() {
        let summary = CostHeatmapAccessibility.summary(
            data,
            dayLabels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: 3) },
            formatInt: formatting.formatInt
        )
        XCTAssertTrue(summary.contains("Charging Cost Heatmap"))
        XCTAssertTrue(summary.contains("11 sessions"))
        XCTAssertTrue(summary.contains("Cheapest $0.090/kWh"))
        XCTAssertTrue(summary.contains("Most expensive $0.480/kWh"))
        XCTAssertTrue(summary.contains("Busiest Tue 18:00"))
    }

    func testEmptyDataFallsBackToEmptyCopy() {
        let summary = CostHeatmapAccessibility.summary(
            CostHeatmapData(),
            dayLabels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
            labels: labels,
            formatCurrency: { formatting.formatCurrency($0, decimals: 3) },
            formatInt: formatting.formatInt
        )
        XCTAssertEqual(summary, "No charging sessions recorded yet")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class CostHeatmapModelTests: XCTestCase {
    private func makeModel(
        _ snapshot: CostHeatmapSnapshot,
        telemetry: CostHeatmapTelemetry = OSLogCostHeatmapTelemetry()
    ) -> (CostHeatmapModel, InMemoryCostHeatmapSource) {
        let source = InMemoryCostHeatmapSource(initial: snapshot)
        let model = CostHeatmapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sample: CostHeatmapData {
        CostHeatmapData(
            entries: [CostHeatmapEntry(day: 2, hour: 18, sessions: 6, avgCostPerKwh: 0.48)],
            peakCostPerKwh: 0.48
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(CostHeatmapSnapshot(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testEmptyStatusShowsLoadedSoPanelSelfEmpties() {
        let (model, _) = makeModel(CostHeatmapSnapshot(status: .empty, data: CostHeatmapData()))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isEmpty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(CostHeatmapSnapshot(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsLoadedEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(CostHeatmapSnapshot(status: .loading, data: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .loaded)

        let (failed, _) = makeModel(CostHeatmapSnapshot(status: .failed("net"), data: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .loaded)
        XCTAssertFalse(failed.isEmpty)
    }

    func testProjectionsAreComputedFromData() {
        let (model, _) = makeModel(CostHeatmapSnapshot(status: .loaded, data: sample))
        model.start()
        XCTAssertEqual(model.cells.count, 168)
        XCTAssertEqual(model.legendSwatches.count, 5)
        XCTAssertEqual(model.dayLabels.count, 7)
        XCTAssertEqual(model.maxCost, 0.48, accuracy: 0.0001)
        XCTAssertFalse(model.accessibilitySummary.isEmpty)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCostHeatmapTelemetry()
        let (model, source) = makeModel(CostHeatmapSnapshot(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CostHeatmap.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CostHeatmapSnapshot(status: .loaded, data: sample))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndDataTrackUpdates() {
        let (model, source) = makeModel(CostHeatmapSnapshot(status: .loading))
        model.start()
        source.push(
            CostHeatmapSnapshot(
                status: .loaded,
                connection: .offline,
                data: sample,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertFalse(model.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCostHeatmapTelemetry: CostHeatmapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
