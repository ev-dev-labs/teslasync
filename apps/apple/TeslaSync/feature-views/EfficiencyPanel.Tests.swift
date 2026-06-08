//
//  EfficiencyPanel.Tests.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  Unit coverage for the EfficiencyPanel surface:
//    • Format — `fmtNumber` / `fmtPercent` / `fmtWithUnit` / `formatDateTime` / `safe`
//      parity with the web `lib/numberFormat.ts` + `lib/dateFormat.ts` helpers.
//    • Projection — the four tiles' value / accent / footer / VoiceOver summary across a
//      resolved payload and the absent (empty fallback) payload, plus the average bar's
//      `min(avg, 100)` clamp.
//    • Phase — `EfficiencyProjection.resolvePhase` across loading / empty / loaded / failed.
//    • State holder — the model wiring, the P1/S11 `view.opened` telemetry, and the stale
//      one-shot auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryEfficiencyPanelSource`.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be asserted
/// without the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

/// The en-US locale + GMT zone the format/projection tests pin for determinism.
private let enUS = Locale(identifier: "en-US")

private func sampleStats() -> EfficiencyPanelInput {
    EfficiencyPanelInput(
        count: 7,
        avgEfficiency: 85.432,
        bestEfficiency: 92.5,
        bestDate: Date(timeIntervalSince1970: 1_777_000_000),
        worstEfficiency: 70.0,
        worstDate: Date(timeIntervalSince1970: 1_776_000_000),
        wallLoss: 3.2,
        totalUsed: 1234.5,
        totalAdded: 1234.5
    )
}

// MARK: - Format (port of lib/numberFormat.ts + lib/dateFormat.ts)

final class EfficiencyFormatTests: XCTestCase {
    func testFmtNumberGroupsAtDefaultPrecision() {
        XCTAssertEqual(EfficiencyFormat.fmtNumber(85.432, locale: enUS), "85.43")
        XCTAssertEqual(EfficiencyFormat.fmtNumber(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(EfficiencyFormat.fmtNumber(0, locale: enUS), "0.00")
    }

    func testFmtNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(EfficiencyFormat.fmtNumber(2.005, decimals: 2, locale: enUS), "2.01")
    }

    func testFmtPercentAppendsSign() {
        XCTAssertEqual(EfficiencyFormat.fmtPercent(85.432, locale: enUS), "85.43%")
        XCTAssertEqual(EfficiencyFormat.fmtPercent(120.5, locale: enUS), "120.50%")
    }

    func testFmtWithUnitAppendsSymbol() {
        XCTAssertEqual(EfficiencyFormat.fmtWithUnit(3.2, unit: "kWh", locale: enUS), "3.20 kWh")
    }

    func testSafeCoercesNonFinite() {
        XCTAssertEqual(EfficiencyFormat.safe(.infinity), 0)
        XCTAssertEqual(EfficiencyFormat.safe(.nan), 0)
        XCTAssertEqual(EfficiencyFormat.fmtPercent(.infinity, locale: enUS), "0.00%")
    }

    func testFormatDateTimeNilFallsBackToDash() {
        XCTAssertEqual(EfficiencyFormat.formatDateTime(nil, locale: enUS, timeZone: .gmt), "—")
    }

    func testFormatDateTimeRendersLocalizedString() {
        let date = Date(timeIntervalSince1970: 1_777_000_000)
        let rendered = EfficiencyFormat.formatDateTime(date, locale: enUS, timeZone: .gmt)
        XCTAssertTrue(rendered.contains("2026"), "expected a 2026 timestamp, got \(rendered)")
        XCTAssertNotEqual(rendered, "—")
    }
}

// MARK: - Projection: the four tiles

final class EfficiencyProjectionTests: XCTestCase {
    private func tile(_ tiles: [EfficiencyMetricModel], _ id: String) -> EfficiencyMetricModel {
        guard let match = tiles.first(where: { $0.id == id }) else {
            return EfficiencyMetricModel(
                id: id, label: "", value: "", footer: .detail(""), accent: .cyan, accessibilityLabel: ""
            )
        }
        return match
    }

    private func fraction(_ footer: EfficiencyMetricFooter) -> Double? {
        if case let .progress(value) = footer { return value }
        return nil
    }

    private func detail(_ footer: EfficiencyMetricFooter) -> String? {
        if case let .detail(text) = footer { return text }
        return nil
    }

    private func project(_ input: EfficiencyPanelInput?) -> [EfficiencyMetricModel] {
        EfficiencyProjection.metrics(from: input, localize: echo, locale: enUS, timeZone: .gmt)
    }

    func testTileOrderAndCount() {
        let tiles = project(sampleStats())
        XCTAssertEqual(tiles.map(\.id), ["average", "best", "worst", "wallLoss"])
    }

