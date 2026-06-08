//
//  SpeedProfileWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  Unit coverage for the SpeedProfileWidget surface:
//    • Adapter (cached → projection) — `SpeedProfileBuilder` parity with the web
//      SpeedProfileWidget.tsx derive block (convertSpeedFromSI, formatBucketLabel,
//      buildChartData, findSweetSpot, peak-frequency / peak-bucket, project).
//    • State holder — `SpeedProfileModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + source wiring
//      and the compact threshold.
//    • Registry — canonical `speed-profile` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySpeedProfileSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web derive block)

@MainActor
final class SpeedProfileAdapterTests: XCTestCase {
    func testConvertSpeedFromSIUsesExactFactors() {
        XCTAssertEqual(SpeedProfileBuilder.convertSpeedFromSI(1, to: .kilometersPerHour), 3.6, accuracy: 1e-9)
        XCTAssertEqual(SpeedProfileBuilder.convertSpeedFromSI(10, to: .kilometersPerHour), 36, accuracy: 1e-9)
        XCTAssertEqual(SpeedProfileBuilder.convertSpeedFromSI(4.4704, to: .milesPerHour), 10, accuracy: 1e-9)
        XCTAssertEqual(SpeedProfileBuilder.convertSpeedFromSI(0, to: .milesPerHour), 0, accuracy: 1e-9)
    }

