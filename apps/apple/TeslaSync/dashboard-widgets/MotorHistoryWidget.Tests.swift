//
//  MotorHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0066 · MotorHistoryWidget (Apple)
//
//  Unit coverage for the MotorHistoryWidget surface:
//    • Adapter (cached → projection) — `MotorHistoryProjectionBuilder` parity with
//      the web `buildChartData` + the widget's derived values.
//    • Scale — the dual-axis temp↔torque mapping used by the chart.
//    • State holder — `MotorHistoryModel` phase resolution + P1/S11 telemetry.
//    • Registry — canonical `motor-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryMotorHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached rows → projection (port of buildChartData)

final class MotorHistoryAdapterTests: XCTestCase {
    private func snapshot(
        ts: String?,
        torque: Double? = nil,
        stator: Double? = nil,
        motorFront: Double? = nil,
        gear: String? = nil,
        shift: String? = nil,
        lateral: Double? = nil,
        longitudinal: Double? = nil
    ) -> MotorSnapshotInput {
        MotorSnapshotInput(
            ts: ts,
            diTorque: torque,
            diStatorTemp: stator,
            motorTempCFront: motorFront,
            gear: gear,
            shiftState: shift,
            lateralAccel: lateral,
            longitudinalAccel: longitudinal
        )
    }

    func testEmptyWhenNoSnapshots() {
        let projection = MotorHistoryProjectionBuilder.build(snapshots: [], measurement: .metric)
        XCTAssertFalse(projection.hasData)
        XCTAssertNil(projection.latestTorque)
        XCTAssertNil(projection.latestStatorTemp)
    }

    func testRowsWithoutTimestampAreDropped() {
        let rows = [
            snapshot(ts: nil, torque: 100),
            snapshot(ts: "   ", torque: 110),
            snapshot(ts: "2024-01-01T00:00:00Z", torque: 120)
        ]
        let projection = MotorHistoryProjectionBuilder.build(snapshots: rows, measurement: .metric)
        XCTAssertEqual(projection.data.count, 1)
        XCTAssertEqual(projection.data.first?.torque, 120)
    }

    func testCreatedAtFallbackWhenTsMissing() {
        let row = MotorSnapshotInput(createdAt: "2024-01-01T00:00:00Z", diTorque: 90)
        let projection = MotorHistoryProjectionBuilder.build(snapshots: [row], measurement: .metric)
        XCTAssertEqual(projection.data.count, 1)
        XCTAssertEqual(projection.data.first?.torque, 90)
    }

    func testSortsAscendingByTime() {
        let rows = [
            snapshot(ts: "2024-01-01T00:00:30Z", torque: 3),
            snapshot(ts: "2024-01-01T00:00:00Z", torque: 1),
            snapshot(ts: "2024-01-01T00:00:15Z", torque: 2)
        ]
        let projection = MotorHistoryProjectionBuilder.build(snapshots: rows, measurement: .metric)
        XCTAssertEqual(projection.data.map(\.torque), [1, 2, 3])
    }

    func testStatorFallsBackToMotorTempFront() {
        let withStator = snapshot(ts: "2024-01-01T00:00:00Z", stator: 80)
        let withFront = snapshot(ts: "2024-01-01T00:00:00Z", motorFront: 65)
        XCTAssertEqual(
            MotorHistoryProjectionBuilder.build(snapshots: [withStator], measurement: .metric).data.first?.statorTemp,
            80
        )
        XCTAssertEqual(
            MotorHistoryProjectionBuilder.build(snapshots: [withFront], measurement: .metric).data.first?.statorTemp,
            65
        )
    }

    func testGearFallsBackToShiftState() {
        let viaGear = snapshot(ts: "2024-01-01T00:00:00Z", gear: "D")
        let viaShift = snapshot(ts: "2024-01-01T00:00:00Z", shift: "R")
        XCTAssertEqual(
            MotorHistoryProjectionBuilder.build(snapshots: [viaGear], measurement: .metric).data.first?.gear,
            "D"
        )
        XCTAssertEqual(
            MotorHistoryProjectionBuilder.build(snapshots: [viaShift], measurement: .metric).data.first?.gear,
            "R"
        )
    }

    func testTemperatureConvertedToImperial() {
        let row = snapshot(ts: "2024-01-01T00:00:00Z", stator: 100)
        let metric = MotorHistoryProjectionBuilder.build(snapshots: [row], measurement: .metric)
        let imperial = MotorHistoryProjectionBuilder.build(snapshots: [row], measurement: .imperial)
        XCTAssertEqual(metric.data.first?.statorTemp, 100)
        XCTAssertEqual(imperial.data.first?.statorTemp, 212)
        XCTAssertEqual(metric.temperatureUnitLabel, "°C")
        XCTAssertEqual(imperial.temperatureUnitLabel, "°F")
    }

    func testLatestSkipsTrailingNils() {
        let rows = [
            snapshot(ts: "2024-01-01T00:00:00Z", torque: 100, stator: 60),
            snapshot(ts: "2024-01-01T00:00:30Z", torque: 50, stator: 70),
            snapshot(ts: "2024-01-01T00:01:00Z", torque: nil, stator: nil)
        ]
        let projection = MotorHistoryProjectionBuilder.build(snapshots: rows, measurement: .metric)
        XCTAssertEqual(projection.latestTorque, 50)
        XCTAssertEqual(projection.latestStatorTemp, 70)
    }

    func testDangerThresholdMatchesUnit() {
        let metric = MotorHistoryProjectionBuilder.build(snapshots: [], measurement: .metric)
        let imperial = MotorHistoryProjectionBuilder.build(snapshots: [], measurement: .imperial)
        XCTAssertEqual(metric.dangerThreshold, 100)
        XCTAssertEqual(imperial.dangerThreshold, 212)
    }

