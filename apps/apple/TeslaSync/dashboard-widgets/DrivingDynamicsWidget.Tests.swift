//
//  DrivingDynamicsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  Unit coverage for the DrivingDynamicsWidget surface:
//    • Adapter (cached → projection) — `DrivingDynamicsBuilder` parity with the
//      web component's deriveSeverity / isSmooth / gaugeColor / maxG /
//      histogramData memos.
//    • Formatting — `DrivingDynamicsFormat` parity with web `fmtNumber`.
//    • State holder — `DrivingDynamicsModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `driving-dynamics` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + per-gauge + per-bar value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryDrivingDynamicsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: driving-style severity (web deriveSeverity)

final class DrivingDynamicsSeverityTests: XCTestCase {
    func testCalmUnderFifteenHundredths() {
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.10, avgBrake: 0.10), .calm)
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.0, avgBrake: 0.0), .calm)
    }

    func testNormalBand() {
        // avg exactly 0.15 is no longer < 0.15 → normal.
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.15, avgBrake: 0.15), .normal)
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.2, avgBrake: 0.2), .normal)
    }

    func testSportyBand() {
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.3, avgBrake: 0.3), .sporty)
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.45, avgBrake: 0.45), .sporty)
    }

    func testAggressiveBand() {
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.5, avgBrake: 0.5), .aggressive)
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.8, avgBrake: 0.7), .aggressive)
    }

    func testAveragesTheTwoInputs() {
        // (0.1 + 0.5) / 2 = 0.3 → sporty (not aggressive — proves the average).
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: 0.1, avgBrake: 0.5), .sporty)
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(DrivingDynamicsBuilder.deriveSeverity(avgAccel: .nan, avgBrake: .infinity), .calm)
    }

    func testSeverityCategoryAndTone() {
        XCTAssertTrue(DrivingDynamicsSeverity.calm.isCalmCategory)
        XCTAssertTrue(DrivingDynamicsSeverity.normal.isCalmCategory)
        XCTAssertFalse(DrivingDynamicsSeverity.sporty.isCalmCategory)
        XCTAssertFalse(DrivingDynamicsSeverity.aggressive.isCalmCategory)
        XCTAssertEqual(DrivingDynamicsSeverity.calm.tone, .success)
        XCTAssertEqual(DrivingDynamicsSeverity.normal.tone, .info)
        XCTAssertEqual(DrivingDynamicsSeverity.sporty.tone, .warning)
        XCTAssertEqual(DrivingDynamicsSeverity.aggressive.tone, .danger)
    }

    func testSeverityFallbackIsCapitalized() {
        XCTAssertEqual(DrivingDynamicsSeverity.calm.labelFallback, "Calm")
        XCTAssertEqual(DrivingDynamicsSeverity.aggressive.labelFallback, "Aggressive")
        XCTAssertEqual(DrivingDynamicsSeverity.sporty.labelKey, "widget.drivingDynamics.severity.sporty")
    }
}

// MARK: - Adapter: smoothness + gauge color band (web isSmooth / gaugeColor)

final class DrivingDynamicsToneTests: XCTestCase {
    func testIsSmoothUnderPointFour() {
        XCTAssertTrue(DrivingDynamicsBuilder.isSmooth(maxG: 0.39))
        XCTAssertTrue(DrivingDynamicsBuilder.isSmooth(maxG: 0.0))
        XCTAssertFalse(DrivingDynamicsBuilder.isSmooth(maxG: 0.4))
        XCTAssertFalse(DrivingDynamicsBuilder.isSmooth(maxG: 0.9))
    }

    func testGaugeToneThresholds() {
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.0), .success)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.19), .success)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.2), .info)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.39), .info)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.4), .warning)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.59), .warning)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 0.6), .danger)
        XCTAssertEqual(DrivingDynamicsBuilder.gaugeTone(forG: 1.1), .danger)
    }
}

// MARK: - Number formatting parity (web fmt / fmtNumber)

final class DrivingDynamicsFormatTests: XCTestCase {
    func testNumberKeepsRequestedDigitsAndGroups() {
        XCTAssertEqual(DrivingDynamicsFormat.number(0.42, decimals: 2, localeIdentifier: "en_US"), "0.42")
        XCTAssertEqual(DrivingDynamicsFormat.number(1234.5, decimals: 1, localeIdentifier: "en_US"), "1,234.5")
        XCTAssertEqual(DrivingDynamicsFormat.number(63, decimals: 0, localeIdentifier: "en_US"), "63")
    }

    func testNumberNonFiniteCollapsesToZero() {
        XCTAssertEqual(DrivingDynamicsFormat.number(.nan, decimals: 2, localeIdentifier: "en_US"), "0.00")
        XCTAssertEqual(DrivingDynamicsFormat.number(.infinity, decimals: 0, localeIdentifier: "en_US"), "0")
    }

    func testSafeNumber() {
        XCTAssertEqual(DrivingDynamicsFormat.safeNumber(0.5), 0.5, accuracy: 0.0001)
        XCTAssertEqual(DrivingDynamicsFormat.safeNumber(.nan), 0, accuracy: 0.0001)
        XCTAssertEqual(DrivingDynamicsFormat.safeNumber(.infinity), 0, accuracy: 0.0001)
    }
}

// MARK: - Adapter: cached DTO → projection

