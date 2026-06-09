//
//  DriveTelemetryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  Unit coverage for the DriveTelemetryWidget surface: the adapter (cached →
//  projection, parity with the web latestDrive/chartData/stats), the dual-axis
//  scale, the DriveTelemetryModel phase resolution + P1/S11 telemetry, the
//  drive-telemetry registry, and the VoiceOver summary. These run in the
//  TeslaSync(/-macOS) XCTest targets, driven by InMemoryDriveTelemetrySource.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached rows → projection

@MainActor final class DriveTelemetryAdapterTests: XCTestCase {
    private func point(
        ts: String?,
        speed: Double? = nil,
        power: Double? = nil,
        battery: Double? = nil,
        soc: Double? = nil,
        elevation: Double? = nil,
        createdAt: String? = nil
    ) -> DriveTelemetryPointInput {
        DriveTelemetryPointInput(
            timestamp: ts,
            createdAt: createdAt,
            speed: speed,
            power: power,
            batteryLevel: battery,
            soc: soc,
            elevation: elevation
        )
    }

    private func drive(
        id: Int64,
        start: String?,
        distanceM: Double = 0,
        durationS: Double = 0,
        energyWh: Double? = nil,
        address: String? = nil
    ) -> DriveTelemetrySummaryInput {
        DriveTelemetrySummaryInput(
            id: id,
            startTs: start,
            distanceM: distanceM,
            durationS: durationS,
            energyUsedWh: energyWh,
            startAddress: address
        )
    }