    func testTempMaxExpandsPastHottestReading() {
        let cool = snapshot(ts: "2024-01-01T00:00:00Z", stator: 70)
        let hot = snapshot(ts: "2024-01-01T00:00:30Z", stator: 180)
        let projection = MotorHistoryProjectionBuilder.build(snapshots: [cool, hot], measurement: .metric)
        // danger(100) + 20 = 120 floor, expanded to the 180 reading.
        XCTAssertEqual(projection.scale.tempMax, 180)
    }

    func testTempMaxFloorIsDangerPlusTwenty() {
        let row = snapshot(ts: "2024-01-01T00:00:00Z", stator: 40)
        let projection = MotorHistoryProjectionBuilder.build(snapshots: [row], measurement: .metric)
        XCTAssertEqual(projection.scale.tempMax, 120)
    }

    func testTorqueMaxNiceCeilingAndFallback() {
        let none = MotorHistoryProjectionBuilder.build(
            snapshots: [snapshot(ts: "2024-01-01T00:00:00Z", stator: 50)],
            measurement: .metric
        )
        XCTAssertEqual(none.scale.torqueMax, 100, "no torque rows → sane left-axis fallback")

        let big = MotorHistoryProjectionBuilder.build(
            snapshots: [snapshot(ts: "2024-01-01T00:00:00Z", torque: 412)],
            measurement: .metric
        )
        XCTAssertEqual(big.scale.torqueMax, 450)
    }

    func testGForcesCarriedThrough() {
        let row = snapshot(ts: "2024-01-01T00:00:00Z", torque: 100, lateral: 0.5, longitudinal: -0.3)
        let datum = MotorHistoryProjectionBuilder.build(snapshots: [row], measurement: .metric).data.first
        XCTAssertEqual(datum?.lateralG, 0.5)
        XCTAssertEqual(datum?.longitudinalG, -0.3)
    }
}

// MARK: - Scale: temp ↔ torque plotting space

final class MotorHistoryScaleTests: XCTestCase {
    func testTempToTorqueRoundTrips() {
        let scale = MotorChartScale(torqueMax: 450, tempMax: 120)
        let projected = scale.tempToTorque(100)
        XCTAssertEqual(projected, 375, accuracy: 0.0001)
        XCTAssertEqual(scale.torqueToTemp(projected), 100, accuracy: 0.0001)
    }

    func testTopOfTempMapsToTorqueMax() {
        let scale = MotorChartScale(torqueMax: 450, tempMax: 120)
        XCTAssertEqual(scale.tempToTorque(120), 450, accuracy: 0.0001)
    }

    func testGuardsAgainstZeroDenominators() {
        let zeroTemp = MotorChartScale(torqueMax: 100, tempMax: 0)
        XCTAssertEqual(zeroTemp.tempToTorque(50), 0)
        let zeroTorque = MotorChartScale(torqueMax: 0, tempMax: 120)
        XCTAssertEqual(zeroTorque.torqueToTemp(50), 0)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class MotorHistoryModelTests: XCTestCase {
    private func loaded(_ torque: Double = 120) -> MotorHistoryUpdate {
        MotorHistoryUpdate(
            status: .loaded,
            snapshots: [MotorSnapshotInput(ts: "2024-01-01T00:00:00Z", diTorque: torque, diStatorTemp: 80)]
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .loading, hasData: false), .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testFailedWithoutCacheShowsError() {
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
    }

    func testCachedDataKeepsContentWhileFetchingOrFailed() {
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(MotorHistoryModel.resolvePhase(status: .failed("net"), hasData: true), .content)
    }

    func testModelProjectsLoadedData() {
        let source = InMemoryMotorHistorySource(initial: loaded())
        let model = MotorHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.latestTorque, 120)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyMotorHistoryTelemetry()
        let source = InMemoryMotorHistorySource(initial: MotorHistoryUpdate(status: .loading))
        let model = MotorHistoryModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MotorHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryMotorHistorySource(initial: loaded())
        let model = MotorHistoryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndMeasurementTrackUpdates() {
        let source = InMemoryMotorHistorySource(initial: MotorHistoryUpdate(status: .loading))
        let model = MotorHistoryModel(source: source)
        model.start()
        source.push(
            MotorHistoryUpdate(
                status: .loaded,
                connection: .offline,
                snapshots: [MotorSnapshotInput(ts: "2024-01-01T00:00:00Z", diTorque: 10, diStatorTemp: 90)],
                measurement: .imperial,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.temperatureUnitLabel, "°F")
    }
}

// MARK: - Registry parity

final class MotorHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MotorHistoryWidget.registration
        XCTAssertEqual(registration.id, "motor-history")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MotorHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class MotorHistoryAccessibilityTests: XCTestCase {
    func testSummaryIncludesLatestTorqueAndStator() {
        let projection = MotorHistoryProjectionBuilder.build(
            snapshots: [MotorSnapshotInput(ts: "2024-01-01T00:00:00Z", diTorque: 240, diStatorTemp: 75)],
            measurement: .metric
        )
        let summary = MotorHistoryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Torque"))
        XCTAssertTrue(summary.contains("240"))
        XCTAssertTrue(summary.contains("Stator"))
        XCTAssertTrue(summary.contains("75"))
    }

    func testSummaryFlagsDangerWhenHot() {
        let projection = MotorHistoryProjectionBuilder.build(
            snapshots: [MotorSnapshotInput(ts: "2024-01-01T00:00:00Z", diTorque: 10, diStatorTemp: 130)],
            measurement: .metric
        )
        let summary = MotorHistoryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("above safe stator temperature"))
    }

    func testSummaryEmptyState() {
        let summary = MotorHistoryAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No motor history")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMotorHistoryTelemetry: MotorHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