final class DrivingDynamicsBuilderTests: XCTestCase {
    private let sample = DrivingDynamicsDTO(
        maxAccelerationG: 0.46,
        maxBrakingG: 0.52,
        maxCorneringG: 0.41,
        avgAccelerationG: 0.22,
        avgBrakingG: 0.27,
        smoothnessScore: 78
    )

    func testMaxGIsPeakOfThreeMaxima() {
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: sample)
        XCTAssertEqual(projection.maxG, 0.52, accuracy: 0.0001)
        XCTAssertEqual(projection.maxGText, "0.52")
        XCTAssertFalse(projection.smooth) // 0.52 ≥ 0.4
        XCTAssertTrue(projection.hasDynamics)
    }

    func testGaugesMapAvgAccelAvgBrakePeakCornering() {
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: sample)
        XCTAssertEqual(projection.gauges.count, 3)
        let accel = projection.gauges.first { $0.role == .accel }
        let brake = projection.gauges.first { $0.role == .brake }
        let lateral = projection.gauges.first { $0.role == .lateral }
        XCTAssertEqual(accel?.value ?? -1, 0.22, accuracy: 0.0001)
        XCTAssertEqual(brake?.value ?? -1, 0.27, accuracy: 0.0001)
        // Lateral reads the PEAK cornering g (there is no avg cornering field).
        XCTAssertEqual(lateral?.value ?? -1, 0.41, accuracy: 0.0001)
        XCTAssertEqual(accel?.valueText, "0.22")
        XCTAssertEqual(accel?.tone, .info) // 0.22 → info band
        XCTAssertEqual(lateral?.tone, .warning) // 0.41 → warning band
    }

    func testGaugeFractionClampsToCeiling() {
        let over = DrivingDynamicsDTO(maxCorneringG: 5.0, avgAccelerationG: 5.0, avgBrakingG: 0.0)
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: over)
        let accel = projection.gauges.first { $0.role == .accel }
        XCTAssertEqual(accel?.fraction ?? -1, 1.0, accuracy: 0.0001) // clamped to G_MAX
        XCTAssertEqual(accel?.max ?? -1, 1.2, accuracy: 0.0001)
    }

    func testHistogramStepLabelsAndCounts() {
        let distribution = DrivingDynamicsAccelerationDistribution(values: [4, 18, 42])
        let projection = DrivingDynamicsBuilder.buildProjection(
            dynamics: sample,
            distribution: distribution,
            localeIdentifier: "en_US"
        )
        XCTAssertEqual(projection.bars.count, 3)
        XCTAssertTrue(projection.hasDistribution)
        // step = G_MAX(1.2) / 3 = 0.4 → lower-bound labels 0.00, 0.40, 0.80.
        XCTAssertEqual(projection.bars.map(\.rangeLabel), ["0.00", "0.40", "0.80"])
        XCTAssertEqual(projection.bars.map(\.count), [4, 18, 42])
    }

    func testHistogramPlotKeysAreUnique() {
        let distribution = DrivingDynamicsAccelerationDistribution(values: Array(repeating: 1, count: 8))
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: sample, distribution: distribution)
        let keys = projection.bars.map(\.plotKey)
        XCTAssertEqual(Set(keys).count, keys.count)
    }

    func testNoDistributionYieldsNoBars() {
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: sample, distribution: nil)
        XCTAssertTrue(projection.bars.isEmpty)
        XCTAssertFalse(projection.hasDistribution)

        let empty = DrivingDynamicsBuilder.buildProjection(
            dynamics: sample,
            distribution: DrivingDynamicsAccelerationDistribution(values: [])
        )
        XCTAssertTrue(empty.bars.isEmpty)
    }

    func testNilDynamicsHasNoDynamicsButStillBuildsBars() {
        let distribution = DrivingDynamicsAccelerationDistribution(values: [1, 2, 3])
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: nil, distribution: distribution)
        XCTAssertFalse(projection.hasDynamics)
        XCTAssertTrue(projection.gauges.isEmpty)
        XCTAssertEqual(projection.bars.count, 3)
    }

    func testCalmSmoothDriveProjection() {
        let calm = DrivingDynamicsDTO(
            maxAccelerationG: 0.18,
            maxBrakingG: 0.22,
            maxCorneringG: 0.15,
            avgAccelerationG: 0.08,
            avgBrakingG: 0.11
        )
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: calm)
        XCTAssertEqual(projection.maxG, 0.22, accuracy: 0.0001)
        XCTAssertTrue(projection.smooth) // 0.22 < 0.4
        XCTAssertEqual(projection.severity, .calm) // (0.08 + 0.11)/2 = 0.095 < 0.15
    }

    func testNonFiniteFieldsCollapseToZero() {
        let bad = DrivingDynamicsDTO(
            maxAccelerationG: .nan,
            maxBrakingG: .infinity,
            maxCorneringG: 0.3,
            avgAccelerationG: .nan,
            avgBrakingG: 0.1
        )
        let projection = DrivingDynamicsBuilder.buildProjection(dynamics: bad)
        XCTAssertEqual(projection.maxG, 0.3, accuracy: 0.0001) // nan/inf → 0, peak is 0.3
        XCTAssertEqual(projection.gauges.first { $0.role == .accel }?.value ?? -1, 0, accuracy: 0.0001)
    }
}
