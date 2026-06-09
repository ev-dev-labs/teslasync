//
//  TirePressureSection.Tests.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  Unit coverage for the TirePressureSection surface:
//    • Adapter (`TPSectionProjector`) — SI(Pa)→display conversion, per-wheel
//      line-presence (non-null) + min/max range (positive-only, the web `tpVals`
//      `v != null && v > 0` filter), the content/empty gate (`stats.hasTirePressure`,
//      with NO `chartData.length > 1` guard), and phase resolution.
//    • Formatting (`TPSectionFormat`) — locale decimal / range / value strings.
//    • State holder (`TirePressureSectionModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once), and offline keeping the cached trace.
//    • Accessibility — the chart summary content (present wheels + ranges).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion

@MainActor final class TPSectionConversionTests: XCTestCase {
    func testKilopascalsDivideByThousand() {
        XCTAssertEqual(convertTirePressureFromSI(0, to: .kpa), 0, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(290_000, to: .kpa), 290, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(101_325, to: .kpa), 101.325, accuracy: 0.0001)
    }

    func testPsiMatchesFormula() {
        // 6894.757 Pa = 6.894757 kPa = exactly 1 psi.
        XCTAssertEqual(convertTirePressureFromSI(6894.757, to: .psi), 1, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(6_894_757, to: .psi), 1000, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(0, to: .psi), 0, accuracy: 0.0001)
    }

    func testBarMatchesFormula() {
        // 100000 Pa = 100 kPa = exactly 1 bar.
        XCTAssertEqual(convertTirePressureFromSI(100_000, to: .bar), 1, accuracy: 0.0001)
        XCTAssertEqual(convertTirePressureFromSI(290_000, to: .bar), 2.9, accuracy: 0.0001)
    }

    func testUnitFromSymbol() {
        XCTAssertEqual(TPSectionUnit.from(symbol: "kPa"), .kpa)
        XCTAssertEqual(TPSectionUnit.from(symbol: "psi"), .psi)
        XCTAssertEqual(TPSectionUnit.from(symbol: "bar"), .bar)
        XCTAssertEqual(TPSectionUnit.from(symbol: "garbage"), .kpa)
        XCTAssertEqual(TPSectionUnit.kpa.symbol, "kPa")
        XCTAssertEqual(TPSectionUnit.psi.symbol, "psi")
        XCTAssertEqual(TPSectionUnit.bar.symbol, "bar")
    }
}

// MARK: - Adapter: projection (web chartData/stats parity)

@MainActor final class TPSectionProjectorTests: XCTestCase {
    private let samples: [TPSectionSample] = [
        TPSectionSample(time: "08:00", frontLeftPa: 280_000, frontRightPa: 290_000, rearLeftPa: 300_000),
        TPSectionSample(time: "08:10", frontLeftPa: 284_000, frontRightPa: 288_000, rearLeftPa: 302_000),
        TPSectionSample(time: "08:20", frontLeftPa: 282_000)
    ]

    func testPresentWheelsAndOrder() {
        let projection = TPSectionProjector.project(samples: samples, unit: .kpa)
        XCTAssertEqual(projection.presentWheels, [.frontLeft, .frontRight, .rearLeft])
        XCTAssertTrue(projection.hasTirePressure)
        XCTAssertFalse(projection.isPresent(.rearRight))
    }

    func testRangePerWheelPositiveOnly() {
        let projection = TPSectionProjector.project(samples: samples, unit: .kpa)
        XCTAssertEqual(projection.range(for: .frontLeft), TPSectionRange(min: 280, max: 284))
        XCTAssertEqual(projection.range(for: .frontRight), TPSectionRange(min: 288, max: 290))
        XCTAssertEqual(projection.range(for: .rearLeft), TPSectionRange(min: 300, max: 302))
        XCTAssertNil(projection.range(for: .rearRight))
    }

    func testBarConvertsPointsAndRanges() {
        let projection = TPSectionProjector.project(samples: samples, unit: .bar)
        XCTAssertEqual(projection.points.first?.frontLeft ?? .nan, 2.8, accuracy: 0.0001)
        XCTAssertEqual(projection.range(for: .frontLeft)?.min ?? .nan, 2.8, accuracy: 0.0001)
        XCTAssertEqual(projection.range(for: .frontLeft)?.max ?? .nan, 2.84, accuracy: 0.0001)
        XCTAssertEqual(projection.unitSymbol, "bar")
    }

    func testPointValueForWheel() {
        let projection = TPSectionProjector.project(samples: samples, unit: .kpa)
        XCTAssertEqual(projection.points[0].value(for: .frontRight) ?? .nan, 290, accuracy: 0.0001)
        XCTAssertNil(projection.points[2].value(for: .frontRight))
        XCTAssertNil(projection.points[2].value(for: .rearRight))
    }