    func testResolvedPayloadFormatsEveryTile() {
        let tiles = project(sampleStats())
        XCTAssertEqual(tile(tiles, "average").value, "85.43%")
        XCTAssertEqual(tile(tiles, "average").accent, .cyan)
        XCTAssertEqual(fraction(tile(tiles, "average").footer) ?? -1, 0.85432, accuracy: 0.00001)
        XCTAssertEqual(tile(tiles, "best").value, "92.50%")
        XCTAssertEqual(tile(tiles, "best").accent, .emerald)
        XCTAssertEqual(tile(tiles, "worst").value, "70.00%")
        XCTAssertEqual(tile(tiles, "worst").accent, .rose)
        XCTAssertEqual(tile(tiles, "wallLoss").value, "3.20 kWh")
        XCTAssertEqual(tile(tiles, "wallLoss").accent, .amber)
        XCTAssertEqual(detail(tile(tiles, "wallLoss").footer), "1,234.50 kWh → 1,234.50 kWh")
    }

    func testBestAndWorstFootersCarryFormattedTimestamps() {
        let tiles = project(sampleStats())
        XCTAssertNotEqual(detail(tile(tiles, "best").footer), "—")
        XCTAssertEqual(detail(tile(tiles, "best").footer)?.contains("2026"), true)
        XCTAssertNotEqual(detail(tile(tiles, "worst").footer), "—")
    }

    func testAbsentPayloadRendersEmDashFallbacks() {
        let tiles = project(nil)
        XCTAssertEqual(tiles.count, 4)
        XCTAssertEqual(tile(tiles, "average").value, "—")
        XCTAssertEqual(fraction(tile(tiles, "average").footer), 0)
        XCTAssertEqual(tile(tiles, "best").value, "—")
        XCTAssertEqual(detail(tile(tiles, "best").footer), "—")
        XCTAssertEqual(tile(tiles, "worst").value, "—")
        XCTAssertEqual(tile(tiles, "wallLoss").value, "—")
        XCTAssertEqual(detail(tile(tiles, "wallLoss").footer), "—")
    }

    func testAverageBarClampsToHundred() {
        let high = EfficiencyPanelInput(
            count: 1, avgEfficiency: 150, bestEfficiency: 0, bestDate: nil,
            worstEfficiency: 0, worstDate: nil, wallLoss: 0, totalUsed: 0, totalAdded: 0
        )
        XCTAssertEqual(fraction(project(high).first { $0.id == "average" }?.footer ?? .detail("")), 1)
        let low = EfficiencyPanelInput(
            count: 1, avgEfficiency: -10, bestEfficiency: 0, bestDate: nil,
            worstEfficiency: 0, worstDate: nil, wallLoss: 0, totalUsed: 0, totalAdded: 0
        )
        XCTAssertEqual(fraction(project(low).first { $0.id == "average" }?.footer ?? .detail("")), 0)
    }

    func testHeaderCount() {
        XCTAssertEqual(EfficiencyProjection.headerCount(from: sampleStats()), 7)
        XCTAssertNil(EfficiencyProjection.headerCount(from: nil))
    }
}

// MARK: - Accessibility summary content

final class EfficiencyAccessibilityTests: XCTestCase {
    func testAverageLabelCombinesLabelAndValue() {
        let tiles = EfficiencyProjection.metrics(from: sampleStats(), localize: echo, locale: enUS, timeZone: .gmt)
        let average = tiles.first { $0.id == "average" }
        XCTAssertEqual(average?.accessibilityLabel, "Average Efficiency, 85.43%")
    }

    func testWallLossLabelCombinesLabelValueAndDetail() {
        let tiles = EfficiencyProjection.metrics(from: sampleStats(), localize: echo, locale: enUS, timeZone: .gmt)
        let wallLoss = tiles.first { $0.id == "wallLoss" }
        XCTAssertEqual(
            wallLoss?.accessibilityLabel,
            "Wall-to-Battery Loss, 3.20 kWh, 1,234.50 kWh → 1,234.50 kWh"
        )
    }
}

// MARK: - Phase resolution

final class EfficiencyPhaseTests: XCTestCase {
    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.loading, hasValue: false), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.loading, hasValue: true), .content)
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.empty, hasValue: false), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.loaded, hasValue: false), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.loaded, hasValue: true), .content)
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.failed("boom"), hasValue: false), .error("boom"))
    }

    func testFailedWithCachedDataStaysContent() {
        XCTAssertEqual(EfficiencyProjection.resolvePhase(.failed("boom"), hasValue: true), .content)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor
final class EfficiencyPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: EfficiencyPanelUpdate,
        telemetry: EfficiencyPanelTelemetry = OSLogEfficiencyPanelTelemetry()
    ) -> (EfficiencyPanelModel, InMemoryEfficiencyPanelSource) {
        let source = InMemoryEfficiencyPanelSource(initial: update)
        let model = EfficiencyPanelModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyEfficiencyPanelTelemetry()
        let (model, source) = makeModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .live),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.metrics.count, 4)
        XCTAssertEqual(model.headerCount, 7)
        XCTAssertEqual(spy.surfaces, [EfficiencyPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EfficiencyPanelUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhaseWithFallbackTiles() {
        let (model, _) = makeModel(EfficiencyPanelUpdate(status: .empty, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.metrics.count, 4)
        XCTAssertNil(model.headerCount)
        XCTAssertEqual(model.metrics.first { $0.id == "average" }?.value, "—")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .live)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .stale))
        source.push(EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)
        source.push(EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .live))
        source.push(EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .live)
        )
        model.start()
        source.push(EfficiencyPanelUpdate(status: .loaded, input: sampleStats(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEfficiencyPanelTelemetry: EfficiencyPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
