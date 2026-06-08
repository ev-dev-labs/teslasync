//
//  StatorTempChart.Tests.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  Unit coverage for the StatorTempChart surface:
//    • Adapter (cached → projection) — `convertStatorTempFromSI` (°C / °F), the `displayValue` nil /
//      non-finite gap, the time-label port of `formatTime`, the three-series catalog, the
//      `connectNulls` chart rows, the converted Normal / Warm threshold lines, the axis tick
//      thinning, the `data.length <= 1` render gate, the number formatting, and phase resolution.
//    • State holder — `StatorTempChartModel` phase resolution across loading / empty / error /
//      content, the unit-aware projection, the refresh delegation, the stale auto-refresh (once per
//      episode), the connection / refreshing tracking, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the chart + per-point VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryStatorTempSource`. String assertions check the web English fallbacks
//  (the per-surface table folds into the master catalog at integration time, so it resolves to the
//  `value:` fallback in the un-integrated bundle).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion / display value / formatting (web parity)

final class StatorTempAdapterTests: XCTestCase {
    private let locale = "en_US"

    func testConvertCelsiusIsIdentity() {
        XCTAssertEqual(convertStatorTempFromSI(60, to: .celsius), 60, accuracy: 0.0001)
        XCTAssertEqual(convertStatorTempFromSI(-12.5, to: .celsius), -12.5, accuracy: 0.0001)
    }

    func testConvertFahrenheitMatchesWebFormula() {
        XCTAssertEqual(convertStatorTempFromSI(0, to: .fahrenheit), 32, accuracy: 0.0001)
        XCTAssertEqual(convertStatorTempFromSI(25, to: .fahrenheit), 77, accuracy: 0.0001)
        XCTAssertEqual(convertStatorTempFromSI(-40, to: .fahrenheit), -40, accuracy: 0.0001)
    }

