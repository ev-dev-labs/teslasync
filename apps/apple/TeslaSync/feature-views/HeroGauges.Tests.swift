//
//  HeroGauges.Tests.swift
//  TeslaSync — P4 feature view · 0143 · HeroGauges (Apple)
//
//  Unit + UI coverage for the drive-detail HeroGauges surface:
//    • Adapter (cached → projection) — `HeroGaugesFormat` SI converters + number formatting parity
//      with the web `convertDistanceFromSI`/`convertSpeedFromSI`/`fmtNumber`, the JS `Math.round`
//      half-up, the `Number(fmtNumber(x))` grouping→NaN quirk, and the `HeroGaugesProjector` gauge
//      math (clamped value, value/max fill fraction, units, accents, metric/imperial conversion,
//      and the conditional fifth Efficiency gauge).
//    • State holder — `HeroGaugesModel` phase resolution across loading / empty / error / content,
//      projection recompute, refresh delegation, the stale auto-refresh guard, and the P1/S11
//      `view.opened` telemetry.
//    • Accessibility — the VoiceOver gauge summary.
//    • View — every render state (loading / empty / error / stale / offline / content) materializes.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryHeroGaugesSource`); the view tests render through `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: SI converters + formatting (web parity)

@MainActor final class HeroGaugesFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(HeroGaugesFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(HeroGaugesFormat.number(1234.567, decimals: 2), "1,234.57")
        XCTAssertEqual(HeroGaugesFormat.number(0, decimals: 0), "0")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(HeroGaugesFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(HeroGaugesFormat.number(2.5, decimals: 0), "3")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.nan), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(HeroGaugesFormat.safeNumber(42.5), 42.5)
    }

    func testMathRoundHalfUpTowardPositiveInfinity() {
        XCTAssertEqual(HeroGaugesFormat.mathRound(2.5), 3)
        XCTAssertEqual(HeroGaugesFormat.mathRound(2.4), 2)
        XCTAssertEqual(HeroGaugesFormat.mathRound(0.5), 1)
        XCTAssertEqual(HeroGaugesFormat.mathRound(36.999), 37)
        XCTAssertEqual(HeroGaugesFormat.mathRound(.nan), 0)
    }

    func testConvertDistanceFromSI() {
        XCTAssertEqual(HeroGaugesFormat.convertDistanceFromSI(1000, to: .km), 1.0, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.convertDistanceFromSI(1609.344, to: .mi), 1.0, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.convertDistanceFromSI(1, to: .ft), 1.0 / 0.3048, accuracy: 1e-9)
    }

    func testConvertSpeedFromSI() {
        XCTAssertEqual(HeroGaugesFormat.convertSpeedFromSI(10, to: .kmh), 36.0, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.convertSpeedFromSI(10, to: .mph), 36000.0 / 1609.344, accuracy: 1e-9)
        // The speed gauge's max bound: convertSpeedFromSI(250, …) — reproduced verbatim from the web.
        XCTAssertEqual(HeroGaugesFormat.convertSpeedFromSI(250, to: .kmh), 900.0, accuracy: 1e-9)
    }

    func testNumberFromFormattedMirrorsNumberOfFmtNumber() {
        // Small values round-trip through the en-US formatter to a parseable double.
        XCTAssertEqual(HeroGaugesFormat.numberFromFormatted(14.2), 14.2, accuracy: 1e-9)
        XCTAssertEqual(HeroGaugesFormat.numberFromFormatted(9.0), 9.0, accuracy: 1e-9)
        // A grouped (≥ 1000) value stringifies with a comma; JS `Number("1,234.50")` is NaN.
        XCTAssertTrue(HeroGaugesFormat.numberFromFormatted(1234.5).isNaN)
    }
}

// MARK: - Adapter: projector gauge math (web parity)

@MainActor final class HeroGaugesProjectorTests: XCTestCase {
    private func gauge(_ id: String, in projection: HeroGaugesProjection) -> HeroGaugeTileModel? {
        projection.gauges.first { $0.id == id }
    }