    func testPresenceUsesNonNullButRangeUsesPositive() {
        // A wheel with a non-null but non-positive reading still draws a line
        // (web `chartData.some(d => d.tireFl !== null)`), but only positive values
        // feed the min/max range (web `tpVals` `filter(v > 0)`).
        let mixed = [
            TPSectionSample(time: "t0", frontLeftPa: -5000),
            TPSectionSample(time: "t1", frontLeftPa: 280_000)
        ]
        let projection = TPSectionProjector.project(samples: mixed, unit: .kpa)
        XCTAssertTrue(projection.isPresent(.frontLeft))
        XCTAssertEqual(projection.range(for: .frontLeft), TPSectionRange(min: 280, max: 280))
    }

    func testTileWheelsAlwaysAllFour() {
        let projection = TPSectionProjector.project(samples: samples, unit: .kpa)
        XCTAssertEqual(projection.tileWheels, [.frontLeft, .frontRight, .rearLeft, .rearRight])
    }

    func testContentGateNeedsNoSecondPoint() {
        // The web tire gate is `stats.hasTirePressure` alone — a single sample with a
        // reading is content (unlike TemperatureSection's `chartData.length > 1`).
        let single = [TPSectionSample(time: "08:00", frontLeftPa: 280_000)]
        let projection = TPSectionProjector.project(samples: single, unit: .kpa)
        XCTAssertTrue(projection.hasTirePressure)
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.pointCount, 1)
    }

    func testNoTirePressureIsEmpty() {
        let blank = [
            TPSectionSample(time: "08:00"),
            TPSectionSample(time: "08:10")
        ]
        let projection = TPSectionProjector.project(samples: blank, unit: .kpa)
        XCTAssertFalse(projection.hasTirePressure)
        XCTAssertFalse(projection.hasContent)
        XCTAssertTrue(projection.presentWheels.isEmpty)
        // Tiles are still all four (each renders the `—` placeholder in the view).
        XCTAssertEqual(projection.tileWheels.count, 4)
    }

    func testEmptySamplesProduceEmptyProjection() {
        let projection = TPSectionProjector.project(samples: [], unit: .kpa)
        XCTAssertEqual(projection.pointCount, 0)
        XCTAssertFalse(projection.hasContent)
        XCTAssertTrue(projection.ranges.isEmpty)
    }
}

// MARK: - Adapter: range helper (web tpVals reduction)

@MainActor final class TPSectionRangeTests: XCTestCase {
    func testRangeOfValues() {
        XCTAssertEqual(TPSectionProjector.range(of: [280, 284, 282]), TPSectionRange(min: 280, max: 284))
        XCTAssertEqual(TPSectionProjector.range(of: [5]), TPSectionRange(min: 5, max: 5))
    }

    func testRangeFiltersNonPositiveAndEmpty() {
        XCTAssertNil(TPSectionProjector.range(of: []))
        XCTAssertNil(TPSectionProjector.range(of: [-1, 0]))
        XCTAssertEqual(TPSectionProjector.range(of: [-3, 0, 9]), TPSectionRange(min: 9, max: 9))
    }
}

// MARK: - Adapter: phase resolution

@MainActor final class TPSectionPhaseTests: XCTestCase {
    func testResolvePhase() {
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loading, hasContent: false), .loading)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loading, hasContent: true), .content)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loaded, hasContent: true), .content)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.loaded, hasContent: false), .empty)
        XCTAssertEqual(TPSectionProjector.resolvePhase(.failed("boom"), hasContent: false), .error("boom"))
        XCTAssertEqual(TPSectionProjector.resolvePhase(.failed("boom"), hasContent: true), .content)
    }
}

// MARK: - Formatting

@MainActor final class TPSectionFormatTests: XCTestCase {
    private let posix = "en_US_POSIX"

    func testNumberFixedTwoDecimals() {
        XCTAssertEqual(TPSectionFormat.number(290, localeIdentifier: posix), "290.00")
        XCTAssertEqual(TPSectionFormat.number(2.8, localeIdentifier: posix), "2.80")
        XCTAssertEqual(TPSectionFormat.number(-3.456, localeIdentifier: posix), "-3.46")
    }

    func testIntDropsFraction() {
        XCTAssertEqual(TPSectionFormat.number(290, decimals: 0, localeIdentifier: posix), "290")
        XCTAssertEqual(TPSectionFormat.number(289.6, decimals: 0, localeIdentifier: posix), "290")
    }