    func testFormatBucketLabelRangeConvertsBothBounds() {
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("20-40", unit: .kilometersPerHour), "72-144")
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("20-40", unit: .milesPerHour), "45-89")
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("0-10", unit: .kilometersPerHour), "0-36")
    }

    func testFormatBucketLabelOpenBucketAddsPlus() {
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("30+", unit: .kilometersPerHour), "108+")
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("30+", unit: .milesPerHour), "67+")
    }

    func testFormatBucketLabelUnparseableReturnsVerbatim() {
        XCTAssertEqual(SpeedProfileBuilder.formatBucketLabel("all", unit: .kilometersPerHour), "all")
    }

    func testParseLeadingDoubleMimicsParseFloat() {
        XCTAssertEqual(SpeedProfileBuilder.parseLeadingDouble("80+"), 80)
        XCTAssertEqual(SpeedProfileBuilder.parseLeadingDouble("20"), 20)
        XCTAssertEqual(SpeedProfileBuilder.parseLeadingDouble("  12.5x"), 12.5)
        XCTAssertNil(SpeedProfileBuilder.parseLeadingDouble("abc"))
        XCTAssertNil(SpeedProfileBuilder.parseLeadingDouble(""))
    }

    func testBuildBarsComputesFrequencyShareAndEfficiency() {
        let input = SpeedProfileInput(distribution: [
            SpeedProfileBucketInput(speedBucket: "0-10", readings: 25, avgPowerKw: 10),
            SpeedProfileBucketInput(speedBucket: "10-20", readings: 75, avgPowerKw: 20)
        ])
        let bars = SpeedProfileBuilder.buildBars(input, unit: .kilometersPerHour)
        XCTAssertEqual(bars.count, 2)
        XCTAssertEqual(bars[0].bucket, "0-36")
        XCTAssertEqual(bars[0].frequency, 25, accuracy: 1e-9)
        XCTAssertEqual(bars[0].efficiency, 10, accuracy: 1e-9)
        XCTAssertEqual(bars[1].bucket, "36-72")
        XCTAssertEqual(bars[1].frequency, 75, accuracy: 1e-9)
    }

    func testBuildBarsAllZeroReadingsYieldsZeroFrequency() {
        let input = SpeedProfileInput(distribution: [
            SpeedProfileBucketInput(speedBucket: "0-10", readings: 0, avgPowerKw: 5),
            SpeedProfileBucketInput(speedBucket: "10-20", readings: 0, avgPowerKw: 9)
        ])
        let bars = SpeedProfileBuilder.buildBars(input, unit: .kilometersPerHour)
        XCTAssertTrue(bars.allSatisfy { $0.frequency == 0 })
    }

    func testFindSweetSpotPicksLowestPositiveEfficiency() {
        let bars = [
            SpeedProfileBar(bucket: "0-36", frequency: 25, efficiency: 18),
            SpeedProfileBar(bucket: "36-72", frequency: 75, efficiency: 11),
            SpeedProfileBar(bucket: "72-108", frequency: 10, efficiency: 0)
        ]
        XCTAssertEqual(SpeedProfileBuilder.findSweetSpot(bars), "36-72")
        XCTAssertEqual(SpeedProfileBuilder.findSweetSpot([]), "—")
    }

    func testSweetSpotPrefersOptimalSpeedEstimate() {
        let input = SpeedProfileInput(
            distribution: [SpeedProfileBucketInput(speedBucket: "0-10", readings: 1, avgPowerKw: 5)],
            optimalSpeedMps: 15
        )
        let bars = SpeedProfileBuilder.buildBars(input, unit: .kilometersPerHour)
        XCTAssertEqual(SpeedProfileBuilder.sweetSpot(input: input, bars: bars, unit: .kilometersPerHour), "54")
    }

    func testProjectDerivesPeakAndHasData() throws {
        let input = SpeedProfileInput(distribution: [
            SpeedProfileBucketInput(speedBucket: "0-10", readings: 25, avgPowerKw: 10),
            SpeedProfileBucketInput(speedBucket: "10-20", readings: 75, avgPowerKw: 20)
        ])
        let projection = try XCTUnwrap(SpeedProfileBuilder.project(input, unit: .kilometersPerHour))
        XCTAssertEqual(projection.peakFrequency, 75, accuracy: 1e-9)
        XCTAssertEqual(projection.peakBucket, "36-72")
        XCTAssertEqual(projection.sweetSpot, "0-36")
        XCTAssertTrue(projection.hasData)
    }

    func testProjectReturnsNilWithoutInputAndFalseHasDataWhenEmpty() throws {
        XCTAssertNil(SpeedProfileBuilder.project(nil, unit: .kilometersPerHour))
        let empty = try XCTUnwrap(SpeedProfileBuilder.project(SpeedProfileInput(), unit: .kilometersPerHour))
        XCTAssertFalse(empty.hasData)
        XCTAssertTrue(empty.bars.isEmpty)
    }

    func testUnitLabelParsing() {
        XCTAssertEqual(SpeedDisplayUnit.fromLabel("mph"), .milesPerHour)
        XCTAssertEqual(SpeedDisplayUnit.fromLabel("km/h"), .kilometersPerHour)
        XCTAssertEqual(SpeedDisplayUnit.fromLabel("KMH"), .kilometersPerHour)
        XCTAssertEqual(SpeedDisplayUnit.fromLabel(nil), .kilometersPerHour)
        XCTAssertEqual(SpeedDisplayUnit.fromLabel("furlongs"), .kilometersPerHour)
    }

    func testNumberFormatGroupsRoundsAndPercents() {
        XCTAssertEqual(SpeedProfileNumberFormat.integer(1609), "1,609")
        XCTAssertEqual(SpeedProfileNumberFormat.decimal(12.34, fractionDigits: 1), "12.3")
        XCTAssertEqual(SpeedProfileNumberFormat.decimal(12.35, fractionDigits: 1), "12.4")
        XCTAssertEqual(SpeedProfileNumberFormat.percent(75), "75.0%")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class SpeedProfileModelTests: XCTestCase {
    private func makeModel(
        _ update: SpeedProfileUpdate,
        telemetry: SpeedProfileTelemetry = OSLogSpeedProfileTelemetry()
    ) -> (SpeedProfileModel, InMemorySpeedProfileSource) {
        let source = InMemorySpeedProfileSource(initial: update)
        let model = SpeedProfileModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var populatedInput: SpeedProfileInput {
        SpeedProfileInput(distribution: [
            SpeedProfileBucketInput(speedBucket: "0-10", readings: 25, avgPowerKw: 10),
            SpeedProfileBucketInput(speedBucket: "10-20", readings: 75, avgPowerKw: 20)
        ])
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SpeedProfileUpdate(status: .loading, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutUsableDataShowsEmpty() {
        let (model, _) = makeModel(SpeedProfileUpdate(status: .loaded, input: SpeedProfileInput()))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SpeedProfileUpdate(status: .failed("boom"), input: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(SpeedProfileUpdate(status: .loading, input: populatedInput))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SpeedProfileUpdate(status: .failed("net"), input: populatedInput))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySpeedProfileTelemetry()
        let (model, source) = makeModel(SpeedProfileUpdate(status: .loading, input: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SpeedProfileWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SpeedProfileUpdate(status: .loaded, input: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionUnitAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SpeedProfileUpdate(status: .loading, input: nil))
        model.start()
        source.push(
            SpeedProfileUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: SpeedProfileVehicleRef(id: 3, displayName: "Cybertruck"),
                input: populatedInput,
                unitLabel: "mph",
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .milesPerHour)
        XCTAssertEqual(model.projection?.peakBucket, "22-45")
    }

    func testCompactThreshold() {
        XCTAssertTrue(SpeedProfileModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(SpeedProfileModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor
final class SpeedProfileRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SpeedProfileWidget.registration
        XCTAssertEqual(registration.id, "speed-profile")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SpeedProfileWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
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

@MainActor
final class SpeedProfileAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryStatLabelAndUnit() throws {
        let input = SpeedProfileInput(
            distribution: [
                SpeedProfileBucketInput(speedBucket: "0-10", readings: 25, avgPowerKw: 18),
                SpeedProfileBucketInput(speedBucket: "10-20", readings: 75, avgPowerKw: 11)
            ],
            optimalSpeedMps: 15
        )
        let projection = try XCTUnwrap(SpeedProfileBuilder.project(input, unit: .milesPerHour))
        let summary = SpeedProfileAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Most Common"))
        XCTAssertTrue(summary.contains("Peak Freq"))
        XCTAssertTrue(summary.contains("Sweet Spot"))
        XCTAssertTrue(summary.contains("mph"))
        XCTAssertTrue(summary.contains("%"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySpeedProfileTelemetry: SpeedProfileTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
