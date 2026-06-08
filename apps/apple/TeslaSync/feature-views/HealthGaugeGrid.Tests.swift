//
//  HealthGaugeGrid.Tests.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  Logic coverage for the Drivetrain Health gauge-grid surface (the per-state view-render smoke
//  tests live in HealthGaugeGrid.ViewTests.swift):
//    • Adapter (cached → projection) — `HealthGaugeFormat` number/integer/jsNumberString parity
//      with the web `fmtNumber`/`fmtInt`/`${value}`, the SI→display distance + speed converters
//      ported from `lib/unitConversion.ts`, and the `HealthGaugeGridProjector` (gauge clamp +
//      decimals + fill fraction + status, the four motor rows, the four drive rows, and the
//      `stats === undefined` nil-rows branch).
//    • State holder — `HealthGaugeGridModel` phase resolution, projection recompute, refresh
//      delegation, the stale one-shot auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver gauge + row + surface summaries.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryHealthGaugeGridSource`).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web parity)

@MainActor
final class HealthGaugeFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(HealthGaugeFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(HealthGaugeFormat.number(72, decimals: 1), "72.0")
        XCTAssertEqual(HealthGaugeFormat.number(0, decimals: 0), "0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(HealthGaugeFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(HealthGaugeFormat.number(2.5, decimals: 0), "3")
        XCTAssertEqual(HealthGaugeFormat.number(67.108, decimals: 1), "67.1")
    }

    func testIntegerGroupsWholeNumbers() {
        XCTAssertEqual(HealthGaugeFormat.integer(1284), "1,284")
        XCTAssertEqual(HealthGaugeFormat.integer(11519.7), "11,520")
        XCTAssertEqual(HealthGaugeFormat.integer(0), "0")
    }

    func testJSNumberStringIsLocaleFreeAndTrimsTrailingZeros() {
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(95), "95")
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(95.0), "95")
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(87.5), "87.5")
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(1234), "1234") // no grouping (template literal)
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(-5), "-5")
        XCTAssertEqual(HealthGaugeFormat.jsNumberString(.nan), "0")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(HealthGaugeFormat.safeNumber(.nan), 0)
        XCTAssertEqual(HealthGaugeFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(HealthGaugeFormat.safeNumber(42.5), 42.5)
    }
}

// MARK: - Adapter: SI converters (web parity)

@MainActor
final class HealthGaugeConverterTests: XCTestCase {
    func testDistanceConverterMatchesWebConstants() {
        XCTAssertEqual(convertHealthDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHealthDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHealthDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertHealthDistanceFromSI(12000, to: .kilometers), 12, accuracy: 1e-9)
    }

    func testSpeedConverterMatchesWebConstants() {
        XCTAssertEqual(convertHealthSpeedFromSI(10, to: .kilometersPerHour), 36, accuracy: 1e-9)
        XCTAssertEqual(convertHealthSpeedFromSI(20, to: .kilometersPerHour), 72, accuracy: 1e-9)
        XCTAssertEqual(convertHealthSpeedFromSI(20, to: .milesPerHour), 72000 / 1609.344, accuracy: 1e-9)
    }
}

// MARK: - Adapter: projector (web parity)

@MainActor
final class HealthGaugeGridProjectorTests: XCTestCase {
    private func row(_ id: String, in rows: [HealthDetailRow]?) -> HealthDetailRow? {
        rows?.first { $0.id == id }
    }

    private func sampleStats() -> DriveStatsInput {
        DriveStatsInput(
            totalDrives: 1284,
            totalDistanceMeters: 12000,
            avgSpeedMetersPerSecond: 20,
            topSpeedMetersPerSecond: 30
        )
    }

    private func sample(
        health: HealthGaugeGridDrivetrainHealthStatus = .good,
        score: Double = 95,
        includeStats: Bool = true
    ) -> DrivetrainHealthInput {
        DrivetrainHealthInput(
            overallHealth: health,
            healthScore: score,
            motorStatus: "Optimal",
            activeSensorCount: 6,
            stats: includeStats ? sampleStats() : nil
        )
    }