    func testRangeJoinsWithEnDashAndUnit() {
        let range = TPSectionRange(min: 280, max: 284)
        XCTAssertEqual(TPSectionFormat.range(range, symbol: "kPa", localeIdentifier: posix), "280.00–284.00 kPa")
        let psi = TPSectionRange(min: 40.5, max: 41)
        XCTAssertEqual(TPSectionFormat.range(psi, symbol: "psi", localeIdentifier: posix), "40.50–41.00 psi")
    }

    func testValueAppendsUnitWithSpace() {
        XCTAssertEqual(TPSectionFormat.value(290, symbol: "kPa", localeIdentifier: posix), "290.00 kPa")
        XCTAssertEqual(TPSectionFormat.value(2.9, symbol: "bar", localeIdentifier: posix), "2.90 bar")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(TPSectionFormat.number(.nan, localeIdentifier: posix), "0.00")
        XCTAssertEqual(TPSectionFormat.number(.infinity, decimals: 0, localeIdentifier: posix), "0")
    }
}

// MARK: - State holder: TirePressureSectionModel

@MainActor final class TirePressureSectionModelTests: XCTestCase {
    private let samples: [TPSectionSample] = [
        TPSectionSample(time: "08:00", frontLeftPa: 280_000, frontRightPa: 290_000, rearLeftPa: 300_000),
        TPSectionSample(time: "08:10", frontLeftPa: 284_000, frontRightPa: 288_000, rearLeftPa: 302_000)
    ]

    private func makeModel(
        initial: TPSectionUpdate?,
        telemetry: TPSectionTelemetry = SpyTPSectionTelemetry()
    ) -> (TirePressureSectionModel, InMemoryTPSectionSource) {
        let source = InMemoryTPSectionSource(initial: initial)
        let model = TirePressureSectionModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        _ samples: [TPSectionSample],
        connection: TPSectionConnection = .live
    ) -> TPSectionUpdate {
        TPSectionUpdate(status: .loaded, samples: samples, connection: connection)
    }

    func testLoadedContentProjects() {
        let (model, source) = makeModel(initial: loaded(samples))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.pointCount, 2)
        XCTAssertEqual(model.projection.presentWheels, [.frontLeft, .frontRight, .rearLeft])
        XCTAssertEqual(model.projection.range(for: .frontLeft), TPSectionRange(min: 280, max: 284))
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: loaded([]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection.pointCount, 0)
    }

    func testSinglePointStillResolvesContent() {
        let single = [TPSectionSample(time: "08:00", frontLeftPa: 280_000)]
        let (model, _) = makeModel(initial: loaded(single))
        model.start()
        XCTAssertEqual(model.phase, .content, "tire gate is hasTirePressure with no length guard")
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TPSectionUpdate(status: .loading, samples: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TPSectionUpdate(status: .failed("timeout"), samples: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTPSectionTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TPSectionSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .stale))
        source.push(loaded(samples, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .stale))
        source.push(loaded(samples, connection: .live))
        source.push(loaded(samples, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(samples, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.pointCount, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TPSectionUpdate(status: .failed("x"), samples: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testUnitPreferenceFromUpdateAppliesToProjection() {
        let update = TPSectionUpdate(status: .loaded, samples: samples, unit: .bar)
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.projection.unitSymbol, "bar")
        XCTAssertEqual(model.projection.range(for: .frontLeft)?.min ?? .nan, 2.8, accuracy: 0.0001)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TPSectionSurface.slug, "TirePressureSection")
        XCTAssertEqual(TirePressureSection.surfaceSlug, "TirePressureSection")
    }
}

// MARK: - Accessibility: VoiceOver summary

@MainActor final class TPSectionAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let posix = "en_US_POSIX"

    private let samples: [TPSectionSample] = [
        TPSectionSample(time: "08:00", frontLeftPa: 280_000, frontRightPa: 290_000),
        TPSectionSample(time: "08:10", frontLeftPa: 284_000, frontRightPa: 288_000)
    ]

    func testChartSummaryIncludesPresentWheelRanges() {
        let projection = TPSectionProjector.project(samples: samples, unit: .kpa)
        let summary = TPSectionAccessibility.chartSummary(
            projection: projection,
            localize: echo,
            localeIdentifier: posix
        )
        XCTAssertTrue(summary.contains("Tire Pressure During Drive"))
        XCTAssertTrue(summary.contains("Front Left 280.00–284.00 kPa"))
        XCTAssertTrue(summary.contains("Front Right 288.00–290.00 kPa"))
    }

    func testChartSummaryEmpty() {
        let projection = TPSectionProjector.project(samples: [], unit: .kpa)
        let summary = TPSectionAccessibility.chartSummary(
            projection: projection,
            localize: echo,
            localeIdentifier: posix
        )
        XCTAssertTrue(summary.contains("Tire Pressure During Drive"))
        XCTAssertTrue(summary.contains("No telemetry data available"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyTPSectionTelemetry: TPSectionTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