    /// 41.84 km / 37 min / 118 km/h / 168 Wh/km / 14.2 %/100.
    private func sample(efficiency: Double? = 14.2) -> DriveGaugeStats {
        DriveGaugeStats(
            distanceM: 41840,
            durationS: 2220,
            maxSpeed: 118,
            consumptionWhKm: 168,
            efficiencyPctPer100: efficiency
        )
    }

    func testGaugeOrderAccentsAndUnitsMetric() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: .metric)
        XCTAssertEqual(projection.gauges.map(\.id), ["distance", "max-speed", "duration", "consumption", "efficiency"])
        XCTAssertEqual(projection.gauges.map(\.accent), [.cyan, .purple, .amber, .red, .green])
        XCTAssertEqual(gauge("distance", in: projection)?.unit, "km")
        XCTAssertEqual(gauge("max-speed", in: projection)?.unit, "km/h")
        XCTAssertEqual(gauge("duration", in: projection)?.unit, "min")
        XCTAssertEqual(gauge("consumption", in: projection)?.unit, "Wh/km")
        XCTAssertEqual(gauge("efficiency", in: projection)?.unit, "%/100km")
    }

    func testGaugeValuesMetric() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: .metric)
        XCTAssertEqual(gauge("distance", in: projection)?.value, "42") // round(41.84)
        XCTAssertEqual(gauge("max-speed", in: projection)?.value, "118")
        XCTAssertEqual(gauge("duration", in: projection)?.value, "37") // 2220 / 60
        XCTAssertEqual(gauge("consumption", in: projection)?.value, "168")
        XCTAssertEqual(gauge("efficiency", in: projection)?.value, "14.20") // 2-decimal global precision
    }

    func testGaugeFillFractionsMatchValueOverMax() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: .metric)
        XCTAssertEqual(gauge("distance", in: projection)?.fraction ?? -1, 42.0 / 100.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("max-speed", in: projection)?.fraction ?? -1, 118.0 / 900.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("duration", in: projection)?.fraction ?? -1, 37.0 / 60.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("consumption", in: projection)?.fraction ?? -1, 168.0 / 300.0, accuracy: 1e-9)
        XCTAssertEqual(gauge("efficiency", in: projection)?.fraction ?? -1, 14.2 / 30.0, accuracy: 1e-9)
    }

    func testImperialConvertsDistanceAndConsumptionAndEfficiencyUnit() {
        let projection = HeroGaugesProjector.project(stats: sample(), units: .imperial)
        // 41840 m / 1609.344 = 25.998… → round → 26 mi
        XCTAssertEqual(gauge("distance", in: projection)?.value, "26")
        XCTAssertEqual(gauge("distance", in: projection)?.unit, "mi")
        // 168 Wh/km * 1.609344 = 270.37 → round → 270 Wh/mi
        XCTAssertEqual(gauge("consumption", in: projection)?.value, "270")
        XCTAssertEqual(gauge("consumption", in: projection)?.unit, "Wh/mi")
        XCTAssertEqual(gauge("max-speed", in: projection)?.unit, "mph")
        XCTAssertEqual(gauge("efficiency", in: projection)?.unit, "%/100mi")
    }

    func testEfficiencyGaugeOmittedWhenNil() {
        let projection = HeroGaugesProjector.project(stats: sample(efficiency: nil), units: .metric)
        XCTAssertEqual(projection.gauges.map(\.id), ["distance", "max-speed", "duration", "consumption"])
        XCTAssertNil(gauge("efficiency", in: projection))
    }

    func testNilDurationFloorsToZeroMinutes() {
        let stats = DriveGaugeStats(distanceM: 1000, durationS: nil, maxSpeed: 0, consumptionWhKm: 0)
        let projection = HeroGaugesProjector.project(stats: stats, units: .metric)
        XCTAssertEqual(gauge("duration", in: projection)?.value, "0")
        XCTAssertEqual(gauge("duration", in: projection)?.fraction ?? -1, 0, accuracy: 1e-9)
    }

    func testNonFiniteInputsCollapseToZero() {
        let bad = DriveGaugeStats(
            distanceM: .nan,
            durationS: .infinity,
            maxSpeed: .nan,
            consumptionWhKm: .nan,
            efficiencyPctPer100: .nan
        )
        let projection = HeroGaugesProjector.project(stats: bad, units: .metric)
        XCTAssertEqual(gauge("distance", in: projection)?.value, "0")
        XCTAssertEqual(gauge("consumption", in: projection)?.value, "0")
        XCTAssertEqual(gauge("consumption", in: projection)?.fraction ?? -1, 0, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class HeroGaugesModelTests: XCTestCase {
    private func makeModel(
        _ update: HeroGaugesUpdate,
        telemetry: HeroGaugesTelemetry = OSLogHeroGaugesTelemetry()
    ) -> (HeroGaugesModel, InMemoryHeroGaugesSource) {
        let source = InMemoryHeroGaugesSource(initial: update)
        let model = HeroGaugesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> DriveGaugeStats {
        DriveGaugeStats(distanceM: 12000, durationS: 900, maxSpeed: 80, consumptionWhKm: 150, efficiencyPctPer100: 12)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(HeroGaugesModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsGauges() {
        let (model, _) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauges.count, 5)
        XCTAssertEqual(model.projection?.gauges.first?.id, "distance")
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(HeroGaugesUpdate(status: .empty, stats: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(HeroGaugesUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(HeroGaugesUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedGaugesStayContentWhileFailing() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        source.push(HeroGaugesUpdate(status: .failed("net"), connection: .offline, stats: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loading))
        model.start()
        source.push(
            HeroGaugesUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                stats: sample(),
                units: .imperial,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.distance, .mi)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loaded, stats: sample()))
        model.start()
        // live → no refresh
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        // stale + idle → refresh
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: false, stats: sample()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
        // stale + fetching → guarded (no extra refresh)
        source.push(HeroGaugesUpdate(status: .loaded, connection: .stale, isFetching: true, stats: sample()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyHeroGaugesTelemetry()
        let (model, source) = makeModel(HeroGaugesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HeroGaugesSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class HeroGaugesAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryGauge() {
        let stats = DriveGaugeStats(
            distanceM: 41840,
            durationS: 2220,
            maxSpeed: 118,
            consumptionWhKm: 168,
            efficiencyPctPer100: 14.2
        )
        let projection = HeroGaugesProjector.project(stats: stats, units: .metric)
        let summary = HeroGaugesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Distance 42 km"))
        XCTAssertTrue(summary.contains("Max Speed 118 km/h"))
        XCTAssertTrue(summary.contains("Duration 37 min"))
        XCTAssertTrue(summary.contains("Consumption 168 Wh/km"))
        XCTAssertTrue(summary.contains("Efficiency 14.20 %/100km"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class HeroGaugesViewStateTests: XCTestCase {
        private func renders(_ update: HeroGaugesUpdate) -> Bool {
            let source = InMemoryHeroGaugesSource(initial: update)
            let model = HeroGaugesModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: HeroGauges(model: model).frame(width: 420, height: 280))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample(efficiency: Double? = 14.2) -> DriveGaugeStats {
            DriveGaugeStats(
                distanceM: 41840,
                durationS: 2220,
                maxSpeed: 118,
                consumptionWhKm: 168,
                efficiencyPctPer100: efficiency
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, stats: sample())))
        }

        func testContentWithoutEfficiencyRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, stats: sample(efficiency: nil))))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .empty, stats: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .stale, stats: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(HeroGaugesUpdate(status: .loaded, connection: .offline, stats: sample())))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyHeroGaugesTelemetry: HeroGaugesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
