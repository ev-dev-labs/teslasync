//
//  SignalStatsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  Unit coverage for the SignalStatsPanel surface:
//    • Adapter — the number / int / numeric formatters (ports of numberFormat.ts),
//      the `displayStats` gap-fill for selected signals, the colour index, and the
//      visible / empty-count bookkeeping.
//    • State holder — `SignalStatsProjection` across loading / empty / error / data,
//      plus the `SignalStatsModel` wiring, the P1/S11 `view.opened` telemetry, and
//      the stale auto-refresh transition.
//    • Accessibility — the VoiceOver row + stat-detail content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalStatsSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func stat(
    _ signal: String,
    min: Double = 0,
    max: Double = 0,
    avg: Double = 0,
    sampleCount: Int = 1
) -> SignalStat {
    SignalStat(signal: signal, min: min, max: max, avg: avg, sampleCount: sampleCount)
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtInt)

@MainActor final class SignalStatsFormatTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(SignalStatsFormat.number(1000, locale: enUS), "1,000.00")
        XCTAssertEqual(SignalStatsFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(SignalStatsFormat.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(SignalStatsFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(SignalStatsFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(SignalStatsFormat.number(-.infinity, locale: enUS), "0.00")
    }

    func testIntGroupsWithoutFraction() {
        XCTAssertEqual(SignalStatsFormat.int(8421, locale: enUS), "8,421")
        XCTAssertEqual(SignalStatsFormat.int(0, locale: enUS), "0")
    }

    func testNumericRendersDashForNonFinite() {
        XCTAssertEqual(SignalStatsFormat.numeric(.nan, locale: enUS), "—")
        XCTAssertEqual(SignalStatsFormat.numeric(.infinity, locale: enUS), "—")
        XCTAssertEqual(SignalStatsFormat.numeric(47.21, locale: enUS), "47.21")
    }
}

// MARK: - Display rows (web `displayStats` gap-fill + colour index)

@MainActor final class SignalStatRowsTests: XCTestCase {
    func testPassesStatsThroughWhenNoSelection() {
        let rows = SignalStatRows.rows(stats: [stat("A"), stat("B")])
        XCTAssertEqual(rows.map(\.signal), ["A", "B"])
        XCTAssertEqual(rows.map(\.colorIndex), [0, 1])
    }

    func testSelectedSignalsEmitOneRowEachAndBackfillGaps() {
        let rows = SignalStatRows.rows(
            stats: [stat("A", sampleCount: 4), stat("B", sampleCount: 7)],
            selectedSignals: ["B", "C", "A"]
        )
        XCTAssertEqual(rows.map(\.signal), ["B", "C", "A"])
        // The absent "C" is back-filled as an empty (no-sample) row.
        XCTAssertFalse(rows[0].isEmpty)
        XCTAssertTrue(rows[1].isEmpty)
        XCTAssertFalse(rows[2].isEmpty)
        XCTAssertEqual(rows.map(\.colorIndex), [0, 1, 2])
    }

    func testSelectedSignalWithNoStatsIsEmptyRow() {
        let rows = SignalStatRows.rows(stats: [], selectedSignals: ["X"])
        XCTAssertEqual(rows.count, 1)
        XCTAssertTrue(rows[0].isEmpty)
        XCTAssertTrue(rows[0].min.isNaN)
    }

    func testSignalIndexOverridesPositionAndClampsNegative() {
        let positive = SignalStatRows.rows(stats: [stat("Speed")], signalIndex: ["Speed": 5])
        XCTAssertEqual(positive[0].colorIndex, 5)

        let negative = SignalStatRows.rows(stats: [stat("Speed")], signalIndex: ["Speed": -3])
        XCTAssertEqual(negative[0].colorIndex, 0)
    }

    func testVisibleFiltersEmptyRowsWhenHideEmpty() {
        let rows = SignalStatRows.rows(
            stats: [stat("A", sampleCount: 3)],
            selectedSignals: ["A", "B"]
        )
        XCTAssertEqual(SignalStatRows.visible(rows, hideEmpty: false).map(\.signal), ["A", "B"])
        XCTAssertEqual(SignalStatRows.visible(rows, hideEmpty: true).map(\.signal), ["A"])
    }

    func testEmptyCountTalliesEmptyRows() {
        let rows = SignalStatRows.rows(
            stats: [stat("A", sampleCount: 3)],
            selectedSignals: ["A", "B", "C"]
        )
        XCTAssertEqual(SignalStatRows.emptyCount(rows), 2)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor final class SignalStatsProjectionTests: XCTestCase {
    private var dataInput: SignalStatsInput {
        SignalStatsInput(stats: [stat("A", min: 1, max: 2, avg: 1.5, sampleCount: 10)])
    }

    func testErrorTakesPrecedence() {
        let resolved = SignalStatsProjection.resolve(
            SignalStatsInput(stats: dataInput.stats, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(SignalStatsProjection.resolve(SignalStatsInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenNoRows() {
        XCTAssertEqual(SignalStatsProjection.resolve(SignalStatsInput(stats: [])).phase, .empty)
    }

    func testDataResolvesRowsAndEmptyCount() {
        let resolved = SignalStatsProjection.resolve(
            SignalStatsInput(stats: [stat("A", sampleCount: 3)], selectedSignals: ["A", "B"])
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 2)
        XCTAssertEqual(resolved.emptyCount, 1)
    }

    func testTitleOverrideIsCarried() {
        let resolved = SignalStatsProjection.resolve(
            SignalStatsInput(stats: dataInput.stats, title: "Range Summary")
        )
        XCTAssertEqual(resolved.title, "Range Summary")
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class SignalStatsModelTests: XCTestCase {
    private func makeModel(
        _ input: SignalStatsInput,
        telemetry: SignalStatsTelemetry = OSLogSignalStatsTelemetry()
    ) -> (SignalStatsModel, InMemorySignalStatsSource) {
        let source = InMemorySignalStatsSource(initial: input)
        let model = SignalStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: SignalStatsInput {
        SignalStatsInput(stats: [stat("A", sampleCount: 10), stat("B", sampleCount: 4)])
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySignalStatsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 2)
        XCTAssertEqual(spy.surfaces, [SignalStatsPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(SignalStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.rows.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SignalStatsInput(isLoading: true))
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

        source.push(SignalStatsInput(stats: dataInput.stats, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(SignalStatsInput(stats: dataInput.stats, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(SignalStatsInput(stats: dataInput.stats, connection: .offline))
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
        XCTAssertEqual(SignalStatsPanel.surfaceSlug, "SignalStatsPanel")
    }
}

// MARK: - Accessibility summary content

@MainActor final class SignalStatsAccessibilityTests: XCTestCase {
    func testRowLabelJoinsSignalAndDetail() {
        XCTAssertEqual(
            SignalStatsAccessibility.rowLabel(signal: "VehicleSpeed", detail: "No data in range"),
            "VehicleSpeed, No data in range"
        )
    }

    func testStatDetailJoinsParts() {
        let detail = SignalStatsAccessibility.statDetail([
            (label: "Min", value: "0.00"),
            (label: "Max", value: "112.40"),
            (label: "Avg", value: "47.21"),
            (label: "Count", value: "8,421")
        ])
        XCTAssertEqual(detail, "Min 0.00, Max 112.40, Avg 47.21, Count 8,421")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalStatsTelemetry: SignalStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