    func testGaugeClampDecimalsFractionAndStatus() {
        let projection = HealthGaugeGridProjector.project(data: sample(), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(projection.gauge.valueText, "95")
        XCTAssertEqual(projection.gauge.unit, "%")
        XCTAssertEqual(projection.gauge.fraction, 0.95, accuracy: 1e-9)
        XCTAssertEqual(projection.gauge.status, .good)
    }

    func testGaugeNonIntegerUsesGlobalPrecision() {
        let projection = HealthGaugeGridProjector.project(data: sample(score: 87.5), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(projection.gauge.valueText, "87.50") // global precision (2) for non-integers
        XCTAssertEqual(projection.gauge.fraction, 0.875, accuracy: 1e-9)
    }

    func testGaugeClampsOutOfRangeScores() {
        let high = HealthGaugeGridProjector.project(data: sample(score: 120), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(high.gauge.valueText, "100")
        XCTAssertEqual(high.gauge.fraction, 1, accuracy: 1e-9)

        let low = HealthGaugeGridProjector.project(data: sample(score: -5), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(low.gauge.valueText, "0")
        XCTAssertEqual(low.gauge.fraction, 0, accuracy: 1e-9)
    }

    func testMotorRowsOrderAndValues() {
        let projection = HealthGaugeGridProjector.project(data: sample(score: 95), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(projection.motorRows.map(\.id), ["motorStatus", "overallHealth", "healthScore", "sensorCount"])
        XCTAssertEqual(row("motorStatus", in: projection.motorRows)?.value, "Optimal")
        XCTAssertEqual(row("overallHealth", in: projection.motorRows)?.value, "Good")
        XCTAssertEqual(row("healthScore", in: projection.motorRows)?.value, "95%") // raw ${score}%
        XCTAssertEqual(row("sensorCount", in: projection.motorRows)?.value, "6") // String(count), no grouping
    }

    func testOverallHealthValueTracksStatus() {
        let warning = HealthGaugeGridProjector.project(data: sample(health: .warning), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(row("overallHealth", in: warning.motorRows)?.value, "Warning")
        let critical = HealthGaugeGridProjector.project(data: sample(health: .critical), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(row("overallHealth", in: critical.motorRows)?.value, "Critical")
    }

    func testHealthScoreRowUsesRawNumberNotClamped() {
        let projection = HealthGaugeGridProjector.project(data: sample(score: 87.5), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(row("healthScore", in: projection.motorRows)?.value, "87.5%")
        let over = HealthGaugeGridProjector.project(data: sample(score: 120), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(row("healthScore", in: over.motorRows)?.value, "120%") // raw, unclamped
    }

    func testDriveRowsMetricAndImperial() {
        let metric = HealthGaugeGridProjector.project(data: sample(), units: HealthGaugeUnitPrefs())
        XCTAssertEqual(metric.driveRows?.map(\.id), ["totalDrives", "totalDistance", "avgSpeed", "topSpeed"])
        XCTAssertEqual(row("totalDrives", in: metric.driveRows)?.value, "1,284")
        XCTAssertEqual(row("totalDistance", in: metric.driveRows)?.value, "12 km")
        XCTAssertEqual(row("avgSpeed", in: metric.driveRows)?.value, "72.0 km/h")
        XCTAssertEqual(row("topSpeed", in: metric.driveRows)?.value, "108.0 km/h")

        let imperial = HealthGaugeGridProjector.project(
            data: sample(),
            units: HealthGaugeUnitPrefs(distance: .miles, speed: .milesPerHour)
        )
        XCTAssertEqual(row("totalDistance", in: imperial.driveRows)?.value, "7 mi") // 12000 m → 7.456 mi → fmtInt
        XCTAssertEqual(row("avgSpeed", in: imperial.driveRows)?.value, "44.7 mph")
        XCTAssertEqual(row("topSpeed", in: imperial.driveRows)?.value, "67.1 mph")
    }

    func testNilStatsProducesNilDriveRows() {
        let projection = HealthGaugeGridProjector.project(
            data: sample(includeStats: false),
            units: HealthGaugeUnitPrefs()
        )
        XCTAssertNil(projection.driveRows)
        XCTAssertFalse(projection.hasDriveStats)
        XCTAssertEqual(projection.motorRows.count, 4) // the other panels still project
        XCTAssertEqual(projection.gauge.valueText, "95")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class HealthGaugeGridModelTests: XCTestCase {
    private func makeModel(
        _ update: HealthGaugeGridUpdate,
        telemetry: HealthGaugeGridTelemetry = OSLogHealthGaugeGridTelemetry()
    ) -> (HealthGaugeGridModel, InMemoryHealthGaugeGridSource) {
        let source = InMemoryHealthGaugeGridSource(initial: update)
        let model = HealthGaugeGridModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> DrivetrainHealthInput {
        DrivetrainHealthInput(
            overallHealth: .good,
            healthScore: 95,
            motorStatus: "Optimal",
            activeSensorCount: 6,
            stats: DriveStatsInput(
                totalDrives: 12,
                totalDistanceMeters: 5000,
                avgSpeedMetersPerSecond: 10,
                topSpeedMetersPerSecond: 20
            )
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(HealthGaugeGridModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsAllPanels() {
        let (model, _) = makeModel(HealthGaugeGridUpdate(status: .loaded, data: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.motorRows.count, 4)
        XCTAssertEqual(model.projection?.driveRows?.count, 4)
        XCTAssertEqual(model.projection?.gauge.valueText, "95")
    }

    func testEmptyLoadingErrorPhases() {
        let (empty, _) = makeModel(HealthGaugeGridUpdate(status: .empty, data: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(HealthGaugeGridUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(HealthGaugeGridUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedPanelsStayContentWhileFailing() {
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthGaugeGridUpdate(status: .failed("net"), connection: .offline, data: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loading))
        model.start()
        source.push(
            HealthGaugeGridUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                data: sample(),
                units: HealthGaugeUnitPrefs(distance: .miles, speed: .milesPerHour),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.units.speed, .milesPerHour)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loaded, data: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loaded, data: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0) // live → no refresh
        source.push(HealthGaugeGridUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1) // stale → one auto-refresh
        source.push(HealthGaugeGridUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 1) // still stale → guarded, no extra refresh
        source.push(HealthGaugeGridUpdate(status: .loaded, connection: .live, data: sample()))
        source.push(HealthGaugeGridUpdate(status: .loaded, connection: .stale, data: sample()))
        XCTAssertEqual(source.refreshCount, 2) // re-armed after live → refreshes again
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loaded, data: sample()))
        model.start()
        source.push(HealthGaugeGridUpdate(status: .loaded, connection: .offline, data: sample()))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHealthGaugeGridTelemetry()
        let (model, source) = makeModel(HealthGaugeGridUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HealthGaugeGridSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor
final class HealthGaugeGridAccessibilityTests: XCTestCase {
    private func data(includeStats: Bool) -> DrivetrainHealthInput {
        DrivetrainHealthInput(
            overallHealth: includeStats ? .good : .warning,
            healthScore: includeStats ? 95 : 60,
            motorStatus: includeStats ? "Optimal" : "Degraded",
            activeSensorCount: includeStats ? 6 : 3,
            stats: includeStats
                ? DriveStatsInput(
                    totalDrives: 1284,
                    totalDistanceMeters: 12000,
                    avgSpeedMetersPerSecond: 20,
                    topSpeedMetersPerSecond: 30
                )
                : nil
        )
    }

    func testSummaryIncludesGaugeMotorAndDriveRows() {
        let projection = HealthGaugeGridProjector.project(data: data(includeStats: true), units: HealthGaugeUnitPrefs())
        let summary = HealthGaugeGridAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Health Score 95%"))
        XCTAssertTrue(summary.contains("Motor Status Optimal"))
        XCTAssertTrue(summary.contains("Overall Health Good"))
        XCTAssertTrue(summary.contains("Active Sensors 6"))
        XCTAssertTrue(summary.contains("Total Drives 1,284"))
        XCTAssertTrue(summary.contains("Total Distance 12 km"))
    }

    func testSummaryOmitsDriveRowsWhenStatsAbsent() {
        let projection = HealthGaugeGridProjector.project(
            data: data(includeStats: false),
            units: HealthGaugeUnitPrefs()
        )
        let summary = HealthGaugeGridAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Overall Health Warning"))
        XCTAssertFalse(summary.contains("Total Drives"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
final class SpyHealthGaugeGridTelemetry: HealthGaugeGridTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