    func testUnitResolvesFromSymbol() {
        XCTAssertEqual(StatorTempUnit.from(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(StatorTempUnit.from(symbol: "°C"), .celsius)
        XCTAssertEqual(StatorTempUnit.from(symbol: "??"), .celsius)
    }

    func testDisplayValuePreservesNilAndNonFinite() {
        XCTAssertNil(StatorTempProjector.displayValue(nil, unit: .celsius))
        XCTAssertNil(StatorTempProjector.displayValue(.nan, unit: .celsius))
        XCTAssertNil(StatorTempProjector.displayValue(.infinity, unit: .celsius))
        XCTAssertEqual(StatorTempProjector.displayValue(25, unit: .celsius) ?? -1, 25, accuracy: 0.0001)
        XCTAssertEqual(StatorTempProjector.displayValue(25, unit: .fahrenheit) ?? -1, 77, accuracy: 0.0001)
    }

    func testNumberFormattingUpToOneDecimal() {
        XCTAssertEqual(StatorTempFormat.decimal(60, localeIdentifier: locale), "60")
        XCTAssertEqual(StatorTempFormat.decimal(61.45, localeIdentifier: locale), "61.5")
        XCTAssertEqual(StatorTempFormat.decimal(.nan, localeIdentifier: locale), "—")
    }

    func testTemperatureFormattingAppendsUnitAndHandlesNil() {
        XCTAssertEqual(StatorTempFormat.temperature(61.5, unit: "°C", localeIdentifier: locale), "61.5 °C")
        XCTAssertEqual(StatorTempFormat.temperature(nil, unit: "°C", localeIdentifier: locale), "—")
    }

    func testTimeLabelNilIsEmptyAndKnownTimestampFormats() throws {
        XCTAssertEqual(StatorTempProjector.timeLabel(for: nil), "")
        let date = Date(timeIntervalSince1970: 1_717_790_400) // 2024-06-07 20:00:00 UTC
        let label = try StatorTempProjector.timeLabel(
            for: date,
            localeIdentifier: "en_US",
            timeZone: XCTUnwrap(TimeZone(identifier: "UTC"))
        )
        XCTAssertTrue(label.contains("8:00"), "expected an 8:00 PM-style label, got \(label)")
    }
}

// MARK: - Adapter: series + thresholds + rows + axis (web grid)

final class StatorTempProjectorTests: XCTestCase {
    private let locale = "en_US"

    func testSeriesOrderColorsAndKeys() {
        let series = StatorSeries.ordered
        XCTAssertEqual(series.map(\.id), ["front", "rearLeft", "rearRight"])
        XCTAssertEqual(series.map(\.color), [.temperature, .power, .regen])
        XCTAssertEqual(
            series.map(\.nameKey),
            ["drivetrain.statorTemp", "drivetrain.statorTempRearLeft", "drivetrain.statorTempRearRight"]
        )
        XCTAssertEqual(
            series.map(\.shortKey),
            ["drivetrain.col.stator", "drivetrain.col.statorRel", "drivetrain.col.statorRer"]
        )
    }

    func testThresholdLinesCelsius() {
        let lines = StatorTempProjector.thresholdLines(unit: .celsius)
        XCTAssertEqual(lines.map(\.threshold), [.normal, .warm])
        XCTAssertEqual(lines[0].value, 60, accuracy: 0.0001)
        XCTAssertEqual(lines[1].value, 80, accuracy: 0.0001)
    }

    func testThresholdLinesFahrenheitConverted() {
        let lines = StatorTempProjector.thresholdLines(unit: .fahrenheit)
        XCTAssertEqual(lines[0].value, 140, accuracy: 0.0001) // 60 °C
        XCTAssertEqual(lines[1].value, 176, accuracy: 0.0001) // 80 °C
    }

    func testChartRowsSkipNullReadings() {
        let point = StatorTempPoint(index: 0, timeLabel: "t", front: 55, rearLeft: 52, rearRight: nil)
        let rows = StatorTempProjector.chartRows(from: [point])
        XCTAssertEqual(rows.map(\.series), [.front, .rearLeft])
        XCTAssertEqual(rows.map(\.value), [55, 52])
    }

    func testProjectConvertsSeriesAndThresholds() {
        let snapshots = [
            StatorTempSnapshot(timestamp: nil, frontC: 0, rearLeftC: 25, rearRightC: 100),
            StatorTempSnapshot(timestamp: nil, frontC: 10, rearLeftC: 20, rearRightC: 30)
        ]
        let projection = StatorTempProjector.project(snapshots: snapshots, unit: .fahrenheit, localeIdentifier: locale)
        XCTAssertEqual(projection.unitSymbol, "°F")
        XCTAssertEqual(projection.points.count, 2)
        XCTAssertEqual(projection.points[0].front ?? -1, 32, accuracy: 0.0001)
        XCTAssertEqual(projection.points[0].rearLeft ?? -1, 77, accuracy: 0.0001)
        XCTAssertEqual(projection.points[0].rearRight ?? -1, 212, accuracy: 0.0001)
        XCTAssertEqual(projection.thresholds[0].value, 140, accuracy: 0.0001)
    }

    func testProjectPreservesNullGap() {
        let snapshots = [
            StatorTempSnapshot(timestamp: nil, frontC: 50, rearLeftC: nil, rearRightC: 40),
            StatorTempSnapshot(timestamp: nil, frontC: 55, rearLeftC: 45, rearRightC: nil)
        ]
        let projection = StatorTempProjector.project(snapshots: snapshots, unit: .celsius, localeIdentifier: locale)
        XCTAssertNil(projection.points[0].rearLeft)
        XCTAssertNil(projection.points[1].rearRight)
        // Two points × three series minus the two null readings → four rows.
        XCTAssertEqual(projection.rows.count, 4)
    }

    func testRenderGateMatchesWebDataLength() {
        // Web `data.length <= 1` returns null → not renderable.
        XCTAssertFalse(StatorTempProjector.project(snapshots: [], unit: .celsius).hasRenderableData)
        let single = [StatorTempSnapshot(timestamp: nil, frontC: 55, rearLeftC: nil, rearRightC: nil)]
        XCTAssertFalse(StatorTempProjector.project(snapshots: single, unit: .celsius).hasRenderableData)
        let pair = single + single
        XCTAssertTrue(StatorTempProjector.project(snapshots: pair, unit: .celsius).hasRenderableData)
    }

    func testAxisTickIndices() {
        XCTAssertEqual(StatorTempProjector.axisTickIndices(pointCount: 0), [])
        XCTAssertEqual(StatorTempProjector.axisTickIndices(pointCount: 1), [0])
        XCTAssertEqual(StatorTempProjector.axisTickIndices(pointCount: 2), [0, 1])
        XCTAssertEqual(StatorTempProjector.axisTickIndices(pointCount: 3, maxTicks: 6), [0, 1, 2])
        XCTAssertEqual(StatorTempProjector.axisTickIndices(pointCount: 8, maxTicks: 6), [0, 1, 3, 4, 6, 7])
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(StatorTempProjector.resolvePhase(.loading, hasRenderableData: false), .loading)
        XCTAssertEqual(StatorTempProjector.resolvePhase(.loading, hasRenderableData: true), .loading)
        XCTAssertEqual(StatorTempProjector.resolvePhase(.loaded, hasRenderableData: false), .empty)
        XCTAssertEqual(StatorTempProjector.resolvePhase(.loaded, hasRenderableData: true), .content)
        XCTAssertEqual(StatorTempProjector.resolvePhase(.failed("e"), hasRenderableData: true), .error("e"))
        XCTAssertEqual(StatorTempProjector.resolvePhase(.failed("e"), hasRenderableData: false), .error("e"))
    }
}

// MARK: - State holder: phases + projection + refresh + telemetry

@MainActor
final class StatorTempModelTests: XCTestCase {
    private func makeModel(
        _ update: StatorTempUpdate,
        telemetry: StatorTempChartTelemetry = OSLogStatorTempChartTelemetry()
    ) -> (StatorTempChartModel, InMemoryStatorTempSource) {
        let source = InMemoryStatorTempSource(initial: update)
        let model = StatorTempChartModel(source: source, telemetry: telemetry, timeZone: TimeZone(identifier: "UTC")!)
        return (model, source)
    }

    private func sampleSnapshots() -> [StatorTempSnapshot] {
        [
            StatorTempSnapshot(
                timestamp: Date(timeIntervalSince1970: 1_717_790_400),
                frontC: 50,
                rearLeftC: 48,
                rearRightC: 45
            ),
            StatorTempSnapshot(
                timestamp: Date(timeIntervalSince1970: 1_717_790_460),
                frontC: 58,
                rearLeftC: 55,
                rearRightC: 52
            ),
            StatorTempSnapshot(
                timestamp: Date(timeIntervalSince1970: 1_717_790_520),
                frontC: 66,
                rearLeftC: 62,
                rearRightC: 59
            )
        ]
    }

    func testInitialContentPhase() {
        let (model, _) = makeModel(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 3)
        XCTAssertFalse(model.rows.isEmpty)
        XCTAssertEqual(model.thresholds.count, 2)
    }

    func testLoadedSingleSnapshotIsEmpty() {
        let single = [StatorTempSnapshot(timestamp: Date(), frontC: 55, rearLeftC: 52, rearRightC: 49)]
        let (model, _) = makeModel(StatorTempUpdate(status: .loaded, snapshots: single))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedNoSnapshotsIsEmpty() {
        let (model, _) = makeModel(StatorTempUpdate(status: .loaded, snapshots: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingPhase() {
        let (model, _) = makeModel(StatorTempUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorPhase() {
        let (model, _) = makeModel(StatorTempUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testProjectionHonorsUnitPreference() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loading))
        model.start()
        source.push(
            StatorTempUpdate(
                status: .loaded,
                snapshots: [
                    StatorTempSnapshot(timestamp: nil, frontC: 25, rearLeftC: 0, rearRightC: 100),
                    StatorTempSnapshot(timestamp: nil, frontC: 30, rearLeftC: 10, rearRightC: 90)
                ],
                units: StatorTempUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")
            )
        )
        XCTAssertEqual(model.projection.unitSymbol, "°F")
        XCTAssertEqual(model.points[0].front ?? -1, 77, accuracy: 0.0001)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots(), connection: .stale))
        source.push(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots(), connection: .live))
        source.push(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots()))
        model.start()
        source.push(StatorTempUpdate(status: .loaded, snapshots: sampleSnapshots(), connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loading))
        model.start()
        source.push(
            StatorTempUpdate(
                status: .loaded,
                snapshots: sampleSnapshots(),
                connection: .offline,
                refreshing: true,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyStatorTempTelemetry()
        let (model, source) = makeModel(StatorTempUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StatorTempChart.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopDelegates() {
        let (model, source) = makeModel(StatorTempUpdate(status: .loading))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summaries

final class StatorTempAccessibilityTests: XCTestCase {
    private let localize: (String, String) -> String = { _, fallback in fallback }

    func testChartSummaryWithData() {
        let projection = StatorTempProjector.project(
            snapshots: [
                StatorTempSnapshot(timestamp: nil, frontC: 50, rearLeftC: 48, rearRightC: 45),
                StatorTempSnapshot(timestamp: nil, frontC: 60, rearLeftC: 58, rearRightC: 55)
            ],
            unit: .celsius
        )
        let summary = StatorTempAccessibility.chartSummary(projection: projection, localize: localize)
        XCTAssertTrue(summary.contains("Stator Temperature History"))
        XCTAssertTrue(summary.contains("2 snapshots"))
        XCTAssertTrue(summary.contains("Latest"))
    }

    func testChartSummaryEmpty() {
        let projection = StatorTempProjector.project(snapshots: [], unit: .celsius)
        let summary = StatorTempAccessibility.chartSummary(projection: projection, localize: localize)
        XCTAssertTrue(summary.contains("No stator temperature history"))
    }

    func testPointLabelSkipsAbsentReadings() {
        let point = StatorTempPoint(index: 0, timeLabel: "8:00 PM", front: 61.5, rearLeft: nil, rearRight: 49)
        let label = StatorTempAccessibility.pointLabel(point, unit: "°C", localize: localize)
        XCTAssertEqual(label, "8:00 PM: Stator 61.5 °C, Rear-Right 49 °C")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyStatorTempTelemetry: StatorTempChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