    func testEmptyWhenNoDrives() {
        let projection = DriveTelemetryProjectionBuilder.build(drives: [], telemetry: [], measurement: .metric)
        XCTAssertFalse(projection.hasDrive)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.distanceText, "—")
        XCTAssertNil(projection.efficiencyText)
    }

    func testLatestDrivePicksNewestStartTs() {
        let drives = [
            drive(id: 1, start: "2026-06-07T08:00:00Z", distanceM: 1000),
            drive(id: 2, start: "2026-06-07T18:00:00Z", distanceM: 2000, address: "Evening"),
            drive(id: 3, start: "2026-06-07T12:00:00Z", distanceM: 1500)
        ]
        let projection = DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [], measurement: .metric)
        XCTAssertTrue(projection.hasDrive)
        // distance of the 18:00 drive (2 km) → "2.0"
        XCTAssertEqual(projection.distanceText, DriveTelemetryNumberFormat.decimal(2.0, fractionDigits: 1))
        XCTAssertEqual(projection.startAddress, "Evening")
    }

    func testDistanceConvertedMetricVsImperial() {
        let drives = [drive(id: 1, start: "2026-06-07T08:00:00Z", distanceM: 1609.344)]
        let metric = DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [], measurement: .metric)
        let imperial = DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [], measurement: .imperial)
        XCTAssertEqual(metric.distanceText, DriveTelemetryNumberFormat.decimal(1.609344, fractionDigits: 1))
        XCTAssertEqual(metric.distanceUnitLabel, "km")
        XCTAssertEqual(imperial.distanceText, DriveTelemetryNumberFormat.decimal(1.0, fractionDigits: 1))
        XCTAssertEqual(imperial.distanceUnitLabel, "mi")
    }

    func testDurationIsWholeMinutes() {
        let drives = [drive(id: 1, start: "2026-06-07T08:00:00Z", durationS: 1530)]
        let projection = DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [], measurement: .metric)
        // 1530 s / 60 = 25.5 → rounded to "26" by the 0-fraction formatter.
        XCTAssertEqual(projection.durationText, DriveTelemetryNumberFormat.decimal(25.5, fractionDigits: 0))
    }

    func testEfficiencyPresentOnlyWithEnergyAndDistance() {
        let withEnergy = drive(id: 1, start: "2026-06-07T08:00:00Z", distanceM: 10000, energyWh: 1500)
        let metric = DriveTelemetryProjectionBuilder.build(drives: [withEnergy], telemetry: [], measurement: .metric)
        // 10 000 m → 10 km; 1500 Wh / 10 km = 150 Wh/km.
        XCTAssertEqual(metric.efficiencyText, DriveTelemetryNumberFormat.decimal(150, fractionDigits: 0))
        XCTAssertEqual(metric.efficiencyUnitLabel, "Wh/km")

        let imperial = DriveTelemetryProjectionBuilder.build(
            drives: [withEnergy],
            telemetry: [],
            measurement: .imperial
        )
        XCTAssertEqual(imperial.efficiencyUnitLabel, "Wh/mi")
    }

    func testEfficiencyAbsentWhenNoEnergyOrZeroDistance() {
        let noEnergy = drive(id: 1, start: "2026-06-07T08:00:00Z", distanceM: 10000, energyWh: nil)
        let zeroDist = drive(id: 2, start: "2026-06-07T08:00:00Z", distanceM: 0, energyWh: 1500)
        XCTAssertNil(DriveTelemetryProjectionBuilder.build(drives: [noEnergy], telemetry: [], measurement: .metric)
            .efficiencyText)
        XCTAssertNil(DriveTelemetryProjectionBuilder.build(drives: [zeroDist], telemetry: [], measurement: .metric)
            .efficiencyText)
    }

    func testSamplesWithoutTimestampAreDropped() {
        let telemetry = [
            point(ts: nil, speed: 10),
            point(ts: "   ", speed: 11),
            point(ts: "2026-06-07T08:00:00Z", speed: 12)
        ]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        XCTAssertEqual(projection.data.count, 1)
    }

    func testCreatedAtFallbackWhenTimestampMissing() {
        let telemetry = [point(ts: nil, speed: 5, createdAt: "2026-06-07T08:00:00Z")]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        XCTAssertEqual(projection.data.count, 1)
    }

    func testSpeedConvertedToDisplayUnit() {
        // 10 m/s → 36 km/h (metric) / ~22.369 mph (imperial).
        let telemetry = [point(ts: "2026-06-07T08:00:00Z", speed: 10)]
        let metric = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        let imperial = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .imperial
        )
        XCTAssertEqual(metric.data.first?.speed ?? 0, 36, accuracy: 0.0001)
        XCTAssertEqual(imperial.data.first?.speed ?? 0, 22.3694, accuracy: 0.001)
        XCTAssertEqual(metric.speedUnitLabel, "km/h")
        XCTAssertEqual(imperial.speedUnitLabel, "mph")
    }

    func testBatteryFallsBackToSoc() {
        let viaLevel = point(ts: "2026-06-07T08:00:00Z", battery: 80)
        let viaSoc = point(ts: "2026-06-07T08:00:00Z", soc: 65)
        let drives = [drive(id: 1, start: "2026-06-07T08:00:00Z")]
        XCTAssertEqual(
            DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [viaLevel], measurement: .metric)
                .data.first?.battery,
            80
        )
        XCTAssertEqual(
            DriveTelemetryProjectionBuilder.build(drives: drives, telemetry: [viaSoc], measurement: .metric)
                .data.first?.battery,
            65
        )
    }

    func testPowerAndElevationCarriedThrough() {
        let telemetry = [point(ts: "2026-06-07T08:00:00Z", power: -12.5, elevation: 240)]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        XCTAssertEqual(projection.data.first?.power, -12.5)
        XCTAssertEqual(projection.data.first?.elevation, 240)
    }

    func testChartDataSortedAscending() {
        let telemetry = [
            point(ts: "2026-06-07T08:00:30Z", speed: 3),
            point(ts: "2026-06-07T08:00:00Z", speed: 1),
            point(ts: "2026-06-07T08:00:15Z", speed: 2)
        ]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        // speeds in seconds order map to 1*3.6, 2*3.6, 3*3.6 km/h.
        XCTAssertEqual(projection.data.map { $0.speed ?? 0 }, [3.6, 7.2, 10.8])
    }

    func testLatestValuesSkipTrailingNils() {
        let telemetry = [
            point(ts: "2026-06-07T08:00:00Z", speed: 10, power: 30, battery: 80),
            point(ts: "2026-06-07T08:00:30Z", speed: 5, power: 20, battery: 78),
            point(ts: "2026-06-07T08:01:00Z", speed: nil, power: nil, battery: nil)
        ]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [drive(id: 1, start: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        XCTAssertEqual(projection.latestSpeed ?? 0, 18, accuracy: 0.0001) // 5 m/s → 18 km/h
        XCTAssertEqual(projection.latestPower, 20)
        XCTAssertEqual(projection.latestBattery, 78)
    }
}

// MARK: - Scale: power ↔ plotting space

@MainActor final class DriveTelemetryScaleTests: XCTestCase {
    func testLeftMaxIsDataMaxPlusTen() {
        let telemetry = [
            DriveTelemetryPointInput(timestamp: "2026-06-07T08:00:00Z", speed: 5, batteryLevel: 90, elevation: 30)
        ]
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [DriveTelemetrySummaryInput(id: 1, startTs: "2026-06-07T08:00:00Z")],
            telemetry: telemetry,
            measurement: .metric
        )
        XCTAssertEqual(projection.scale.leftMax, 100)
    }

    func testPowerToPlotRoundTrips() {
        let scale = DriveTelemetryChartScale(leftMax: 100, powerMin: -20, powerMax: 80)
        let plotted = scale.powerToPlot(30)
        XCTAssertEqual(plotted, 50, accuracy: 0.0001)
        XCTAssertEqual(scale.plotToPower(plotted), 30, accuracy: 0.0001)
    }

    func testBaselineIsZeroPower() {
        let scale = DriveTelemetryChartScale(leftMax: 100, powerMin: -20, powerMax: 80)
        XCTAssertEqual(scale.powerBaselinePlot, 20, accuracy: 0.0001)
    }

    func testGuardsAgainstZeroRanges() {
        let zeroPower = DriveTelemetryChartScale(leftMax: 100, powerMin: 5, powerMax: 5)
        XCTAssertEqual(zeroPower.powerToPlot(5), 0)
        let zeroLeft = DriveTelemetryChartScale(leftMax: 0, powerMin: 0, powerMax: 10)
        XCTAssertEqual(zeroLeft.plotToPower(5), 0)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DriveTelemetryModelTests: XCTestCase {
    private func loaded() -> DriveTelemetryUpdate {
        DriveTelemetryUpdate(
            status: .loaded,
            drives: [DriveTelemetrySummaryInput(id: 1, startTs: "2026-06-07T08:00:00Z", distanceM: 5000)],
            telemetry: [DriveTelemetryPointInput(timestamp: "2026-06-07T08:00:00Z", speed: 10, power: 20)]
        )
    }

    func testLoadingWithoutDriveShowsLoading() {
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .loading, hasDrive: false), .loading)
    }

    func testLoadedWithoutDriveShowsEmpty() {
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .loaded, hasDrive: false), .empty)
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .empty, hasDrive: false), .empty)
    }

    func testFailedWithoutDriveShowsError() {
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .failed("boom"), hasDrive: false), .error("boom"))
    }

    func testDriveKeepsContentWhileFetchingOrFailed() {
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .loading, hasDrive: true), .content)
        XCTAssertEqual(DriveTelemetryModel.resolvePhase(status: .failed("net"), hasDrive: true), .content)
    }

    func testModelProjectsLoadedData() {
        let source = InMemoryDriveTelemetrySource(initial: loaded())
        let model = DriveTelemetryModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(model.projection.latestPower, 20)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDriveTelemetryDiagnostics()
        let source = InMemoryDriveTelemetrySource(initial: DriveTelemetryUpdate(status: .loading))
        let model = DriveTelemetryModel(source: source, diagnostics: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveTelemetryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryDriveTelemetrySource(initial: loaded())
        let model = DriveTelemetryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndMeasurementTrackUpdates() {
        let source = InMemoryDriveTelemetrySource(initial: DriveTelemetryUpdate(status: .loading))
        let model = DriveTelemetryModel(source: source)
        model.start()
        source.push(
            DriveTelemetryUpdate(
                status: .loaded,
                connection: .offline,
                drives: [DriveTelemetrySummaryInput(id: 1, startTs: "2026-06-07T08:00:00Z", distanceM: 1609.344)],
                telemetry: [DriveTelemetryPointInput(timestamp: "2026-06-07T08:00:00Z", speed: 10)],
                measurement: .imperial,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.speedUnitLabel, "mph")
        XCTAssertEqual(model.projection.distanceUnitLabel, "mi")
    }
}

// MARK: - Registry parity

@MainActor final class DriveTelemetryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DriveTelemetryWidget.registration
        XCTAssertEqual(registration.id, "drive-telemetry")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = DriveTelemetryWidget.registration
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

@MainActor final class DriveTelemetryAccessibilityTests: XCTestCase {
    func testSummaryIncludesLatestSpeedPowerBattery() {
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [DriveTelemetrySummaryInput(id: 1, startTs: "2026-06-07T08:00:00Z")],
            telemetry: [DriveTelemetryPointInput(
                timestamp: "2026-06-07T08:00:00Z",
                speed: 10,
                power: 25,
                batteryLevel: 73
            )],
            measurement: .metric
        )
        let summary = DriveTelemetryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Speed"))
        XCTAssertTrue(summary.contains("km/h"))
        XCTAssertTrue(summary.contains("Power (kW)"))
        XCTAssertTrue(summary.contains("25"))
        XCTAssertTrue(summary.contains("Battery %"))
        XCTAssertTrue(summary.contains("73"))
    }

    func testSummaryEmptyWhenNoTelemetry() {
        let projection = DriveTelemetryProjectionBuilder.build(
            drives: [DriveTelemetrySummaryInput(id: 1, startTs: "2026-06-07T08:00:00Z")],
            telemetry: [],
            measurement: .metric
        )
        XCTAssertEqual(DriveTelemetryAccessibility.summary(for: projection), "No telemetry for this drive")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDriveTelemetryDiagnostics: DriveTelemetryDiagnostics, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
